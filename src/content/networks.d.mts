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
   *  ERC-20 swap because there is no wrapper on the chain at all. */
  nativeQuote: { decimals: number; wrapped: boolean };
  /** Where this chain's contracts are verified, and under what name – the
   *  explorer where it has a public one, Sourcify where it has not. */
  verify: { name: string; url: string };
  dexSwapUrl: string;
  /** DexScreener chart slug, null where the chain is not indexed. */
  dexscreenerSlug: string | null;
  /** Public "view this token" page for a chain with no public explorer
   *  (explorerPublic:false); null everywhere else, where the explorer is it. */
  dexTokenUrl: string | null;
}
export const NETWORKS: NetworkEntry[];
export function networkByChainId(id: number | string): NetworkEntry | undefined;
