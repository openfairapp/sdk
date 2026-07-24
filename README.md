# @openfair/sdk

Official SDK for [openfair](https://openfair.app) – the non-custodial fair token launchpad. Multichain: **Robinhood Chain** (chainId 4663) and **Stable** (chainId 988) are supported out of the box; pick one with `new Openfair({ chainId })`. Launch tokens from your own site, app, script or AI agent; every launch made through your integration records your wallet as the **on-chain referrer**, entitling you to half of the platform's fee share for that token – forever, enforced by the contracts, not by a server.

​```js
import { Openfair } from '@openfair/sdk';
const sdk = new Openfair({ chainId: 988 }); // Stable; omit for Robinhood Chain
​```

- **Fair Launch** — community-funded bonding curve (5 ETH target), anti-snipe, auto-listing on Uniswap V3, LP locked forever.
- **Instant Listing** — trading starts on Uniswap V3 in the creation transaction; zero capital needed.

## Install

```bash
npm install @openfair/sdk viem
```

Or drop-in for any web page (no build step):

```html
<script src="https://sdk.openfair.app/v1.2.0/openfair.js"
        integrity="sha384-17+49/XBKnNrlu8HHVZ6sxc3CyLaItelm+QzmMb7uitzcs5AlR5iVjCcKcbqUyE3" crossorigin="anonymous"></script>
<openfair-create ref="0xYourWallet"></openfair-create>
```

Pinned versions and SRI hashes: [`https://sdk.openfair.app/sri.json`](https://sdk.openfair.app/sri.json). `https://sdk.openfair.app/openfair.js` always serves the latest build.

## Quick start (headless)

```ts
import { Openfair } from '@openfair/sdk';

const sdk = new Openfair({ referrer: '0xYourReferralWallet' });
await sdk.connect(); // connects the wallet, switches/adds Robinhood Chain

// Staged pipeline: quote → simulate → execute → wait
const quote = await sdk.launch.quote({
  mode: 'instant',
  name: 'My Token',
  symbol: 'MTK',
  platformShareBps: 5000, // 50/50 → Supporter: creation is FREE
});
const sim = await sdk.launch.simulate(quote);
if (!sim.success) throw sim.error; // typed, human-readable, nothing sent

const op = await sdk.launch.execute(quote, {
  onProgress: (e) => console.log(e.stage, e.progress),
});
const result = await op.wait({ confirmations: 1, waitForIndexer: true });
console.log(result.tokenAddress, result.openfairUrl, result.dexUrl);
```

One-call shortcuts `sdk.createInstant(...)` / `sdk.createFairLaunch(...)` run the same pipeline internally.

## What's inside

| Area | API |
|---|---|
| Launch pipeline | `launch.quote` · `launch.simulate` · `launch.execute` · `operation.wait` — full cost quote (fee + gas), pre-wallet simulation, progress stages, `AbortSignal` |
| Curve preview | `launch.preview()` — sale supply, start/final price, FDV, buy examples with price impact |
| Token registry | `tokens.list` (cursor pagination) · `tokens.get` · `tokens.waitUntilIndexed` · `tokens.getLaunchStatus` |
| Referral revenue | `referrals.getStats / getPositions / getClaimable / claim / claimAll` |
| Wallets | injected (MetaMask, Rabby, …) or **any EIP-1193 provider** (WalletConnect v2, Coinbase — pass it to the constructor); `accountChanged` / `chainChanged` / `disconnect` events |
| Widget | `import '@openfair/sdk/widget'` → `<openfair-create>`: shadow-DOM web component, CSS-variable theming, `::part()` hooks, events `of-ready / of-progress / of-tx-submitted / of-created / of-error / …`, custom dictionaries via `dict` |
| Errors | typed `OpenfairError { code, stage, retriable, contractReason, suggestedAction }` |
| Ops | `rpcUrls` fallback transport, `contracts.verifyDeployment()`, privacy-safe `onEvent` hook, `diagnostics()` |

## Platform interfaces

| Interface | URL |
|---|---|
| REST API (OpenAPI 3.1) | `https://api.openfair.app` · spec at [`/openapi.yaml`](https://api.openfair.app/openapi.yaml) |
| MCP server (AI agents) | `https://mcp.openfair.app` — Streamable HTTP, 16 public read-only tools (search, quotes, simulation, referral analytics) |
| Browser bundle | `https://sdk.openfair.app` |

MCP client config (Claude Code, Cursor, etc.):

```json
{ "mcpServers": { "openfair": { "type": "http", "url": "https://mcp.openfair.app" } } }
```

## Policy

- Launches prepared through the API/MCP set `platformShareBps ≥ 1500` (15%). The default `5000` (50/50) is recommended: it grants **Supporter** status and makes creation free.
- The SDK, API and MCP never hold keys and never sign transactions — signing happens only in the user's wallet.
- Partner capabilities (launch sessions with wallet-handoff URLs, webhooks) require an API key — contact the team via [openfair.app](https://openfair.app).

## Building from source

```bash
npm install
npm run build       # dist/: ESM + CJS (viem is a peer dependency) + types
```

## License

MIT
