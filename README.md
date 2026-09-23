# @openfair/sdk

Official SDK for [openfair](https://openfair.app) – the non-custodial fair token launchpad on **Robinhood Chain** (chainId 4663). Launch tokens from your own site, app, script or AI agent; every launch made through your integration records your wallet as the **on-chain referrer**, entitling you to half of the platform's fee share for that token – forever, enforced by the contracts, not by a server.

- **Fair Launch** – community-funded bonding curve (5 ETH target), anti-snipe, auto-listing on Uniswap V3, LP locked forever.
- **Instant Listing** – trading starts on Uniswap V3 in the creation transaction; zero capital needed.

## Install

```bash
npm install @openfair/sdk viem
```

Or drop-in for any web page (no build step):

```html
<script src="https://sdk.openfair.app/v1.4.1/openfair.js"
        integrity="sha384-Ors1kkp+TIlZnXxqZoRt/ZlJ3EB4Wd+VTBvo7IlsxQy+4WaPAV+53WPXZpoHcajV"
        crossorigin="anonymous"></script>
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

## Quote pairs (1.3.0)

A launch can be paired with an allow-listed ERC-20 instead of the chain's native coin. Pass `quote` and the transaction carries no value: `seedEth`, `devBuyEth` and `vanityFeeWei` become amounts **in the pair asset**, and the creation fee, curve target and start FDV come from the on-chain `QuoteRegistry` rather than from the chain's native economics.

```ts
const pairs = await sdk.quotes.list();      // [] on a chain without a registry
const tsla = pairs.find((q) => q.symbol === 'TSLA');

const quote = await sdk.launch.quote({ mode: 'instant', name: 'My Token', symbol: 'MTK', quote: tsla.address });
quote.requiredQuoteWei;   // fee + seed/dev-buy + vanity, in the pair's base units
quote.approvalNeeded;     // true → the factory needs an allowance first

if (quote.approvalNeeded) await sdk.launch.approve(quote); // execute() does this itself
const op = await sdk.launch.execute(quote);
```

`launch.approve(quote)` grants `approveAmountWei` – `requiredQuoteWei` plus 1 %, because the price feed is re-read inside the creation transaction. It is public only so an integration can split the two signatures across its own UI; `execute()` calls it when needed and reports the extra `approving` progress stage. `launch.preview({ quote })` / `previewFor(address)` return the same curve math in units of the pair.

Everything here is additive – a native launch is encoded exactly as before, `sdk.quotes.supported` is `false` and `quotes.list()` returns `[]` on chains where pairs are off.

## Pay a paired launch in ETH (1.3.1)

A launch paired with an ERC-20 collects that asset – but a buyer can pay the chain's coin instead, in one signature, through **OpenZap**: it wraps the coin, swaps it for the pair asset on Uniswap and buys on the curve inside a single transaction, crediting the tokens to the buyer (so the anti-snipe cap and the ramp apply to them, not to the zap).

```ts
const q = await sdk.tokens.zapQuote(token, { ethIn: 10n ** 16n }); // 0.01 ETH
q.poolFee;        // 500 / 3000 / 10000 – the deepest WETH/pair pool, discovered
q.quoteOut;       // pair asset the swap leg delivers
q.amountOut;      // curve tokens for it
await sdk.tokens.buyWithEth(token, { ethIn: 10n ** 16n, slippageBps: 200 });

// selling back to the coin: one approval (the zap pulls the tokens), one sale
await sdk.tokens.sellForEth(token, { tokensIn: 1_000n * 10n ** 18n });
```

The same three methods are mirrored on `sdk.launch`. Both floors – the pool leg and the curve leg – come from `slippageBps` (default 2 %); never pass `0`, the contract accepts it and it makes the trade a free sandwich. `contracts.zap` is `null` on a chain without a deployment and the calls then throw `ZapUnavailable` instead of guessing an address. Graduated tokens need no zap at all: their pool is token/pair, so a router `exactInput` over the packed path `WETH → pair → token` does it.

## Fee split – generation 3 (1.4.0)

Generation 3 of the launch factory enforces where the LP fee goes: a share of the quote side to the token's holders, and a share of the token side to holders instead of the burn. It is **opt-in**: a launch config without `feeSplit` / `generation: 3` is created exactly as before, and the SDK reads nothing new for it.

```ts
const quote = await sdk.launch.quote({
  mode: 'fair', name: 'My Token', symbol: 'MTK', platformShareBps: 5000,
  // bps of the WHOLE quote side / of the whole token side
  feeSplit: { holdersBps: 1500, buybackBps: 0, tokenHoldersBps: 2500 },
});
quote.generation; // 3 where the chain serves it
quote.factory;    // manifest.contracts.factoryG3 – approvals and fees follow it
quote.feeSplit;   // exactly what is signed
```

- Generation 3 is used only while the chain's own backend (`apiBase`) says `features.storefrontG3` and names `contracts.factoryG3` in `GET /api/v1/config` (one cached read). Another chain's answer reads as "off": for Arc pass `apiBase: 'https://arc.openfair.app'`. Stable (988) has no generation 3.
- `platformShareBps + holdersBps + buybackBps <= 10000`, every non-zero share `>= 100`, `buybackBps` must be `0` (the leg is not live), and a holders' share needs both `features.feeSplit` and `features.holdersPublisher` – anything else is an `OpenfairError('BadInput')` before any signature (while the config cannot be reached at all, a holders' share is a retriable `NetworkUnavailable` instead). A split that routes something is never silently dropped where generation 3 is off.
- `GET /api/v1/config` is read only for an opted-in create (and `diagnostics({ generation: 3 })`), past the browser's HTTP cache, and cached by the SDK for 60 s.
- `launch.target(config)` answers `{ generation, factory, feeSplit }` without pricing; `LaunchResult.generation` / `feeSplit` report what the chain recorded.
- A vanity `salt` pins the factory (the token's CREATE2 address depends on it): an opted-in create with a salt goes to generation 3 or is refused, never to a generation-2 fallback; `predictAddress()` follows the same rule, and `simulate()` checks the token the factory itself names against the prediction (`VanityMismatch`) before the vanity fee is signed.
- Widget: `<openfair-create fee-split="1500/0/2500">` shows the split read-only above the button; a config read that merely failed is retried, not shown as a refusal.
- `contracts.info()` returns the ABI of the factory's own shape (quote-aware on 4663; `{ generation: 3 }` for the generation-3 factory).
- 1.4.0 also chooses the OpenZap per launch (by its `factory()`) – a chain with generation 3 has two zaps, and each serves only its own factory's launches.

## Token symbol (1.4.1)

openfair.app, `POST /v1/launches/quote` and the `<openfair-create>` widget take any script – Latin, Cyrillic, CJK, emoji – 1 to 11 characters as MetaMask counts them (UTF-16 code units: an emoji takes two or more), no whitespace or control characters; the ends are trimmed and it is upper-cased. 11 is MetaMask's symbol limit for adding a token to the wallet. The headless `launch.quote()` sends `symbol` as given and only requires it to be non-empty.

## What's inside

| Area | API |
|---|---|
| Launch pipeline | `launch.quote` · `launch.simulate` · `launch.execute` · `operation.wait` – full cost quote (fee + gas), pre-wallet simulation, progress stages, `AbortSignal` |
| Quote pairs | `quotes.list / get` · `quotes.supported` · `quotes.registry` · `LaunchConfig.quote` · `launch.approve` · `supporterFeeBps()` – launches paired with an allow-listed ERC-20 |
| Curve preview | `launch.preview()` – sale supply, start/final price, FDV, buy examples with price impact (in units of the pair when `quote` is passed) |
| Token registry | `tokens.list` (cursor pagination) · `tokens.get` · `tokens.waitUntilIndexed` · `tokens.getLaunchStatus` |
| Referral revenue | `referrals.getStats / getPositions / getClaimable / claim / claimAll` |
| Wallets | injected (MetaMask, Rabby, …) or **any EIP-1193 provider** (WalletConnect v2, Coinbase – pass it to the constructor); `accountChanged` / `chainChanged` / `disconnect` events |
| Widget | `import '@openfair/sdk/widget'` → `<openfair-create>`: shadow-DOM web component, CSS-variable theming, `::part()` hooks, pair selector (`pair` attribute fixes it), events `of-ready / of-progress / of-pair-change / of-tx-submitted / of-created / of-error / …`, custom dictionaries via `dict` |
| Errors | typed `OpenfairError { code, stage, retriable, contractReason, suggestedAction }` |
| Ops | `rpcUrls` fallback transport, `contracts.verifyDeployment()`, privacy-safe `onEvent` hook, `diagnostics()` |

## Platform interfaces

| Interface | URL |
|---|---|
| REST API (OpenAPI 3.1) | `https://api.openfair.app` · spec at [`/openapi.yaml`](https://api.openfair.app/openapi.yaml) |
| MCP server (AI agents) | `https://mcp.openfair.app` – Streamable HTTP, 19 public read-only tools (search, quotes, simulation, referral analytics) + 2 behind a partner key (`create_launch_session`, `get_launch_session`) |
| Browser bundle | `https://sdk.openfair.app` |

MCP client config (Claude Code, Cursor, etc.):

```json
{ "mcpServers": { "openfair": { "type": "http", "url": "https://mcp.openfair.app" } } }
```

## Policy

- Launches prepared through the API/MCP set `platformShareBps ≥ 1500` (15%). The default `5000` (50/50) is recommended: it grants **Supporter** status and makes creation free.
- The SDK, API and MCP never hold keys and never sign transactions – signing happens only in the user's wallet.
- Partner capabilities (launch sessions with wallet-handoff URLs, webhooks) require an API key – contact the team via [openfair.app](https://openfair.app).

## Building from source

```bash
npm install
npm run build       # dist/: ESM + CJS (viem is a peer dependency) + types
```

## License

MIT
