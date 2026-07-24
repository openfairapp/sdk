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
    factory: '0x05366E22fe142e38e62d72584404Ca978B92Bf6F', // v2.0: Uniswap pool-squat defense
    promotions: '0x1aF3Cc534ad6F78eEaBCFfe295FA0210CdFf6b31', // v2.1: supporter via harvester share
    subdomains: '0x78Bcf75c837D3d80959AAb169272EF25aBcC5107',
    weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    simpleTokenDeployer: '0x69B229843fD08E76D55373901CB57dE571987c36',
    fairTokenDeployer: '0x12F394C101bA7ed4dbb71b978060F89B7c958143',
    swapRouter: '0xCaf681a66D020601342297493863E78C959E5cb2',
    quoterV2: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  },
  econ: { deployFee: 0.0005, target: 5, startFdv: 3, boost: 0.1, topSlot: 0.05 },
} as const;

const STABLE = {
  CHAIN: {
    id: 988, hexId: '0x3dc', name: 'Stable',
    rpcUrl: 'https://rpc.stable.xyz',
    explorer: 'https://stablescan.xyz',
    currency: { name: 'USDT0', symbol: 'USDT0', decimals: 18 },
  },
  ADDR: {
    factory: '0xFf8b0b4901ccaC881E7C5733ff8A321eA144C31B',
    promotions: '0xdd8715fa10C91ad22e15620023F4A70aDafF245E',
    subdomains: '0x1D16C3600136eD44A3D4FA259aC614Ba4E975123',
    // USDT0 ERC-20 (6d) — the pool quote asset; there is no WETH on Stable.
    weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    simpleTokenDeployer: '0xB35963EDD6059E1Df875202aA3Aea7d185E5c5a9',
    fairTokenDeployer: '0x71D6E3A164C4b1CcbD08785592df4ff3aE11E7Fb',
    swapRouter: '0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a', // SwapRouter02
    quoterV2: '0xb070179E7032CdA868b53e6C1742F80c9e940d1A',
  },
  // Economics per the brief: start FDV 5000 USDT0, fair-launch target 10000.
  econ: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50 },
} as const;

const NET = IS_STABLE ? STABLE : ROBINHOOD;

export const CHAIN = NET.CHAIN;
export const ADDR = NET.ADDR;

export const DEPLOY_FEE_ETH = NET.econ.deployFee;
/** Uniswap V3 pool fee tier for every graduation – fixed platform-wide. */
export const POOL_FEE_TIER = 10000; // 1%
/** Listing target – fixed platform-wide (native units). */
export const TARGET_ETH = NET.econ.target;
/** Starting market cap (FDV) for every launch – fixed platform-wide. */
export const START_FDV_ETH = NET.econ.startFdv;
export const BOOST_PRICE_ETH = NET.econ.boost;
export const TOP_SLOT_PRICE_ETH = NET.econ.topSlot;
/** Native-currency ticker for fee lines / amounts (ETH or USDT0). */
export const CUR = CHAIN.currency.symbol;

/** Whether this build's chain has a native bridge page (Robinhood only). */
export const HAS_BRIDGE = !IS_STABLE;

// Sibling deployments for the header network switcher, derived from THE
// network registry (src/content/networks.mjs – the single source of truth
// that also feeds the API/SDK/MCP/embed surfaces). Each network is its own
// domain (own build + backend + DB); switching navigates across domains.
export const NETWORK_SITES = REGISTRY.map((n) => ({ id: n.chainId, label: n.name, origin: n.origin }));

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
    currency: { name: string; symbol: string; decimals: number };
  };
  addr: { factory: string; simpleTokenDeployer: string; fairTokenDeployer: string; weth: string };
}
