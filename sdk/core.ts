// openfair SDK core – headless token creation for third-party sites.
// Everything that matters is enforced by the on-chain contracts (fees,
// referral, LP lock); this library only makes calling them convenient:
// quotes, simulation, a staged launch pipeline with progress events,
// metadata pinning, curve math, token/referral registries and
// human-readable errors. v1.4.0 – see docs/SDK_CHANGELOG.md.
import {
  createPublicClient, createWalletClient, custom, http, fallback, defineChain,
  parseEther, parseUnits, formatUnits, parseEventLogs, parseAbi, BaseError, ContractFunctionRevertedError,
  type Address, type WalletClient, type PublicClient,
} from 'viem';
import { CHAIN, ADDR, POOL_FEE_TIER, SUPPORTER_SHARE_BPS } from '../src/lib/config';
import { NETWORKS as REGISTRY } from '../src/content/networks.mjs';
import { factoryAbi, factoryQuoteAbi, erc20Abi, zapAbi, quoterAbi } from '../src/lib/abi';
// The CREATE2 rules the site mines by – ONE module, so the SDK and the wizard
// can never disagree about what a salt produces.
import {
  isQuoteAwareFactory, planVanityMine, predictTokenAddress, servedShapeMismatch, vanityMismatch, type ServedCreationCode,
} from '../src/lib/vanity';
// Generation 3 – the enforced fee split (FEE_SPLIT_DESIGN, option B). The ABIs,
// the gate and the arithmetic are the SITE's own modules, imported rather than
// retyped: the SDK and the create wizard can then never disagree about what a
// split encodes to, which factory takes it or which splits are refused. None of
// this reaches lib/abi.ts – tests/fee-split-create.test.mjs pins that the
// generation-3 surface enters sdk/ through these two modules only.
import { factoryG3Abi, factoryQuoteG3Abi, feeSplitSetEventAbi } from '../src/lib/factoryG3Abi';
import {
  BPS, ZERO_FEE_SPLIT, g3LaunchFactoryFor, holdersLegOn, isDefaultFeeSplit, validateFeeSplit,
  type FeeSplitArg, type FeeSplitConfigLike,
} from '../src/lib/feeSplit';
// The argument lists of both generations, from the builder the wizard signs
// with – `null` split = the generation-2 list, byte for byte.
import { launchArgs, listingArgs } from '../src/lib/createPayload';

export type { FeeSplitArg } from '../src/lib/feeSplit';

export const SDK_VERSION = '1.4.1';

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const ZERO_SALT = ('0x' + '0'.repeat(64)) as `0x${string}`;
/** The vanity salt a create carries, or null for none. Anything but the zero
 *  salt counts – a malformed one included, so it is checked, never waved
 *  through. The token's CREATE2 address depends on the factory it is sent to,
 *  so a create that carries one may not change factories silently (1.4.0). */
function vanitySaltOf(s: unknown): `0x${string}` | null {
  return typeof s === 'string' && !/^0x0*$/i.test(s) ? s as `0x${string}` : null;
}
/** A manifest address slot, or null. CHAIN_MANIFESTS is exported and mutable,
 *  so a caller may register a manifest written against the 1.3.x
 *  ChainManifest, which has no generation-3 keys at all: an ABSENT slot
 *  (undefined) must read exactly like null – "not on this chain" – and never
 *  reach `.toLowerCase()` or a contract read. */
function slot(a: Address | null | undefined): Address | null {
  return typeof a === 'string' && a.length > 0 ? a : null;
}

// The creation events, one ABI per params SHAPE. The params struct is emitted
// whole inside each event, so every shape has its own topic0 and a decoder only
// ever matches the shape it was written for – which is how 1.3.x lost the token
// of every native fair launch: it decoded with the 21-field tuple below, which
// no factory the manifests name has emitted since the vanity fields landed.
//
//  - quote-aware (the shared lineage's v3 factory and its generation 3 – 4663):
//    24-field LaunchCreated, 13-field DirectListingCreated, for NATIVE launches
//    too (the quote fields are there, holding zero);
//  - pre-quote (the stable lineage – Arc 5042, Stable 988 – in both
//    generations): 23-field LaunchCreated, 11-field DirectListingCreated;
//  - legacy: the 21-field LaunchCreated of the factories before vanity salts,
//    kept as the last resort so nothing that decoded before stops decoding.
//
// Generation 3 moved only the function SELECTORS (the split is a separate
// argument, FEE_SPLIT_DESIGN D15), so these topics are the same in both
// generations. tests/sdk-create-shapes.test.mjs holds each one against the
// deployed factories' own frozen ABIs.
const quoteCreatedAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256,bytes32,uint256,address) params)',
  'event DirectListingCreated(address indexed creator, address indexed token, address harvester, address pool, uint256 liquidityEth, uint256 poolTokens, string metadataCID, (string,string,uint256,uint16,address,uint24,uint256,bytes32,uint256,uint16,address,address,uint256) params)',
]);
const plainCreatedAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256,bytes32,uint256) params)',
  'event DirectListingCreated(address indexed creator, address indexed token, address harvester, address pool, uint256 liquidityEth, uint256 poolTokens, string metadataCID, (string,string,uint256,uint16,address,uint24,uint256,bytes32,uint256,uint16,address) params)',
]);
const launchCreatedAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256) params)',
]);
const createdEventAbi = [...quoteCreatedAbi, ...plainCreatedAbi, ...launchCreatedAbi] as const;
const launchAbi = parseAbi([
  'function feesAccrued(address) view returns (uint256)',
  'function claimFees(address account)',
  // Curve pricing + pair identity, for the coin-payment helpers (spec §10).
  'function quoteBuy(uint256 ethAmount) view returns (uint256)',
  'function quoteSell(uint256 tokensIn) view returns (uint256)',
  'function quote() view returns (address)',
  'function isNative() view returns (bool)',
  // The factory that made the launch – OpenZap refuses (UnknownLaunch) any
  // launch its own factory did not make, so this picks the zap (1.4.0).
  'function factory() view returns (address)',
]);

// What `contracts.info()` hands out: the create entry points of the factory's
// OWN shape, plus the views and knobs every generation and lineage shares
// (deployFee, supporterFeeBps, updateMetadata – present on the deployed
// generation-2 factories of both lineages and on both generation-3 builds).
// Handing out `factoryAbi` everywhere was the quote() bug over again: the live
// v3 factory on 4663 has no pre-quote createLaunch / createDirectListing, so an
// integrator encoding with it got a selector that reverts. The quote-aware and
// generation-3 ABIs name only their own create shape, so each is completed
// with the shared views rather than merged with `factoryAbi` (which would put
// the pre-quote overloads back in).
const factoryViewsAbi = parseAbi([
  'function deployFee() view returns (uint256)',
  'function supporterFeeBps() view returns (uint16)',
  'function updateMetadata(address token, string metadataCID)',
]);
const factoryInfoAbis = {
  /** generation 2, pre-quote (the stable lineage – Arc, Stable): 1.3.x's answer. */
  g2Plain: factoryAbi,
  /** generation 2, quote-aware (the shared lineage's v3 factory – 4663). */
  g2Quote: [...factoryQuoteAbi, ...factoryViewsAbi] as const,
  /** generation 3, stable lineage. */
  g3Plain: [...factoryG3Abi, ...factoryViewsAbi] as const,
  /** generation 3, shared lineage. */
  g3Quote: [...factoryQuoteG3Abi, ...factoryViewsAbi] as const,
};
/** The ABI `contracts.info()` returns: one of the four factory shapes. */
export type FactoryInfoAbi = typeof factoryInfoAbis[keyof typeof factoryInfoAbis];

// ---------------------------------------------------------------------------
// Chain manifest (versioned): every deployment the SDK can target.
// Robinhood Chain only for now; the structure is multichain-ready and new
// chains ship by adding a manifest here.
// ---------------------------------------------------------------------------
export interface ChainManifest {
  chainId: number; hexId: string; name: string; testnet: boolean;
  rpcUrls: string[]; explorer: string;
  currency: { name: string; symbol: string; decimals: number };
  factoryVersion: string;
  /**
   * `registry` is the chain's QuoteRegistry – the allow-list of ERC-20 assets a
   * launch may be priced in instead of the native coin. `null` = this chain has
   * no quote pairs and every launch on it is native. It also decides which
   * factory shape applies: a manifest with a registry carries the factory that
   * accepts the quote fields, so the two always travel together.
   *
   * `zap` is OpenZap – the contract that lets a buyer pay the chain's coin for
   * a launch that collects an ERC-20 (spec §10). `null` = not deployed on this
   * chain, and `buyWithEth` / `sellForEth` refuse instead of guessing an
   * address; a paired launch is then traded in its own asset, as before.
   *
   * GENERATION 3 (1.4.0, the enforced fee split) arrives in ADDITIVE fields –
   * `factory` and `zap` keep their generation-2 meaning for ever, because
   * pinned bundles and third-party integrations encode against them:
   *  - `factoryG3`: the LaunchFactory whose create entry points take the
   *    FeeSplit argument. A create goes there only when the caller opts in
   *    (`feeSplit` / `generation: 3`) AND the chain's running backend says so
   *    (GET /api/v1/config `features.storefrontG3`, naming this exact address).
   *  - `crowdFactoryG3`: the generation-3 CrowdFactory, for reference – the SDK
   *    does not create crowd raises.
   *  - `zapG3`: the OpenZap the generation-3 factory was built with. A zap only
   *    serves launches of its own factory, so the zap is chosen per launch.
   * `null` = no generation 3 on this chain. A manifest a caller registers in
   * CHAIN_MANIFESTS without these three keys (written against 1.3.x) reads
   * exactly as if they were null.
   */
  contracts: {
    factory: Address; simpleTokenDeployer: Address; fairTokenDeployer: Address; weth: Address;
    registry: Address | null; zap: Address | null;
    factoryG3: Address | null; crowdFactoryG3: Address | null; zapG3: Address | null;
  };
  /**
   * Which contract sources the chain runs: 'shared' (contracts/src – Robinhood
   * 4663, whose v3 factory carries the quote fields in both params structs) or
   * 'stable' (contracts/src/stable – Arc 5042, Stable 988, no quote fields).
   * Decides the struct shape of the generation-3 entry points.
   */
  lineage: 'shared' | 'stable';
  dexSwapUrl: ((token: string) => string) | null;
  /**
   * Per-chain economics. The SDK can target ANY manifest, so these must come
   * from the manifest and not from the chain this bundle happened to be built
   * for – otherwise an Arc launch prepared through the SDK carried Robinhood's
   * 5-unit curve target while the site used 10000.
   */
  economics: { deployFee: number; target: number; startFdv: number };
}

// Built from THE network registry (src/content/networks.mjs): EVERY network
// openfair supports is a manifest here, so `new Openfair({ chainId })` can
// target any of them – not just the chain this bundle was built for. Adding a
// chain to the registry adds it to the SDK automatically.
export const CHAIN_MANIFESTS: Record<number, ChainManifest> = Object.fromEntries(
  REGISTRY.map((n) => [n.chainId, {
    chainId: n.chainId, hexId: n.hexId, name: n.name, testnet: n.testnet,
    rpcUrls: [n.rpcUrl], explorer: n.explorer, currency: n.currency,
    factoryVersion: n.factoryVersion,
    contracts: {
      factory: n.contracts.factory as Address,
      simpleTokenDeployer: n.contracts.simpleTokenDeployer as Address,
      fairTokenDeployer: n.contracts.fairTokenDeployer as Address,
      weth: n.contracts.weth as Address,
      registry: (n.contracts.registry as Address | null) ?? null,
      zap: (n.contracts.zap as Address | null) ?? null,
      // Additive generation-3 keys (option B) – read by name, never folded
      // into the generation-2 slots above.
      factoryG3: (n.contracts.launchFactoryG3 as Address | null | undefined) ?? null,
      crowdFactoryG3: (n.contracts.crowdFactoryG3 as Address | null | undefined) ?? null,
      zapG3: (n.contracts.zapG3 as Address | null | undefined) ?? null,
    },
    lineage: n.lineage === 'stable' ? 'stable' : 'shared',
    dexSwapUrl: (token: string) => `${n.dexSwapUrl}${token}`,
    economics: {
      deployFee: n.economics.deployFee,
      target: n.economics.target,
      startFdv: n.economics.startFdv,
    },
  }]),
);

function chainFromManifest(m: ChainManifest) {
  return defineChain({
    id: m.chainId, name: m.name, nativeCurrency: m.currency,
    rpcUrls: { default: { http: m.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: m.explorer } },
  });
}

/** Back-compat export: the default (Robinhood Chain) viem chain. */
export const chain = chainFromManifest(CHAIN_MANIFESTS[CHAIN.id]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
// 'approving' only ever occurs on a quote-paired launch, where the factory
// pulls an ERC-20 and therefore needs an allowance before the create itself.
export type LaunchStage =
  | 'validating' | 'preparing_metadata' | 'quoting' | 'approving' | 'simulating'
  | 'awaiting_wallet' | 'transaction_submitted' | 'confirming'
  | 'indexing' | 'completed' | 'failed';

export class OpenfairError extends Error {
  code: string;
  stage: LaunchStage | 'setup';
  retriable: boolean;
  transactionHash?: `0x${string}`;
  contractReason?: string;
  suggestedAction?: string;
  cause?: unknown;
  constructor(code: string, message: string, extra: Partial<Pick<OpenfairError,
    'stage' | 'retriable' | 'transactionHash' | 'contractReason' | 'suggestedAction' | 'cause'>> = {}) {
    super(message);
    this.code = code;
    this.stage = extra.stage ?? 'setup';
    this.retriable = extra.retriable ?? false;
    this.transactionHash = extra.transactionHash;
    this.contractReason = extra.contractReason;
    this.suggestedAction = extra.suggestedAction;
    this.cause = extra.cause;
  }
}

function explainRevert(e: unknown, stage: LaunchStage = 'simulating'): OpenfairError {
  if (e instanceof OpenfairError) return e;
  if (e instanceof BaseError) {
    const rev = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) {
      const name = rev.data.errorName;
      const msgs: Record<string, [string, string]> = {
        WrongPayment: ['sent value does not match the required fee', 'refresh fees via quote() and retry'],
        VanityNotAllowed: ['vanity addresses require a platform share of at least 15%', 'raise platformShareBps or drop the salt'],
        SelfReferral: ['the referrer cannot be the creator or the fee recipient', 'omit the referrer for self-launches'],
        BadConfig: ['invalid launch parameters', 'check supply/fees/curve inputs'],
        EthSendFailed: ['native transfer inside the contract failed', 'retry'],
        PoolSquatted: ['a mispriced pool already exists for this token/WETH pair', 'retry – a different token address avoids the squatted pool'],
        QuoteNotAllowed: ['this asset is not on the registry allow-list', 'call quotes.list() for the assets a launch may be paired with'],
        QuoteTransferMismatch: ['the quote asset moved a different amount than requested (transfer fee or issuer rule)', 'this asset cannot be used as a pair'],
        QuoteFrozen: ['the issuer has paused the quote asset or blocked this launch', 'wait – trading resumes by itself once the issuer lifts it'],
        QuoteNotAccepted: ['this launch is native: it takes the chain coin, not an ERC-20', 'drop `quote` / use buy()'],
        NativeNotAccepted: ['this launch is paired with an ERC-20: it takes no native value', 'send the quote amount instead of msg.value'],
        // OpenZap (spec §10) AND the native curve: OpenLaunch reverts this too
        // when buy()/sell() miss their floor, so the wording must be true with
        // no swap in the picture. On the ETH route it is usually the pool leg.
        Slippage: ['the trade returned less than the floor the call was signed with – on the ETH route this is usually the pool leg', 'raise the slippage tolerance or re-quote'],
        NothingReceived: ['a leg of the route delivered nothing', 're-quote – the pool may have no liquidity at this size'],
        BadFee: ['the pool fee tier is not one of 500 / 3000 / 10000', 'take poolFee from zapQuote()'],
        Expired: ['the deadline passed before the transaction was mined', 'retry with a fresh quote'],
        NotQuoteLaunch: ['this launch collects the chain coin – it needs no zap', 'buy it directly'],
        // OpenZap serves the launches of ONE factory: since generation 3 a chain
        // has two zaps, and the other generation's refuses with this.
        UnknownLaunch: ['the zap does not serve this launch – it is not a launch of the zap\'s own factory (usually the other generation\'s zap)', 'let the SDK pick the zap: call zapQuote() / buyWithEth() / sellForEth() without a hand-built quote'],
        TokenNotConsumed: ['the curve did not take the whole amount offered', 'lower the amount – the curve is close to its target'],
        // Generation 3: the fee split (LaunchFactory._validateSplit). The SDK
        // refuses all three before a signature (BadInput); these are what the
        // factory says if a split reaches it anyway.
        BadSplit: ['the fee split is not one the factory accepts (a side over 100 % or a share under 1 %)', 'check feeSplit: platformShareBps + holdersBps + buybackBps <= 10000, every non-zero share >= 100 bps'],
        BuybackUnavailable: ['the buy-back leg is not live on this chain', 'set feeSplit.buybackBps to 0'],
        HoldersUnavailable: ['the holders\' leg is not live on this chain', 'set feeSplit.holdersBps and tokenHoldersBps to 0'],
      };
      const [msg, action] = msgs[name] ?? [`contract reverted: ${name}`, 'check the parameters'];
      return new OpenfairError('SimulationFailed', msg, { stage, contractReason: name, suggestedAction: action, cause: e, retriable: name === 'WrongPayment' || name === 'EthSendFailed' });
    }
    if (/user (rejected|denied)|4001/i.test(e.message)) {
      return new OpenfairError('UserRejected', 'the user rejected the transaction in the wallet', { stage: 'awaiting_wallet', retriable: true, cause: e });
    }
    if (/insufficient funds/i.test(e.message)) {
      return new OpenfairError('InsufficientFunds', 'wallet balance too low for fee + gas', { stage, retriable: false, cause: e, suggestedAction: 'top up the wallet' });
    }
    if (/request limit|rate limit|429/i.test(e.message)) {
      return new OpenfairError('RpcRateLimited', 'the RPC endpoint rate-limited the request', { stage, retriable: true, cause: e, suggestedAction: 'wait a few seconds and retry, or pass your own rpcUrls' });
    }
    if (/timeout|timed out/i.test(e.message)) {
      return new OpenfairError('RpcTimeout', 'the RPC endpoint timed out', { stage, retriable: true, cause: e, suggestedAction: 'retry, or pass fallback rpcUrls' });
    }
    if (/fetch|network|failed to fetch/i.test(e.message)) {
      return new OpenfairError('NetworkUnavailable', 'network request failed', { stage, retriable: true, cause: e });
    }
    return new OpenfairError('TxError', e.shortMessage, { stage, cause: e });
  }
  const m = (e as Error)?.message ?? 'unknown error';
  if (/user (rejected|denied)|4001/i.test(m)) return new OpenfairError('UserRejected', 'the user rejected the request in the wallet', { stage: 'awaiting_wallet', retriable: true, cause: e });
  if (/abort/i.test(m)) return new OpenfairError('Aborted', 'the operation was aborted', { stage, retriable: true, cause: e });
  return new OpenfairError('Error', m.split('\n')[0], { stage, cause: e });
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface OpenfairOptions {
  /** Wallet that receives the on-chain referral share of every launch made
   * through this integration. Optional but the point of the exercise. */
  referrer?: string;
  /** EIP-1193 provider; defaults to window.ethereum. Pass a WalletConnect v2
   * or Coinbase Wallet provider here – the SDK treats them identically. */
  provider?: Eip1193;
  /** openfair origin for metadata pinning + links. */
  apiBase?: string;
  /** Target chain (Robinhood Chain 4663 – the only supported network). */
  chainId?: number;
  /** Override / extend RPC endpoints; more than one enables fallback. */
  rpcUrls?: string[];
  /** Per-request RPC timeout, ms (default 10000). */
  rpcTimeoutMs?: number;
  /** Don't switch the wallet's network automatically on connect(). */
  autoSwitchChain?: boolean;
  /** Privacy-safe observability hook (no addresses are ever passed). Off unless provided. */
  onEvent?: (e: { name: string; correlationId?: string; stage?: string; ms?: number }) => void;
}

export type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (arg: unknown) => void) => void;
  removeListener?: (event: string, cb: (arg: unknown) => void) => void;
};

export interface SocialLinks { website?: string; twitter?: string; telegram?: string; discord?: string }

/**
 * One allow-listed quote asset, as GET /api/v1/quotes reports it. Every *Wei
 * field is in the asset's OWN base units and comes from the registry's USD
 * anchor read at request time – so a launch paired with this asset costs
 * `deployFeeWei` to create and graduates at `targetWei`, not at the chain's
 * native figures. They are `null` exactly when the asset's price feed is stale
 * or unreadable, which is also when a creation paired with it would revert.
 */
export interface QuoteAsset {
  address: Address;
  symbol: string | null;
  /** v1 registry enforces 18; the field exists because the ABI carries it. */
  decimals: number;
  feed: Address | null;
  enabled: boolean;
  priceUsd: number | null;
  /** Unix seconds of the feed's last answer; null when it could not be read. */
  updatedAt: number | null;
  /** Equity feeds run 24/5: stale means older than the registry's MAX_PRICE_AGE. */
  stale: boolean;
  deployFeeWei: bigint | null;
  targetWei: bigint | null;
  startFdvWei: bigint | null;
}

/** The three real on-chain anti-snipe knobs (presets are sugar over these). */
export interface AntiSnipeCustom {
  /** Seconds for the global ramp to release the full sale (0 = off). */
  rampSeconds?: number;
  /** Per-wallet cap growth: reach `walletCapPct` % of supply over `walletCapWindowBlocks` Ethereum blocks (12s each). 0 = off. */
  walletCapPct?: number;
  walletCapWindowBlocks?: number;
}

/**
 * Generation 3 – the enforced fee split (1.4.0). Both fields are OPT-IN: a
 * config with neither is created exactly as in 1.3.x, on the generation-2
 * factory, without the SDK reading anything new.
 *
 * With either one set, the create goes to the generation-3 factory
 * (`manifest.contracts.factoryG3`) only while the chain's running backend
 * serves it – GET /api/v1/config `features.storefrontG3`, naming that same
 * address. Otherwise it stays on generation 2, which is only possible for a
 * split that routes nothing: a split with a holders' share needs generation 3
 * AND both `features.feeSplit` and `features.holdersPublisher`, and without
 * them it is refused (BadInput – or NetworkUnavailable, retriable, while the
 * config cannot be reached at all) rather than silently dropped.
 * `LaunchQuote.generation` says which one it is.
 */
export interface FeeSplitOptions {
  /**
   * Where the LP fee goes, as the factory enforces it (FEE_SPLIT_DESIGN D1):
   *  - `holdersBps` – bps of the WHOLE quote side to the holders' vault;
   *  - `buybackBps` – bps of the quote side to buy-back-and-burn. Must be 0:
   *    the leg is not live on any chain yet;
   *  - `tokenHoldersBps` – bps of the WHOLE token side to the holders' vault
   *    instead of the burn.
   * The creator keeps the rest of the quote side: 10000 - platformShareBps -
   * holdersBps - buybackBps. All three fields are required integers 0..10000;
   * any non-zero one is at least 100 (1 %).
   */
  feeSplit?: FeeSplitArg;
  /** 3 = ask for generation 3 (with the default split {0,0,0} unless
   *  `feeSplit` says otherwise); it is granted only where the chain serves it,
   *  and `LaunchQuote.generation` reports the answer. 2 = the generation-2
   *  factory, which takes no split – a non-default `feeSplit` beside it is
   *  refused. Omitted = 3 when a `feeSplit` is given, else 2. */
  generation?: 2 | 3;
}

export interface InstantParams extends SocialLinks, FeeSplitOptions {
  name: string;
  symbol: string;
  /**
   * Pair the launch with an allow-listed ERC-20 (address from `quotes.list()`)
   * instead of the chain's native coin. Omitted / undefined = native, which is
   * every launch this SDK made before 1.3.0 and stays byte-identical. In quote
   * mode the transaction carries NO value: `seedEth`, `devBuyEth` and
   * `vanityFeeWei` are amounts of the pair asset, the factory pulls them with
   * transferFrom, and the fee/target/start FDV come from the registry.
   */
  quote?: string;
  /** Whole tokens, default 1_000_000_000. */
  totalSupply?: number;
  description?: string;
  /** data: URL of the logo (use Openfair.prepareLogo to downscale a File). */
  logoDataUrl?: string | null;
  /** % of supply into the pool (1–100, default 100). */
  poolPct?: number;
  /** Native amount to seed the pool with (default 0 = token-only listing). */
  seedEth?: number;
  /** Share of LP fees left to the platform, bps. >=5000 = Supporter perks. */
  platformShareBps?: number;
  feeRecipient?: string;
  /** CREATE2 vanity salt (mine it yourself or on openfair.app/create). */
  salt?: `0x${string}`;
  /** Vanity fee in wei, per the published tier table. */
  vanityFeeWei?: bigint;
  /** Extra metadata fields, pinned alongside the standard ones. */
  extraMetadata?: Record<string, unknown>;
}

export interface FairLaunchParams extends SocialLinks, FeeSplitOptions {
  name: string;
  symbol: string;
  /** Pair with an allow-listed ERC-20 – see InstantParams.quote. */
  quote?: string;
  totalSupply?: number;
  description?: string;
  logoDataUrl?: string | null;
  /** 0 classic · 1 linear · 2 exponential (default 0). */
  curveType?: 0 | 1 | 2;
  buyFeePct?: number;   // default 1
  sellFeePct?: number;  // default 1
  /** Preset or the raw on-chain knobs (default 'normal' – seal-worthy). */
  antiSnipe?: 'standard' | 'normal' | 'hardcore' | AntiSnipeCustom;
  platformShareBps?: number;
  feeRecipient?: string;
  /** Unix seconds; 0/undefined = trading opens immediately. */
  startTime?: number;
  sellsEnabled?: boolean; // default true
  /** Team allocation: % of supply (≤20) locked in immutable linear vesting. */
  teamPct?: number;
  teamMonths?: number;      // default 6
  teamBeneficiary?: string; // default creator
  /** Creator buy inside the creation tx (forfeits the Fair Launch seal). */
  devBuyEth?: number;
  salt?: `0x${string}`;
  vanityFeeWei?: bigint;
  extraMetadata?: Record<string, unknown>;
}

export type LaunchConfig = ({ mode: 'instant' } & InstantParams) | ({ mode: 'fair' } & FairLaunchParams);

/** Where a create goes: the factory it is sent to and the split it carries. */
export interface LaunchTarget {
  /** 3 = the fee-split generation (`manifest.contracts.factoryG3`), 2 = the
   *  generation-2 factory (`manifest.contracts.factory`). */
  generation: 2 | 3;
  factory: Address;
  /** The split signed with the create – normalised, validated. Always set on
   *  generation 3 ({0,0,0} by default), always null on generation 2. */
  feeSplit: FeeSplitArg | null;
}

export interface LaunchQuote {
  mode: 'instant' | 'fair';
  chainId: number;
  /** The factory the create is SENT to – the generation-3 one when
   *  `generation` is 3. Approvals, fees and the receipt all follow it. */
  factory: Address;
  generation: 2 | 3;
  /** The enforced split this create carries (generation 3), null on generation 2. */
  feeSplit: FeeSplitArg | null;
  /**
   * The asset this launch is priced in – null = the chain's native coin.
   * When it is set, every *Wei figure below except gasEstimateWei is in THAT
   * asset's base units, and requiredValueWei is 0.
   */
  quote: QuoteAsset | null;
  deployFeeWei: bigint;
  supporterDiscountWei: bigint;
  gasEstimateWei: bigint;
  /** msg.value the transaction must carry (fee + seed/dev-buy + vanity). */
  requiredValueWei: bigint;
  /** Quote mode: what the factory pulls with transferFrom (0 when native). */
  requiredQuoteWei: bigint;
  /**
   * What `approve()` grants: requiredQuoteWei plus 1%, because the factory
   * re-reads the price feed when the create lands and a downward tick of the
   * asset inside that window raises what it pulls.
   */
  approveAmountWei: bigint;
  /** Current allowance to the factory; null when no wallet is connected. */
  allowanceWei: bigint | null;
  /** true = call `launch.approve(quote)` before executing (quote mode only). */
  approvalNeeded: boolean;
  /** requiredValueWei + gasEstimateWei. */
  estimatedTotalWei: bigint;
  platformShareBps: number;
  /** Referral share of the platform's take (fixed 50% when a referrer rides). */
  referralShareBps: number;
  expiresAt: number;
  /** Normalized on-chain params – exactly what execute() will send. */
  params: Record<string, unknown>;
  config: LaunchConfig;
}

export interface SimulationResult {
  success: boolean;
  error?: OpenfairError;
  gasEstimate?: bigint;
}

export interface TokenMetadata extends SocialLinks { name: string; description?: string; logoDataUrl?: string | null }

export interface LaunchResult {
  mode: 'instant' | 'fair';
  tokenAddress: Address;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  creator: Address;
  referrer: Address | null;
  poolAddress: Address | null;
  openfairUrl: string;
  explorerUrl: string;
  dexUrl: string | null;
  indexed: boolean;
  metadata: TokenMetadata;
  /** The generation of the factory that created the token. */
  generation: 2 | 3;
  /** Generation 3: the split the chain enforces – read from the create's
   *  FeeSplitSet event, which the factory emits only for a split that routes
   *  something, so {0,0,0} when it is absent. Generation 2: null (the
   *  question did not exist for that factory). */
  feeSplit: FeeSplitArg | null;
  // ---- legacy aliases (v1.0) ----
  token: Address;
  txHash: `0x${string}`;
  uniswapUrl: string | null;
}

/** @deprecated v1.0 name – use LaunchResult. */
export type CreateResult = Pick<LaunchResult, 'token' | 'txHash' | 'openfairUrl' | 'uniswapUrl' | 'explorerUrl'>;

export interface ProgressEvent { stage: LaunchStage; progress: number; correlationId: string; txHash?: `0x${string}` }

/**
 * Curve economics. The `*Eth` names are v1.0 and kept for compatibility: every
 * amount is denominated in the launch's OWN unit, which is `unit` – the chain
 * coin for a native launch, the pair's symbol for a quote-paired one.
 */
export interface FairPreview {
  saleSupply: number;
  priceMultiple: number;
  startPriceEth: number;
  finalPriceEth: number;
  startFdvEth: number;
  graduationFdvEth: number;
  targetEth: number;
  buyExamples: { eth: number; tokens: number; pctOfSale: number; priceImpactPct: number }[];
  /** Ticker every figure above is quoted in. */
  unit: string;
  /** The pair asset, or null when the launch is native. */
  quote: Address | null;
}

export interface TokenListItem {
  address: Address; name: string; symbol: string; mode: 'instant' | 'fair';
  createdAt: number; graduated: boolean; creator: Address; referrer: Address | null;
  logoUrl: string | null; openfairUrl: string; explorerUrl: string;
}

export interface LaunchStatus {
  phase: 'upcoming' | 'curve' | 'readyToGraduate' | 'graduated' | 'instant';
  progress: number;
  ethCollected?: string;
  targetEth?: string;
}

/**
 * A priced ETH route into (or out of) a launch that collects an ERC-20
 * (spec §10). Two legs, each with its own floor: the pool leg is where MEV
 * lives, the curve leg moves with whatever the pool actually delivered.
 * `poolFee` is DISCOVERED per asset – the deepest of the three tiers OpenZap
 * accepts – never configured, because liquidity moves between them.
 */
export interface ZapQuote {
  token: Address;
  launch: Address;
  /**
   * The OpenZap this launch trades through – the one its own factory was built
   * with (`launch.factory()`): the generation-2 zap for a generation-2 launch,
   * `zapG3` for a generation-3 one. The other one reverts UnknownLaunch.
   * Always set on a quote zapQuote() returns; optional because a ZapQuote is
   * also an INPUT (`buyWithEth` / `sellForEth` `{ quote }`), and one built
   * before 1.4.0 has none – the SDK then asks the launch's own `factory()`.
   */
  zap?: Address;
  /** The ERC-20 the curve collects – the middle of the route. */
  quote: Address;
  /** 500 / 3000 / 10000: the only tiers the zap will route through. */
  poolFee: number;
  /** Coin in (buy) or launch tokens in (sell). */
  amountIn: bigint;
  quoteOut: bigint;
  /** Curve tokens for a buy, coin for a sell. */
  amountOut: bigint;
  minQuoteOut: bigint;
  /** Floor for the leg that CONSUMES the pool leg's output, so its haircut
   *  compounds with minQuoteOut's – flooring both at (1-s) reverts Slippage on
   *  a route that behaved inside tolerance. Same rule as the API's minimums. */
  minAmountOut: bigint;
  /** 'chain' = priced here because the backend has no zap-quote route yet. */
  source: 'api' | 'chain';
  /** true when the input takes everything the curve has left: OpenLaunch caps
   *  the fill and refunds the overpayment in the QUOTE asset, never as ETH
   *  through the zap. `suggestedAmountIn` is the input that fills it exactly.
   *  Only the API can see this – it is undefined on a chain-priced quote. */
  fillsCurve?: boolean;
  suggestedAmountIn?: bigint | null;
  /** ISO time the older leg was read on-chain (API-priced quotes only). */
  quotedAt?: string;
}

/** The part of GET /api/v1/config the SDK reads (1.4.0): the running
 *  backend's feature flags and contract addresses, for THIS chain only. */
export interface RuntimeConfig {
  chainId: number;
  features: Record<string, unknown>;
  contracts: Record<string, unknown>;
}

export interface ReferralPosition {
  token: Address; name: string; symbol: string; mode: 'instant' | 'fair';
  launch: Address | null; claimableWei: bigint;
}

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------
type Events = 'launch:progress' | 'accountChanged' | 'chainChanged' | 'disconnect';

export class Openfair {
  readonly referrer: Address | null;
  readonly apiBase: string;
  readonly manifest: ChainManifest;
  readonly chain: ReturnType<typeof defineChain>;
  account: Address | null = null;
  private provider: Eip1193 | undefined;
  private wallet: WalletClient | null = null;
  readonly public: PublicClient;
  private autoSwitch: boolean;
  private onEvent?: OpenfairOptions['onEvent'];
  private listeners = new Map<Events, Set<(arg: unknown) => void>>();
  private inflight = false;
  private lastOp: { correlationId: string; stages: { stage: string; at: number }[] } | null = null;
  private cfgCache: { at: number; value: RuntimeConfig | null; unreachable: boolean } | null = null;
  private cfgInflight: Promise<{ value: RuntimeConfig | null; unreachable: boolean }> | null = null;

  readonly launch: LaunchApi;
  readonly tokens: TokensApi;
  readonly referrals: ReferralsApi;
  readonly contracts: ContractsApi;
  readonly quotes: QuotesApi;

  constructor(opts: OpenfairOptions = {}) {
    const m = CHAIN_MANIFESTS[opts.chainId ?? CHAIN.id];
    if (!m) throw new OpenfairError('BadConfig', `unsupported chainId ${opts.chainId} – known: ${Object.keys(CHAIN_MANIFESTS).join(', ')}`);
    this.manifest = opts.rpcUrls?.length ? { ...m, rpcUrls: opts.rpcUrls } : m;
    this.chain = chainFromManifest(this.manifest);
    this.referrer = opts.referrer && /^0x[0-9a-fA-F]{40}$/.test(opts.referrer) ? (opts.referrer as Address) : null;
    this.apiBase = (opts.apiBase ?? 'https://openfair.app').replace(/\/$/, '');
    this.provider = opts.provider;
    this.autoSwitch = opts.autoSwitchChain ?? true;
    this.onEvent = opts.onEvent;
    const timeout = opts.rpcTimeoutMs ?? 10_000;
    const transports = this.manifest.rpcUrls.map((u) => http(u, { timeout, retryCount: 2 }));
    this.public = createPublicClient({
      chain: this.chain,
      transport: transports.length > 1 ? fallback(transports) : transports[0],
    }) as unknown as PublicClient;
    this.launch = new LaunchApi(this);
    this.tokens = new TokensApi(this);
    this.referrals = new ReferralsApi(this);
    this.contracts = new ContractsApi(this);
    this.quotes = new QuotesApi(this);
  }

  // ---- events ----
  on(event: Events, cb: (arg: never) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as (arg: unknown) => void);
    return () => this.off(event, cb);
  }
  off(event: Events, cb: (arg: never) => void) { this.listeners.get(event)?.delete(cb as (arg: unknown) => void); }
  /** @internal */
  emit(event: Events, arg: unknown) {
    this.listeners.get(event)?.forEach((cb) => { try { cb(arg); } catch { /* listener errors are not ours */ } });
    if (event === 'launch:progress' && this.onEvent) {
      const p = arg as ProgressEvent;
      this.onEvent({ name: event, correlationId: p.correlationId, stage: p.stage });
    }
  }
  /** @internal */
  track(correlationId: string, stage: string) {
    if (!this.lastOp || this.lastOp.correlationId !== correlationId) this.lastOp = { correlationId, stages: [] };
    this.lastOp.stages.push({ stage, at: Date.now() });
  }

  /** @internal */
  getProvider(): Eip1193 {
    const p = this.provider ?? (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!p) throw new OpenfairError('NoWallet', 'no wallet found – install a browser wallet, open in a wallet dapp-browser, or pass a provider (e.g. WalletConnect) to the constructor');
    return p;
  }

  /** Connect the wallet; switches/adds the target chain unless autoSwitchChain=false. */
  async connect(): Promise<Address> {
    const eth = this.getProvider();
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
    const m = this.manifest;
    if (this.autoSwitch) {
      const current = (await eth.request({ method: 'eth_chainId' })) as string;
      if (parseInt(current, 16) !== m.chainId) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: m.hexId }] });
        } catch {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: m.hexId, chainName: m.name, nativeCurrency: m.currency, rpcUrls: m.rpcUrls, blockExplorerUrls: [m.explorer] }],
          });
        }
      }
    }
    this.wallet = createWalletClient({ chain: this.chain, transport: custom(eth) });
    this.account = accounts[0];
    // Forward wallet lifecycle events once (idempotent via marker).
    const p = eth as Eip1193 & { _ofBound?: boolean };
    if (p.on && !p._ofBound) {
      p._ofBound = true;
      p.on('accountsChanged', (a) => { this.account = (a as Address[])[0] ?? null; this.emit('accountChanged', this.account); });
      p.on('chainChanged', (c) => this.emit('chainChanged', parseInt(String(c), 16)));
      p.on('disconnect', () => { this.account = null; this.wallet = null; this.emit('disconnect', undefined); });
    }
    return this.account;
  }

  /** @internal */
  walletClient(): WalletClient {
    if (!this.wallet || !this.account) throw new OpenfairError('NoWallet', 'call connect() first');
    return this.wallet;
  }

  /**
   * Live creation fees from a factory (both are on-chain knobs) – the
   * generation-2 factory by default. Pass `quote.factory` (or a
   * `launch.target()`'s) to price a generation-3 create: that factory checks
   * msg.value EXACTLY against its own deployFee, which is a separate knob.
   */
  async fees(factory: Address = this.manifest.contracts.factory): Promise<{ deployFeeWei: bigint; supporterFeeWei: bigint }> {
    const f = factory;
    // Sequential + backoff: public RPCs rate-limit bursts, and a
    // rate-limited supporterFeeBps read must not silently misquote the fee.
    const read = async (functionName: 'deployFee' | 'supporterFeeBps'): Promise<bigint | number> => {
      for (let i = 0; ; i++) {
        try { return await this.public.readContract({ address: f, abi: factoryAbi, functionName }) as bigint | number; }
        catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
      }
    };
    const fee = await read('deployFee');
    const bps = await read('supporterFeeBps').catch(() => 5000); // pre-v1.9 factories: fixed half price
    return { deployFeeWei: fee as bigint, supporterFeeWei: (fee as bigint) * BigInt(Number(bps)) / 10000n };
  }

  /**
   * Supporter multiplier on the creation fee, in bps of the list fee (5000 =
   * half price, 0 = free). A quote-paired launch pays the registry's fee in the
   * pair asset, and the factory applies THIS same rule to it – so the discount
   * has to be read on its own rather than inferred from the native fee pair.
   * Per factory, like fees(): the generation-2 one by default.
   */
  async supporterFeeBps(factory: Address = this.manifest.contracts.factory): Promise<number> {
    return await this.public.readContract({
      address: factory, abi: factoryAbi, functionName: 'supporterFeeBps',
    }).then((v) => Number(v)).catch(() => 5000); // pre-v1.9 factories: fixed half price
  }

  /**
   * @internal The chain's running backend – GET {apiBase}/api/v1/config –
   * reduced to what the generation-3 gate reads. ONE read, cached (60 s for an
   * answer, 5 s for a failure) and shared by concurrent callers.
   *
   * null means "generation 3 is off", and so does every way of not getting a
   * usable answer: a network error, a non-200, a body that names no chain, and
   * an answer from ANOTHER chain's backend. The default apiBase is
   * openfair.app (4663), so `new Openfair({ chainId: 5042 })` without
   * `apiBase: 'https://arc.openfair.app'` reads Robinhood's config, which says
   * nothing about Arc. Only a create that opted into generation 3 ever asks
   * (LaunchApi.target) – and diagnostics({ generation: 3 }).
   *
   * The request bypasses the browser's HTTP cache (`cache: 'no-store'`): the
   * backend serves this route with `max-age=300`, and through the HTTP cache a
   * flipped `features.storefrontG3` would reach the SDK up to five minutes
   * late instead of within the 60 s of its own cache above.
   */
  async runtimeConfig(opts: { force?: boolean } = {}): Promise<RuntimeConfig | null> {
    return (await this.runtimeConfigState(opts)).value;
  }

  /**
   * @internal runtimeConfig() plus WHY there is no answer. `unreachable` is
   * true when the backend could not be asked at all – a network error, a
   * timeout, a 408/429 or a 5xx – which says nothing about generation 3 and
   * may pass by itself. It is false for every ANSWER that is not a usable
   * config: a 404 (a backend from before the route), a body that is not one,
   * another chain's backend. The holders' gate (LaunchApi.target) refuses the
   * first as NetworkUnavailable, retriable, and the rest as BadInput.
   */
  async runtimeConfigState(opts: { force?: boolean } = {}): Promise<{ value: RuntimeConfig | null; unreachable: boolean }> {
    const c = this.cfgCache;
    if (!opts.force && c && Date.now() - c.at < (c.value ? 60_000 : 5_000)) return { value: c.value, unreachable: c.unreachable };
    if (this.cfgInflight) return this.cfgInflight;
    const answer = (value: RuntimeConfig | null, unreachable = false) => ({ value, unreachable });
    const read = async (): Promise<{ value: RuntimeConfig | null; unreachable: boolean }> => {
      let res: Response;
      try {
        res = await fetch(`${this.apiBase}/api/v1/config`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      } catch {
        return answer(null, true);
      }
      if (!res.ok) return answer(null, res.status >= 500 || res.status === 408 || res.status === 429);
      try {
        const body = await res.json() as { data?: Record<string, unknown>; meta?: { chainId?: unknown } } | null;
        // The v1 envelope is `{ data, meta }`; a bare object is accepted too,
        // under the same chain check.
        const data = (body?.data ?? body) as { chain?: { id?: unknown }; features?: unknown; contracts?: unknown } | null;
        if (!data || typeof data !== 'object') return answer(null);
        const chainId = Number(data.chain?.id ?? body?.meta?.chainId);
        if (chainId !== this.manifest.chainId) return answer(null);
        const bag = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
        return answer({ chainId, features: bag(data.features), contracts: bag(data.contracts) });
      } catch (e) {
        // A 200 that does not parse – the SPA shell a host serves for a path
        // it does not know – is an answer, not an outage; a body cut off in
        // transit is an outage.
        return answer(null, !(e instanceof SyntaxError));
      }
    };
    const p = read().then((r) => { this.cfgCache = { at: Date.now(), ...r }; return r; });
    this.cfgInflight = p;
    try { return await p; } finally { this.cfgInflight = null; }
  }

  /** Downscale a logo File exactly like openfair.app does (≤512px). */
  async prepareLogo(file: File, opts: { square?: boolean; maxSize?: number; quality?: number } = {}): Promise<string> {
    return (await this.prepareLogoDetailed(file, opts)).dataUrl;
  }

  /** prepareLogo + preview facts: final MIME, byte size and dimensions. */
  prepareLogoDetailed(file: File, opts: { square?: boolean; maxSize?: number; quality?: number } = {}):
    Promise<{ dataUrl: string; mime: string; bytes: number; width: number; height: number }> {
    const maxSize = opts.maxSize ?? 512;
    const quality = opts.quality ?? 0.85;
    return new Promise((resolve, reject) => {
      if (file.size > 5 * 1024 * 1024) return reject(new OpenfairError('LogoTooBig', 'logo file over 5MB'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        if (opts.square) {
          const side = Math.min(img.width, img.height);
          const out = Math.min(maxSize, side);
          canvas.width = canvas.height = Math.max(1, out);
          // center cover-crop
          canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
        } else {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        const webp = canvas.toDataURL('image/webp', quality);
        const png = canvas.toDataURL('image/png');
        const jpg = canvas.toDataURL('image/jpeg', quality);
        let dataUrl: string;
        if (webp.startsWith('data:image/webp') && webp.length < Math.min(png.length, jpg.length)) dataUrl = webp;
        else dataUrl = png.length <= jpg.length * 1.4 ? png : jpg;
        const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
        const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
        resolve({ dataUrl, mime, bytes, width: canvas.width, height: canvas.height });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new OpenfairError('LogoReadFail', 'could not read the image')); };
      img.src = url;
    });
  }

  /** @internal Metadata pinning – content-addressed (same body → same CID), so
   * retries are naturally idempotent. Two retries on 5xx/network failures. */
  async metadataCid(p: TokenMetadata & { extraMetadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<string> {
    const body = JSON.stringify({
      name: p.name, description: p.description ?? '', logoDataUrl: p.logoDataUrl ?? null,
      website: p.website ?? '', twitter: p.twitter ?? '', telegram: p.telegram ?? '', discord: p.discord ?? '',
      ...(p.extraMetadata ? { extra: p.extraMetadata } : {}),
    });
    let lastErr: OpenfairError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(signal, 'preparing_metadata');
      try {
        const res = await fetch(`${this.apiBase}/api/metadata`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          signal: signal ?? AbortSignal.timeout(20_000),
        });
        if (res.status === 429) throw new OpenfairError('MetadataRateLimited', 'metadata endpoint rate limit hit', { stage: 'preparing_metadata', retriable: true, suggestedAction: 'wait a minute and retry' });
        if (res.status >= 500) throw new OpenfairError('MetadataError', `metadata pinning failed (${res.status})`, { stage: 'preparing_metadata', retriable: true });
        if (!res.ok) throw new OpenfairError('MetadataError', `metadata pinning failed (${res.status})`, { stage: 'preparing_metadata' });
        return (await res.json()).cid as string;
      } catch (e) {
        lastErr = e instanceof OpenfairError ? e : new OpenfairError('NetworkUnavailable', 'metadata upload failed – network error', { stage: 'preparing_metadata', retriable: true, cause: e });
        if (!lastErr.retriable || attempt === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastErr!;
  }

  /** @internal */
  txReferrer(): Address {
    if (this.referrer && this.referrer.toLowerCase() !== (this.account ?? '').toLowerCase()) return this.referrer;
    return ZERO;
  }

  /** @internal Second concurrent execute() is almost always a double-click. */
  guardInflight() {
    if (this.inflight) throw new OpenfairError('OperationInProgress', 'a launch is already in progress – wait for it to finish', { retriable: true });
    this.inflight = true;
  }
  /** @internal */
  releaseInflight() { this.inflight = false; }

  /** Diagnostic snapshot – versions, chain health, last operation timings.
   * Contains no addresses or personal data; safe to attach to bug reports.
   *
   * Generation 3 is opt-in here exactly as it is for a create: `diagnostics()`
   * reads nothing a 1.3.x create would not – no GET /api/v1/config, no read of
   * the generation-3 factory – and reports `createGeneration: 2` with the
   * generation-3 probes null ("not asked"). `diagnostics({ generation: 3 })`
   * asks, on a chain whose manifest has a generation 3: what an opted-in
   * create would do RIGHT NOW, and why. */
  async diagnostics(opts: { generation?: 2 | 3 } = {}): Promise<Record<string, unknown>> {
    const rpcOk = await this.public.getChainId().then((id) => id === this.manifest.chainId).catch(() => false);
    const factoryOk = await this.public.readContract({
      address: this.manifest.contracts.factory, abi: factoryAbi, functionName: 'deployFee',
    }).then(() => true).catch(() => false);
    const c = this.manifest.contracts;
    const g3 = slot(c.factoryG3);
    const ask = opts.generation === 3 && g3 !== null;
    const g3FactoryOk = !ask ? null : await this.public.readContract({
      address: g3, abi: factoryAbi, functionName: 'deployFee',
    }).then(() => true).catch(() => false);
    const cfg = !ask ? null : await this.runtimeConfig();
    const flag = (k: string) => (ask && cfg ? cfg.features[k] === true : null);
    return {
      sdkVersion: SDK_VERSION,
      chainId: this.manifest.chainId,
      factoryVersion: this.manifest.factoryVersion,
      lineage: this.manifest.lineage,
      quoteRegistry: this.manifest.contracts.registry,
      rpcOk, factoryOk,
      // 2 = the create goes to `factory`; 3 = a create that opts in
      // (feeSplit / generation: 3) goes to `factoryG3` – only ever 3 when
      // asked with { generation: 3 }.
      createGeneration: ask && g3LaunchFactoryFor(cfg, g3) ? 3 : 2,
      factoryG3: g3, zapG3: slot(c.zapG3), g3FactoryOk,
      // null = not asked (no { generation: 3 }, or no generation 3 on this
      // chain); false = this chain's backend gave no usable answer, so an
      // opted-in create stays on 2.
      runtimeConfigRead: ask ? cfg !== null : null,
      // A holders' share needs BOTH feeSplit and holdersPublisher (and the
      // gate above): `holdersLeg` is the verdict launch.target() applies.
      storefrontG3: flag('storefrontG3'), feeSplit: flag('feeSplit'), holdersPublisher: flag('holdersPublisher'),
      holdersLeg: ask ? holdersLegOn(cfg as FeeSplitConfigLike, g3) : null,
      walletConnected: !!this.account,
      lastOperation: this.lastOp ? {
        correlationId: this.lastOp.correlationId,
        stages: this.lastOp.stages.map((s, i, a) => ({ stage: s.stage, ms: i ? s.at - a[i - 1].at : 0 })),
      } : null,
    };
  }

  // ---- v1.0 back-compat: one-call creation (now runs the full pipeline) ----
  /** Instant listing: straight to a locked Uniswap V3 pool. */
  async createInstant(p: InstantParams): Promise<LaunchResult> {
    return this.launch.run({ mode: 'instant', ...p });
  }
  /** Fair launch: bonding curve that collects the target, then auto-lists. */
  async createFairLaunch(p: FairLaunchParams): Promise<LaunchResult> {
    return this.launch.run({ mode: 'fair', ...p });
  }
}

// ---------------------------------------------------------------------------
// Launch pipeline: quote → simulate → execute → wait
// ---------------------------------------------------------------------------
export class LaunchOperation {
  readonly correlationId: string;
  readonly txHash: `0x${string}`;
  private sdk: Openfair;
  private quote: LaunchQuote;
  private metadata: TokenMetadata;
  constructor(sdk: Openfair, quote: LaunchQuote, txHash: `0x${string}`, correlationId: string, metadata: TokenMetadata) {
    this.sdk = sdk; this.quote = quote; this.txHash = txHash; this.correlationId = correlationId; this.metadata = metadata;
  }

  /** Wait for confirmations (and optionally the openfair indexer). */
  async wait(opts: { confirmations?: number; waitForIndexer?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<LaunchResult> {
    const { sdk, quote } = this;
    const emit = (stage: LaunchStage, progress: number) => {
      sdk.track(this.correlationId, stage);
      sdk.emit('launch:progress', { stage, progress, correlationId: this.correlationId, txHash: this.txHash } satisfies ProgressEvent);
    };
    try {
      emit('confirming', 0.7);
      const receipt = await sdk.public.waitForTransactionReceipt({
        hash: this.txHash, confirmations: opts.confirmations ?? 1, timeout: opts.timeoutMs ?? 180_000,
      });
      if (receipt.status !== 'success') {
        throw new OpenfairError('TransactionReverted', 'the transaction reverted on-chain', { stage: 'confirming', transactionHash: this.txHash, suggestedAction: 'inspect the tx on the explorer' });
      }
      // The token comes from the creation event of the factory the create was
      // SENT to – and only from that factory's logs, so a token, a pair asset
      // or a vault logging something with the same shape can never answer.
      // Every shape is tried (the topics differ, so exactly one can match);
      // 1.3.x decoded native fair launches with the 21-field shape alone and
      // found no token on any current factory. `token` is indexed in all of
      // them.
      const generation: 2 | 3 = quote.generation === 3 ? 3 : 2;
      const factory = quote.factory.toLowerCase();
      const own = receipt.logs.filter((l) => l.address?.toLowerCase() === factory);
      const created = parseEventLogs({
        abi: createdEventAbi, eventName: quote.mode === 'fair' ? 'LaunchCreated' : 'DirectListingCreated', logs: own,
      });
      let tokenAddress: Address | null = (created[0]?.args.token as Address | undefined) ?? null;
      // Last resort, and only where it was the 1.3.x rule: a NATIVE instant
      // listing's first log is the new token's mint. Never for a pair – its
      // create pulls the asset (a Transfer of THAT asset) before it deploys.
      if (!tokenAddress && quote.mode === 'instant' && !quote.quote) tokenAddress = (receipt.logs[0]?.address as Address) ?? null;
      if (!tokenAddress) throw new OpenfairError('TxError', 'could not find the token address in the receipt', { stage: 'confirming', transactionHash: this.txHash });
      // Generation 3: the split as the chain recorded it. FeeSplitSet is emitted
      // only for a split that routes something, so its absence on a
      // generation-3 create IS the default {0,0,0}.
      let feeSplit: FeeSplitArg | null = null;
      if (generation === 3) {
        const set = parseEventLogs({ abi: feeSplitSetEventAbi, logs: own })
          .find((e) => (e.args.token as string).toLowerCase() === tokenAddress!.toLowerCase());
        feeSplit = set
          ? { holdersBps: Number(set.args.holdersBps), buybackBps: Number(set.args.buybackBps), tokenHoldersBps: Number(set.args.tokenHoldersBps) }
          : { ...ZERO_FEE_SPLIT };
      }

      let indexed = false;
      if (opts.waitForIndexer) {
        emit('indexing', 0.9);
        indexed = await sdk.tokens.waitUntilIndexed(tokenAddress, { timeoutMs: 60_000, signal: opts.signal }).then(() => true).catch(() => false);
      }
      const m = sdk.manifest;
      emit('completed', 1);
      const result: LaunchResult = {
        mode: quote.mode,
        tokenAddress,
        transactionHash: this.txHash,
        blockNumber: receipt.blockNumber,
        creator: sdk.account!,
        referrer: sdk.txReferrer() === ZERO ? null : sdk.txReferrer(),
        poolAddress: null,
        openfairUrl: `${sdk.apiBase}/token/${tokenAddress}`,
        explorerUrl: `${m.explorer}/token/${tokenAddress}`,
        dexUrl: quote.mode === 'instant' && m.dexSwapUrl ? m.dexSwapUrl(tokenAddress) : null,
        indexed,
        metadata: this.metadata,
        generation,
        feeSplit,
        token: tokenAddress, txHash: this.txHash,
        uniswapUrl: quote.mode === 'instant' && m.dexSwapUrl ? m.dexSwapUrl(tokenAddress) : null,
      };
      return result;
    } catch (e) {
      emit('failed', 1);
      throw explainRevert(e, 'confirming');
    } finally {
      sdk.releaseInflight();
    }
  }
}

class LaunchApi {
  constructor(private sdk: Openfair) {}

  /**
   * Where a create with these options goes – generation, factory and the split
   * it carries – after the fee-split rules (FEE_SPLIT_DESIGN D21), without
   * pricing anything. quote() runs this first; it is public so a form can show
   * the destination and the split before the user presses anything.
   *
   * Not opted in (no `feeSplit`, `generation` not 3): generation 2 on
   * `manifest.contracts.factory`, answered without a single network read –
   * the 1.3.x create, unchanged.
   *
   * Opted in: the split is checked in the factory's own order and every
   * refusal is a BadInput at stage 'validating', before a signature is asked
   * for (`contractReason` names the revert the factory would raise):
   *  - every field an integer 0..10000, platformShareBps too;
   *  - platformShareBps + holdersBps + buybackBps <= 10000 (BadSplit);
   *  - no non-zero share under 100 bps (BadSplit);
   *  - buybackBps 0 – the leg is not live anywhere (BuybackUnavailable);
   *  - a holders' share (holdersBps or tokenHoldersBps) only where the
   *    backend serves generation 3 AND says both features.feeSplit and
   *    features.holdersPublisher (HoldersUnavailable) – lib/feeSplit's
   *    holdersLegOn, the site's own gate. While the config cannot be reached
   *    at all (network, timeout, 5xx) that is not known either way, and the
   *    refusal is NetworkUnavailable, retriable, instead.
   * Then the chain's GET /api/v1/config decides: generation 3 on
   * `manifest.contracts.factoryG3` when it says features.storefrontG3 and names
   * that exact address, generation 2 otherwise – which the rules above leave
   * open only to the default split {0,0,0}, and only WITHOUT a vanity salt.
   *
   * A non-zero `salt` pins the factory: the token's CREATE2 address depends on
   * it (the holder of an OpenSimpleToken, the router of a paired
   * OpenFairToken), so a salt mined for one generation buys an address the
   * other factory never produces. On a chain that has a generation 3, an
   * opted-in create with a salt therefore goes to generation 3 or nowhere:
   *  - the config could not be read (network, or `apiBase` is another chain's
   *    host) – NetworkUnavailable, retriable;
   *  - the backend does not serve generation 3 – BadInput.
   * Neither falls back to generation 2. predictAddress() resolves its target
   * through this same rule, so a salt is never mined on one side of it and
   * created on the other.
   */
  async target(config: FeeSplitOptions & { platformShareBps?: number; salt?: `0x${string}` }): Promise<LaunchTarget> {
    const sdk = this.sdk;
    const m = sdk.manifest;
    const gen2: LaunchTarget = { generation: 2, factory: m.contracts.factory, feeSplit: null };
    const bad = (message: string, contractReason?: string, suggestedAction?: string) =>
      new OpenfairError('BadInput', message, { stage: 'validating', contractReason, suggestedAction });
    const { feeSplit, generation } = config;
    if (generation !== undefined && generation !== 2 && generation !== 3) {
      throw bad(`generation must be 2 or 3, got ${String(generation)}`);
    }
    // Not opted in: exactly 1.3.x – no config read, no new failure mode.
    if (feeSplit === undefined && generation !== 3) return gen2;

    const split = feeSplit === undefined ? { ...ZERO_FEE_SPLIT } : checkedFeeSplit(feeSplit, bad);
    const shareBps = config.platformShareBps ?? 5000;
    if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > BPS) {
      throw bad(`platformShareBps must be an integer 0..${BPS}, got ${String(shareBps)}`);
    }
    // lib/feeSplit.ts – the same check, in the same order, as the wizard and
    // LaunchFactory._validateSplit. The fields are integers by now, so its
    // rounding is a no-op.
    const problem = validateFeeSplit(split, shareBps);
    if (problem === 'sum') {
      throw bad(`platformShareBps + holdersBps + buybackBps = ${shareBps + split.holdersBps + split.buybackBps} – the quote side has only ${BPS}`, 'BadSplit', 'lower holdersBps or platformShareBps');
    }
    if (problem === 'tokenSum') throw bad(`tokenHoldersBps ${split.tokenHoldersBps} is over the token side's ${BPS}`, 'BadSplit');
    if (problem === 'dust') {
      throw bad('every non-zero share of the split must be at least 100 bps (1 %) – a smaller one pays less than its own claim gas', 'BadSplit', 'use 0 or at least 100');
    }
    if (problem === 'buyback') {
      throw bad('the buy-back leg is not live on any chain yet – buybackBps must be 0', 'BuybackUnavailable', 'set feeSplit.buybackBps to 0');
    }
    if (problem !== null) throw bad(`the fee split was refused (${problem})`, 'BadSplit');

    if (generation === 2) {
      if (!isDefaultFeeSplit(split)) {
        throw bad('the generation-2 factory takes no fee split – drop `generation: 2` or the split', undefined, 'omit generation to let the SDK choose');
      }
      return gen2;
    }
    // Absent (a manifest registered against the 1.3.x type) = null = none.
    const staticG3 = slot(m.contracts.factoryG3);
    const { value: cfg, unreachable } = await sdk.runtimeConfigState();
    const g3 = g3LaunchFactoryFor(cfg as FeeSplitConfigLike, staticG3) as Address | null;
    if ((split.holdersBps !== 0 || split.tokenHoldersBps !== 0) && !holdersLegOn(cfg as FeeSplitConfigLike, staticG3)) {
      // Not reached at all: whether generation 3 and the holders' leg are on
      // is unknown, not "off" – so retriable, never a verdict a form latches.
      if (cfg === null && unreachable && staticG3 !== null) {
        throw new OpenfairError(
          'NetworkUnavailable',
          `could not reach ${sdk.apiBase}/api/v1/config – whether chain ${m.chainId} takes a holders' share right now is unknown, and a fee split that routes something is never created without that answer`,
          { stage: 'validating', retriable: true, suggestedAction: 'retry in a few seconds' },
        );
      }
      // The leg needs BOTH flags (lib/feeSplit holdersLegOn): the split
      // feature (what indexes FeeSplitSet and prints it back) and the
      // publisher that pays the vault. Name the ones that are off.
      const off = ['feeSplit', 'holdersPublisher'].filter((k) => cfg?.features[k] !== true).map((k) => `features.${k}`);
      throw bad(
        g3
          ? `the holders' leg is not live on chain ${m.chainId} yet – a holders' share needs both features.feeSplit and features.holdersPublisher, and ${sdk.apiBase} has ${off.join(' and ')} off; it would accrue to a vault nobody pays out`
          : staticG3 === null
            ? `chain ${m.chainId} has no generation 3 – a fee split that routes something cannot be created here`
            : `generation 3 is not served for chain ${m.chainId} by ${sdk.apiBase} (features.storefrontG3) – a fee split that routes something cannot be created yet`,
        'HoldersUnavailable',
        g3 ? 'set holdersBps and tokenHoldersBps to 0, or omit feeSplit'
          : 'omit feeSplit – and check that apiBase is this chain\'s own openfair host',
      );
    }
    if (!g3) {
      // A chain with no generation 3 at all answers 2 every time, so a salt
      // mined there is created there – nothing can move under it.
      if (vanitySaltOf(config.salt) !== null && staticG3 !== null) {
        if (cfg === null) {
          throw new OpenfairError(
            'NetworkUnavailable',
            `could not tell whether chain ${m.chainId} creates on generation 3 – ${sdk.apiBase}/api/v1/config gave no answer for this chain, and a vanity salt is mined for ONE factory's address`,
            {
              stage: 'validating', retriable: true,
              suggestedAction: 'retry – and check that apiBase is this chain\'s own openfair host; to create on generation 2 instead, omit feeSplit / generation and mine the salt with predictAddress() for that',
            },
          );
        }
        throw bad(
          `generation 3 is not served for chain ${m.chainId} by ${sdk.apiBase} (features.storefrontG3) – a vanity salt is not moved to the generation-2 factory, where it produces another address`,
          undefined,
          'omit feeSplit / generation to create on generation 2, and mine the salt with predictAddress() for that',
        );
      }
      return gen2;
    }
    return { generation: 3, factory: g3, feeSplit: split };
  }

  /** Normalize a config into the exact on-chain params + full cost quote. */
  async quote(config: LaunchConfig): Promise<LaunchQuote> {
    const sdk = this.sdk;
    if (!config.name || !config.symbol) throw new OpenfairError('BadInput', 'name and symbol are required', { stage: 'validating' });
    const shareBps = config.platformShareBps ?? 5000;
    // Generation and destination first: the split rules are the cheapest
    // refusals, and every figure below is read from the TARGET factory.
    const target = await this.target(config);
    // Does that factory's params struct carry the quote fields? It does on the
    // shared lineage's v3 factory and its generation 3 (4663) – for a NATIVE
    // launch too, holding zero: that factory has no other entry point, and
    // 1.3.2 and 1.3.3 – the bundles whose 4663 manifest names it – sent every
    // native create there with the pre-quote selector, which it does not have
    // (0x7c178686 / 0x3515085c – reverted at simulation). 1.3.0 and 1.3.1 name
    // the v2.1 factory 0x205344a2…1508, which still takes that selector.
    const quoteAware = speaksQuoteShape(sdk.manifest, target.generation);
    const qa = config.quote ? await sdk.quotes.require(config.quote) : null;
    if (qa && !quoteAware) {
      throw new OpenfairError('QuotePairsUnavailable', `the chain ${sdk.manifest.chainId} factory takes no pair asset – omit \`quote\` to launch in ${sdk.manifest.currency.symbol}`, { stage: 'validating' });
    }
    const qdec = qa?.decimals ?? 18;
    // Money units of this launch. Native: the chain's coin and the factory's own
    // deployFee. Quote: the pair asset, whose fee/target/start FDV the registry
    // derives from the USD anchor – the factory reads the SAME views when the
    // create lands, so quoting from anywhere else would drift from the payment.
    // Both from the factory the create is SENT to: generation 3 has its own
    // deployFee / supporterFeeBps knobs and checks msg.value exactly.
    const nativeFees = qa ? null : await sdk.fees(target.factory);
    const listFee = qa ? qa.deployFeeWei! : nativeFees!.deployFeeWei;
    const supporterFee = qa
      ? qa.deployFeeWei! * BigInt(await sdk.supporterFeeBps(target.factory)) / 10000n
      : nativeFees!.supporterFeeWei;
    const fee = shareBps >= SUPPORTER_SHARE_BPS ? supporterFee : listFee;
    const econ = qa
      ? {
          deployFee: Number(formatUnits(listFee, qdec)),
          target: Number(formatUnits(qa.targetWei!, qdec)),
          startFdv: Number(formatUnits(qa.startFdvWei!, qdec)),
        }
      : sdk.manifest.economics;
    // Amounts the caller states in whole units (seedEth / devBuyEth) are the
    // PAIR asset in quote mode – nothing here is ever ETH-denominated then.
    const amount = (whole: number) => parseUnits(String(whole), qdec);
    const vanityFee = config.vanityFeeWei ?? 0n;
    let params: Record<string, unknown>;
    let value: bigint;
    let quoteDue: bigint;
    if (config.mode === 'instant') {
      const totalSupply = config.totalSupply ?? 1_000_000_000;
      const seedEth = config.seedEth ?? 0;
      const seedWei = amount(seedEth);
      params = {
        name: config.name, symbol: config.symbol,
        totalSupply: parseEther(String(totalSupply)),
        poolBps: Math.round((config.poolPct ?? 100) * 100),
        feeRecipient: (config.feeRecipient ?? ZERO) as Address,
        poolFeeTier: POOL_FEE_TIER,
        // Start price = start FDV / supply, in the launch's unit. Quote mode
        // divides the registry's exact figure instead of a float round-trip.
        startPriceWei: seedEth > 0 ? 0n
          : qa ? qa.startFdvWei! / BigInt(totalSupply)
          : BigInt(Math.round(sdk.manifest.economics.startFdv * 1e18 / totalSupply)),
        salt: config.salt ?? ZERO_SALT,
        vanityFeeWei: vanityFee,
        platformShareBps: shareBps,
        referrer: sdk.txReferrer(),
        // Present whenever the factory's struct has them – zero for native.
        ...(quoteAware ? { quote: qa?.address ?? ZERO, liquidityQuote: qa ? seedWei : 0n } : {}),
      };
      value = qa ? 0n : fee + seedWei + vanityFee;
      quoteDue = qa ? fee + seedWei + vanityFee : 0n;
    } else {
      const totalSupply = config.totalSupply ?? 1_000_000_000;
      const curveType = config.curveType ?? 0;
      const { multiple, saleSupply } = deriveCurve(curveType, totalSupply, econ);
      const anti = antiSnipeNumbers(config.antiSnipe ?? 'normal', saleSupply, totalSupply);
      const teamPct = Math.min(config.teamPct ?? 0, 20);
      const devBuyWei = amount(config.devBuyEth ?? 0);
      params = {
        name: config.name, symbol: config.symbol,
        totalSupply: parseEther(String(totalSupply)),
        saleSupply: parseEther(String(saleSupply)),
        curveType,
        priceMultiple: BigInt(multiple),
        // Quote mode REQUIRES 0 here (spec §11c): the factory takes the target
        // from the registry and rejects a caller-supplied one rather than
        // silently ignoring it.
        targetEth: qa ? 0n : parseEther(String(sdk.manifest.economics.target)),
        buyFeeBps: Math.round((config.buyFeePct ?? 1) * 100),
        sellFeeBps: Math.round((config.sellFeePct ?? 1) * 100),
        platformShareBps: shareBps,
        feeRecipient: (config.feeRecipient ?? ZERO) as Address,
        sellsEnabled: config.sellsEnabled ?? true,
        startTime: BigInt(config.startTime ?? 0),
        walletCapFloor: 0n,
        walletCapPerSec: parseEther(String(anti.capRate)),
        globalRampPerSec: parseEther(String(anti.ramp)),
        poolFeeTier: POOL_FEE_TIER,
        teamAllocation: parseEther(String(Math.floor((config.totalSupply ?? 1_000_000_000) * teamPct / 100))),
        teamBeneficiary: (config.teamBeneficiary ?? sdk.account ?? ZERO) as Address,
        teamVestingDuration: BigInt(teamPct > 0 ? (config.teamMonths ?? 6) * 30 * 86400 : 0),
        devBuyEth: devBuyWei,
        salt: config.salt ?? ZERO_SALT,
        vanityFeeWei: vanityFee,
        ...(quoteAware ? { quote: qa?.address ?? ZERO } : {}),
      };
      value = qa ? 0n : fee + devBuyWei + vanityFee;
      quoteDue = qa ? fee + devBuyWei + vanityFee : 0n;
    }
    // Allowance to the factory, read only when there is a wallet to read it
    // for: without it the caller cannot know whether execute() needs a first
    // signature. approve() grants 1% over the requirement (feed re-read).
    const approveAmount = quoteDue === 0n ? 0n : quoteDue + quoteDue / 100n;
    let allowanceWei: bigint | null = null;
    if (qa && sdk.account) {
      allowanceWei = await sdk.public.readContract({
        address: qa.address, abi: erc20Abi, functionName: 'allowance',
        args: [sdk.account, target.factory],
      }).catch(() => null) as bigint | null;
    }
    // Gas estimate: same calldata shape with a placeholder CID (CIDs are
    // fixed-length, so the estimate matches the real tx within noise). In quote
    // mode it reverts until the allowance lands, which is not an error here.
    let gasWei = 0n;
    try {
      const gas = await sdk.public.estimateContractGas(this.callFor({ params, value, mode: config.mode, ...target }, 'bafkreicfxudbe2wjpnyecchmyaa2ufnpiss4ht24uvxgamqit67r7ybc3a') as unknown as Parameters<PublicClient['estimateContractGas']>[0]);
      const gasPrice = await sdk.public.getGasPrice();
      gasWei = gas * gasPrice * 12n / 10n; // +20% headroom
    } catch { /* без кошелька или при реверте оценка недоступна – квота всё равно полезна */ }
    return {
      mode: config.mode,
      chainId: sdk.manifest.chainId,
      factory: target.factory,
      generation: target.generation,
      feeSplit: target.feeSplit,
      quote: qa,
      deployFeeWei: listFee,
      supporterDiscountWei: listFee - supporterFee,
      gasEstimateWei: gasWei,
      requiredValueWei: value,
      requiredQuoteWei: quoteDue,
      approveAmountWei: approveAmount,
      allowanceWei,
      approvalNeeded: !!qa && (allowanceWei === null || allowanceWei < quoteDue),
      estimatedTotalWei: value + gasWei,
      platformShareBps: shareBps,
      referralShareBps: sdk.txReferrer() === ZERO ? 0 : 5000,
      expiresAt: Date.now() + 60_000,
      params,
      config,
    };
  }

  /**
   * The create call, addressed to the factory the quote targets and encoded
   * with THAT factory's entry point. The ABI is a fact about the factory, never
   * about the launch: the shared lineage's v3 factory (4663) takes the
   * quote-aware structs for native launches too, generation 3 appends the
   * FeeSplit argument (a different selector), and the stable lineage (Arc,
   * Stable) has neither quote field.
   *
   *   generation 2, pre-quote    createLaunch 0x7c178686 · createDirectListing 0x3515085c
   *   generation 2, quote-aware  createLaunch 0xfc6359c6 · createDirectListing 0xa3b13422
   *   generation 3, pre-quote    createLaunch 0xd457b5ae · createDirectListing 0xf2a90781
   *   generation 3, quote-aware  createLaunch 0x139fa5a8 · createDirectListing 0xd20670fa
   */
  private callFor(q: { params: Record<string, unknown>; value: bigint; mode: 'instant' | 'fair'; factory: Address; generation: 2 | 3; feeSplit: FeeSplitArg | null }, cid: string):
    { chain: typeof chain; account?: Address; address: Address; abi: typeof factoryAbi | typeof factoryQuoteAbi | typeof factoryG3Abi | typeof factoryQuoteG3Abi; functionName: 'createDirectListing' | 'createLaunch'; args: readonly unknown[]; value: bigint } {
    const sdk = this.sdk;
    const gen3 = q.generation === 3;
    const quoteAware = speaksQuoteShape(sdk.manifest, q.generation);
    const abi = gen3
      ? (quoteAware ? factoryQuoteG3Abi : factoryG3Abi)
      : (quoteAware ? factoryQuoteAbi : factoryAbi);
    // null = the generation-2 argument list, byte for byte (lib/createPayload).
    const split = gen3 ? (q.feeSplit ?? { ...ZERO_FEE_SPLIT }) : null;
    return q.mode === 'instant'
      ? {
          chain: sdk.chain, account: sdk.account ?? undefined,
          address: q.factory, abi,
          functionName: 'createDirectListing' as const, args: listingArgs(q.params, split, cid), value: q.value,
        }
      : {
          chain: sdk.chain, account: sdk.account ?? undefined,
          address: q.factory, abi,
          functionName: 'createLaunch' as const, args: launchArgs(q.params, split, sdk.txReferrer(), cid), value: q.value,
        };
  }

  /**
   * Grant the factory the allowance a quote-paired launch needs. No-op (returns
   * null) for a native launch or when the standing allowance already covers it.
   * execute() calls this itself; it is public so an integrator can stage the
   * two signatures in their own UI.
   */
  async approve(quote: LaunchQuote): Promise<`0x${string}` | null> {
    const sdk = this.sdk;
    const qa = quote.quote;
    if (!qa || quote.requiredQuoteWei === 0n) return null;
    if (!sdk.account) await sdk.connect();
    // The spender is the factory the create is SENT to – on generation 3 an
    // allowance to the generation-2 factory is worth nothing.
    const allowance = await sdk.public.readContract({
      address: qa.address, abi: erc20Abi, functionName: 'allowance',
      args: [sdk.account!, quote.factory],
    }).catch(() => 0n) as bigint;
    if (allowance >= quote.requiredQuoteWei) {
      quote.allowanceWei = allowance;
      quote.approvalNeeded = false;
      return null;
    }
    const hash = await sdk.walletClient().writeContract({
      chain: sdk.chain, account: sdk.account!,
      address: qa.address, abi: erc20Abi, functionName: 'approve',
      args: [quote.factory, quote.approveAmountWei],
    });
    await sdk.public.waitForTransactionReceipt({ hash });
    quote.allowanceWei = quote.approveAmountWei;
    quote.approvalNeeded = false;
    return hash;
  }

  /** Dry-run the exact transaction (balance + eth_call) BEFORE the wallet opens. */
  async simulate(quote: LaunchQuote): Promise<SimulationResult> {
    const sdk = this.sdk;
    if (!sdk.account) return { success: false, error: new OpenfairError('NoWallet', 'call connect() first', { stage: 'simulating' }) };
    try {
      const bal = await sdk.public.getBalance({ address: sdk.account });
      const headroom = quote.gasEstimateWei > 0n ? quote.gasEstimateWei : parseEther('0.001');
      // Native launch: one balance covers value + gas. Quote launch: msg.value
      // is 0, so the native balance is a GAS check only and the payment is
      // judged against the pair asset – a shortfall names the asset that is
      // actually short instead of the coin the user has plenty of.
      if (bal < quote.requiredValueWei + headroom) {
        return {
          success: false,
          error: new OpenfairError('InsufficientFunds',
            `wallet needs ~${fmtNative(quote.requiredValueWei + headroom)} ${sdk.manifest.currency.symbol} (${quote.quote ? 'gas' : 'value + gas'}), has ${fmtNative(bal)}`,
            { stage: 'simulating', suggestedAction: 'top up the wallet' }),
        };
      }
      if (quote.quote) {
        const unit = quote.quote.symbol ?? 'the quote asset';
        const qbal = await sdk.public.readContract({
          address: quote.quote.address, abi: erc20Abi, functionName: 'balanceOf', args: [sdk.account],
        }).catch(() => 0n) as bigint;
        if (qbal < quote.requiredQuoteWei) {
          return {
            success: false,
            error: new OpenfairError('InsufficientQuoteBalance',
              `wallet needs ${formatUnits(quote.requiredQuoteWei, quote.quote.decimals)} ${unit} (fee + seed/dev-buy + vanity), has ${formatUnits(qbal, quote.quote.decimals)}`,
              { stage: 'simulating', suggestedAction: `acquire ${unit} before launching` }),
          };
        }
        // eth_call would only report the factory's transferFrom failing, which
        // reads as a contract bug rather than a missing first signature.
        const allowance = await sdk.public.readContract({
          address: quote.quote.address, abi: erc20Abi, functionName: 'allowance',
          args: [sdk.account, quote.factory],
        }).catch(() => 0n) as bigint;
        if (allowance < quote.requiredQuoteWei) {
          return {
            success: false,
            error: new OpenfairError('ApprovalRequired',
              `the factory must be allowed to pull ${formatUnits(quote.requiredQuoteWei, quote.quote.decimals)} ${unit}`,
              { stage: 'simulating', retriable: true, suggestedAction: 'call launch.approve(quote) first (execute() does it for you)' }),
          };
        }
      }
      // The CID string length never changes the revert outcome – placeholder is fine here.
      const call = this.callFor({ ...quote, value: quote.requiredValueWei }, 'bafkreicfxudbe2wjpnyecchmyaa2ufnpiss4ht24uvxgamqit67r7ybc3a');
      // A vanity salt: the factory itself names the token this exact call
      // deploys (both entry points return it first), and it must be the
      // address the salt produces on THAT factory – the site's
      // `vanityMismatch` guard. The creation code and the deployer behind a
      // prediction are the backend's word; a drift in either, or a salt mined
      // for the other generation's factory, would otherwise be paid for in
      // full (vanityFeeWei) and buy an unrelated address. An unreadable result
      // or a prediction that cannot be made fails closed. The CID is not part
      // of the token's initcode, so the placeholder answers for the real call.
      const salt = vanitySaltOf(quote.params.salt);
      if (salt !== null) {
        const { result } = await sdk.public.simulateContract(call as unknown as Parameters<PublicClient['simulateContract']>[0]);
        const predicted = await this.predictFor(quote.config, salt, quote);
        if (vanityMismatch(result, salt, predicted)) {
          const got = Array.isArray(result) ? result[0] : result;
          return {
            success: false,
            error: new OpenfairError('VanityMismatch',
              `the generation-${quote.generation} factory ${quote.factory} would deploy ${typeof got === 'string' ? got : 'an unreadable address'}, not ${predicted}, the address this salt gives on that factory – the served creation code or deployer has drifted`,
              { stage: 'simulating', suggestedAction: 're-mine the salt with launch.predictAddress() and re-quote, or drop salt and vanityFeeWei' }),
          };
        }
      }
      const gas = await sdk.public.estimateContractGas(call as unknown as Parameters<PublicClient['estimateContractGas']>[0]);
      return { success: true, gasEstimate: gas };
    } catch (e) {
      return { success: false, error: explainRevert(e, 'simulating') };
    }
  }

  /**
   * Fair-launch economics before any transaction: prices, FDV, buy examples.
   * Pass `quote` (an entry from `quotes.list()`) to get the same numbers in
   * THAT asset's units – the curve of a paired launch is anchored to the
   * registry's target, not to the chain's.
   */
  preview(config: { curveType?: 0 | 1 | 2; totalSupply?: number; quote?: QuoteAsset | null }): FairPreview {
    const curveType = config.curveType ?? 0;
    const totalSupply = config.totalSupply ?? 1_000_000_000;
    const qa = config.quote ?? null;
    if (qa && (qa.targetWei === null || qa.startFdvWei === null)) {
      throw new OpenfairError('QuotePriceStale', `no live price for ${qa.symbol ?? qa.address} – its economics cannot be derived`, { stage: 'validating', retriable: true });
    }
    const econ = qa
      ? {
          deployFee: Number(formatUnits(qa.deployFeeWei ?? 0n, qa.decimals)),
          target: Number(formatUnits(qa.targetWei!, qa.decimals)),
          startFdv: Number(formatUnits(qa.startFdvWei!, qa.decimals)),
        }
      : this.sdk.manifest.economics;
    const { multiple: M, saleSupply: S } = deriveCurve(curveType, totalSupply, econ);
    // Relative price shape p(s), s = sold fraction 0..1, p(0)=1, p(1)=M.
    const rel = (s: number): number => {
      if (curveType === 1) return 1 + (M - 1) * s;
      if (curveType === 2) return 1 + (M - 1) * s * s;
      const r = Math.sqrt(M) / (Math.sqrt(M) - 1);
      return 1 / Math.pow(1 - s / r, 2);
    };
    // Scale p0 so that ∫ p(s)·S ds over 0..1 equals the chain's target.
    const n = 2000;
    let integ = 0;
    for (let i = 0; i < n; i++) integ += rel((i + 0.5) / n) / n;
    const p0 = econ.target / (S * integ);
    const buyExamples = [0.1, 0.5, 1].map((eth) => {
      let spent = 0, s = 0;
      const ds = 1 / n;
      while (s < 1 && spent < eth) { spent += rel(s + ds / 2) * p0 * S * ds; s += ds; }
      const tokens = Math.min(1, s) * S;
      return { eth, tokens: Math.round(tokens), pctOfSale: +(Math.min(1, s) * 100).toFixed(2), priceImpactPct: +((rel(Math.min(1, s)) - 1) * 100).toFixed(2) };
    });
    return {
      saleSupply: S, priceMultiple: M,
      startPriceEth: p0, finalPriceEth: p0 * M,
      startFdvEth: p0 * totalSupply, graduationFdvEth: p0 * M * totalSupply,
      targetEth: econ.target, buyExamples,
      unit: qa ? (qa.symbol ?? short(qa.address)) : this.sdk.manifest.currency.symbol,
      quote: qa ? qa.address : null,
    };
  }

  /** preview() for a pair given by address – resolves the asset, then previews. */
  async previewFor(quote: string | null, config: { curveType?: 0 | 1 | 2; totalSupply?: number } = {}): Promise<FairPreview> {
    return this.preview({ ...config, quote: quote ? await this.sdk.quotes.require(quote) : null });
  }

  /** Pin metadata + send the transaction. Returns an operation to wait() on. */
  async execute(quote: LaunchQuote, opts: { signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void } = {}): Promise<LaunchOperation> {
    const sdk = this.sdk;
    sdk.guardInflight();
    const correlationId = `of-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const emit = (stage: LaunchStage, progress: number, txHash?: `0x${string}`) => {
      sdk.track(correlationId, stage);
      const ev: ProgressEvent = { stage, progress, correlationId, txHash };
      sdk.emit('launch:progress', ev);
      opts.onProgress?.(ev);
    };
    try {
      emit('validating', 0.05);
      if (!sdk.account) await sdk.connect();
      throwIfAborted(opts.signal, 'validating');
      if (Date.now() > quote.expiresAt) {
        // Fees may have moved – refresh silently. The refresh re-resolves the
        // target too (the backend may have opened or closed generation 3 in
        // the meantime), and a move to another factory is taken silently only
        // when it is the same launch on either: a split that routes nothing
        // AND no vanity salt. A salt is mined for one factory's address – the
        // factory is the holder of an OpenSimpleToken, and its zap the router
        // of a paired OpenFairToken – so on the other factory the vanity fee
        // would buy an address nobody mined.
        const fresh = await this.quote(quote.config);
        const moved = fresh.generation !== quote.generation
          || fresh.factory.toLowerCase() !== quote.factory.toLowerCase();
        if (moved && vanitySaltOf(quote.params.salt) !== null) {
          throw new OpenfairError(
            'BadInput',
            `this create would now go to the generation-${fresh.generation} factory ${fresh.factory}, not the generation-${quote.generation} one the vanity salt was mined for – it would produce another address`,
            { stage: 'validating', retriable: true, suggestedAction: 're-mine the salt with launch.predictAddress() and re-quote' },
          );
        }
        if (moved && !isDefaultFeeSplit(quote.feeSplit ?? ZERO_FEE_SPLIT)) {
          throw new OpenfairError('BadInput', `generation ${quote.generation} is no longer served for this fee split – re-quote`, { stage: 'validating', retriable: true });
        }
        quote = fresh;
      }

      emit('preparing_metadata', 0.15);
      const c = quote.config;
      const metadata: TokenMetadata = {
        name: c.name, description: c.description, logoDataUrl: c.logoDataUrl,
        website: c.website, twitter: c.twitter, telegram: c.telegram, discord: c.discord,
      };
      const cid = await sdk.metadataCid({ ...metadata, extraMetadata: c.extraMetadata }, opts.signal);
      throwIfAborted(opts.signal, 'preparing_metadata');

      // A quote-paired launch needs the allowance BEFORE the dry-run: without
      // it the factory's transferFrom reverts and the simulation would only
      // report that. Native launches never reach this branch.
      if (quote.quote && quote.requiredQuoteWei > 0n) {
        emit('approving', 0.25);
        await this.approve(quote);
        throwIfAborted(opts.signal, 'approving');
      }

      emit('simulating', 0.3);
      const sim = await this.simulate(quote);
      if (!sim.success) throw sim.error;
      throwIfAborted(opts.signal, 'simulating');

      emit('awaiting_wallet', 0.45);
      const call = this.callFor({ ...quote, value: quote.requiredValueWei }, cid);
      const txHash = await sdk.walletClient().writeContract(call as unknown as Parameters<WalletClient['writeContract']>[0]);
      emit('transaction_submitted', 0.6, txHash);
      return new LaunchOperation(sdk, quote, txHash, correlationId, metadata);
    } catch (e) {
      emit('failed', 1);
      sdk.releaseInflight();
      throw explainRevert(e, 'awaiting_wallet');
    }
  }

  /** quote → simulate → execute → wait, in one call (used by createInstant/createFairLaunch). */
  async run(config: LaunchConfig, opts: { signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void; confirmations?: number; waitForIndexer?: boolean } = {}): Promise<LaunchResult> {
    const q = await this.quote(config);
    const op = await this.execute(q, opts);
    return op.wait({ confirmations: opts.confirmations, waitForIndexer: opts.waitForIndexer, signal: opts.signal });
  }

  /**
   * Predict the CREATE2 token address for a salt (verify mined vanity salts).
   *
   * The initcode is the token's creation code FOLLOWED BY its encoded
   * constructor arguments, so this is right only when both halves belong to the
   * same contract. It used to hand-roll a FOUR-argument tail, which is wrong in
   * two directions at once: §12b appended a fifth `router` argument on the v3
   * (quote-pairs) generation, and the chains running the STABLE lineage compile
   * a different OpenFairToken altogether. Both halves now come from the same
   * place they do on the site – `planVanityMine` for the shape (driven by the
   * manifest's own factoryVersion, so the SDK can target any chain), the
   * backend for the bytes – and the two are checked against each other before a
   * single hash is taken, using the constructor the served bytes were compiled
   * with.
   *
   * 1.4.0: predicted for the factory the create is SENT to (`launch.target`) –
   * a config that opts into generation 3 is minted by `factoryG3`, which is the
   * holder of an OpenSimpleToken and routes a paired fair launch through
   * `zapG3`, so both halves of the constructor move with it. The target is
   * resolved WITH this salt, under the same rule quote() applies: an opted-in
   * config is predicted on generation 3 or refused, never on a generation-2
   * fallback that the create might not take.
   */
  async predictAddress(config: LaunchConfig, salt: `0x${string}`): Promise<Address> {
    return this.predictFor(config, salt, await this.target({ ...config, salt }));
  }

  /** predictAddress() for a target already resolved – simulate() checks a
   *  quote against the factory the QUOTE is sent to, not a fresh answer. */
  private async predictFor(config: LaunchConfig, salt: `0x${string}`, target: Pick<LaunchTarget, 'generation' | 'factory'>): Promise<Address> {
    const sdk = this.sdk;
    const mode = config.mode;
    const contractName = mode === 'fair' ? 'OpenFairToken' : 'OpenSimpleToken';
    const m = sdk.manifest;
    // The manifest IS the config here: `new Openfair({ chainId })` may target a
    // chain this bundle was not built for, so nothing may come from the
    // build-time table – hence no `fallback` that could answer instead.
    //
    // Generation 3 is described in the planner's GENERATION-2 slots on purpose.
    // Its generation-3 branch (keyed by `launchFactoryG3`) takes the token's
    // arity from the chain this BUNDLE was built for (STATIC_TABLE_QUOTE_AWARE)
    // – right for the site, wrong for an SDK built for Robinhood and pointed at
    // Arc. The generation-2 branch takes it from `factoryVersion`, which this
    // manifest carries for its own chain, and generation 3 changes nothing else
    // it reads: the same two token deployers (D13), its own factory as the
    // simple token's holder, its own zap as a paired fair token's router.
    const plan = planVanityMine({
      kind: mode === 'fair' ? 'curve' : 'direct',
      factory: target.factory,
      quoteSelected: Boolean(config.quote),
      cfg: {
        contracts: {
          launchFactory: target.factory,
          factoryVersion: m.factoryVersion,
          fairTokenDeployer: m.contracts.fairTokenDeployer,
          simpleTokenDeployer: m.contracts.simpleTokenDeployer,
          zap: slot(target.generation === 3 ? m.contracts.zapG3 : m.contracts.zap),
        },
        features: { quotePairs: m.contracts.registry !== null },
      },
      fallback: { fairTokenDeployer: m.contracts.fairTokenDeployer, simpleTokenDeployer: m.contracts.simpleTokenDeployer },
      token: { name: config.name, symbol: config.symbol, totalSupply: parseEther(String(config.totalSupply ?? 1_000_000_000)) },
    });
    if (!plan.ok) {
      throw new OpenfairError('BadConfig', `cannot determine the ${contractName} constructor for this chain – no address can be predicted`);
    }
    const res = await fetch(`${sdk.apiBase}/api/bytecode/${contractName}`);
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', 'could not fetch token bytecode');
    const served = await res.json() as ServedCreationCode;
    if (!/^0x[0-9a-fA-F]{2,}$/.test(served?.bytecode ?? '')) {
      throw new OpenfairError('NetworkUnavailable', 'the backend served no token creation code');
    }
    if (servedShapeMismatch(plan.ctor, served)) {
      throw new OpenfairError(
        'BadConfig',
        `the ${contractName} this backend serves (${served.source ?? 'unknown source'}) takes `
        + `(${served.ctorTypes?.join(', ')}), not the constructor this chain's factory calls – `
        + 'the predicted address would be one nothing deploys',
      );
    }
    return predictTokenAddress({
      creationCode: served.bytecode as `0x${string}`, ctor: plan.ctor, deployer: plan.deployer, salt,
    });
  }

  // ---- coin payment for a launch this API just created (spec §10) ----------
  // The implementation lives on `tokens` (it is about an existing launch, not
  // about creating one); these forward to it so an integrator who holds
  // `sdk.launch` after a create does not have to reach for another surface.

  /** @see TokensApi.zapQuote */
  zapQuote(token: string, opts?: { ethIn?: bigint; tokensIn?: bigint; slippageBps?: number }): Promise<ZapQuote> {
    return this.sdk.tokens.zapQuote(token, opts);
  }

  /** @see TokensApi.buyWithEth */
  buyWithEth(token: string, opts: { ethIn: bigint; slippageBps?: number; deadlineSec?: number; quote?: ZapQuote }): Promise<`0x${string}`> {
    return this.sdk.tokens.buyWithEth(token, opts);
  }

  /** @see TokensApi.sellForEth */
  sellForEth(token: string, opts: { tokensIn: bigint; slippageBps?: number; deadlineSec?: number; quote?: ZapQuote }): Promise<`0x${string}`> {
    return this.sdk.tokens.sellForEth(token, opts);
  }
}

// ---------------------------------------------------------------------------
// Read-only token registry (openfair public API, normalized + typed)
// ---------------------------------------------------------------------------
interface RawSummary {
  token: string; kind: 'curve' | 'direct'; name: string; symbol: string; createdAt: number;
  graduated: boolean; creator: string; referrer: string | null; logoUrl: string | null;
  launch: string; startTime: number; readyToGraduate: boolean;
}

class TokensApi {
  constructor(private sdk: Openfair) {}

  private normalize(r: RawSummary): TokenListItem {
    const sdk = this.sdk;
    return {
      address: r.token as Address, name: r.name, symbol: r.symbol,
      mode: r.kind === 'direct' ? 'instant' : 'fair',
      createdAt: r.createdAt, graduated: !!r.graduated,
      creator: r.creator as Address, referrer: (r.referrer as Address) ?? null,
      logoUrl: r.logoUrl ? `${sdk.apiBase}${r.logoUrl}` : null,
      openfairUrl: `${sdk.apiBase}/token/${r.token}`,
      explorerUrl: `${sdk.manifest.explorer}/token/${r.token}`,
    };
  }

  /** Cursor-paginated token list. `referrer`/`mode` filters are applied
   * client-side (the public API has no server-side filter yet). */
  async list(opts: { referrer?: string; mode?: 'instant' | 'fair'; cursor?: string; limit?: number } = {}):
    Promise<{ items: TokenListItem[]; nextCursor: string | null; total: number }> {
    const limit = Math.min(opts.limit ?? 24, 100);
    const offset = opts.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const res = await fetch(`${this.sdk.apiBase}/api/launches?sort=new&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', `token list failed (${res.status})`, { retriable: true });
    const { items, total } = await res.json() as { items: RawSummary[]; total: number };
    let out = items.map((r) => this.normalize(r));
    if (opts.referrer) out = out.filter((t) => t.referrer?.toLowerCase() === opts.referrer!.toLowerCase());
    if (opts.mode) out = out.filter((t) => t.mode === opts.mode);
    const next = offset + items.length;
    return { items: out, nextCursor: items.length === limit && next < total ? String(next) : null, total };
  }

  /** Full detail for one token (typed passthrough of /api/tokens/:address). */
  async get(address: string): Promise<(TokenListItem & { raw: Record<string, unknown> }) | null> {
    const res = await fetch(`${this.sdk.apiBase}/api/tokens/${address}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', `token fetch failed (${res.status})`, { retriable: true });
    const raw = await res.json() as RawSummary & Record<string, unknown>;
    return { ...this.normalize(raw), raw };
  }

  /** Poll until the indexer knows the token (default 60s, ~3s per check). */
  async waitUntilIndexed(address: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TokenListItem> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      throwIfAborted(opts.signal, 'indexing');
      const t = await this.get(address).catch(() => null);
      if (t) return t;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new OpenfairError('IndexerTimeout', 'the indexer did not pick the token up in time', { stage: 'indexing', retriable: true, suggestedAction: 'the token exists on-chain; check again later' });
  }

  /** Launch phase + curve progress. */
  async getLaunchStatus(address: string): Promise<LaunchStatus | null> {
    const t = await this.get(address);
    if (!t) return null;
    const raw = t.raw as { kind: string; graduated: boolean; readyToGraduate: boolean; startTime: number; state?: { progress?: number; ethCollected?: string; saleProceeds?: string } | null; targetEth?: string };
    if (raw.kind === 'direct') return { phase: 'instant', progress: 1 };
    if (raw.graduated) return { phase: 'graduated', progress: 1 };
    if (raw.readyToGraduate) return { phase: 'readyToGraduate', progress: 1 };
    if (raw.startTime > Date.now() / 1000) return { phase: 'upcoming', progress: 0 };
    return { phase: 'curve', progress: raw.state?.progress ?? 0, ethCollected: raw.state?.ethCollected, targetEth: raw.targetEth };
  }

  // ---- pay a quote-paired launch in the chain's coin (OpenZap, spec §10) ----

  /**
   * The launch + pair behind a token, refusing every state in which the zap
   * cannot be used – so the caller gets a reason instead of a revert.
   */
  /**
   * The OpenZap a launch trades through (1.4.0).
   *
   * A chain with generation 3 has TWO zaps, and they are not interchangeable:
   * OpenZap checks `launch.factory() == its own factory` and reverts
   * UnknownLaunch for anything else. So the launch is asked which factory made
   * it, on chain – not the API, not a guess – and only the zap of that exact
   * factory is ever used: the manifest's `zap` for the generation-2 factory,
   * `zapG3` for the generation-3 one. A launch of any other factory has no zap
   * this SDK will send coin to, or ask a seller to approve.
   */
  private async zapFor(launch: Address): Promise<Address> {
    const c = this.sdk.manifest.contracts;
    const made = await this.sdk.public.readContract({ address: launch, abi: launchAbi, functionName: 'factory' })
      .catch((e: unknown) => {
        throw new OpenfairError('NetworkUnavailable', 'could not read which factory made this launch', { stage: 'validating', retriable: true, cause: e });
      }) as Address;
    // slot(): a manifest without the generation-3 keys (1.3.x shape) has
    // `undefined` there, which must read as "no such factory", not throw.
    const is = (a: Address | null | undefined): boolean => {
      const s = slot(a);
      return s !== null && s.toLowerCase() === String(made).toLowerCase();
    };
    const zap2 = slot(c.zap);
    const zap3 = slot(c.zapG3);
    if (is(c.factory) && zap2) return zap2;
    if (is(c.factoryG3) && zap3) return zap3;
    throw new OpenfairError('ZapUnavailable',
      `this launch was made by ${made}, which has no OpenZap on chain ${this.sdk.manifest.chainId} – trade it in its own asset`,
      { stage: 'validating' });
  }

  private async curvePair(token: string): Promise<{ launch: Address; quote: Address; zap: Address }> {
    const c = this.sdk.manifest.contracts;
    if (!slot(c.zap) && !slot(c.zapG3)) {
      throw new OpenfairError('ZapUnavailable', `chain ${this.sdk.manifest.chainId} has no OpenZap deployment – trade this launch in its own asset`, { stage: 'validating' });
    }
    const t = await this.get(token);
    if (!t) throw new OpenfairError('TokenNotFound', `${token} is not an openfair launch`, { stage: 'validating' });
    const raw = t.raw as { launch?: string; kind?: string; graduated?: boolean; quote?: { address?: string } | null };
    if (raw.kind === 'direct' || raw.graduated) {
      throw new OpenfairError('NotOnCurve', 'this token trades in a Uniswap pool, not on a curve – swap WETH -> quote -> token on the router instead', { stage: 'validating' });
    }
    if (!raw.quote?.address) {
      throw new OpenfairError('NotQuoteLaunch', 'this launch collects the chain coin already – buy it directly, no zap needed', { stage: 'validating' });
    }
    const launch = raw.launch as Address;
    return { launch, quote: raw.quote.address as Address, zap: await this.zapFor(launch) };
  }

  /**
   * Best of the three tiers for one hop, or null when none of them prices.
   *
   * QuoterV2 is NOT in the chain manifest (the manifests carry the openfair
   * deployment, not Uniswap's periphery), so this on-chain path only exists for
   * the chain THIS bundle was built for. Targeting another chain's zap through
   * `new Openfair({ chainId })` leaves the API as the only pricing source –
   * which is the normal case anyway, and a missing route is reported as
   * NoRoute rather than guessed.
   */
  private async bestHop(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ poolFee: number; amountOut: bigint } | null> {
    if (this.sdk.manifest.chainId !== CHAIN.id) return null;
    const quoter = ADDR.quoterV2 as Address;
    const legs = await Promise.all([500, 3000, 10000].map(async (poolFee) => {
      try {
        const r = await this.sdk.public.readContract({
          address: quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle',
          args: [{ tokenIn, tokenOut, amountIn, fee: poolFee, sqrtPriceLimitX96: 0n }],
        }) as readonly [bigint, bigint, number, bigint];
        return { poolFee, amountOut: r[0] };
      } catch { return null; }
    }));
    let best: { poolFee: number; amountOut: bigint } | null = null;
    for (const l of legs) if (l && l.amountOut > 0n && (best === null || l.amountOut > best.amountOut)) best = l;
    return best;
  }

  /**
   * Price an ETH buy (`ethIn`) or an ETH-settled sell (`tokensIn`) end to end.
   * The openfair API answers the buy side from a 10 s cache; both sides fall
   * back to QuoterV2 + the curve's own views, so an integrator pointed at a
   * backend that predates the route still gets numbers.
   *
   * `slippageBps` sizes BOTH floors (default 2 %). Never send a zero floor: the
   * contract accepts it on purpose (aggregators need "any price") and it makes
   * the trade a free sandwich.
   */
  async zapQuote(token: string, opts: { ethIn?: bigint; tokensIn?: bigint; slippageBps?: number } = {}): Promise<ZapQuote> {
    const { launch, quote, zap } = await this.curvePair(token);
    const bps = BigInt(10000 - (opts.slippageBps ?? 200));
    /** The second leg spends what the first delivered, and the first may fill
     *  at exactly its own floor – so the haircuts compound. One haircut on both
     *  legs is a revert on a route that stayed inside tolerance. */
    const floor2 = (x: bigint) => (x * bps * bps) / 100000000n;
    const weth = this.sdk.manifest.contracts.weth;
    if (opts.tokensIn !== undefined) {
      if (opts.tokensIn <= 0n) throw new OpenfairError('BadConfig', 'tokensIn must be > 0', { stage: 'validating' });
      const quoteOut = await this.sdk.public.readContract({
        address: launch, abi: launchAbi, functionName: 'quoteSell', args: [opts.tokensIn],
      }).catch(() => 0n) as bigint;
      const leg = quoteOut > 0n ? await this.bestHop(quote, weth, quoteOut) : null;
      if (!leg) throw new OpenfairError('NoRoute', 'no WETH pool for the pair asset could be priced', { stage: 'quoting', retriable: true });
      return {
        token: token as Address, launch, zap, quote, poolFee: leg.poolFee,
        amountIn: opts.tokensIn, quoteOut, amountOut: leg.amountOut,
        // Curve leg once, pool leg twice: the pool is quoted from the FULL
        // curve payout while the curve may legally pay only (1-s) of it.
        minQuoteOut: quoteOut * bps / 10000n, minAmountOut: floor2(leg.amountOut),
        source: 'chain',
      };
    }
    const ethIn = opts.ethIn ?? 0n;
    if (ethIn <= 0n) throw new OpenfairError('BadConfig', 'pass ethIn (buy) or tokensIn (sell)', { stage: 'validating' });
    // The wire names are the *Wei ones (ZapQuote in docs/openapi.yaml). Reading
    // `quoteOut`/`tokensOut` here made every API answer look empty and sent
    // every caller down the chain path – including the cross-chain manifests
    // bestHop() cannot serve at all.
    const fromApi = await fetch(`${this.sdk.apiBase}/api/v1/zap-quote?launch=${launch}&ethIn=${ethIn.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => (b?.data ?? null) as {
        poolFee?: number | string; quoteOutWei?: string; tokensOutWei?: string | null;
        fillsCurve?: boolean; suggestedEthInWei?: string | null; quotedAt?: string;
      } | null)
      .catch(() => null);
    if (fromApi?.quoteOutWei && fromApi.tokensOutWei) {
      const quoteOut = BigInt(fromApi.quoteOutWei);
      const tokensOut = BigInt(fromApi.tokensOutWei);
      if (quoteOut > 0n && tokensOut > 0n) {
        return {
          token: token as Address, launch, zap, quote, poolFee: Number(fromApi.poolFee),
          amountIn: ethIn, quoteOut, amountOut: tokensOut,
          minQuoteOut: quoteOut * bps / 10000n, minAmountOut: floor2(tokensOut),
          source: 'api',
          fillsCurve: fromApi.fillsCurve ?? false,
          suggestedAmountIn: fromApi.suggestedEthInWei ? BigInt(fromApi.suggestedEthInWei) : null,
          quotedAt: fromApi.quotedAt,
        };
      }
    }
    const leg = await this.bestHop(weth, quote, ethIn);
    if (!leg) throw new OpenfairError('NoRoute', 'no WETH pool for the pair asset could be priced', { stage: 'quoting', retriable: true });
    const tokensOut = await this.sdk.public.readContract({
      address: launch, abi: launchAbi, functionName: 'quoteBuy', args: [leg.amountOut],
    }).catch(() => 0n) as bigint;
    if (tokensOut === 0n) throw new OpenfairError('NoRoute', 'the curve returned nothing for that amount', { stage: 'quoting', retriable: true });
    return {
      token: token as Address, launch, zap, quote, poolFee: leg.poolFee,
      amountIn: ethIn, quoteOut: leg.amountOut, amountOut: tokensOut,
      // Pool leg once, curve leg twice – it is priced from the full pool output.
      minQuoteOut: leg.amountOut * bps / 10000n, minAmountOut: floor2(tokensOut),
      source: 'chain',
    };
  }

  /**
   * Buy a quote-paired launch with the chain's coin in ONE signature: the zap
   * wraps, swaps and buys on the curve, and the tokens are credited to the
   * caller (the curve books the buy against them, so the anti-snipe cap and the
   * ramp apply to the buyer, not to the zap). No allowance is involved – the
   * payment is msg.value.
   */
  async buyWithEth(token: string, opts: { ethIn: bigint; slippageBps?: number; deadlineSec?: number; quote?: ZapQuote } = { ethIn: 0n }): Promise<`0x${string}`> {
    const sdk = this.sdk;
    const q = opts.quote ?? await this.zapQuote(token, { ethIn: opts.ethIn, slippageBps: opts.slippageBps });
    // The launch's own zap: from the quote, or asked of the launch itself for a
    // quote built before 1.4.0 carried one.
    const zap = q.zap ?? await this.zapFor(q.launch);
    if (!sdk.account) await sdk.connect();
    try {
      const hash = await sdk.walletClient().writeContract({
        chain: sdk.chain, account: sdk.account!,
        address: zap, abi: zapAbi, functionName: 'buyWithEth',
        args: [q.launch, q.poolFee, q.minQuoteOut, q.minAmountOut, deadline(opts.deadlineSec)],
        value: q.amountIn,
      });
      await sdk.public.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { throw explainRevert(e, 'awaiting_wallet'); }
  }

  /**
   * Sell curve tokens for the chain's coin. Two signatures: the zap moves the
   * tokens with transferFrom, so it needs an allowance first (exact amount –
   * this is a per-trade allowance, not a standing one).
   */
  async sellForEth(token: string, opts: { tokensIn: bigint; slippageBps?: number; deadlineSec?: number; quote?: ZapQuote } = { tokensIn: 0n }): Promise<`0x${string}`> {
    const sdk = this.sdk;
    const q = opts.quote ?? await this.zapQuote(token, { tokensIn: opts.tokensIn, slippageBps: opts.slippageBps });
    // Chosen BEFORE anything is approved: the allowance is granted to this
    // address, and an approval to the other generation's zap is a signature
    // spent on a sell that reverts UnknownLaunch.
    const zap = q.zap ?? await this.zapFor(q.launch);
    if (!sdk.account) await sdk.connect();
    try {
      const allowance = await sdk.public.readContract({
        address: q.token, abi: erc20Abi, functionName: 'allowance', args: [sdk.account!, zap],
      }).catch(() => 0n) as bigint;
      if (allowance < q.amountIn) {
        const approval = await sdk.walletClient().writeContract({
          chain: sdk.chain, account: sdk.account!,
          address: q.token, abi: erc20Abi, functionName: 'approve', args: [zap, q.amountIn],
        });
        await sdk.public.waitForTransactionReceipt({ hash: approval });
      }
      const hash = await sdk.walletClient().writeContract({
        chain: sdk.chain, account: sdk.account!,
        address: zap, abi: zapAbi, functionName: 'sellForEth',
        args: [q.launch, q.amountIn, q.minQuoteOut, q.poolFee, q.minAmountOut, deadline(opts.deadlineSec)],
      });
      await sdk.public.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { throw explainRevert(e, 'awaiting_wallet'); }
  }
}

// ---------------------------------------------------------------------------
// Referral revenue (on-chain accruals; instant LP fees are auto-paid)
// ---------------------------------------------------------------------------
class ReferralsApi {
  constructor(private sdk: Openfair) {}

  /** Launches attributed to the referrer (scans the public list, ≤500 newest). */
  async getPositions(referrer?: string): Promise<ReferralPosition[]> {
    const sdk = this.sdk;
    const who = (referrer ?? sdk.referrer ?? sdk.account)?.toLowerCase();
    if (!who) throw new OpenfairError('BadInput', 'pass a referrer or construct the SDK with one');
    const found: ReferralPosition[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const { items, nextCursor } = await sdk.tokens.list({ limit: 100, cursor: cursor ?? undefined });
      for (const t of items) {
        if (t.referrer?.toLowerCase() !== who) continue;
        const raw = (await sdk.tokens.get(t.address))?.raw as { launch?: string } | undefined;
        const launch = raw?.launch && raw.launch.startsWith('0x') ? raw.launch as Address : null;
        let claimable = 0n;
        if (t.mode === 'fair' && launch) {
          claimable = await sdk.public.readContract({ address: launch, abi: launchAbi, functionName: 'feesAccrued', args: [who as Address] }).catch(() => 0n) as bigint;
        }
        found.push({ token: t.address, name: t.name, symbol: t.symbol, mode: t.mode, launch, claimableWei: claimable });
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return found;
  }

  /** Positions with a claimable balance (curve-phase accruals only – instant
   * LP-fee referral cuts are paid automatically on every harvest). */
  async getClaimable(referrer?: string): Promise<ReferralPosition[]> {
    return (await this.getPositions(referrer)).filter((p) => p.claimableWei > 0n);
  }

  async getStats(referrer?: string): Promise<{ launches: number; fairLaunches: number; instantLaunches: number; claimableWei: bigint }> {
    const pos = await this.getPositions(referrer);
    return {
      launches: pos.length,
      fairLaunches: pos.filter((p) => p.mode === 'fair').length,
      instantLaunches: pos.filter((p) => p.mode === 'instant').length,
      claimableWei: pos.reduce((a, p) => a + p.claimableWei, 0n),
    };
  }

  /** Claim accrued curve fees from one launch contract. */
  async claim(launch: Address): Promise<`0x${string}`> {
    const sdk = this.sdk;
    if (!sdk.account) await sdk.connect();
    const hash = await sdk.walletClient().writeContract({
      chain: sdk.chain, account: sdk.account!,
      address: launch, abi: launchAbi, functionName: 'claimFees', args: [sdk.account!],
    });
    await sdk.public.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Claim everything claimable, sequentially. Returns tx hashes. */
  async claimAll(referrer?: string): Promise<`0x${string}`[]> {
    const claimable = await this.getClaimable(referrer);
    const hashes: `0x${string}`[] = [];
    for (const p of claimable) {
      if (p.launch) hashes.push(await this.claim(p.launch));
    }
    return hashes;
  }
}

// ---------------------------------------------------------------------------
// Contract registry + deployment verification
// ---------------------------------------------------------------------------
class ContractsApi {
  constructor(private sdk: Openfair) {}

  /**
   * Addresses, versions and the factory ABI for the active (or any) chain.
   *
   * `abi` is the ABI of THAT factory's own shape (1.4.0) – the one its create
   * entry points actually have, plus deployFee / supporterFeeBps /
   * updateMetadata:
   *  - generation 2 (default, `factory`): quote-aware on a factory of version
   *    3.0 and up (Robinhood 4663 – native creates too, with `quote = 0`),
   *    pre-quote on the stable lineage (Arc 5042, Stable 988) – the 1.3.x
   *    answer there, unchanged;
   *  - `{ generation: 3 }` (`factoryG3`): the generation-3 entry points, which
   *    take the FeeSplit after the params – quote-aware on the shared lineage,
   *    pre-quote on the stable one. BadConfig on a chain without generation 3.
   * `factory` / `generation` say which address the ABI belongs to. Before
   * 1.4.0 this was the pre-quote ABI for every chain, and on 4663 its
   * createLaunch / createDirectListing selectors are ones the live factory
   * does not have.
   */
  info(chainId?: number, opts: { generation?: 2 | 3 } = {}): { manifest: ChainManifest; abi: FactoryInfoAbi; sdkVersion: string; factory: Address; generation: 2 | 3 } {
    const m = CHAIN_MANIFESTS[chainId ?? this.sdk.manifest.chainId];
    if (!m) throw new OpenfairError('BadConfig', `unknown chainId ${chainId}`);
    const generation = opts.generation ?? 2;
    if (generation !== 2 && generation !== 3) throw new OpenfairError('BadConfig', `generation must be 2 or 3, got ${String(generation)}`);
    if (generation === 2) {
      const abi = speaksQuoteShape(m, 2) ? factoryInfoAbis.g2Quote : factoryInfoAbis.g2Plain;
      return { manifest: m, abi, sdkVersion: SDK_VERSION, factory: m.contracts.factory, generation };
    }
    const g3 = slot(m.contracts.factoryG3);
    if (g3 === null) throw new OpenfairError('BadConfig', `chain ${m.chainId} has no generation-3 factory`);
    const abi = speaksQuoteShape(m, 3) ? factoryInfoAbis.g3Quote : factoryInfoAbis.g3Plain;
    return { manifest: m, abi, sdkVersion: SDK_VERSION, factory: g3, generation };
  }

  /** All chains the SDK ships manifests for. */
  deployments(): ChainManifest[] { return Object.values(CHAIN_MANIFESTS); }

  /** Check that the factory at `address` (default: active manifest) is a live
   * openfair deployment: has code, answers deployFee(), carries provenance.
   * `generation` (1.4.0) says which of the manifest's factories the address
   * is – 2 for `factory`, 3 for `factoryG3` – and is absent for any other. */
  async verifyDeployment(address?: Address): Promise<{ verified: boolean; factory: Address; deployFeeWei?: bigint; reason?: string; generation?: 2 | 3 }> {
    const sdk = this.sdk;
    const factory = address ?? sdk.manifest.contracts.factory;
    const c = sdk.manifest.contracts;
    // slot(): an absent generation-3 key (a 1.3.x-shaped manifest) is "none".
    const same = (a: Address | null | undefined) => {
      const s = slot(a);
      return s !== null && s.toLowerCase() === factory.toLowerCase();
    };
    const generation = same(c.factory) ? 2 as const : same(c.factoryG3) ? 3 as const : undefined;
    const tag = generation === undefined ? {} : { generation };
    const code = await sdk.public.getCode({ address: factory }).catch(() => undefined);
    if (!code || code === '0x') return { verified: false, factory, reason: 'no contract code at the address', ...tag };
    try {
      const fee = await sdk.public.readContract({ address: factory, abi: factoryAbi, functionName: 'deployFee' }) as bigint;
      return { verified: true, factory, deployFeeWei: fee, ...tag };
    } catch {
      return { verified: false, factory, reason: 'the contract does not answer the factory ABI', ...tag };
    }
  }
}

// ---------------------------------------------------------------------------
// Quote pairs: the allow-list of assets a launch can be priced in
// ---------------------------------------------------------------------------
interface RawQuote {
  address: string; symbol: string | null; decimals: number | null; feed: string | null;
  enabled: boolean; priceUsd: number | null; updatedAtUnix: number | null; stale: boolean;
  deployFeeWei: string | null; targetWei: string | null; startFdvWei: string | null;
}

class QuotesApi {
  // 60 s, matching the backend's own cache: the figures move with a Chainlink
  // feed, and a create page that renders a list re-asks on every keystroke.
  private cache: { at: number; items: QuoteAsset[] } | null = null;
  constructor(private sdk: Openfair) {}

  /** Does this chain have a QuoteRegistry at all? */
  get supported(): boolean { return this.sdk.manifest.contracts.registry !== null; }
  /** The chain's QuoteRegistry, or null where quote pairs are off. */
  get registry(): Address | null { return this.sdk.manifest.contracts.registry; }

  /**
   * Allow-listed assets, newest figures from the openfair API. Empty on a chain
   * without a registry and on a backend that predates quote pairs – so a caller
   * that always shows the list simply shows nothing there.
   */
  async list(opts: { force?: boolean } = {}): Promise<QuoteAsset[]> {
    if (!this.supported) return [];
    if (!opts.force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.items;
    const res = await fetch(`${this.sdk.apiBase}/api/v1/quotes`).catch(() => null);
    if (!res || !res.ok) {
      if (this.cache) return this.cache.items;
      if (res && res.status === 404) return [];
      throw new OpenfairError('NetworkUnavailable', 'the quote list could not be read', { retriable: true });
    }
    const body = await res.json() as { data?: { items?: RawQuote[] } };
    const items = (body.data?.items ?? []).map((r): QuoteAsset => ({
      address: r.address as Address,
      symbol: r.symbol,
      decimals: r.decimals ?? 18, // v1 registry enforces 18
      feed: (r.feed as Address | null) ?? null,
      enabled: !!r.enabled,
      priceUsd: r.priceUsd ?? null,
      updatedAt: r.updatedAtUnix ?? null,
      stale: !!r.stale,
      deployFeeWei: r.deployFeeWei === null ? null : BigInt(r.deployFeeWei),
      targetWei: r.targetWei === null ? null : BigInt(r.targetWei),
      startFdvWei: r.startFdvWei === null ? null : BigInt(r.startFdvWei),
    }));
    this.cache = { at: Date.now(), items };
    return items;
  }

  /** One asset by address (case-insensitive), or null if it is not listed. */
  async get(address: string): Promise<QuoteAsset | null> {
    const want = address.toLowerCase();
    return (await this.list()).find((q) => q.address.toLowerCase() === want) ?? null;
  }

  /**
   * @internal get() for the launch pipeline: turns every reason a pair cannot
   * be used into the error the caller can act on, instead of a revert later.
   */
  async require(address: string): Promise<QuoteAsset> {
    if (!this.supported) {
      throw new OpenfairError('QuotePairsUnavailable', `chain ${this.sdk.manifest.chainId} has no quote registry – omit \`quote\` to launch in ${this.sdk.manifest.currency.symbol}`, { stage: 'validating' });
    }
    const qa = await this.get(address);
    if (!qa || !qa.enabled) {
      throw new OpenfairError('QuoteNotAllowed', `${address} is not an allow-listed quote asset`, { stage: 'validating', suggestedAction: 'call quotes.list() for the assets a launch may be paired with' });
    }
    if (qa.deployFeeWei === null || qa.targetWei === null || qa.startFdvWei === null) {
      throw new OpenfairError('QuotePriceStale', `the price feed for ${qa.symbol ?? address} is stale or unreadable – creation would revert`, { stage: 'validating', retriable: true, suggestedAction: 'try again when the feed publishes (equity feeds trade 24/5)' });
    }
    return qa;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function short(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

/**
 * Do this chain's create structs carry the quote fields, for the factory of
 * this generation?
 *
 * Generation 2: the manifest's factoryVersion – v3 is the first quote-aware
 * generation – exactly the rule the vanity planner applies (lib/vanity.ts
 * isQuoteAwareFactory). Generation 3 keeps its LINEAGE's structs and only
 * appends the split (D15), and only the shared lineage has quote fields.
 */
function speaksQuoteShape(m: ChainManifest, generation: 2 | 3): boolean {
  if (generation === 3) return m.lineage === 'shared';
  return isQuoteAwareFactory({
    contracts: {
      launchFactory: m.contracts.factory, factoryVersion: m.factoryVersion,
      fairTokenDeployer: m.contracts.fairTokenDeployer, simpleTokenDeployer: m.contracts.simpleTokenDeployer,
    },
    features: { quotePairs: m.contracts.registry !== null },
  });
}

/**
 * A caller's `feeSplit`, checked field by field BEFORE lib/feeSplit.ts sees
 * it: that module rounds and clamps (it serves a form), and a split is money –
 * 1500.4, -1 or "1500" is refused here rather than quietly becoming a number
 * nobody typed. All three fields are required.
 */
function checkedFeeSplit(
  raw: unknown,
  bad: (message: string, contractReason?: string, suggestedAction?: string) => OpenfairError,
): FeeSplitArg {
  if (!raw || typeof raw !== 'object') throw bad('feeSplit must be { holdersBps, buybackBps, tokenHoldersBps }');
  const o = raw as Record<string, unknown>;
  const field = (k: keyof FeeSplitArg): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > BPS) {
      throw bad(`feeSplit.${k} must be an integer 0..${BPS}, got ${JSON.stringify(v) ?? 'undefined'}`, undefined, 'bps: 1500 = 15 %');
    }
    return v;
  };
  return { holdersBps: field('holdersBps'), buybackBps: field('buybackBps'), tokenHoldersBps: field('tokenHoldersBps') };
}

/** Wall-clock bound OpenZap enforces itself – SwapRouter02 moved the deadline
 *  out of its params struct into multicall, which the zap does not use. */
function deadline(seconds = 600): bigint { return BigInt(Math.floor(Date.now() / 1000) + seconds); }

function throwIfAborted(signal: AbortSignal | undefined, stage: LaunchStage) {
  if (signal?.aborted) throw new OpenfairError('Aborted', 'the operation was aborted', { stage, retriable: true });
}

function fmtNative(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

/** Price-multiple + sale-supply derivation, mirrored from openfair.app:
 * every launch starts at the fixed START_FDV, so M is fully determined. */
function deriveCurve(curveType: 0 | 1 | 2, totalSupply: number, econ: ChainManifest['economics']): { multiple: number; saleSupply: number } {
  const TARGET_ETH = econ.target;
  const START_FDV_ETH = econ.startFdv;
  const T = totalSupply;
  let best = 2, bestErr = Infinity;
  const per = (M: number) => curveType === 0
    ? (() => { const r = Math.sqrt(M) / (Math.sqrt(M) - 1); return 1 / (1 + (r - 1) / r); })()
    : curveType === 1 ? 1 / (1 + (M + 1) / (2 * M)) : 1 / (1 + (M + 2) / (3 * M));
  for (let M = 2; M <= 400; M++) {
    const S = T * per(M) * 0.98;
    const p0 = curveType === 0 ? TARGET_ETH / (S * Math.sqrt(M))
      : curveType === 1 ? 2 * TARGET_ETH / (S * (M + 1))
      : 3 * TARGET_ETH / (S * (M + 2));
    const err = Math.abs(p0 * T - START_FDV_ETH);
    if (err < bestErr) { bestErr = err; best = M; }
  }
  const saleSupply = Math.floor(T * per(best) * 0.98);
  return { multiple: best, saleSupply };
}

/** Anti-snipe: presets mirrored from the site, or the raw on-chain knobs. */
function antiSnipeNumbers(cfg: 'standard' | 'normal' | 'hardcore' | AntiSnipeCustom, saleSupply: number, totalSupply: number) {
  if (cfg === 'standard') return { ramp: 0, capRate: 0 };
  if (typeof cfg === 'object') {
    const ramp = cfg.rampSeconds && cfg.rampSeconds > 0 ? Math.ceil(saleSupply / cfg.rampSeconds) : 0;
    const capRate = cfg.walletCapPct && cfg.walletCapPct > 0
      ? Math.floor((cfg.walletCapPct / 100) * totalSupply / ((cfg.walletCapWindowBlocks ?? 75) * 12))
      : 0;
    return { ramp, capRate };
  }
  const ramp = Math.ceil(saleSupply / (cfg === 'hardcore' ? 86400 : 41400));
  const capPct = cfg === 'hardcore' ? 0.5 : 1.5;
  const capBlocks = cfg === 'hardcore' ? 100 : 75;
  const capRate = Math.floor((capPct / 100) * totalSupply / (capBlocks * 12));
  return { ramp, capRate };
}
