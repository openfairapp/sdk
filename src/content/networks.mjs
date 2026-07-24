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
    explorer: 'https://robinhoodchain.blockscout.com',
    origin: 'https://openfair.app',
    // integration endpoints (per-deployment: each domain serves its own chain)
    api: 'https://openfair.app/api/v1',
    mcp: 'https://openfair.app/mcp',
    sdk: 'https://openfair.app/sdk/openfair.js',
    embed: 'https://openfair.app/embed/create',
    factoryVersion: '2.1',
    contracts: {
      factory: '0x05366E22fe142e38e62d72584404Ca978B92Bf6F',
      simpleTokenDeployer: '0x69B229843fD08E76D55373901CB57dE571987c36',
      fairTokenDeployer: '0x12F394C101bA7ed4dbb71b978060F89B7c958143',
      // pool quote asset: WETH on Robinhood
      weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    },
    economics: { deployFee: 0.0005, target: 5, startFdv: 3 },
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
      factory: '0xFf8b0b4901ccaC881E7C5733ff8A321eA144C31B',
      simpleTokenDeployer: '0xB35963EDD6059E1Df875202aA3Aea7d185E5c5a9',
      fairTokenDeployer: '0x71D6E3A164C4b1CcbD08785592df4ff3aE11E7Fb',
      // pool quote asset: the USDT0 ERC-20 (6 decimals) – no WETH on Stable,
      // the native gas token IS this ERC-20 over one shared balance.
      weth: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    },
    economics: { deployFee: 0.5, target: 10000, startFdv: 5000 },
    dexSwapUrl: 'https://swap.stable.xyz/#/swap?outputCurrency=',
  },
];

export const networkByChainId = (id) => NETWORKS.find((n) => n.chainId === Number(id));
