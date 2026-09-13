import { NETWORKS as REGISTRY } from '../content/networks.mjs';

// openfair deployment config. Robinhood Chain is the default (production);
// building with VITE_CHAIN=stable selects the Stable Mainnet deployment.
// The branch is resolved at build time, so each build ships exactly one chain
// (no runtime multichain) and the unused branch is tree-shaken away.

// WalletConnect Cloud project id (public by design – it ships in the bundle).
export const WC_PROJECT_ID = '9a845b77600cebab8ee3f803776091f5';

// VITE_CHAIN selects the chain at build time. Guarded so the SDK bundle
// (built by esbuild, where import.meta.env is undefined) can import this file
// without crashing – it just falls through to the Robinhood default.
const TARGET_CHAIN =
  ((typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_CHAIN) as string)
  || 'robinhood';
export const IS_STABLE = TARGET_CHAIN === 'stable';
export const IS_ARC = TARGET_CHAIN === 'arc';

// On Stable the native gas token USDT0 is 18-decimal at the EVM level
// (msg.value / parseEther work unchanged) but reads as USDT0. There is no
// wrapped native: `weth` below is the USDT0 ERC-20 (6d) used as the pool quote.
const ROBINHOOD = {
  CHAIN: {
    id: 4663, hexId: '0x1237', name: 'Robinhood Chain',
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  ADDR: {
    // v3 (quote pairs + OpenZap), live 2026-09-10 – docs/deployments/robinhood-v3.
    // The previous generation (v2.1 0x205344a2…D1508, FairTokenDeployer
    // 0x35a0c465…5fAd4E) keeps serving the tokens it minted and stays indexed,
    // but every NEW launch is created here.
    factory: '0x1Af66EB4e249EfB0eDD975A10A8bD6c98789CFce',
    promotions: '0x1aF3Cc534ad6F78eEaBCFfe295FA0210CdFf6b31', // v2.1: supporter via harvester share
    subdomains: '0x78Bcf75c837D3d80959AAb169272EF25aBcC5107',
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    simpleTokenDeployer: '0x69B229843fD08E76D55373901CB57dE571987c36', // unchanged by v3
    fairTokenDeployer: '0x28ae99370203fC25c605Cebb5Cd411Da479d772A', // v3: §12b token ctor
    swapRouter: '0xCaf681a66D020601342297493863E78C959E5cb2',
    quoterV2: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  },
} as const;

const STABLE = {
  CHAIN: {
    id: 988, hexId: '0x3dc', name: 'Stable',
    rpcUrl: 'https://rpc.stable.xyz',
    explorer: 'https://stablescan.xyz',
    currency: { name: 'USDT0', symbol: 'USDT0', decimals: 18 },
  },
  ADDR: {
    factory: '0xd4a5AC9D63954C33b9E0dd045da5fb9e41A1B8f2', // v2: audit fixes
    promotions: '0xdd8715fa10C91ad22e15620023F4A70aDafF245E',
    subdomains: '0x1D16C3600136eD44A3D4FA259aC614Ba4E975123',
    // USDT0 ERC-20 (6d) – the pool quote asset; there is no WETH on Stable.
    weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    simpleTokenDeployer: '0x8b5dCdeF943b16f2a07f56E7ffE38bBad7A9d2bd',
    fairTokenDeployer: '0xB4E8edc4Bcb815Ba3D65D3Dc2d9f3659baF74EA3',
    swapRouter: '0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a', // SwapRouter02
    quoterV2: '0xb070179E7032CdA868b53e6C1742F80c9e940d1A',
  },
} as const;

// Arc (Circle's testnet, chain 5042002). Native gas is USDC with 18-decimal
// EVM semantics, so – unlike Stable – no decimal adaptation is needed and the
// shared contracts run unchanged. It is a TESTNET: no bridge from Ethereum, no
// DEX aggregator coverage, funds come from a faucet.
const ARC = {
  CHAIN: {
    id: 5042002, hexId: '0x4cef52', name: 'ARC',
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorer: 'https://testnet.arcscan.app',
    currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  },
  ADDR: {
    // LaunchFactory v3 (2026-09-12). The 2.1 dollar-economics factory 0x514488E3…
    // and the earlier 0xB35963ED… keep serving the tokens they created (the
    // backend indexes all three).
    factory: '0x8dbbDD311927C7a34f802Fa3cCD4916742d65374', // LaunchFactory v3, 2026-09-12; the 2.1 factories 0x514488E3…/0xB35963ED… stay indexed by the backend
    promotions: '0xFf8b0b4901ccaC881E7C5733ff8A321eA144C31B',
    subdomains: '0xdd8715fa10C91ad22e15620023F4A70aDafF245E',
    weth: '0x911b4000D3422F482F4062a913885f7b035382Df', // WUSDC (18 dec)
    simpleTokenDeployer: '0x6E53cf0adb1A9640E1dCB7DD6ABF3d766Bcd02B6',
    fairTokenDeployer: '0xD25857A5608f28B33354737DC471e1daf1382A1C', // v3 helper – curve vanity salts are mined against it
    swapRouter: '0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01',
    quoterV2: '0x121aeB6DEf00F6F67665008CaC1C19805886ed1a',
  },
} as const;

const NET = IS_ARC ? ARC : IS_STABLE ? STABLE : ROBINHOOD;
const NET_KEY = IS_ARC ? 'arc' : IS_STABLE ? 'stable' : 'robinhood';

/**
 * Economics come from THE network registry (content/networks.mjs), not from a
 * second copy here: the same numbers also feed /api/v1/networks, the MCP
 * tools, the SDK manifests and the embed picker, and keeping two lists in step
 * by hand is exactly how Stable ended up advertising a 5 USDT0 curve target
 * next to its real 10000 one.
 *
 * Note on deployFee: the factory checks msg.value EXACTLY, so this number is a
 * mirror of on-chain state, never an aspiration – change the contract first.
 */
const NET_ENTRY = REGISTRY.find((n) => n.key === NET_KEY) ?? REGISTRY[0];
const ECON = NET_ENTRY.economics;

/** This deployment's own origin – every subdomain self-canonicalizes. */
export const SITE_ORIGIN = NET_ENTRY.origin;

export const CHAIN = NET.CHAIN;

/**
 * OpenZap for this deployment (spec §10): the contract that turns one ETH
 * signature into "swap on Uniswap, then buy on the curve" for a launch paired
 * with an ERC-20, and the reverse when selling. null = it is not deployed here,
 * and EVERY control that would call it stays hidden – a quote launch is then
 * bought and sold in its own asset, exactly as it is without this feature.
 *
 * It travels in THE network registry (content/networks.mjs) with the other
 * addresses so the API, the SDK manifests and the site cannot disagree.
 */
export const ADDR = { ...NET.ADDR, zap: (NET_ENTRY.contracts.zap ?? null) as string | null };

/**
 * Does the factory in THIS build's ADDR table speak the quote-pairs generation
 * (spec §2/§12b)? Robinhood moved to LaunchFactory v3 on 2026-09-10 and Arc
 * testnet on 2026-09-12; Stable is still on its pre-v3 factory.
 *
 * It is a property of the TABLE, not of the feature: the two generations expose
 * different entry points, because `quote` was appended to CreateParams and
 * DirectParams and that changes the selector. A v3 factory has no 23-field
 * createLaunch and a pre-v3 one has no 24-field one, so every encoder that
 * sends calldata to ADDR.factory – including a plain NATIVE launch – has to
 * pick the shape of the generation the table points at. The same flag decides
 * how many constructor arguments a vanity salt is mined against
 * (lib/vanity.ts: STATIC_TABLE_QUOTE_AWARE), which is the other thing that
 * breaks silently when a table is repointed and this is not moved with it.
 *
 * The RUNNING backend still wins wherever it answers (GET /api/v1/config): this
 * is the build-time fallback for the factory this bundle was compiled against.
 *
 * Keyed by chain rather than written as one boolean so it moves with the table
 * it describes: repointing a chain's `factory` above means flipping its row
 * here in the same edit (and back, on a rollback).
 */
const QUOTE_AWARE_TABLE: Record<string, boolean> = {
  robinhood: true, // LaunchFactory v3, live 2026-09-10
  stable: false,
  arc: true, // LaunchFactory v3 on Arc testnet, 2026-09-12 (registry empty – quote pairs stay off, native launches use the v3 structs)
};
export const STATIC_FACTORY_QUOTE_AWARE: boolean = QUOTE_AWARE_TABLE[NET_KEY] ?? false;

/**
 * Does THIS build's chain have crowd-launch contracts at all (plan §0.3)?
 *
 * Crowd launch is a separate factory with its own children, deployed on
 * Robinhood Chain (2026-09-10) and Arc testnet (2026-09-12). Stable has none,
 * so the backend zeroes the address in its override block – but the
 * three deployments share ONE env template, and a single wrong answer from a
 * running backend would otherwise light the crowd catalogue up on a bundle
 * built for a chain where nothing can be signed.
 *
 * So the site's predicate is a CONJUNCTION, not a fallback: this build-time
 * table AND `features.crowdLaunch` from /api/v1/config (see
 * lib/exploreApi.ts crowdLaunchEnabled). Where the row is false the runtime
 * factory address is not "overridden" – it is not looked at.
 *
 * Keyed by chain for the same reason QUOTE_AWARE_TABLE is: it moves with the
 * ADDR table above, in the same edit, and back on a rollback.
 */
const CROWD_TABLE: Record<string, boolean> = {
  robinhood: true, // CrowdFactory 0xB70bAa29…03f6, live 2026-09-10
  stable: false,
  arc: true, // CrowdFactory on Arc testnet, 2026-09-12
};
export const STATIC_CROWD_SUPPORTED: boolean = CROWD_TABLE[NET_KEY] ?? false;

/**
 * QuoteRegistry for this deployment: the allow-list of ERC-20 assets a launch
 * may be paired with instead of the native coin. null = quote pairs are off
 * and every launch here is native.
 *
 * The RUNNING backend is the authority (GET /api/v1/config): the address
 * arrives by env at rollout time, before it is pasted into the registry file,
 * and the site must never offer a pair the server cannot prepare. This constant
 * is the static mirror for surfaces that have no API to ask (SDK manifests).
 */
export const QUOTE_REGISTRY: string | null = NET_ENTRY.contracts.registry ?? null;

/**
 * Does this deployment OFFER launches paired with a tokenised asset at all?
 *
 * Deliberately not `QUOTE_REGISTRY !== null`. A QuoteRegistry is the allow-list
 * mechanism; the assets in it come from a price feed that has to exist on the
 * chain. Arc's v3 factory takes a registry that is deployed EMPTY and stays
 * empty (no equity feeds on the testnet), so the address is present and the
 * list is permanently `[]` – and every surface that gated on the address alone
 * would publish text for a feature no Arc reader can use.
 *
 * The flag lives in THE network registry (content/networks.mjs) so the same
 * predicate serves the React pages, the prerender script and the article
 * corpus, and moves with the addresses in one edit. Runtime surfaces do not
 * read it: they ask the backend (features.quotePairs) and then render what
 * GET /api/v1/quotes actually returns, which for an empty registry is the
 * native coin and nothing else.
 */
export const QUOTE_PAIRS_OFFERED: boolean = NET_ENTRY.quotePairs === true;

export const DEPLOY_FEE_ETH = ECON.deployFee;
/** Uniswap V3 pool fee tier for every graduation – fixed platform-wide. */
export const POOL_FEE_TIER = 10000; // 1%
/** Listing target – fixed platform-wide (native units). */
export const TARGET_ETH = ECON.target;
/** Starting market cap (FDV) for every launch – fixed platform-wide. */
export const START_FDV_ETH = ECON.startFdv;
export const BOOST_PRICE_ETH = ECON.boost;
/** Wallet top-up range quoted in the guides (creation fee + gas), per chain. */
export const STARTER_LOW = ECON.starterLow;
export const STARTER_HIGH = ECON.starterHigh;
export const TOP_SLOT_PRICE_ETH = ECON.topSlot;
/** Native-currency ticker for fee lines / amounts (ETH or USDT0). */
export const CUR = CHAIN.currency.symbol;

/** Whether this build's chain has a native bridge page (Robinhood only:
 *  Stable has no Arbitrum route, Arc is a faucet-funded testnet). Read from
 *  the registry's `bridge` flag – the same field scripts/prerender.mjs (which
 *  files to write) and the backend sitemap (which URLs to list) read, so the
 *  route, the prerendered file and the sitemap entry cannot disagree. */
export const HAS_BRIDGE: boolean = NET_ENTRY.bridge === true;

/** Testnet builds: money is faucet play-money, so real-value framing is wrong. */
export const IS_TESTNET = IS_ARC;

/** Where testnet users get gas. Null on real-money chains. */
export const FAUCET_URL: string | null = IS_ARC ? 'https://faucet.circle.com/' : null;

/** External DEX deep-link for a graduated/instant token, or null when the
 *  chain has no public swap UI (Arc testnet). Used for "Trade on …" buttons. */
export const DEX_SWAP_URL: ((token: string) => string) | null = IS_ARC
  ? null
  : IS_STABLE
    ? (t: string) => `https://swap.stable.xyz/#/swap?outputCurrency=${t}`
    : (t: string) => `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${t}`;

/** DexScreener chart slug, or null where the chain is not covered. */
export const DEXSCREENER_SLUG: string | null = IS_ARC ? null : IS_STABLE ? null : 'robinhood';

// Sibling deployments for the header network switcher, derived from THE
// network registry (src/content/networks.mjs – the single source of truth
// that also feeds the API/SDK/MCP/embed surfaces). Each network is its own
// domain (own build + backend + DB); switching navigates across domains.
// The switcher is the ONE place that flags a testnet – everywhere else the
// chain is written plainly (titles, prose, fee lines), so the site reads the
// same on Arc as on a mainnet.
export const NETWORK_SITES = REGISTRY.map((n) => ({
  id: n.chainId,
  label: n.testnet ? `${n.name} (Testnet)` : n.name,
  origin: n.origin,
}));

/** Supporter perks: leave the platform >=50% of the trade fee. */
export const SUPPORTER_SHARE_BPS = 5000;
export const VANITY_MIN_SHARE_BPS = 1500;

/**
 * Vanity address pricing (ETH). Short patterns are a loyalty bonus:
 * >=50% share: 3-5 chars free · >=30%: 3-4 free · <15%: vanity unavailable.
 * 6 chars and 7-8 chars are always paid. Since v1.7 the same tiers apply to
 * instant listings (their share = LP-fee split enforced by the harvester).
 */
export function vanityPriceEth(len: number, shareBps: number): number | null {
  if (len < 3 || len > 8) return null;
  if (shareBps < VANITY_MIN_SHARE_BPS) return null; // blocked on-chain
  if (len >= 7) return 0.03;
  if (len === 6) return 0.01;
  if (shareBps >= 5000) return 0;            // 3-5 free
  if (shareBps >= 3000) return len <= 4 ? 0 : 0.005; // 3-4 free, 5 paid
  return len <= 4 ? 0.0025 : 0.005;          // 15-30%: paid
}

export const REF_STORAGE_KEY = 'openfair.ref';
export const REF_TTL_MS = 30 * 24 * 3600 * 1000;

// ---- multichain scaffolding ------------------------------------------------
// The network registry itself lives in networks.ts (NOT imported by the SDK
// build); only the type is declared here. Production ships Robinhood Chain
// only – extra networks are added to networks.ts on explicit request.
export interface NetworkCfg {
  key: string;
  label: string;
  testnet?: boolean;
  /** Native-currency ticker shown in fee lines. */
  cur: string;
  chain: {
    id: number; hexId: string; name: string; rpcUrl: string; explorer: string;
    /** Optional ordered fallback list, `rpcUrl` first (see lib/rpc.ts). Absent
     *  = one endpoint, which is what every network but Robinhood has. */
    rpcUrls?: readonly string[];
    currency: { name: string; symbol: string; decimals: number };
  };
  addr: { factory: string; simpleTokenDeployer: string; fairTokenDeployer: string; weth: string };
}
