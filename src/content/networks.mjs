// THE network registry – single source of truth for every deployment of
// openfair. Adding a chain here propagates it to ALL integration surfaces:
//   - REST API   GET /api/v1/networks (backend/src/v1.js)
//   - MCP        list_networks tool + get_network_config (backend/src/mcp.js)
//   - SDK        CHAIN_MANIFESTS – both the site bundle and @openfair/sdk (frontend/sdk/core.ts)
//   - iframe     the embed snippet generator's network picker (EmbedGenerator.tsx)
//   - the header cross-domain NetworkSwitcher (frontend/src/lib/config.ts)
// Plain ESM (like seo.mjs) so the node backend and every bundler can import it.
// Amounts are in whole native units (both chains use 18-decimal native gas).

export const NETWORKS = [
  {
    key: 'robinhood',
    chainId: 4663,
    hexId: '0x1237',
    name: 'Robinhood Chain',
    testnet: false,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    // Optional, and READ BY THE SITE ONLY (src/lib/rpc.ts): the ordered list the
    // browser client falls through, official node first. `rpcUrl` above stays
    // the single value every other consumer means – the SDK manifest, the
    // wallet_addEthereumChain the site sends, GET /api/v1/networks – so adding
    // this field changes nothing anywhere it is not read.
    //
    // Why it exists: the official node sits behind Cloudflare bot protection and
    // intermittently answers with HTTP 403 and a "Just a moment…" HTML challenge
    // page instead of JSON (measured against the production backend 2026-09-10/11:
    // 708 failures in one afternoon, then every request for 13 minutes). A page
    // fetch cannot solve a challenge either, so the browser needs somewhere else
    // to go. These are public endpoints for chain 4663 with their own per-IP
    // limits – hence BELOW the official node, and never ranked above it.
    rpcUrls: [
      'https://rpc.mainnet.chain.robinhood.com',
      'https://robinhood-rpc.publicnode.com',
      'https://4663.rpc.thirdweb.com',
      'https://robinhood.drpc.org',
    ],
    explorer: 'https://robinhoodchain.blockscout.com',
    origin: 'https://openfair.app',
    // integration endpoints (per-deployment: each domain serves its own chain)
    api: 'https://openfair.app/api/v1',
    mcp: 'https://openfair.app/mcp',
    sdk: 'https://openfair.app/sdk/openfair.js',
    embed: 'https://openfair.app/embed/create',
    /**
     * WHICH CONTRACT SOURCES ARE DEPLOYED HERE – contracts/src/ ('shared') or
     * contracts/src/stable/ ('stable'). The two trees carry the SAME contract
     * names, and `forge build` files the collision under out/ vs out/stable/,
     * so any code that reaches for an artifact by basename silently gets the
     * shared one on every chain. That is not a cosmetic difference: the stable
     * OpenFairToken takes FOUR constructor arguments and the shared one five
     * (§12b's `router`), and their creation code differs outright – so the
     * backend served Arc's in-browser vanity miner an init code no deployer on
     * Arc produces, and a mined salt bought an address the factory could never
     * mint (2026-09-16, the owner's own launch). The backend reads this field
     * to resolve every artifact by fully-qualified source path; it is also the
     * field verify.sources' `src/` -> `src/stable/` rewrite has always meant.
     */
    lineage: 'shared',
    // v3 (quote pairs + OpenZap) went live on chain 4663 on 2026-09-10
    // (docs/deployments/robinhood-v3/). The v2.1 generation keeps serving every
    // token it minted and stays indexed by the backend; NEW launches go here.
    factoryVersion: '3.0',
    contracts: {
      // LaunchFactory v3 – its CreateParams/DirectParams carry the trailing
      // quote field, so it does NOT expose the 23-field v2.1 entry points.
      // Previous generation (still live, still indexed, no new launches):
      // v2.1 0x205344a2e70529d4c6ECF4C45B3c0c64Fc7D1508.
      factory: '0x1Af66EB4e249EfB0eDD975A10A8bD6c98789CFce',
      // Unchanged by v3 – the same helper deploys every instant listing.
      simpleTokenDeployer: '0x69B229843fD08E76D55373901CB57dE571987c36',
      // Redeployed for v3: it embeds OpenFairToken, whose constructor gained
      // the §12b router argument, so curve vanity salts are mined against THIS
      // address. v2.1 helper (historic): 0x35a0c465D7091757e15fFF64DFDF78079B5fAd4E.
      fairTokenDeployer: '0x28ae99370203fC25c605Cebb5Cd411Da479d772A',
      // OpenPromotions v2 (boost / top slot) and OpenSubdomains. They take
      // REAL money by msg.value – 100 and 50 units of the chain's coin – and
      // the token page sends those calls WITHOUT a simulation, so a wrong or
      // codeless address here is not a failed transaction, it is a transfer
      // into nothing. They live in the registry with the launch contracts for
      // exactly that reason: src/lib/config.ts derives ADDR from these, and a
      // null here is what makes CONTRACTS_PENDING true and hides the controls.
      promotions: '0x1aF3Cc534ad6F78eEaBCFfe295FA0210CdFf6b31', // v2.1: supporter via harvester share
      subdomains: '0x78Bcf75c837D3d80959AAb169272EF25aBcC5107',
      // pool quote asset: WETH on Robinhood
      weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
      // QuoteRegistry: the allow-list of ERC-20 assets a launch may be paired
      // with (tokenised stocks) plus their USD-anchored economics. null = quote
      // pairs are off and every launch on the chain is native. Live since
      // 2026-09-10 with 35 quotes – GET /api/v1/quotes enumerates it.
      // The backend serving THIS chain overrides the field from its REGISTRY
      // env in GET /api/v1/networks, so the two surfaces cannot disagree while
      // the address is live but not yet pasted here.
      registry: '0xEeC131B94dE023cc88bC1cF3fDedF216dD47AA5C',
      // OpenZap (spec §10): buy/sell a quote-paired launch with the native
      // coin in one signature. null = the zap is not deployed on this chain
      // and every ETH-payment control stays hidden – a quote launch is then
      // traded in its own asset. Live since 2026-09-10; the backend's own ZAP
      // env still overrides it in GET /api/v1/networks.
      zap: '0xa5f301EE9568Db8cE1cE0Bb2707410926210bf89',
    },
    // Can a launch on this chain actually BE paired with a tokenised asset?
    //
    // Not the same question as `contracts.registry != null`, and every static
    // surface that used to ask it that way was wrong for a chain that has a
    // QuoteRegistry which stays EMPTY: a registry is the allow-list mechanism,
    // the assets in it come from a price feed that has to exist on the chain.
    // Robinhood has 35 of them; Arc gets the contract (the v3 factory takes it
    // as a constructor argument) with nothing to put in it, because there are
    // no equity feeds there. So the four build-time surfaces that PUBLISH text
    // about the feature – Terms §22, the quote-pairs article, the homepage FAQ
    // entries and the /pairs prerender cluster – read THIS flag instead, and
    // the address stays what it is: an address.
    quotePairs: true,
    // Does this chain have a CrowdFactory – the soft-cap "urun dana" launch
    // mode, where a token is deployed only if the cap is reached and every
    // contribution is refundable if it is not?
    //
    // THE predicate for every build-time surface that PUBLISHES text about the
    // mode (the [[crowd]] prose blocks in articles and seo.mjs), read here and
    // not retyped: src/lib/config.ts derives its CROWD_TABLE from this field,
    // so the site bundle and the prerendered HTML cannot disagree. The RUNNING
    // backend stays the second half of the runtime predicate
    // (features.crowdLaunch from /api/v1/config) – this flag is the static one.
    crowd: true, // CrowdFactory 0xB70bAa29…03f6, live 2026-09-10
    // Does this chain have a bridge page (/bridge and its nine locale variants)?
    // The page is chain-aware (src/pages/Bridge.tsx): Robinhood's is the
    // Arbitrum canonical bridge from Ethereum, Arc's is Relay plus Circle's
    // CCTP. Stable has neither. THE predicate for every surface that emits or
    // links the route – the prerender (which files to write), the SPA route,
    // the backend sitemap (which URLs to list) and the [[bridge]] prose blocks
    // – so a chain cannot list a page it does not build: Stable and Arc used
    // to advertise ten /bridge URLs in their sitemaps that answered 404.
    bridge: true,
    // deployFee mirrors the live factory's deployFee() – 1e14 wei on v3
    // 0x1Af66EB4…9CFce, read on chain 2026-09-10 (unchanged from v2.1). The
    // factory checks msg.value exactly, so a stale number here is a reverted
    // create on every surface that falls back to it (useDeployFee FALLBACK,
    // SDK manifest) and a wrong price on every one that prints it
    // ({fee}/{feeHalf}, prerender, llms.txt, /api/v1/networks). In quote mode
    // the fee is the registry's USD anchor in the pair asset instead.
    // Change the contract first, then this line.
    economics: { deployFee: 0.0001, target: 5, startFdv: 3, boost: 0.1, topSlot: 0.05, starterLow: '0.002', starterHigh: '0.005' },
    // What `contracts.weth` IS, for the on-site Uniswap panel. On Robinhood it
    // is a real WETH9: 18 decimals, and the router wraps msg.value itself on
    // the way in and unwraps on the way out.
    nativeQuote: { decimals: 18, wrapped: true },
    // Where contracts are verified, and under what name. Used by the docs
    // sentence and by anything that promises a reader they can read the code.
    verify: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
    dexSwapUrl: 'https://app.uniswap.org/swap?chain=robinhood&outputCurrency=',
    // DexScreener chart slug for this chain, null where it is not indexed.
    dexscreenerSlug: 'robinhood',
    // A DEX "token page" to send a reader to when the chain has no public
    // block explorer (explorerPublic:false). Only needed there, so only Arc
    // carries one – see the note on its entry.
    dexTokenUrl: null,
  },
  {
    key: 'stable',
    chainId: 988,
    hexId: '0x3dc',
    name: 'Stable',
    testnet: false,
    currency: { name: 'USDT0', symbol: 'USDT0', decimals: 18 },
    rpcUrl: 'https://rpc.stable.xyz',
    explorer: 'https://stablescan.xyz',
    origin: 'https://stable.openfair.app',
    api: 'https://stable.openfair.app/api/v1',
    mcp: 'https://stable.openfair.app/mcp',
    sdk: 'https://stable.openfair.app/sdk/openfair.js',
    embed: 'https://stable.openfair.app/embed/create',
    // Deployed from contracts/src/stable/ – see `lineage` on the Robinhood
    // entry for what that field decides.
    lineage: 'stable',
    factoryVersion: '2.1',
    contracts: {
      factory: '0xd4a5AC9D63954C33b9E0dd045da5fb9e41A1B8f2',
      simpleTokenDeployer: '0x8b5dCdeF943b16f2a07f56E7ffE38bBad7A9d2bd',
      fairTokenDeployer: '0xB4E8edc4Bcb815Ba3D65D3Dc2d9f3659baF74EA3',
      // Promotions / subdomains – see the note on the Robinhood entry: these
      // are msg.value calls sent without a simulation, so they belong in the
      // registry with everything else the site is allowed to spend against.
      promotions: '0xdd8715fa10C91ad22e15620023F4A70aDafF245E',
      subdomains: '0x1D16C3600136eD44A3D4FA259aC614Ba4E975123',
      // pool quote asset: the USDT0 ERC-20 (6 decimals) – no WETH on Stable,
      // the native gas token IS this ERC-20 over one shared balance.
      weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
      registry: null, // no quote pairs on Stable
      zap: null, // no quote pairs – nothing for the zap to route into
    },
    quotePairs: false, // no registry, no assets
    crowd: false, // no CrowdFactory on Stable – fair launch and instant listing only
    bridge: false, // no Arbitrum route from Ethereum – USDT0 arrives via usdt0.to
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50, starterLow: '0.6', starterHigh: '1' },
    // `contracts.weth` here is the native coin's OWN 6-decimal ERC-20 face,
    // not a wrapper: one balance seen at two scales. So a graduated pool is
    // quoted in SIX decimals, and a "native" swap is an ordinary ERC-20 swap
    // – there is nothing to wrap and nothing to unwrap. Both halves matter:
    // the decimals decide how an amount is parsed (18 here means 1e12 times
    // too much), and `wrapped` decides whether the router is handed msg.value
    // or an allowance.
    nativeQuote: { decimals: 6, wrapped: false },
    verify: { name: 'Stablescan', url: 'https://stablescan.xyz' },
    dexSwapUrl: 'https://swap.stable.xyz/#/swap?outputCurrency=',
    dexscreenerSlug: null, // Stable is not indexed by DexScreener
    dexTokenUrl: null,
  },
  {
    key: 'arc',
    chainId: 5042,
    hexId: '0x13b2',
    // "Arc", never "Arc Testnet" and never "ARC": the ticker of the proposed
    // Arc coordination asset is ARC, and a chain rendered in caps next to a
    // fee line reads as a token amount. The testnet (5042002) is retired – the
    // key stays 'arc' so every URL, sitemap entry and SDK manifest id that
    // already points at this deployment keeps pointing at it.
    name: 'Arc',
    testnet: false,
    currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrl: 'https://rpc.mainnet.arc.io',
    // Read by the site's browser client only (src/lib/rpc.ts), exactly as on
    // Robinhood: `rpcUrl` above stays the one value the SDK manifest, the
    // wallet_addEthereumChain payload and GET /api/v1/networks mean. Circle
    // publishes these four beside the primary node, plus the independent
    // beamrpc endpoint; all five answered chain id 5042 when probed
    // 2026-09-16. They sit BELOW the official node and are never ranked above
    // it – see the rank:false reasoning in lib/rpc.ts.
    rpcUrls: [
      'https://rpc.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
      'https://rpc.beamrpc.com',
    ],
    // The ONLY explorer Arc has. Circle's own docs, Uniswap's chain config
    // (which calls it "Arcscan") and Relay's chain list all name this exact
    // host – and on 2026-09-16 every path on it, /api/v2 included, answers a
    // Cloudflare Access redirect to Circle's SSO. It is therefore the right
    // value for a link that must be absolute (every `${CHAIN.explorer}/address/…`
    // in the components) and the wrong thing to advertise as a public block
    // explorer: `explorerPublic` below is what surfaces ask before they
    // promise a reader they can look something up. Every alternative was
    // probed and none exists: arc.blockscout.com 404, arcscan.org parked,
    // arcscan.io / explorer.arc-scan.org / arc.socialscan.io NXDOMAIN,
    // arc-scan.org behind an unclearable challenge (a squat pattern – do not
    // link it), and Routescan answers "chain not supported" for 5042 from its
    // own API. Re-probe this when Circle opens the explorer.
    explorer: 'https://explorer.arc.io',
    // Is that explorer something a reader can actually open? On Arc: no. The
    // flag exists so a page can link DexScreener or the Uniswap token page
    // instead of promising a block explorer that answers a login wall, and so
    // "verified on <explorer>" prose can be withheld rather than published
    // falsely. Absent on the other chains, whose explorers are public.
    explorerPublic: false,
    origin: 'https://arc.openfair.app',
    api: 'https://arc.openfair.app/api/v1',
    mcp: 'https://arc.openfair.app/mcp',
    sdk: 'https://arc.openfair.app/sdk/openfair.js',
    embed: 'https://arc.openfair.app/embed/create',
    // The STABLE lineage (contracts/src/stable/): an 18-decimal native coin
    // whose ERC-20 face is 6-decimal, NATIVE_TO_ERC20 = 1e12, no WETH, and
    // sqrtPrice math rescaled for the decimal gap. Same generation as the
    // Stable deployment, hence the same 2.1 – NOT the 3.0 quote-pairs
    // generation: the v3 factory and the CrowdFactory both still assume an
    // 18-decimal quote and need a 6-decimal port before they can run here.
    // `lineage` is that same sentence said to the code – see the Robinhood
    // entry for what the field decides.
    lineage: 'stable',
    factoryVersion: '2.1',
    contracts: {
      // BROADCAST AND LIVE since 2026-09-16, block 21161925 (the LaunchFactory
      // creation). Source of truth for every address below:
      // docs/deployments/arc-mainnet/addresses.env, written by
      // contracts/deploy-chains/deploy-arc-mainnet.sh at 20260916T130822Z, and
      // the README.md beside it. EIP-55 spelling, because that is the casing
      // the contracts were compiled against and the casing every other table
      // in this repo carries.
      //
      // Five, not three: the deploy script emits OPEN_PROMOTIONS and
      // OPEN_SUBDOMAINS alongside the factory and the two deployers, and the
      // token page spends 100 / 50 USDC against `promotions` by msg.value with
      // no simulation in front of it. A half-filled table is therefore not "a
      // feature that is still off", it is a real transfer to a codeless
      // address. src/lib/config.ts derives ADDR from THIS block, so there is
      // no second copy to keep in step.
      //
      // The sixth address the script emits, LAUNCH_DEPLOYER
      // 0xd1296e5576Ba48facFc104B8593a36d9f1F2e3e8, is a constructor argument
      // of the factory and is read off the chain by the backend verifier – the
      // site never sends it calldata, so it has no slot here.
      //
      // Verification is Sourcify only (Arc has no public explorer – see
      // `verify` below): https://repo.sourcify.dev/5042/<address>.
      //
      // ---- what these five addresses turned on, and what was done BY HAND --
      //
      // AUTOMATIC (no edit – these read the five slots below):
      //   * /create is no longer gated: src/lib/config.ts CONTRACTS_PENDING is
      //     false on the arc build, the launch-method cards and BOTH submit
      //     buttons are enabled (src/pages/Create.tsx).
      //   * the "go and launch now" prose is back in all ten locales: the
      //     [[live]]…[[/live]] blocks in src/content/articles.mjs (the
      //     arc-blockchain-guide launch section and its "can I launch a token
      //     on Arc today?" FAQ pair, the step-by-step section and the closing
      //     call to action of how-to-create-a-token-on-{chain}) and in
      //     src/content/articles/arc-mainnet-what-changes.mjs. The predicate is
      //     the same five slots in both readers – lib/i18n.ts at runtime and
      //     scripts/prerender.mjs in the static HTML – so the pages and the
      //     button cannot disagree. Rebuild + re-prerender is all it takes.
      //
      // BY HAND, in the same release (nothing below reads this table):
      //   1. DONE – `npm run release:sdk` cut SDK v1.3.2. The pins that ship
      //      below it (v1.2.1–v1.3.1 under frontend/public/sdk/) embed the
      //      RETIRED Arc testnet – chain 5042002 and its addresses – because a
      //      pin is immutable by design and those files were cut before the
      //      cutover. An integrator on a pinned bundle gets the dead testnet
      //      until they move to v1.3.2, which is why the release had to wait
      //      for the addresses: a pin cut earlier would have frozen the nulls.
      //   2. DONE – the /developers example calls v1.3.2 and its integrity
      //      attribute is that version's entry in frontend/public/sdk/sri.json,
      //      so the page's hash and the version it tells people to load are the
      //      ones just released.
      //   3. DONE – `npm run build:sdk:npm` regenerated the type declaration
      //      (frontend/sdk/npm-package/types/…), which carries this chain table
      //      into the npm package's types: it now declares 5042 and these five
      //      addresses.
      //   4. NOT DONE HERE – publishing @openfair/sdk 1.3.2 to npm and
      //      deploying the built site are the conductor's steps, not the
      //      frontend workstream's.
      factory: '0xb122C3C07f7fFC0c72bE2AC1933a6D188ef09912',
      simpleTokenDeployer: '0x6A4b2f1e771349Cfe2E4ea507e0651E8B3F2f35f',
      fairTokenDeployer: '0x7bf697F9Eb52605fD1DCE1Cc9cbf94E289C85f06',
      promotions: '0xB35963EDD6059E1Df875202aA3Aea7d185E5c5a9',
      subdomains: '0xFf8b0b4901ccaC881E7C5733ff8A321eA144C31B',
      // Pool quote asset: the USDC ERC-20 face (6 decimals) at the Arc system
      // address. Same shape as Stable's USDT0 face above – the native gas coin
      // and this ERC-20 are ONE balance seen at two decimal scales (probed
      // 2026-09-16: 23831038000000000000 wei native == 23831038 face units at
      // one block). There is no wrapped 18-decimal USDC on Arc and Circle says
      // there will be none, so nothing here may point at a WETH-shaped
      // wrapper. The canonical Uniswap v3 deployment's own WETH9() returns a
      // 53-byte stub that reverts UnsupportedProtocolError() on every call –
      // never call it, never store it.
      weth: '0x3600000000000000000000000000000000000000',
      registry: null, // no QuoteRegistry on Arc mainnet – the v3 generation is not ported yet
      zap: null, // no quote pairs – nothing for the zap to route into
    },
    quotePairs: false, // no registry, no equity feeds, and no 6-decimal v3 port
    crowd: false, // CrowdFactory is part of the v3 generation – not ported to the 6-decimal face yet
    // Arc HAS a bridge page, and it is not the Arbitrum one: USDC reaches Arc
    // through Relay (api.relay.link lists chain 5042, depositEnabled true) and
    // through Circle's own CCTP v2 (Arc is domain 26). The page is chain-aware
    // – see src/pages/Bridge.tsx – so this flag means "write /bridge and its
    // nine locale variants, list them in the sitemap, keep the [[bridge]]
    // prose", not "the Arbitrum portal".
    bridge: true,
    // Dollar economics, the same figures the Stable deployment runs on: the
    // creation fee, the curve target and the start FDV are read by the
    // factory's own constants, so these lines are a mirror of on-chain state
    // and not an aspiration. The factory checks msg.value EXACTLY.
    //
    // starterLow/High are NOT the Stable pair, and that is the one figure in
    // this block that is a measurement rather than a mirror of the factory.
    // The fork run in docs/deployments/arc-mainnet/README.md §6.2 puts
    // createLaunch at 5 385 404 gas; Arc's base fee has a 20 gwei FLOOR and
    // was seen at ~31 gwei under launch-day load, so the gas alone is
    // 0.108–0.167 USDC and a create costs 0.61–0.67 USDC with the fee. "0.6"
    // – the number bridged by anyone who follows the /bridge step – does not
    // reach it. 1–2 USDC covers a create at the observed ceiling and leaves
    // gas for trading afterwards (a curve buy is ~297 190 gas ≈ 0.006 USDC).
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50, starterLow: '1', starterHigh: '2' },
    // Same shape as Stable: `contracts.weth` is the native coin's own
    // 6-decimal ERC-20 face, not a wrapper. See the note on the Stable entry –
    // on Arc the stakes are the same and the WETH9 the periphery advertises is
    // a reverting stub, so `wrapped:false` is a fact about the chain.
    nativeQuote: { decimals: 6, wrapped: false },
    // No Blockscout and no public explorer at all (explorerPublic:false above),
    // so the "read the code yourself" promise is kept by Sourcify, which
    // supports chain 5042. Every surface that names a verification target
    // reads this rather than a literal.
    verify: { name: 'Sourcify', url: 'https://sourcify.dev' },
    // Uniswap's own interface ships Arc as a first-class chain with
    // urlParam 'arc' (packages/uniswap/src/features/chains/evm/info/arc.ts),
    // so the deep link is the ordinary app.uniswap.org one. The pool quotes
    // against the USDC face directly – there is no wrapped native to route
    // through – which is why no inputCurrency is pinned here.
    dexSwapUrl: 'https://app.uniswap.org/swap?chain=arc&outputCurrency=',
    dexscreenerSlug: 'arc',
    // The "view this token somewhere public" destination on a chain with no
    // public block explorer: Uniswap's own token page, which reads the same
    // canonical v3 pools this deployment graduates into. It is not a code
    // viewer – nothing is – but it is a real page a reader can open, which
    // explorer.arc.io is not.
    dexTokenUrl: 'https://app.uniswap.org/explore/tokens/arc/',
  },
];

export const networkByChainId = (id) => NETWORKS.find((n) => n.chainId === Number(id));
