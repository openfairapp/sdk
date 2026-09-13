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
  origin: string;
  api: string;
  mcp: string;
  sdk: string;
  embed: string;
  factoryVersion: string;
  /** registry = QuoteRegistry (quote pairs), zap = OpenZap (pay a quote-paired
   *  launch in the native coin); null where the chain has neither. */
  contracts: {
    factory: string; simpleTokenDeployer: string; fairTokenDeployer: string; weth: string;
    registry: string | null; zap: string | null;
  };
  /** Can a launch here actually be paired with a tokenised asset? A deployed
   *  QuoteRegistry is not the answer: Arc's is deployed empty and stays empty,
   *  so `contracts.registry != null` would publish text for a feature the
   *  chain does not offer. Every build-time quote-pairs surface reads this. */
  quotePairs: boolean;
  /** Does the chain have a bridge page (/bridge + nine locale variants)? The
   *  page is about the Arbitrum canonical bridge from Ethereum, so Robinhood
   *  only. The prerender (which files to write), the SPA route and the backend
   *  sitemap (which URLs to list) all read this one flag. */
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
  dexSwapUrl: string;
}
export const NETWORKS: NetworkEntry[];
export function networkByChainId(id: number | string): NetworkEntry | undefined;
