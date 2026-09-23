export interface NetworkEntry {
  key: string;
  chainId: number;
  hexId: string;
  name: string;
  testnet: boolean;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  /** Optional ordered fallback list, `rpcUrl` first – read by the site's own
   *  browser client (src/lib/rpc.ts) and by nothing else. Absent = one endpoint. */
  rpcUrls?: readonly string[];
  explorer: string;
  /** Is that explorer one a reader can actually open? Absent (= public) on
   *  every chain but Arc, whose only explorer – explorer.arc.io, the host
   *  Circle's docs, Uniswap's chain config and Relay all name – answers a
   *  Cloudflare Access login on every path. Surfaces that would promise a
   *  lookup ("verified on …", a "view on explorer" button) ask this first and
   *  offer DexScreener or the Uniswap token page instead. */
  explorerPublic?: boolean;
  origin: string;
  api: string;
  mcp: string;
  sdk: string;
  embed: string;
  /** Which source tree this chain's contracts were compiled from:
   *  'shared' = contracts/src/ (Robinhood), 'stable' = contracts/src/stable/
   *  (Arc 5042, Stable 988). The two compile DIFFERENT structs under the same
   *  names, so this is what every encoder asks before it builds calldata –
   *  lib/vanity.ts for the token constructor's arity, lib/crowdAbi.ts for the
   *  crowd tuple (25 fields and no `quote` on the stable lineage against the
   *  shared build's 26). Also what the backend resolves artifacts by. */
  lineage: 'shared' | 'stable';
  factoryVersion: string;
  /** The five launch contracts (factory, the two deployers, promotions,
   *  subdomains) are null ONLY while a chain is built and not yet broadcast –
   *  the state Arc was in until its mainnet broadcast on 2026-09-16, and the
   *  state the next chain will be in. All three deployments carry addresses
   *  today. The nullability stays because it is what CONTRACTS_PENDING reads:
   *  every consumer publishes what it finds here, so an address-shaped value is
   *  a claim that something is deployed and a null is the true statement "not
   *  yet". `weth` is never null – it is the pool quote asset, which exists
   *  before anything of ours does. registry = QuoteRegistry (quote pairs), zap
   *  = OpenZap (pay a quote-paired launch in the native coin); null where the
   *  chain has neither. */
  contracts: {
    factory: string | null; simpleTokenDeployer: string | null; fairTokenDeployer: string | null;
    promotions: string | null; subdomains: string | null; weth: string;
    registry: string | null; zap: string | null;
    /** Generation 3 (the enforced fee split), ADDITIVE: `factory` / `zap` and
     *  `crowdContracts.factory` keep their generation-2 meaning for ever. Read
     *  by the site only (lib/config.ts STATIC_*_G3), to pin the running
     *  backend's `contracts.launchFactoryG3` / `crowdFactoryG3` / `zapG3`.
     *  Absent or null = this chain has no generation 3 (Stable 988), or no zap
     *  for it (Arc, which has no quote pairs). */
    launchFactoryG3?: string | null;
    crowdFactoryG3?: string | null;
    zapG3?: string | null;
  };
  /** Can a launch here actually be paired with a tokenised asset? A deployed
   *  QuoteRegistry is not the answer: Arc's is deployed empty and stays empty,
   *  so `contracts.registry != null` would publish text for a feature the
   *  chain does not offer. Every build-time quote-pairs surface reads this. */
  quotePairs: boolean;
  /** Does the chain have a CrowdFactory (the soft-cap launch mode)? THE
   *  predicate for every static surface that publishes text about it –
   *  the [[crowd]] prose blocks and lib/config.ts CROWD_TABLE, which is
   *  derived from this field rather than retyped. */
  crowd: boolean;
  /** The crowd generation's own five addresses, for a chain that carries the
   *  contracts in the REGISTRY rather than only in a running backend – which is
   *  what a stable-lineage switch-on has to do, because there `crowd: true` is a
   *  claim about a factory whose 25-field tuple this bundle encodes at build
   *  time (lib/crowdAbi.ts), not a storefront flag a backend can walk back.
   *
   *  The five are the same five the backend's own override block needs
   *  (backend/src/config.js: crowdFactory, crowdDeployer, crowdTokenDeployer,
   *  teamVestingDeployer, poolSeeder): the factory is where a create is sent,
   *  the three helpers are what the verify worker links and resolves children
   *  against, and without them not one crowd child would ever verify.
   *
   *  Absent (or null) = this chain has no crowd generation. A HALF-filled block
   *  is the state the rule in tests/crowd-lineage-abi.test.mjs exists to refuse:
   *  the same shape of bug as a half-broadcast `contracts` block, where the
   *  first paste re-opens a control pointed at 0x0000…0000. */
  crowdContracts?: {
    factory: string | null;
    deployer: string | null;
    tokenDeployer: string | null;
    teamVesting: string | null;
    poolSeeder: string | null;
  } | null;
  /** First block a crowd backfill has to look at – the block the CrowdFactory
   *  was created in. Per deployment, like the address itself; null/absent where
   *  the chain has no crowd generation. Without it an indexer sweeps from the
   *  chain's genesis for a factory that has existed for a day. */
  crowdStartBlock?: number | null;
  /** Does the chain have a bridge page (/bridge + nine locale variants)? The
   *  page is chain-aware: Robinhood's is the Arbitrum canonical bridge from
   *  Ethereum, Arc's is Relay plus Circle's CCTP. Stable has neither. The
   *  prerender (which files to write), the SPA route and the backend sitemap
   *  (which URLs to list) all read this one flag. */
  bridge: boolean;
  /** Everything priced in the chain's native unit. Single source of truth:
   *  the site config, the API, the MCP tools and the SDK manifests all read
   *  these, so the figures cannot drift apart per surface.
   *  starterLow/High are the "you need about this much to get going" range
   *  quoted in the guides (creation fee + gas). */
  economics: {
    deployFee: number; target: number; startFdv: number;
    boost: number; topSlot: number;
    starterLow: string; starterHigh: string;
  };
  /** What `contracts.weth` is, for the on-site Uniswap panel. `decimals` is
   *  the pool-side scale of a NATIVE launch (6 wherever the quote is the
   *  native coin's own ERC-20 face); `wrapped` says whether the router may be
   *  handed msg.value and asked to wrap/unwrap, or whether the swap is a plain
   *  ERC-20 swap because there is no wrapper on the chain at all. `stable` is
   *  a third, independent fact – IS the native coin itself a dollar
   *  stablecoin (Arc's USDC, Stable's USDT0)? – never inferred from
   *  `decimals`, and it is what drives the trade panel's quick-buy presets
   *  to dollar sizes instead of ETH-sized fractions. */
  nativeQuote: { decimals: number; wrapped: boolean; stable: boolean };
  /** Where this chain's contracts are verified, and under what name – the
   *  explorer where the explorer is the target a reader checks, and both
   *  targets named in one phrase where the worker submits to both (Arc). */
  verify: { name: string; url: string };
  /** The explorer's product name, where it differs from `verify.name` – i.e.
   *  where the chain verifies against more than its own explorer. Optional;
   *  `verify.name` is the fallback. */
  explorerName?: string;
  dexSwapUrl: string;
  /** DexScreener chart slug, null where the chain is not indexed. */
  dexscreenerSlug: string | null;
  /** Public "view this token" page for a chain with no public explorer
   *  (explorerPublic:false); null where the explorer is it. Arc keeps one
   *  though its explorer is public again – lib/explorer.ts simply never
   *  reaches the fallback while EXPLORER_PUBLIC is true. */
  dexTokenUrl: string | null;
}
export const NETWORKS: NetworkEntry[];
export function networkByChainId(id: number | string): NetworkEntry | undefined;
