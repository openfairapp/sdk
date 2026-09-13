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
    // Does this chain have a bridge page (/bridge and its nine locale variants)?
    // The page is entirely about the Arbitrum canonical bridge from Ethereum,
    // so only Robinhood has one. THE predicate for every surface that emits or
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
    dexSwapUrl: 'https://app.uniswap.org/swap?chain=robinhood&outputCurrency=',
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
    factoryVersion: '2.1',
    contracts: {
      factory: '0xd4a5AC9D63954C33b9E0dd045da5fb9e41A1B8f2',
      simpleTokenDeployer: '0x8b5dCdeF943b16f2a07f56E7ffE38bBad7A9d2bd',
      fairTokenDeployer: '0xB4E8edc4Bcb815Ba3D65D3Dc2d9f3659baF74EA3',
      // pool quote asset: the USDT0 ERC-20 (6 decimals) – no WETH on Stable,
      // the native gas token IS this ERC-20 over one shared balance.
      weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
      registry: null, // no quote pairs on Stable
      zap: null, // no quote pairs – nothing for the zap to route into
    },
    quotePairs: false, // no registry, no assets
    bridge: false, // no Arbitrum route from Ethereum – USDT0 arrives via usdt0.to
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50, starterLow: '0.6', starterHigh: '1' },
    dexSwapUrl: 'https://swap.stable.xyz/#/swap?outputCurrency=',
  },
  {
    key: 'arc',
    chainId: 5042002,
    hexId: '0x4cef52',
    name: 'ARC',
    testnet: true,
    currency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorer: 'https://testnet.arcscan.app',
    origin: 'https://arc.openfair.app',
    api: 'https://arc.openfair.app/api/v1',
    mcp: 'https://arc.openfair.app/mcp',
    sdk: 'https://arc.openfair.app/sdk/openfair.js',
    embed: 'https://arc.openfair.app/embed/create',
    factoryVersion: '3.0',
    contracts: {
      // Redeployed 2026-08-20 for dollar economics: the previous factory
      // (0xB35963ED…5c5a9) compiled MAX_DEPLOY_FEE as a 0.1-unit constant, so a
      // 0.5 USDC creation fee was unreachable on it. WUSDC is 18-decimal, so
      // the shared contracts run unchanged – no Stable-style 6-decimal work.
      factory: '0x8dbbDD311927C7a34f802Fa3cCD4916742d65374',
      simpleTokenDeployer: '0x6E53cf0adb1A9640E1dCB7DD6ABF3d766Bcd02B6',
      fairTokenDeployer: '0xD25857A5608f28B33354737DC471e1daf1382A1C',
      weth: '0x911b4000D3422F482F4062a913885f7b035382Df',
      registry: '0xaf8Db292b038De25D74c5C64269128b6203fb920', // deployed EMPTY – no Chainlink stock feeds on Arc, so quotePairs stays false
      zap: '0xAD69B524b84A07176381b37855FDb895248b8762',
    },
    // Stays false when the v3 addresses land: Arc's QuoteRegistry is deployed
    // EMPTY and stays empty (no Chainlink equity feeds on the testnet), so the
    // zap has no route and every Arc launch is native. Pasting the registry
    // address above must NOT publish the tokenised-stock surfaces – that is
    // exactly what this flag separates.
    quotePairs: false,
    bridge: false, // a faucet-funded testnet: nothing to bridge
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50, starterLow: '0.6', starterHigh: '1' },
    // Testnet: no public swap UI, so token pages show no external DEX button.
    dexSwapUrl: '',
  },
];

export const networkByChainId = (id) => NETWORKS.find((n) => n.chainId === Number(id));
