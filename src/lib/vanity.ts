/* CREATE2 vanity addresses: what a mined salt actually produces.
 *
 * address = keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode))[12..],
 * and the initcode is the token's creation code followed by its ABI-encoded
 * constructor arguments – so a salt is valid only for the exact
 * (deployer, constructor) pair the factory will use.
 *
 * Spec §12b appended a fifth `router` argument to OpenFairToken, which makes
 * that constructor a property of the factory GENERATION rather than of this
 * build: the same page has to hash 4 arguments against a v2.1 FairTokenDeployer
 * and 5 against v3's. Everything here is pure – the page fetches the creation
 * code and the running backend's config, this module decides what is hashed –
 * so the node tests can re-derive the same address with viem.
 */
import { concat, encodeAbiParameters, getCreate2Address, keccak256 } from 'viem';
// Explicit .ts extension: `node --test` imports this module directly (type
// stripping), and node does not resolve extensionless specifiers.
import { ZERO_ADDRESS } from './createPayload.ts';
import { STATIC_FACTORY_QUOTE_AWARE } from './config.ts';

export type Hex = `0x${string}`;

/** Which token contract a launch mode deploys. */
export type LaunchKind = 'curve' | 'direct';

/** The token constructor exactly as the deployer helper will call it. `router`
 *  null = the pre-§12b four-argument constructor (OpenSimpleToken always;
 *  OpenFairToken on every factory before v3). */
export interface TokenCtor {
  name: string;
  symbol: string;
  totalSupply: bigint;
  /** OpenFairToken: the FairTokenDeployer itself (it holds the supply).
   *  OpenSimpleToken: the factory that ordered the deployment. */
  holder: Hex;
  /** §12b curve-phase transfer exemption: the zap on a quote launch,
   *  address(0) on a native one, null where the argument does not exist. */
  router: Hex | null;
}

const CTOR_4 = [{ type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'address' }] as const;
const CTOR_5 = [...CTOR_4, { type: 'address' }] as const;

/** The constructor tail of the initcode, in the factory's own argument order. */
export function encodeTokenCtorArgs(c: TokenCtor): Hex {
  return c.router === null
    ? encodeAbiParameters(CTOR_4, [c.name, c.symbol, c.totalSupply, c.holder])
    : encodeAbiParameters(CTOR_5, [c.name, c.symbol, c.totalSupply, c.holder, c.router]);
}

/** The argument types this plan will append to the creation code. */
export const ctorTypesOf = (c: TokenCtor): string[] =>
  (c.router === null ? CTOR_4 : CTOR_5).map((t) => t.type);

/** GET /api/bytecode/:name. `ctorTypes` is the constructor the served bytes
 *  were COMPILED with – absent on a backend from before this shipped. */
export interface ServedCreationCode {
  bytecode?: string;
  ctorTypes?: string[];
  /** Fully-qualified source path, e.g. "src/stable/OpenFairToken.sol". */
  source?: string;
  lineage?: string;
}

/**
 * Do the bytes and the shape disagree?
 *
 * The init code is the creation code FOLLOWED BY the encoded constructor
 * arguments, and the two halves have always come from different places: the
 * bytes from the backend, the shape worked out here from the factory's
 * generation. On Arc they disagreed for a day – the backend served the SHARED
 * lineage's OpenFairToken (five arguments since §12b) while the chain's own
 * FairTokenDeployer deploys the stable one (four) – and every salt mined
 * against it bought an address the factory could never produce.
 *
 * So the two halves are now compared before a single hash is taken. A backend
 * that does not publish `ctorTypes` yet says nothing either way and cannot
 * refuse anything (`false`); one that does is the artifact speaking for itself.
 */
export function servedShapeMismatch(c: TokenCtor, served: ServedCreationCode | null | undefined): boolean {
  const types = served?.ctorTypes;
  if (!Array.isArray(types) || types.length === 0) return false;
  const want = ctorTypesOf(c);
  return types.length !== want.length || types.some((t, i) => t !== want[i]);
}

/** keccak256 of creation code ++ constructor arguments – what the workers race
 *  salts against. */
export function tokenInitCodeHash(creationCode: Hex, c: TokenCtor): Hex {
  return keccak256(concat([creationCode, encodeTokenCtorArgs(c)]));
}

/** The address `salt` produces at `deployer`. The page checks every worker hit
 *  against this before it offers the salt. */
export function predictTokenAddress(a: {
  creationCode: Hex; ctor: TokenCtor; deployer: Hex; salt: Hex;
}): Hex {
  return getCreate2Address({
    from: a.deployer, salt: a.salt, bytecodeHash: tokenInitCodeHash(a.creationCode, a.ctor),
  });
}

/** The fields of GET /api/v1/config this module reads. Structural, so the full
 *  V1Config passes without importing it. */
export interface VanityConfig {
  contracts: {
    launchFactory: string;
    factoryVersion?: string;
    fairTokenDeployer: string;
    simpleTokenDeployer: string;
    zap?: string | null;
  };
  features?: { quotePairs?: boolean };
}

const isAddress = (a: string | null | undefined): a is Hex => /^0x[0-9a-fA-F]{40}$/.test(a ?? '');
const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();

/** Does the reported factory speak §12b (five constructor arguments)? v3 is the
 *  first generation that does; quotePairs is only ever on for a v3 factory, so
 *  it answers for a backend that publishes the flag but not the version. */
export function isQuoteAwareFactory(cfg: VanityConfig): boolean {
  const major = Number.parseInt(String(cfg.contracts.factoryVersion ?? '').split('.')[0], 10);
  return (Number.isFinite(major) && major >= 3) || cfg.features?.quotePairs === true;
}

/** Constructor shape of the generation the build-time ADDR table (lib/config.ts)
 *  of THIS build's chain points at. It is the fallback used when the API cannot
 *  be reached, so repointing one of those tables at a quote-aware factory means
 *  flipping this with it – which is why it is not a literal here but the one
 *  flag that travels with the table itself: Robinhood is on the v3 factory
 *  since 2026-09-10 (five constructor arguments), Stable and Arc are still
 *  pre-§12b (four). A build targets exactly one chain, so this is one boolean. */
export const STATIC_TABLE_QUOTE_AWARE: boolean = STATIC_FACTORY_QUOTE_AWARE;

/** The token address a simulated create says the factory WILL deploy. Both
 *  entry points return the token FIRST – createLaunch (token, launch,
 *  harvester), createDirectListing (token, harvester, pool) – and viem decodes
 *  an unnamed multi-return as a tuple. */
export function simulatedTokenAddress(result: unknown): Hex | null {
  const first = Array.isArray(result) ? result[0] : result;
  return typeof first === 'string' && isAddress(first) ? first : null;
}

/**
 * Must this create be abandoned instead of signed? The creation code and the
 * deployer under a mined salt are taken on trust from the backend; the
 * simulation is the factory itself naming the address it will deploy, so a
 * drift (another creation code, a misreported generation) surfaces here – the
 * last moment before the vanity fee buys an unrelated address.
 *
 * No salt: nothing was paid for and nothing is checked. A salt whose address
 * the simulation does not confirm – unreadable result included – is a
 * mismatch, never a silent pass.
 */
export function vanityMismatch(simulated: unknown, salt: Hex | null, mined: string | null): boolean {
  if (salt === null) return false;
  return !sameAddress(simulatedTokenAddress(simulated), mined);
}

export type VanityPlan =
  | { ok: true; contract: 'OpenFairToken' | 'OpenSimpleToken'; deployer: Hex; ctor: TokenCtor }
  /** The shape could not be determined – no salt may be offered. */
  | { ok: false; reason: 'shapeUnknown' };

/**
 * What to hash, and where. Fails instead of guessing: a salt mined against the
 * wrong generation is an address the factory never produces, paid for in full.
 */
export function planVanityMine(i: {
  kind: LaunchKind;
  /** The factory the create is actually sent to. */
  factory: string;
  quoteSelected: boolean;
  /** GET /api/v1/config, or null when it could not be read. */
  cfg: VanityConfig | null;
  fallback: { fairTokenDeployer: string; simpleTokenDeployer: string; quoteAware?: boolean };
  token: { name: string; symbol: string; totalSupply: bigint };
}): VanityPlan {
  const fail = { ok: false, reason: 'shapeUnknown' } as const;
  const factory = i.factory;
  if (!isAddress(factory)) return fail;
  // The backend describes ONE generation: the factory NEW launches go to. That
  // may not be the factory this create is sent to – after a v3 rollout the API
  // reports v3 while the build-time table still sends every native launch to
  // v2.1 – so its addresses only answer for the factory it names.
  const cfg = i.cfg !== null && sameAddress(i.cfg.contracts.launchFactory, factory) ? i.cfg : null;
  // A quote launch exists only on the reported factory; without a config that
  // confirms it, both the deployer and the router are guesses.
  if (i.quoteSelected && !cfg) return fail;

  if (i.kind === 'direct') {
    // OpenSimpleToken never took the §12b argument, and its holder is the
    // factory itself (LaunchFactory passes address(this)).
    const deployer = cfg ? cfg.contracts.simpleTokenDeployer : i.fallback.simpleTokenDeployer;
    if (!isAddress(deployer)) return fail;
    return { ok: true, contract: 'OpenSimpleToken', deployer, ctor: { ...i.token, holder: factory, router: null } };
  }

  const deployer = cfg ? cfg.contracts.fairTokenDeployer : i.fallback.fairTokenDeployer;
  if (!isAddress(deployer)) return fail;
  const quoteAware = cfg ? isQuoteAwareFactory(cfg) : (i.fallback.quoteAware ?? STATIC_TABLE_QUOTE_AWARE);
  let router: Hex | null = null;
  if (quoteAware) {
    const zap = cfg?.contracts.zap ?? null;
    // Exactly what LaunchFactory passes: `quoteMode ? zapRouter : address(0)`.
    if (!i.quoteSelected) router = ZERO_ADDRESS;
    else if (isAddress(zap)) router = zap;
    // A quote-aware factory whose zap the backend does not publish: nothing
    // here names the router it would pass, so no salt is offered.
    else return fail;
  }
  // The FairTokenDeployer mints the supply to itself, so holder = deployer.
  return { ok: true, contract: 'OpenFairToken', deployer, ctor: { ...i.token, holder: deployer, router } };
}
