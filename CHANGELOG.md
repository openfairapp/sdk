# Changelog

## 1.2.0 · 2026-07-24

- multichain: Stable (chainId 988)

## 1.1.2 · 2026-07-22

- Package README on npmjs.com and `repository` metadata pointing to [github.com/openfairapp/sdk](https://github.com/openfairapp/sdk). No code changes.

## 1.1.1 · 2026-07-21

- Fixed: `@openfair/sdk/widget` no longer crashes when imported in Node/SSR (Next.js) — the element extends `HTMLElement` only in a real DOM.
- Fixed: `./package.json` added to the `exports` map (bundler tooling compatibility).

## 1.1.0 · 2026-07-20

- Launch pipeline: `launch.quote → simulate → execute → operation.wait` with progress stages (`validating → preparing_metadata → simulating → awaiting_wallet → transaction_submitted → confirming → indexing → completed/failed`), `AbortSignal` support and double-submit protection. The v1.0 one-call methods keep working and now run the pipeline internally.
- Full cost quotes: deploy fee, Supporter discount, gas estimate (+20% safety), required value, expiry (stale quotes refresh silently on execute).
- Pre-wallet simulation: balance + `eth_call` with typed revert reasons — a doomed transaction never reaches the wallet.
- Rich errors: `OpenfairError { code, stage, retriable, transactionHash?, contractReason?, suggestedAction? }` with codes such as `UserRejected`, `RpcRateLimited`, `SimulationFailed`, `TransactionReverted`, `IndexerTimeout`.
- Wallets: any EIP-1193 provider (WalletConnect v2, Coinbase — bring your provider), `autoSwitchChain: false` mode, `accountChanged` / `chainChanged` / `disconnect` events.
- Read-only registry: `tokens.list` (cursor pagination) / `get` / `waitUntilIndexed` / `getLaunchStatus`.
- Referral revenue: `referrals.getStats / getPositions / getClaimable / claim / claimAll`.
- Fair-launch preview: prices, FDV, graduation, buy examples with price impact — before any transaction.
- Custom anti-snipe (the raw on-chain knobs), team allocation, dev-buy, vanity salts + `launch.predictAddress`.
- Metadata: square crop, `prepareLogoDetailed` (mime/bytes/dimensions), pinning retries (content-addressed → idempotent), `extraMetadata` passthrough.
- Transport: `rpcUrls` fallback list, configurable timeouts, fee reads hardened against public-RPC rate limits.
- Observability: privacy-safe `onEvent` hook, per-operation correlation IDs, `diagnostics()`.
- Widget: events `of-ready / of-mode-change / of-wallet-connected / of-progress / of-tx-submitted / of-indexed / of-error`, `dict` attribute / `.dictionary` property for custom translations, `aria-live` status region, `Intl` number formatting.
- Distribution: npm package (ESM + CJS + types, `viem` as peer dependency, side-effect-free core), pinned browser bundles at `https://sdk.openfair.app/v<version>/openfair.js` with SRI hashes in `/sri.json`.

## 1.0.0 · 2026-07-17

Initial release: `connect`, `fees`, `prepareLogo`, `createInstant`, `createFairLaunch`, the `<openfair-create>` widget.
