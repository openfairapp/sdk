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
      // ---- generation 3: the enforced fee split (FEE_SPLIT_DESIGN) ----------
      // NEW keys, and ADDITIVE ones: `factory`, `zap` above and every other
      // consumer's idea of "the factory" keep their generation-2 meaning for
      // ever. Pinned SDK bundles bake the generation-2 factory in at build time
      // and third parties encode against the published one, so the old names
      // cannot be repointed – first-party surfaces opt into generation 3 through
      // these three instead, and only while the running backend says so
      // (features.storefrontG3, lib/feeSplit.ts g3LaunchFactoryFor).
      //
      // They are what PINS that runtime answer: a backend whose
      // `contracts.launchFactoryG3` is not this exact address reads as "off",
      // never as a destination. lib/config.ts STATIC_*_G3 reads them; nothing in
      // the SDK or the backend does (both read the fields they need by name).
      //
      // The token deployers are REUSED by generation 3 (D13 – read back off
      // the chain 2026-09-23: fairTokenDeployer() / simpleTokenDeployer() of
      // the G3 factory are the two above), so they have no G3 twin here.
      // `zapG3` is the zap the G3 factory was constructed with
      // (LaunchFactory G3 zapRouter() == this, and its factory() == G3): the old
      // OpenZap above reverts UnknownLaunch for a launch another factory made,
      // so a G3 quote launch is traded ONLY through this one.
      launchFactoryG3: '0x399933d7b38084E1Bc867DC156d06A1216c22D0E',
      crowdFactoryG3: '0x5760E802c7A84489A26Ad943A392F92e9242aCf0',
      zapG3: '0xC39EE0090f81c664Cf13F58Fd342890514D9FB76',
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
    //
    // `stable: false` – the native coin is ETH, not a dollar. It drives the
    // trade panel's quick-buy presets: ETH-sized fractions, not dollar sizes.
    nativeQuote: { decimals: 18, wrapped: true, stable: false },
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
      // No generation 3 on 988 – nothing of the fee-split generation was ever
      // broadcast here, so every first-party create stays on `factory` above
      // whatever a backend says (see the Robinhood entry).
      launchFactoryG3: null,
      crowdFactoryG3: null,
      zapG3: null,
    },
    quotePairs: false, // no registry, no assets
    // No CrowdFactory ON CHAIN 988 – fair launch and instant listing only.
    //
    // Read this as a fact about the BROADCAST and nothing else. The crowd set
    // it would need is this chain's own lineage (contracts/src/stable/), it is
    // compiled, the site encodes its 25-field tuple (src/lib/crowdAbi.ts,
    // selected by `lineage`), and since 2026-09-17 the very same sources run
    // on Arc mainnet – see the arc entry's `crowdContracts`. Nobody has sent
    // the creation transactions on 988, so there is no address to point at
    // here, and that is the whole of the difference.
    //
    // The switch-on is therefore a paste and not a port: flip this to true AND
    // fill `crowdContracts` + `crowdStartBlock` in the SAME edit. Half of that
    // is refused by tests/crowd-lineage-abi.test.mjs, because a `crowd: true`
    // with no factory address is a storefront pointed at 0x0000…0000.
    crowd: false,
    bridge: false, // no Arbitrum route from Ethereum – USDT0 arrives via usdt0.to
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000, boost: 100, topSlot: 50, starterLow: '0.6', starterHigh: '1' },
    // `contracts.weth` here is the native coin's OWN 6-decimal ERC-20 face,
    // not a wrapper: one balance seen at two scales. So a graduated pool is
    // quoted in SIX decimals, and a "native" swap is an ordinary ERC-20 swap
    // – there is nothing to wrap and nothing to unwrap. Both halves matter:
    // the decimals decide how an amount is parsed (18 here means 1e12 times
    // too much), and `wrapped` decides whether the router is handed msg.value
    // or an allowance.
    //
    // `stable: true` – the native coin IS a dollar (USDT0). It drives the
    // trade panel's quick-buy presets: dollar sizes, not ETH-sized fractions.
    nativeQuote: { decimals: 6, wrapped: false, stable: true },
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
    // The ONLY explorer Arc has, and a PUBLIC one since 2026-09-17. Circle's
    // own docs, Uniswap's chain config (which calls it "Arcscan") and Relay's
    // chain list all name this exact host. It went public one day after the
    // mainnet cutover: on 2026-09-16 every path on it answered a Cloudflare
    // Access redirect to Circle's SSO, and on 2026-09-17 it is an ordinary
    // Blockscout – /api/v2/stats answers 200 JSON and /api?module=stats answers
    // the Etherscan-style v1 shape, from a browser and from our own server.
    // Same shape as Robinhood's Blockscout, including the failure mode: a plain
    // curl from an unblessed IP gets a Cloudflare JS challenge on /api/* while
    // the HTML pages answer 200, so READS can be walled per IP even though the
    // explorer is public. `explorerPublic` below is about the PAGES, which are
    // what a reader opens.
    //
    // Lookalikes stay off this entry, permanently: arc.blockscout.com 404,
    // arcscan.org parked, arcscan.io / explorer.arc-scan.org /
    // arc.socialscan.io NXDOMAIN, arc-scan.org behind an unclearable challenge
    // (a squat pattern – do not link it), and Routescan answers "chain not
    // supported" for 5042 from its own API.
    explorer: 'https://explorer.arc.io',
    // `explorerPublic: false` used to sit here – the flag that let a page link
    // DexScreener or the Uniswap token page instead of promising a block
    // explorer that answers a login wall, and let "verified on <explorer>" prose
    // be withheld rather than published falsely. It is ABSENT now, which is how
    // every chain whose explorer is public spells it, and the machinery stays
    // in place (lib/explorer.ts, EXPLORER_PUBLIC in lib/config.ts and
    // backend/src/config.js) for the next chain that needs it – or for this one,
    // if Circle ever puts the wall back. `dexTokenUrl` below stays for the same
    // reason: it is a real page and costs nothing to keep pointing at.
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
      // Verification runs against TWO targets (see `verify` below): Blockscout
      // on https://explorer.arc.io, and Sourcify at
      // https://repo.sourcify.dev/5042/<address>.
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
      // Generation 3 (the enforced fee split), ADDITIVE keys – see the note on
      // the Robinhood entry: `factory` above and `crowdContracts.factory` below
      // keep their generation-2 meaning, and first-party creates move here only
      // while the running backend says features.storefrontG3 AND names these
      // exact addresses. The stable lineage's G3 LaunchFactory keeps the
      // 23-field pre-quote structs and reuses the two deployers above (D13).
      // No zap: Arc has no quote pairs, so there is nothing for one to route.
      launchFactoryG3: '0xa40Fc41E109244f57A6572a13c54F4Fd0A704416',
      crowdFactoryG3: '0x451E191c1DD158A3612a788fa1c961295214DeE3',
      zapG3: null,
    },
    quotePairs: false, // no registry, no equity feeds, and no 6-decimal v3 port
    // CrowdFactory on Arc mainnet: BROADCAST AND LIVE since 2026-09-17, block
    // 21303194 (the factory's creation). What was missing on 2026-09-16 was
    // only the broadcast – the mode was never "not ported": the stable lineage
    // has its own CrowdFactory (contracts/src/stable/), a 25-field CrowdParams
    // with no `quote` at all, selector 0x32520209, native only because the
    // chain's coin IS the dollar, and the site has encoded that tuple since
    // the lineage split (src/lib/crowdAbi.ts, selected by `lineage`). So this
    // edit is the chain catching up with the bundle, not a port.
    //
    // The flag and `crowdContracts`/`crowdStartBlock` below move together, in
    // ONE edit – tests/crowd-lineage-abi.test.mjs fails a half-filled entry,
    // because a `crowd: true` with no factory address is a storefront pointed
    // at 0x0000…0000.
    crowd: true, // CrowdFactory 0x65B7b17c…457B (gen 2, 1-day vesting floor), live 2026-09-21; was 0x514488E3…02d5 since 2026-09-17
    /**
     * The crowd generation's own five addresses, and the block to backfill
     * from. Source of truth: docs/deployments/arc-mainnet/crowd-addresses.env,
     * written by contracts/deploy-chains/deploy-crowd-stable.sh at
     * 20260917T090103Z from the deployer
     * 0x5aF99e6aad5F7c09eb16115204a02217a448B157, with the creation tx of every
     * one of them recorded beside it. EIP-55 spelling, the casing the contracts
     * were compiled against. tests/crowd-arc-live.test.mjs reads that file and
     * compares it with this block, so the two cannot drift.
     *
     * THREE OF THESE ADDRESSES ALSO EXIST ON STABLE (988), AND THAT IS NOT A
     * PASTE ERROR. `deployer`, `tokenDeployer` and `teamVesting` are byte for
     * byte the Stable entry's `factory`, `fairTokenDeployer` and
     * `simpleTokenDeployer`: a CREATE address is keccak(sender, nonce) and
     * nothing else, the two chains were deployed from the SAME EOA, and its
     * nonces 20/21/22 landed on the same three addresses on both. (All five
     * here are that EOA's nonces 19-23 on 5042; the launch set in `contracts`
     * above is the same key's 6-8, 12 and 14.) The practical consequence is
     * worth knowing: an Arc call aimed at one of these three from a wallet left
     * on 988 does not hit empty space, it hits a different live contract.
     *
     * NO ECONOMICS BLOCK, on purpose – the Robinhood entry carries none either.
     * Read back off this factory on 2026-09-17: createFee 10 USDC,
     * minContribution 5 USDC, feeCap 2500 USDC, raiseFee 200 bps,
     * platformShare 1500 bps, platform treasury
     * 0xC2579e54cab276047B1dD030A07297a39b20CE26, pool quote = the 6-decimal
     * USDC face in `contracts.weth` above. Every crowd surface reads those
     * live – `termsFor(quote)` and `raiseFeeBps()` on the factory itself
     * (src/pages/Create.tsx), printed through {amt}/{sym} – because four of
     * them sit behind owner setters (setCreateFeeNative, setRaiseFeeBps,
     * setPlatformShareBps, setPlatformTreasury). A copy here would be a number
     * that can go stale against a setter, on a page quoting a fee.
     *
     * REPLACING THE FACTORY (a second crowd generation). `MIN_VESTING` came
     * down from 90 days to 1 on 2026-09-20, which is a change to CrowdFactory
     * and to NOTHING ELSE: the swap replaces ONE contract.
     *
     * `crowdDeployer` is immutable inside the factory, which is what a cascade
     * would go through – but the cascade never starts, because the edit stopped
     * short of OpenCrowd. CrowdDeployer embeds OpenCrowd's creation code and is
     * byte-for-byte unchanged, so the new factory points at the SAME deployer,
     * tokenDeployer, teamVesting and poolSeeder, and
     * script/RedeployCrowdFactory.s.sol asserts that equality field by field
     * after the broadcast (one CREATE in the record, `CROWD_DEPLOYER`
     * unchanged). Every vanity salt already mined stays valid for the same
     * reason: CrowdTokenDeployer did not move.
     *
     * When the conductor has the new address:
     *
     *   1. the deploy script writes docs/deployments/arc-mainnet/
     *      crowd-factory-v2.env; paste `CROWD_FACTORY_V2` from it into
     *      `factory` below and change NOTHING else in this block – the other
     *      four lines are the reused contracts and moving one would point the
     *      site at a helper the new factory does not use. There is no list and
     *      no history here: `factory` IS the factory a create is sent to, and
     *      the address it replaces is history that lives in the deploy records.
     *      Raises already created by the old factory are unaffected – a
     *      campaign page reads the RAISE contract, never the factory that made
     *      it, so each one keeps the 90-day terms it was created with for as
     *      long as it exists.
     *   2. LEAVE `crowdStartBlock` where it is. It is the earliest crowd
     *      factory this chain has carried, not the newest; moving it forward to
     *      the new record's block starts every backfill after the first
     *      generation's live raises.
     *   3. the running backend needs BOTH crowd names in the same change:
     *      CROWD_FACTORIES=<old>,<new> (oldest first – it is what the indexer
     *      filters eth_getLogs on, and a list that drops the old generation
     *      takes its live raises off the site) and CROWD_FACTORY=<new> (where
     *      new raises are created). lib/exploreApi.ts crowdFactoryFor compares
     *      the storefront with `factory` above and answers "off" when they
     *      disagree, so a half-done swap is a dark create card on Arc – never a
     *      create signed against the wrong address. That is the intended
     *      failure mode; it is still an outage, so do all three.
     *
     * tests/crowd-arc-live.test.mjs is written for exactly this: everything
     * that is a fact about the FIRST generation sits behind `isFirstGeneration`
     * and stops applying on its own, while the rules that hold for any
     * generation – registry equals the record, every address is a CREATE
     * address of the recorded deployer, the factory never collides with a
     * Stable contract – keep running against the new set.
     */
    crowdContracts: {
      // Generation 2, 2026-09-21: MIN_VESTING/MIN_VESTING_INTERVAL down to the
      // 1-day floor (was 90/30 days on generation 1). ONE contract moved – the
      // four lines below are unchanged, byte-for-byte the same helpers
      // generation 1 pointed at. History: generation 1's factory was
      // 0x514488E3dD7E78848Db8dD22cfd8c27077f102d5, live 2026-09-17 to
      // 2026-09-21 (see docs/deployments/arc-mainnet/crowd-factory-v2.env);
      // its raises stay indexed under CROWD_FACTORIES=old,new.
      factory: '0x65B7b17c0fFdD10deBb092C070ac93851536457B',
      deployer: '0xd4a5AC9D63954C33b9E0dd045da5fb9e41A1B8f2',
      tokenDeployer: '0xB4E8edc4Bcb815Ba3D65D3Dc2d9f3659baF74EA3',
      teamVesting: '0x8b5dCdeF943b16f2a07f56E7ffE38bBad7A9d2bd',
      poolSeeder: '0xB217b6eB980985C74107528Af7713548Fb0AE658',
    },
    crowdStartBlock: 21303194,
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
    //
    // `stable: true` – the native coin IS a dollar (USDC). It drives the
    // trade panel's quick-buy presets: dollar sizes, not ETH-sized fractions.
    nativeQuote: { decimals: 6, wrapped: false, stable: true },
    // TWO targets on Arc, and the name says both: the chain's own Blockscout at
    // explorer.arc.io (public since 2026-09-17, and what the backend's verify
    // worker submits to first) and Sourcify, which supports chain 5042 and is
    // the second, independent record. Every surface that names a verification
    // target reads this field rather than a literal – it is substituted as
    // {verifyName}/{verifyUrl} into the /docs prose, the landing feature and
    // the ten locale dictionaries – so the whole phrase lives here, once.
    // Robinhood names only Blockscout for the same reason in reverse: Sourcify
    // is on there too, but its explorer is the target a reader checks.
    verify: { name: 'explorer.arc.io (Blockscout) and Sourcify', url: 'https://explorer.arc.io' },
    // The explorer's own PRODUCT name, asked separately because on Arc the two
    // questions have different answers: `verify.name` above is "where are these
    // contracts verified" (two targets, named in one phrase for the /docs
    // sentence), while this is "what is the explorer called" – the label a
    // wallet shows on a View-on-explorer entry, where a two-target phrase reads
    // as nonsense. Omitted on Robinhood and Stable, where their explorer IS the
    // verification target and `verify.name` already answers both.
    explorerName: 'Blockscout',
    // Uniswap's own interface ships Arc as a first-class chain with
    // urlParam 'arc' (packages/uniswap/src/features/chains/evm/info/arc.ts),
    // so the deep link is the ordinary app.uniswap.org one. The pool quotes
    // against the USDC face directly – there is no wrapped native to route
    // through – which is why no inputCurrency is pinned here.
    dexSwapUrl: 'https://app.uniswap.org/swap?chain=arc&outputCurrency=',
    dexscreenerSlug: 'arc',
    // The "view this token somewhere public" destination for a chain with no
    // public block explorer: Uniswap's own token page, which reads the same
    // canonical v3 pools this deployment graduates into. Arc HAS a public
    // explorer again, so lib/explorer.ts never reaches this fallback today –
    // it is kept because it is a correct, live page and because the fallback is
    // one registry line away from being needed again.
    dexTokenUrl: 'https://app.uniswap.org/explore/tokens/arc/',
  },
];

export const networkByChainId = (id) => NETWORKS.find((n) => n.chainId === Number(id));
