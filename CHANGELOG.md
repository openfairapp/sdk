# Changelog

## 1.4.1 – 2026-09-23

Ticker accepts any script, 1–11 characters as MetaMask counts them: `<openfair-create>` now applies the site's symbol rule (any script, at most 11 UTF-16 code units – MetaMask's limit, counted as MetaMask counts, so an emoji takes two or more – no whitespace, control or invisible format characters, trimmed and upper-cased) and refuses a symbol that breaks it in place, instead of silently keeping its first 8 UTF-16 code units. Pinned bundle `https://sdk.openfair.app/v1.4.1/openfair.js` (`sha384-Ors1kkp+TIlZnXxqZoRt/ZlJ3EB4Wd+VTBvo7IlsxQy+4WaPAV+53WPXZpoHcajV`).

## 1.4.0 – 2026-09-23

Two live create bugs fixed, and generation 3 – the enforced fee split – as an
opt-in. Released together with the pinned browser bundle
`https://sdk.openfair.app/v1.4.0/openfair.js`
(`sha384-J3mJKd1cP0YotcIeY4i/s7SNllUSz09QEttloeyAJmkmftoKq7N/Km8F6Itot8X2`).

### Fixed
- **Native creates on Robinhood (4663) reverted in 1.3.2 and 1.3.3.** They
  encoded a native launch with the pre-quote entry points (`createLaunch`
  0x7c178686 / `createDirectListing` 0x3515085c), but the v3 factory the 4663
  manifest names since 1.3.2 (0x1Af66EB4…CFce) exposes only the quote-aware
  shapes (0xfc6359c6 / 0xa3b13422) – so every native create through the SDK or
  the widget failed at simulation. The shape is now chosen by the FACTORY, not
  by whether a pair is selected: on a quote-aware factory a native launch uses
  the same struct with `quote = 0x0` (and `liquidityQuote = 0` for an instant
  listing), as the site does. Verified with read-only `eth_call`s on 4663. 1.3.0
  and 1.3.1 are not affected: they send native creates to the previous v2.1
  factory (0x205344a2…1508), which still accepts them.
- **The token address of a native fair launch.** 1.3.x decoded `LaunchCreated`
  with a 21-field tuple no current factory emits, so a successful native fair
  launch on Arc or Stable ended in `TxError` "could not find the token address in
  the receipt". The token now comes from the creation event of the factory the
  transaction was sent to – other addresses' logs are ignored – in every shape:
  24/13 fields on quote-aware factories, 23/11 on the stable lineage, 21 as the
  last resort. Checked against real receipts on 4663 and Arc.
- **`contracts.info()` handed out the pre-quote ABI for every chain** – the
  same selector bug: an integrator encoding a create with `info().abi` on 4663
  got 0x7c178686 / 0x3515085c, which the v3 factory does not have. The ABI is
  now the factory's own shape (quote-aware from `factoryVersion` 3.0, pre-quote
  on Arc/Stable as in 1.3.x) plus `deployFee` / `supporterFeeBps` /
  `updateMetadata`; `info(chainId, { generation: 3 })` answers for the
  generation-3 factory (`BadConfig` where there is none). The result gains
  `factory` and `generation`.
- **A manifest without the generation-3 keys.** `CHAIN_MANIFESTS` is exported
  and mutable; a manifest registered against the 1.3.x type (no `factoryG3` /
  `zapG3` / `crowdFactoryG3`) crashed `zapFor` and `verifyDeployment` on
  `undefined.toLowerCase()`, and a salted `generation: 3` create was refused
  instead of staying on generation 2. An absent key now reads as `null`.

### Added
- **Generation 3, opt-in.** `feeSplit?: { holdersBps, buybackBps,
  tokenHoldersBps }` and `generation?: 2 | 3` on `InstantParams` /
  `FairLaunchParams`. Without them a create is exactly 1.3.x (generation 2, no
  new request). With them it goes to `manifest.contracts.factoryG3` only while
  the chain's running backend says `features.storefrontG3` and names that exact
  address in `contracts.launchFactoryG3`; otherwise it stays on generation 2.
- **One cached `GET /api/v1/config` read** (60 s for an answer, 5 s for a
  failure, shared by concurrent calls), fetched past the browser's HTTP cache
  (`cache: 'no-store'`): the backend serves the route with `max-age=300`, and
  through the HTTP cache a flipped `storefrontG3` would reach the SDK up to
  five minutes late. Another chain's answer reads as "off" – target Arc with
  `apiBase: 'https://arc.openfair.app'`.
- **D21 rules before any signature** – `BadInput`, stage `validating`,
  `contractReason` naming the factory revert: integer fields 0..10000;
  `platformShareBps + holdersBps + buybackBps <= 10000` (`BadSplit`); no
  non-zero share under 100 bps (`BadSplit`); `buybackBps` 0
  (`BuybackUnavailable`); a holders' share (`holdersBps` or `tokenHoldersBps`)
  only on generation 3 with BOTH `features.feeSplit` and
  `features.holdersPublisher` on (`HoldersUnavailable`, naming the one that is
  off) – the site's own `holdersLegOn`. A non-default split where generation 3
  is off is refused too, never silently dropped. While the config cannot be
  reached at all (network, timeout, 408/429/5xx) a holders' share is
  `NetworkUnavailable`, retriable – not a verdict a form should keep.
- **`launch.target(config)`** → `{ generation, factory, feeSplit }`.
- **`LaunchQuote.generation` / `feeSplit`**, and `LaunchQuote.factory` is now the
  factory the create is sent to. **`LaunchResult.generation` / `feeSplit`** –
  read back from `FeeSplitSet` (absent on a generation-3 create = {0,0,0}).
- **Manifests**: `contracts.factoryG3`, `contracts.crowdFactoryG3`,
  `contracts.zapG3` and `lineage`. `factory` / `zap` keep their generation-2
  meaning for ever.
- **Widget**: `fee-split="h/b/t"`, shown read-only above the button; a split the
  chain cannot take disables the button with the reason; a config read that
  merely failed (timeout, 5xx) does not – the target is re-resolved after 5 s,
  10 s, 20 s, 40 s, then every minute, and on the next click; a malformed
  attribute replaces the form with a `BadInput` error. `of-ready` carries `feeSplit`,
  `of-created` carries `feeSplit` and `generation`. Dictionary keys `split`,
  `splitQuote`, `splitBuyback`, `splitToken`, `splitOff`.
- **`diagnostics()`**: `lineage`, `createGeneration`, `factoryG3`, `zapG3`.
  Generation 3 is opt-in here too: `diagnostics()` reads neither
  `/api/v1/config` nor the generation-3 factory (`createGeneration: 2`, probes
  `null`); `diagnostics({ generation: 3 })` does, and adds `g3FactoryOk`,
  `runtimeConfigRead`, `storefrontG3`, `feeSplit`, `holdersPublisher` and
  `holdersLeg` (the verdict `launch.target()` applies);
  `contracts.verifyDeployment()` reports `generation` for the manifest's
  factories. `RuntimeConfig`, `LaunchTarget`, `FeeSplitOptions`, `FeeSplitArg`
  types.

### Changed
- **The zap is chosen per launch** by its on-chain `factory()`: the manifest's
  `zap` for the generation-2 factory, `zapG3` for generation 3, otherwise
  `ZapUnavailable`. `sellForEth` chooses before it reads the allowance or
  approves. `ZapQuote` gains `zap` – optional in the type, because a ZapQuote
  is also an input (`buyWithEth` / `sellForEth` `{ quote }`) and one built
  before 1.4.0 has none; the launch's `factory()` is then asked.
- **Allowance spender** (`approve`, `simulate`, `quote().allowanceWei`) is the
  target factory.
- **Fees per factory**: `fees(factory?)`, `supporterFeeBps(factory?)` (default
  generation 2 – old calls unchanged).
- **`predictAddress`** predicts for the target factory in the manifest's own
  lineage (checked against `eth_call`s of both generations on 4663 and Arc).
- **A vanity salt pins the factory.** The token's CREATE2 address depends on
  the factory (the holder of an OpenSimpleToken, the router of a paired
  OpenFairToken is its zap), so the same salt gives an instant listing on 4663
  different addresses on generations 2 and 3. A create with a non-zero `salt`
  therefore never changes generation silently any more:
  - `launch.target()` / `quote()`: an opted-in create (`feeSplit` or
    `generation: 3`) with a salt, on a chain that has generation 3, goes to
    generation 3 or is refused – `NetworkUnavailable` (retriable) when
    `/api/v1/config` gave no answer for this chain, `BadInput` when the backend
    does not serve generation 3. It used to fall back to generation 2, so one
    failed config read sent a salt mined for generation 3 – and its
    `vanityFeeWei` – to the generation-2 factory. No opt-in, `generation: 2`
    and chains without generation 3 (988) are unchanged;
  - `predictAddress()` resolves its factory under the same rule, with that
    salt, so a salt is never mined on one side of the gate and created on the
    other;
  - `execute()`: an expired quote with a salt whose factory would change on
    refresh is a retriable `BadInput` ("re-mine the salt and re-quote");
  - `simulate()`: with a salt it dry-runs the create (`simulateContract`) and
    checks the token the factory itself names (its first return value) against
    the prediction for the quote's factory, as the site's `vanityMismatch`
    does. A mismatch, an unreadable result or a prediction that cannot be made
    refuses before any signature (new code `VanityMismatch`, or the prediction's
    error). Checked with read-only `eth_call`s on 4663 and Arc, both
    generations, both modes.

### Unchanged
- Native creates on Arc (5042) and Stable (988), and pair creates on 4663, are
  byte-identical to 1.3.3.
- Every method of 1.0–1.3.3, with its signature.

## 1.3.3 – 2026-09-16

`launch.predictAddress()` predicted an address nothing on the chain deploys.

A CREATE2 address is `keccak(0xff ++ deployer ++ salt ++ keccak(initCode))`, and
the initCode is the token's creation code followed by its **encoded constructor
arguments**. This package hard-coded a four-argument tail. That is wrong twice
over: the v3 factory generation on Robinhood (4663) appends a fifth argument
(`router`), and the `contracts/src/stable/` lineage behind Stable (988) and Arc
(5042) is a different contract under the same name. A salt mined towards such a
prediction buys an address the factory can never mint – the vanity fee is paid
up front.

### Changed
- **`launch.predictAddress(config, salt)`** now computes CREATE2 through
  `src/lib/vanity.ts` – the same module the openfair.app wizard mines with – so
  the SDK and the site cannot disagree about what a salt produces. The
  constructor shape comes from `manifest.factoryVersion`, never from a literal;
  the package's own second encoder is gone.
- **`GET /api/bytecode/:name`** now answers `{ bytecode, ctorTypes, source,
  lineage }`. The SDK checks the served `ctorTypes` against the shape it worked
  out and throws `BadConfig` – naming the source path and the shape it got –
  instead of returning an address. A backend older than 1.3.3 answers `bytecode`
  alone: silence is the old contract, not a mismatch.
- **Refusals, never guesses**: an unknown factory generation is `BadConfig`; a
  host whose `contracts/out` does not hold this chain's lineage answers 503 and
  the SDK raises `NetworkUnavailable`. No address is returned in either case.

### Unchanged
- Every method of 1.0–1.3.2, the create path, the widget, the zap, the chain
  manifests and their addresses.
- `<openfair-create chain-id="…">` – added in **1.3.2**, unchanged here.

## 1.3.2 – 2026-09-16

Arc mainnet (chain **5042**) carries its launch contracts. Nothing existing
changes shape: the chain table every manifest is built from moved, and the
widget element gained one optional attribute. The reason this needed a version
of its own is that a pin is immutable – v1.2.1 through v1.3.1 were cut before
the cutover and still describe the retired Arc testnet (5042002), which nothing
can fix in place without breaking the `integrity` attribute already pasted into
other people's HTML.

### Added
- **`<openfair-create chain-id="…">`** – names the deployment the widget
  launches on, so one pinned bundle serves every domain; absent = the chain the
  bundle was built for (unchanged for every existing integration), and an id the
  bundle does not know renders `BadConfig` instead of silently launching on the
  built-in chain.

### Changed
- **Arc manifest**: `chainId` 5042, RPC `https://rpc.mainnet.arc.io`, and the
  five launch addresses broadcast on 2026-09-16 – LaunchFactory
  `0xb122C3C07f7fFC0c72bE2AC1933a6D188ef09912`, SimpleTokenDeployer
  `0x6A4b2f1e771349Cfe2E4ea507e0651E8B3F2f35f`, FairTokenDeployer
  `0x7bf697F9Eb52605fD1DCE1Cc9cbf94E289C85f06`, OpenPromotions
  `0xB35963EDD6059E1Df875202aA3Aea7d185E5c5a9`, OpenSubdomains
  `0xFf8b0b4901ccaC881E7C5733ff8A321eA144C31B`. The chain table carries all
  five; `manifest.contracts` exposes the first three of them, as it always has.
  They are not `null` in 1.3.1: that pin, and every pin before it, carries the
  retired 5042002 testnet's own addresses under the `arc` key (factory
  `0x514488E3dD7E78848Db8dD22cfd8c27077f102d5`, SimpleTokenDeployer
  `0x6E53cf0adb1A9640E1dCB7DD6ABF3d766Bcd02B6`, FairTokenDeployer
  `0x5db37e8860d8C2B187031b5BCddf80d07b0eb5a8`) and has no `promotions` /
  `subdomains` slots at all – both are new to the table here. So a client still
  pinned to 1.3.1 is not pointed at nothing, it is pointed at three addresses
  with no code on 5042, which is the whole reason this cutover needed a version
  of its own instead of an edit.
- The pool quote on Arc is the 6-decimal USDC ERC-20 face
  `0x3600000000000000000000000000000000000000`, not a wrapped native coin, and
  the deployment runs the Stable lineage (`factoryVersion` 2.1): the 23-field
  pre-v3 create, no QuoteRegistry (`registry: null`) and no zap (`zap: null`).

### Unchanged
- Every method of 1.0–1.3.1, the Robinhood and Stable manifests, the widget,
  and the wire format of every call.

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
anything. (Correction, 1.4.0: "the same bytes" holds only for a factory without
quote fields. From 1.3.2 the 4663 manifest names the v3 factory, which has no
pre-quote entry points, and those bytes revert there – fixed in 1.4.0.)

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
