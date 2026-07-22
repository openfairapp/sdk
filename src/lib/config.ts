// Robinhood Chain mainnet deployment of openfair.

// WalletConnect Cloud project id (public by design – it ships in the bundle).
export const WC_PROJECT_ID = '9a845b77600cebab8ee3f803776091f5';

export const CHAIN = {
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
} as const;

export const ADDR = {
  factory: '0x05366E22fe142e38e62d72584404Ca978B92Bf6F', // v2.0: Uniswap pool-squat defense
  promotions: '0x1aF3Cc534ad6F78eEaBCFfe295FA0210CdFf6b31', // v2.1: supporter via harvester share
  subdomains: '0x78Bcf75c837D3d80959AAb169272EF25aBcC5107',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  simpleTokenDeployer: '0x69B229843fD08E76D55373901CB57dE571987c36',
  // v1.9: curve tokens are CREATE2-deployed (and initially held) by this
  // helper — curve vanity salts are mined against ITS address, not the factory.
  fairTokenDeployer: '0x12F394C101bA7ed4dbb71b978060F89B7c958143',
  swapRouter: '0xCaf681a66D020601342297493863E78C959E5cb2',
  quoterV2: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
} as const;

export const DEPLOY_FEE_ETH = 0.0005;
/** Uniswap V3 pool fee tier for every graduation – fixed platform-wide. */
export const POOL_FEE_TIER = 10000; // 1%
/** Listing target – fixed platform-wide. */
export const TARGET_ETH = 5;
/** Starting market cap (FDV) for every launch – fixed platform-wide. */
export const START_FDV_ETH = 3;
export const BOOST_PRICE_ETH = 0.1;
export const TOP_SLOT_PRICE_ETH = 0.05;

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
// only — extra networks are added to networks.ts on explicit request.
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
