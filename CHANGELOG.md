# Changelog

## 1.3.1 – 2026-09-07

ETH access to launches that collect an ERC-20 (spec §10), through the new
permissionless **OpenZap** contract. Additive: on a chain without a zap
deployment the manifest carries `zap: null` and the three new methods refuse
with `ZapUnavailable` instead of guessing an address; nothing else moves.

### Added
- **`tokens.zapQuote(token, { ethIn | tokensIn, slippageBps })`** – both legs of
  the route priced end to end: the WETH/pair pool tier (the deepest of
  500/3000/10000, discovered per asset), what the swap delivers, what the curve
  gives for it, and a floor for each leg. Source is `GET /api/v1/zap-quote`
  (10 s cache) with a QuoterV2 + `quoteBuy`/`quoteSell` fallback for the chain
  the bundle was built for; `source` says which answered.
- **`tokens.buyWithEth(token, { ethIn, slippageBps, deadlineSec, quote })`** –
  one signature: the coin is `msg.value`, so there is no allowance. The curve
  books the buy against the BUYER, so the anti-snipe cap and the global ramp
  apply to them.
- **`tokens.sellForEth(token, { tokensIn, … })`** – two signatures: the zap
  moves the tokens with `transferFrom`, so an exact-amount allowance lands
  first, then the sale swaps the pair asset back to the coin.
- All three are mirrored on `sdk.launch` for integrations that hold the launch
  API after a create.
- **Manifests**: `contracts.zap` (from the network registry) – `null` where the
  zap is not deployed.
- **Errors**: `ZapUnavailable`, `NotQuoteLaunch`, `NotOnCurve`, `NoRoute`,
  `TokenNotFound`; revert decoding for `Slippage`, `BadFee`, `Expired`,
  `NothingReceived`, `TokenNotConsumed`, `UnknownLaunch`.

### Unchanged
- Every method of 1.0–1.3.0, the native launch path, the widget and all
  contract addresses.

## 1.3.0 – 2026-09-07

Catches the npm package up with the browser bundle (1.2.x was never published to
npm) and adds launches paired with an allow-listed ERC-20 – "quote pairs".
Everything is additive: a native launch is encoded with the same bytes as in
1.2.2, and on a chain without a QuoteRegistry none of the new calls change
anything.

### Added
- **Quote registry**: `sdk.quotes.list()` / `get(address)`, `sdk.quotes.supported`,
  `sdk.quotes.registry`. Source – `GET /api/v1/quotes`, cached 60 s. On a chain
  without a registry and on a backend that predates quote pairs the list is
  empty, not an error.
- **Manifests**: `contracts.registry` – `null` where pairs are off. Registry and
  factory travel together: a manifest carrying a registry carries a factory that
  understands the quote fields.
- **`LaunchConfig.quote`** (asset address) for both modes. In this mode
  `msg.value = 0`, and `seedEth` / `devBuyEth` / `vanityFeeWei` are amounts IN
  THE PAIR ASSET; creation fee, curve target and start FDV come from the
  registry, not from the chain's native economics.
- **Quote**: `LaunchQuote.quote`, `requiredQuoteWei`, `approveAmountWei`
  (+1 % against a feed re-read at creation time), `allowanceWei`,
  `approvalNeeded`.
- **`launch.approve(quote)`** – allowance for the factory to pull the required
  amount; `execute()` calls it itself, the public method is for integrations
  that split the two signatures across their own UI. New progress stage
  `approving`.
- **`launch.preview({ quote })`** and `launch.previewFor(address)` – the same
  curve math in units of the pair; `FairPreview` gained `unit` and `quote`.
- **`sdk.supporterFeeBps()`** – the supporter discount multiplier read from the
  factory separately, because the same rule applies to a fee paid in the pair
  asset.
- **Widget `<openfair-create>`**: pair selector (the `pair` attribute fixes it
  and hides the choice), `of-pair-change` event, fee line and curve target in
  units of the pair, `stApproving` status. New dictionary keys: `pair`,
  `pairNative`, `pairNote`, `stApproving` (en/ru, overridable via `dict`).
- **Errors**: `QuotePairsUnavailable`, `QuoteNotAllowed`, `QuotePriceStale`,
  `InsufficientQuoteBalance`, `ApprovalRequired`; decoding of the
  `QuoteNotAllowed / QuoteTransferMismatch / QuoteFrozen / QuoteNotAccepted /
  NativeNotAccepted` reverts.

### Fixed
- Token address in the instant-listing receipt in pair mode: creation pulls the
  ERC-20 first, so `logs[0]` is the pair asset's Transfer, not the mint.
  `DirectListingCreated.token` is read instead. The native path is unchanged.

### Unchanged
- Every method of 1.0–1.2 and the `of-created` payload; native parameters,
  values and contract addresses.

## 1.2.0 – 2026-07-24

Browser bundle release (`https://sdk.openfair.app/v1.2.0/openfair.js`); not
published to npm – the npm line went 1.1.3 → 1.3.0.

- multichain: Stable (chainId 988)

## 1.1.3 – 2026-07-27

- **Contract addresses updated to LaunchFactory v2.1.** The platform redeployed
  its contracts after a security audit; 1.1.2 and earlier ship the v2.0
  addresses and keep talking to the superseded factory. Upgrading is
  recommended for every integrator.
  - LaunchFactory `0x205344a2e70529d4c6ECF4C45B3c0c64Fc7D1508`
  - FairTokenDeployer `0x35a0c465D7091757e15fFF64DFDF78079B5fAd4E`
  - Curve vanity salts are mined against the FairTokenDeployer, so a salt mined
    with 1.1.2 resolves to a different token address. Re-mine after upgrading.
- **Security fix in the `<openfair-create>` web component.** Attribute values
  and localisation strings are now escaped before they reach the shadow DOM.
  A page that fed attacker-controlled text into the element's attributes could
  previously break out of the attribute context.

## 1.1.2 – 2026-07-22

- Pinned bundle + SRI hashes published at `https://sdk.openfair.app/sri.json`.
- Package README on npmjs.com and `repository` metadata pointing to
  [github.com/openfairapp/sdk](https://github.com/openfairapp/sdk). No code
  changes.

## 1.1.1 – 2026-07-21

- Fixed: `@openfair/sdk/widget` no longer crashes when imported in Node/SSR
  (Next.js) – the element extends `HTMLElement` only in a real DOM.
- Fixed: `./package.json` added to the `exports` map (bundler tooling
  compatibility).

## 1.1.0 – 2026-07-20

- Launch pipeline: `launch.quote → simulate → execute → operation.wait` with
  progress stages (`validating → preparing_metadata → simulating →
  awaiting_wallet → transaction_submitted → confirming → indexing →
  completed/failed`), `AbortSignal` support and double-submit protection. The
  v1.0 one-call methods keep working and now run the pipeline internally.
- Full cost quotes: deploy fee, Supporter discount, gas estimate (+20% safety),
  required value, expiry (stale quotes refresh silently on execute).
- Pre-wallet simulation: balance + `eth_call` with typed revert reasons – a
  doomed transaction never reaches the wallet.
- Rich errors: `OpenfairError { code, stage, retriable, transactionHash?,
  contractReason?, suggestedAction? }` with codes such as `UserRejected`,
  `RpcRateLimited`, `SimulationFailed`, `TransactionReverted`,
  `IndexerTimeout`.
- Wallets: any EIP-1193 provider (WalletConnect v2, Coinbase – bring your
  provider), `autoSwitchChain: false` mode, `accountChanged` / `chainChanged` /
  `disconnect` events.
- Read-only registry: `tokens.list` (cursor pagination) / `get` /
  `waitUntilIndexed` / `getLaunchStatus`.
- Referral revenue: `referrals.getStats / getPositions / getClaimable / claim /
  claimAll`.
- Fair-launch preview: prices, FDV, graduation, buy examples with price impact
  – before any transaction.
- Custom anti-snipe (the raw on-chain knobs), team allocation, dev-buy, vanity
  salts + `launch.predictAddress`.
- Metadata: square crop, `prepareLogoDetailed` (mime/bytes/dimensions), pinning
  retries (content-addressed → idempotent), `extraMetadata` passthrough.
- Transport: `rpcUrls` fallback list, configurable timeouts, fee reads hardened
  against public-RPC rate limits.
- Observability: privacy-safe `onEvent` hook, per-operation correlation IDs,
  `diagnostics()`.
- Widget: events `of-ready / of-mode-change / of-wallet-connected / of-progress
  / of-tx-submitted / of-indexed / of-error`, `dict` attribute / `.dictionary`
  property for custom translations, `aria-live` status region, `Intl` number
  formatting.
- Distribution: npm package (ESM + CJS + types, `viem` as peer dependency,
  side-effect-free core), pinned browser bundles at
  `https://sdk.openfair.app/v<version>/openfair.js` with SRI hashes in
  `/sri.json`.

## 1.0.0 – 2026-07-17

Initial release: `connect`, `fees`, `prepareLogo`, `createInstant`,
`createFairLaunch`, the `<openfair-create>` widget.
