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

/**
 * A slot in an ADDR table whose contract is built but not yet broadcast.
 *
 * It is the zero address on purpose. The table is typed as strings and read by
 * calldata encoders, by the CREATE2 vanity miner and by every explorer link,
 * so a null would move a build-time fact ("nothing is deployed yet") into a
 * runtime TypeError in whichever component happened to touch it first. The
 * zero address is inert, unmistakable in a wallet prompt, and greppable.
 */
const PENDING = '0x0000000000000000000000000000000000000000';

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
    // promotions / subdomains are NOT here any more: they come from the
    // registry's `contracts` block, like everything else the site spends
    // against. See the ADDR export below.
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
    // promotions / subdomains: registry-derived (see the ADDR export below).
    // USDT0 ERC-20 (6d) – the pool quote asset; there is no WETH on Stable.
    weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    simpleTokenDeployer: '0x8b5dCdeF943b16f2a07f56E7ffE38bBad7A9d2bd',
    fairTokenDeployer: '0xB4E8edc4Bcb815Ba3D65D3Dc2d9f3659baF74EA3',
    swapRouter: '0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a', // SwapRouter02
    quoterV2: '0xb070179E7032CdA868b53e6C1742F80c9e940d1A',
  },
} as const;

// Arc mainnet, chain 5042 (Circle's L1, public mainnet since 2026-09-16 – the
// 5042002 testnet is retired and none of its addresses have code here). Native
// gas is USDC with 18-decimal wei semantics, and its ERC-20 face
// 0x3600…0000 shows THE SAME balance at 6 decimals. So Arc is a STABLE-lineage
// deployment, not a Robinhood-lineage one: there is no wrapped 18-decimal USDC
// (Circle says there will be none) and `weth` below is that 6-decimal face,
// exactly as on Stable.
//
// The Uniswap addresses are Uniswap Labs' own canonical v3 deployment on 5042,
// cross-checked three ways on 2026-09-16: every fee tier reports its canonical
// spacing, and live pool addresses reproduce from the canonical
// POOL_INIT_CODE_HASH. Do NOT call .WETH9() on the router, the position
// manager or the quoter: all three return 0x8bcEaA40…7937f, a 53-byte stub
// that reverts UnsupportedProtocolError() on every call. Live pools quote
// against the USDC face directly.
const ARC = {
  CHAIN: {
    id: 5042, hexId: '0x13b2', name: 'Arc',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    // The only explorer Arc has, and it answers Circle's SSO login on every
    // path today – see the long note in content/networks.mjs. It stays here so
    // that every `${CHAIN.explorer}/address/…` link in the components is an
    // absolute URL to the canonical host rather than a relative path into our
    // own SPA, which is what an empty string would produce.
    explorer: 'https://explorer.arc.io',
    currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  },
  ADDR: {
    // Broadcast and live since 2026-09-16 (docs/deployments/arc-mainnet/
    // addresses.env, LaunchFactory in block 21161925): the Stable-lineage
    // contracts, EIP-55 spelled as they were compiled. The same five addresses
    // are in the `contracts` block of the arc entry in src/content/networks.mjs
    // – that block is THE source, and CONTRACTS_PENDING below is derived from
    // it, not from this table. Only the three below live here; promotions and
    // subdomains are registry-derived in the ADDR export, so there is nothing
    // to paste twice and nothing to forget.
    //
    // The PENDING sentinel above is what these three held between "the flavour
    // exists" and this broadcast: the zero address rather than null, because
    // this table is typed as strings and read by encoders, by the CREATE2
    // vanity miner and by every "open in explorer" link, and a null would have
    // turned a build-time absence into a runtime TypeError far from here.
    factory: '0xb122C3C07f7fFC0c72bE2AC1933a6D188ef09912',
    weth: '0x3600000000000000000000000000000000000000', // USDC ERC-20 face (6d) – the pool quote asset; there is no WETH on Arc
    simpleTokenDeployer: '0x6A4b2f1e771349Cfe2E4ea507e0651E8B3F2f35f',
    fairTokenDeployer: '0x7bf697F9Eb52605fD1DCE1Cc9cbf94E289C85f06',
    // Uniswap Labs canonical v3 on Arc mainnet (EIP-55 checksummed – the
    // lowercase spelling of the quoter does not compile in Solidity, and the
    // same casing is what the contracts were compiled against):
    //   UniswapV3Factory            0xf0db7b58379503491d857dB50AC9ece64c653918
    //   NonfungiblePositionManager  0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377
    swapRouter: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77', // SwapRouter02
    quoterV2: '0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468',
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

/**
 * Which CONTRACT LINEAGE this deployment runs – the registry's own `lineage`.
 *
 * 'shared' is contracts/src/ (Robinhood): an 18-decimal native coin with a real
 * WETH9 behind it. 'stable' is contracts/src/stable/ (Arc 5042, Stable 988):
 * the chain's coin IS the dollar, its ERC-20 face is the same balance at six
 * decimals, and there is nothing to wrap.
 *
 * It is not a synonym for "which chain": it is the question every encoder has
 * to ask, because the two lineages compile DIFFERENT structs under the same
 * names. lib/vanity.ts already asks it of the constructor arity; lib/crowdAbi.ts
 * asks it of the crowd tuple, whose stable build has no `quote` field at all
 * (25 fields, selector 0x32520209) where the shared one has 26 (0xc61106a9).
 * A tuple is positional, so that is not a type error anywhere – it is a
 * different call, decoded into different slots.
 */
export const LINEAGE: string = NET_ENTRY.lineage;
/** Shorthand for the question above, so no consumer re-spells the string. */
export const IS_STABLE_LINEAGE: boolean = LINEAGE === 'stable';

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
export const ADDR = {
  ...NET.ADDR,
  // Promotions and subdomains come from the registry, not from the tables
  // above. They are the two addresses the site sends REAL money to without a
  // simulation in front of it (Token.tsx doBoost / doTopSlot, msg.value 100
  // and 50 units of the chain's coin), and a codeless recipient does not
  // revert – a plain value transfer to an EOA-shaped address succeeds. So the
  // "is it deployed" answer has to come from the same file that answers it for
  // the factory, and PROMOTIONS_PENDING below turns that null into a gate.
  promotions: (NET_ENTRY.contracts.promotions ?? PENDING) as string,
  subdomains: (NET_ENTRY.contracts.subdomains ?? PENDING) as string,
  zap: (NET_ENTRY.contracts.zap ?? null) as string | null,
};

/**
 * Is this build pointed at launch contracts that are not on the chain yet?
 *
 * True only between "the flavour exists" and "the conductor broadcast it" –
 * the state the Arc mainnet build is in until the addresses land in the arc
 * entry of content/networks.mjs. The registry is the thing asked, not the ADDR
 * table: the registry says null for a contract that was never broadcast, while
 * ADDR holds PENDING so the typed reads downstream keep working. Anything that
 * is about to offer the user a transaction gates on this instead of
 * rediscovering the zero address for itself (Create.tsx).
 *
 * EVERY launch-side slot is asked, not just the factory. Asking the factory
 * alone meant that the first half of a broadcast – factory pasted, promotions
 * not – would flip this to false and re-open a boost button pointed at
 * 0x0000…0000, which does not revert.
 */
const PENDING_SLOTS = [
  NET_ENTRY.contracts.factory,
  NET_ENTRY.contracts.simpleTokenDeployer,
  NET_ENTRY.contracts.fairTokenDeployer,
  NET_ENTRY.contracts.promotions,
  NET_ENTRY.contracts.subdomains,
];
export const CONTRACTS_PENDING: boolean = PENDING_SLOTS.some((a) => a == null);

/**
 * The narrower question for the promotion controls alone: is OpenPromotions on
 * this chain? boost() and buyTopSlot() are the only writes the site makes with
 * a hard-coded price and NO simulateContract in front of them, so this is the
 * gate that stands between "not deployed yet" and 100 USDC sent to nowhere.
 */
export const PROMOTIONS_PENDING: boolean = NET_ENTRY.contracts.promotions == null;

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
  // Arc mainnet runs the STABLE lineage (factoryVersion 2.1): the 6-decimal
  // USDC face needs the rescaled sqrtPrice math, and the v3 quote-pairs
  // generation has not been ported to it. So the 23-field pre-v3 structs are
  // the shape of every create here, and the vanity miner mines against the
  // pre-v3 constructor arity (lib/vanity.ts STATIC_TABLE_QUOTE_AWARE). The
  // factory broadcast on 2026-09-16 is that 2.1 lineage, so this row did not
  // move with it; flip it the same day a v3 factory address replaces the one
  // above, not before.
  arc: false,
};
export const STATIC_FACTORY_QUOTE_AWARE: boolean = QUOTE_AWARE_TABLE[NET_KEY] ?? false;

/**
 * Does THIS build's chain have crowd-launch contracts at all (plan §0.3)?
 *
 * Crowd launch is a separate factory with its own children, deployed on
 * Robinhood Chain (2026-09-10, the shared lineage) and on Arc mainnet
 * (2026-09-17, the stable lineage's own 25-field factory – the Arc testnet set
 * of 2026-09-12 died with that network). Stable (988) has none, so the backend
 * zeroes the address in its override block – but the three deployments share
 * ONE env template, and a single wrong answer from a running backend would
 * otherwise light the crowd catalogue up on a bundle built for a chain where
 * nothing can be signed.
 *
 * So the site's predicate is a CONJUNCTION, not a fallback: this build-time
 * table AND `features.crowdLaunch` from /api/v1/config (see
 * lib/exploreApi.ts crowdLaunchEnabled). Where the row is false the runtime
 * factory address is not "overridden" – it is not looked at.
 *
 * The rows live in THE network registry (content/networks.mjs `crowd`), next
 * to `quotePairs` and `bridge`, and are read here rather than retyped. That is
 * not tidiness: scripts/prerender.mjs is plain ESM and cannot import this file,
 * so a table kept only here left the prerendered HTML with no way to ask the
 * question – which is how stable.openfair.app came to publish an article step
 * describing a launch mode the host has no contracts for. One flag, three
 * readers (this bundle, the prerender's [[crowd]] blocks, the backend).
 */
const CROWD_TABLE: Record<string, boolean> = Object.fromEntries(
  REGISTRY.map((n) => [n.key, n.crowd === true]),
);
export const STATIC_CROWD_SUPPORTED: boolean = CROWD_TABLE[NET_KEY] ?? false;

/**
 * The crowd factory THIS build's registry names, or null where it names none.
 *
 * It is what pins the runtime answer. The address a create is signed against
 * comes from the running backend (GET /api/v1/config `contracts.crowdFactory`),
 * because that is the value the deployment is actually configured with – but
 * the table above stops being a guard on the day a chain's row turns true, and
 * the three deployments still share ONE env template. So where the registry
 * knows the address, a backend answering with a DIFFERENT one reads as "off"
 * rather than as a destination (lib/exploreApi.ts crowdFactoryFor): a bundle
 * built for 5042 cannot be talked into signing against 4663's factory by a
 * stale `CROWD_FACTORY=` line.
 *
 * Every stable-lineage switch-on carries the address here – that is the rule
 * tests/crowd-lineage-abi.test.mjs enforces, because on this lineage `crowd:
 * true` is a claim about a factory whose 25-field tuple the bundle encodes at
 * build time. The shared lineage carries none, so this is null on Robinhood and
 * the runtime answer stands alone there exactly as it did before Arc: null is
 * "the registry has no opinion", never "no factory".
 */
export const STATIC_CROWD_FACTORY: string | null = NET_ENTRY.crowdContracts?.factory ?? null;

/**
 * GENERATION 3 – the enforced fee split – as this build's registry names it,
 * or null where the chain has none (Stable 988; `zapG3` also on Arc, which has
 * no quote pairs).
 *
 * NEW NAMES, on purpose, and never folded into ADDR or STATIC_CROWD_FACTORY
 * above. The backend's `contracts.launchFactory` / `crowdFactory` / `zap` keep
 * their generation-2 meaning for ever: pinned SDK bundles bake the generation-2
 * factory in at build time and third parties encode against it, so repointing
 * those names would be a silent change of selector under every integrator.
 * First-party clients opt in instead, through ADDITIVE fields –
 * `features.storefrontG3` and `contracts.launchFactoryG3` / `crowdFactoryG3` /
 * `zapG3` – and these constants are what PIN that runtime answer: a backend
 * naming a different address reads as "off", exactly as STATIC_CROWD_FACTORY
 * pins `crowdFactory` (lib/feeSplit.ts g3LaunchFactoryFor, lib/exploreApi.ts
 * crowdFactoryG3For, lib/launchZap.ts).
 *
 * Named exports and not ADDR keys, because sdk/core.ts imports ADDR whole and
 * reads the generation-2 slots by name; these are for the storefront only.
 */
export const STATIC_LAUNCH_FACTORY_G3: string | null = NET_ENTRY.contracts.launchFactoryG3 ?? null;
export const STATIC_CROWD_FACTORY_G3: string | null = NET_ENTRY.contracts.crowdFactoryG3 ?? null;
export const STATIC_ZAP_G3: string | null = NET_ENTRY.contracts.zapG3 ?? null;

/**
 * Is a raise on THIS chain denominated in the chain's own coin and nothing
 * else?
 *
 * True on the stable lineage, where it is a property of the CONTRACT and not a
 * setting: that CrowdFactory's `CrowdParams` has no `quote` field at all (25
 * fields against the shared build's 26), `OpenCrowd.quote()` is address(0) and
 * `isNative()` is true for every raise it can ever deploy, and there is no
 * `contributeQuote` on the raise. The chain's coin IS the dollar there (Arc's
 * USDC, Stable's USDT0), so "pay in the coin or pay in a dollar asset" is not a
 * choice anybody could make.
 *
 * Read by the crowd encoder (lib/createPayload.ts, which drops the field) and
 * by every crowd surface that would otherwise offer a quote/native toggle,
 * a `feeCapUsd` line or an ERC-20 approval. It is NOT the same question as
 * `QUOTE_PAIRS_OFFERED`: that one is about the LAUNCH factory's allow-list and
 * is answered by the running backend, this one is about which struct the crowd
 * factory in this build's lineage decodes, and no backend can change it.
 */
export const CROWD_NATIVE_ONLY: boolean = IS_STABLE_LINEAGE;

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

/** Whether this build's chain has a bridge page. Robinhood's is the Arbitrum
 *  canonical portal, Arc's is Relay plus Circle's CCTP bridge; Stable has
 *  neither (USDT0 arrives through usdt0.to). Read from
 *  the registry's `bridge` flag – the same field scripts/prerender.mjs (which
 *  files to write) and the backend sitemap (which URLs to list) read, so the
 *  route, the prerendered file and the sitemap entry cannot disagree. */
export const HAS_BRIDGE: boolean = NET_ENTRY.bridge === true;

/**
 * Can a reader actually open this chain's block explorer?
 *
 * CHAIN.explorer is always a URL – components build `${explorer}/address/…`
 * links from it and an empty string would turn every one of them into a
 * relative path into our own SPA. But a URL being correct is not the same as a
 * reader being able to open it: Arc's only explorer, explorer.arc.io (the host
 * Circle's docs, Uniswap's chain config and Relay all name), answered a
 * Cloudflare Access login for Circle SSO on every path for one day after the
 * mainnet cutover. A surface that tells a reader "look it up in the explorer"
 * asks THIS first, and offers the DexScreener pair page or the Uniswap token
 * page instead when the answer is no.
 *
 * TRUE ON EVERY CHAIN since 2026-09-17, when Circle opened explorer.arc.io as
 * an ordinary public Blockscout. The constant stays, and so does every branch
 * that reads it – one registry line (`explorerPublic: false`) closes every such
 * surface again, for this chain or the next one, which is exactly why the
 * question is asked of the registry and never of the chain key.
 */
export const EXPLORER_PUBLIC: boolean = NET_ENTRY.explorerPublic !== false;

/**
 * Testnet builds: money is faucet play-money, so real-value framing is wrong.
 *
 * Read from the registry's own `testnet` flag rather than written as "which
 * chain is it" – that equality (IS_TESTNET = IS_ARC) survived the day Arc
 * stopped being a testnet, which is exactly the class of bug the registry
 * exists to prevent. Every deployment is a mainnet today; the constant stays
 * because the next chain added may not be.
 */
export const IS_TESTNET: boolean = NET_ENTRY.testnet === true;

/** Where testnet users get gas. Null on real-money chains – which, since the
 *  Arc cutover to chain 5042 on 2026-09-16, is all of them. USDC on Arc
 *  mainnet is real money and has no faucet; the page that answers "how do I
 *  get funds here" is /bridge. */
export const FAUCET_URL: string | null = null;

/** External DEX deep-link for a graduated/instant token, or null when the
 *  chain has no public swap UI. Used for "Trade on …" buttons. Arc is a
 *  first-class chain in Uniswap's own interface (urlParam 'arc'), and its
 *  pools quote against the USDC face directly, so the ordinary app.uniswap.org
 *  deep link works with no inputCurrency pinned. */
export const DEX_SWAP_URL: ((token: string) => string) | null = NET_ENTRY.dexSwapUrl
  ? (tok: string) => `${NET_ENTRY.dexSwapUrl}${tok}`
  : null;

/** DexScreener chart slug, or null where the chain is not covered. Arc is
 *  indexed: both the v1 token-pairs endpoint and the older pairs endpoint
 *  answered for chain slug 'arc' on 2026-09-16 with live Uniswap v3 and v4
 *  pairs, and every pair object's own `url` is dexscreener.com/arc/<pair>. */
export const DEXSCREENER_SLUG: string | null = NET_ENTRY.dexscreenerSlug ?? null;

/**
 * Public "view this token" page for a chain with no public block explorer, or
 * null where the explorer IS that page. Read by lib/explorer.ts, which is the
 * only thing that should be deciding where a "view" control points.
 */
export const DEX_TOKEN_URL: ((token: string) => string) | null = NET_ENTRY.dexTokenUrl
  ? (tok: string) => `${NET_ENTRY.dexTokenUrl}${tok}`
  : null;

/**
 * The pool-side asset of a NATIVE launch – `ADDR.weth` – described.
 *
 * `decimals` is the scale an amount on that side is parsed and printed at. It
 * is SIX on Stable and Arc, where the "wrapped native" is really the native
 * coin's own ERC-20 face, and reading 18 there is not a rounding error: it is
 * 1e12 times the amount the user typed, quoted and then spent.
 *
 * `wrapped` is the other half of the same fact. A real WETH9 lets the router
 * take msg.value and wrap it (and unwrapWETH9 on the way out); a face has
 * nothing to wrap, so the swap is an ordinary ERC-20 swap with an allowance
 * and no value. Sending msg.value to a router that then pulls the same amount
 * by transferFrom spends the balance twice.
 *
 * Both come from the registry so the site and the SDK cannot disagree.
 */
export const NATIVE_QUOTE_DECIMALS: number = NET_ENTRY.nativeQuote.decimals;
export const NATIVE_QUOTE_WRAPPED: boolean = NET_ENTRY.nativeQuote.wrapped;
/** Is the native coin ITSELF a dollar stablecoin (Arc's USDC, Stable's
 *  USDT0)? A third, independent fact – never inferred from `decimals`, since
 *  a 6-decimal face is what a wrapped native ERC-20 face looks like on this
 *  chain, not what makes it a dollar. Drives the trade panel's quick-buy
 *  presets: dollar sizes here, ETH-sized fractions on Robinhood. */
export const NATIVE_QUOTE_STABLE: boolean = NET_ENTRY.nativeQuote.stable === true;

/** Default "You pay" amount for a native buy: a round dollar where the coin
 *  IS a dollar, the old ETH-sized fraction everywhere else. Single source for
 *  every input that resets to "the small default" – src/pages/Token.tsx and
 *  src/components/SwapPanel.tsx both read this instead of restating '0.01'. */
export const NATIVE_BUY_DEFAULT: string = NATIVE_QUOTE_STABLE ? '1' : '0.01';

/** Where this chain's contracts are verified, and under what name: the block
 *  explorer on Robinhood and Stable, and on Arc BOTH targets named in one
 *  phrase ("explorer.arc.io (Blockscout) and Sourcify") because the verify
 *  worker submits to both there. Injected into the locale strings as
 *  {verifyName}/{verifyUrl} (lib/i18n.ts) so no dictionary carries a chain's
 *  explorer host as a literal – which is how ten locales came to promise
 *  Blockscout on a chain that did not have it. */
export const VERIFY_NAME: string = NET_ENTRY.verify.name;
/** What the chain's own EXPLORER is called – a different question from
 *  VERIFY_NAME wherever a chain verifies against more than its explorer, which
 *  Arc does (Blockscout AND Sourcify). Used where a PRODUCT is being named –
 *  the wallet's View-on-explorer entry – rather than a verification promise.
 *  Falls back to VERIFY_NAME, which is what every chain whose explorer is its
 *  only verification target already says. */
export const EXPLORER_NAME: string = NET_ENTRY.explorerName ?? NET_ENTRY.verify.name;
export const VERIFY_URL: string = NET_ENTRY.verify.url;

/** This deployment's own machine surfaces: the versioned REST base and the MCP
 *  endpoint. Injected into prose as {apiHost}/{mcpHost} (lib/i18n.ts,
 *  scripts/prerender.mjs) for the same reason {verifyName} exists – four blog
 *  articles printed `https://api.openfair.app` and `https://mcp.openfair.app`
 *  as literals, which are the Robinhood deployment's subdomains and answer
 *  nothing for a reader on Stable or Arc. The registry carries one base per
 *  chain (`api` / `mcp`), so a path appended to either of these is the path
 *  THIS backend serves. */
export const API_BASE: string = NET_ENTRY.api;
export const MCP_BASE: string = NET_ENTRY.mcp;

// Sibling deployments for the header network switcher, derived from THE
// network registry (src/content/networks.mjs – the single source of truth
// that also feeds the API/SDK/MCP/embed surfaces). Each network is its own
// domain (own build + backend + DB); switching navigates across domains.
// The switcher is the ONE place that would flag a testnet – everywhere else
// the chain is written plainly (titles, prose, fee lines). No deployment is a
// testnet since the Arc cutover, so the branch renders nothing today; it stays
// for the next chain that is one.
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
