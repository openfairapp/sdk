// Node / bots / AI agents: read-only registry, curve maths and referral accounting.
// (Launching from Node requires an EIP-1193 provider you control.)
import { Openfair, CHAIN_MANIFESTS, SDK_VERSION } from '@openfair/sdk';

// One manifest per chain the SDK ships: Robinhood Chain (4663), Stable (988), Arc (5042).
console.log(`sdk ${SDK_VERSION}:`, Object.values(CHAIN_MANIFESTS).map((m) => `${m.name} (${m.chainId})`).join(', '));

const sdk = new Openfair(); // Robinhood Chain; `new Openfair({ chainId: 988 })` targets Stable

// Curve economics before any transaction, in the chain's own coin:
const preview = sdk.launch.preview({ curveType: 0 });
const ex = preview.buyExamples[0];
console.log(`M=${preview.priceMultiple}, ${ex.eth} ${preview.unit} buys ~${ex.tokens.toLocaleString()} tokens (${ex.priceImpactPct}% impact)`);

// Quote pairs: allow-listed ERC-20s a launch can be priced in ([] where pairs are off):
const pairs = await sdk.quotes.list();
console.log('quote pairs:', pairs.length ? pairs.map((q) => q.symbol).join(', ') : 'none on this chain');
if (pairs[0]) {
  // The same curve maths in units of the pair – target and start FDV come from the registry.
  const paired = await sdk.launch.previewFor(pairs[0].address, { curveType: 0 });
  console.log(`paired with ${paired.unit}: target ${paired.targetEth} ${paired.unit}, start FDV ${paired.startFdvEth} ${paired.unit}`);
}

// Token registry with cursor pagination:
const { items, nextCursor } = await sdk.tokens.list({ limit: 10 });
console.log(items.map((t) => `${t.symbol} (${t.mode})`).join(', '), '| next:', nextCursor);

// Referral revenue of a wallet:
const stats = await sdk.referrals.getStats('0xYourReferralWallet');
console.log(`${stats.launches} referred launches, claimable: ${stats.claimableWei} wei`);

// Generation 3 – the enforced LP-fee split (1.4.0), opt-in. launch.target() answers where a
// create would go without pricing it. Only an opted-in config (feeSplit or generation: 3) reads
// GET /api/v1/config (one cached read); without one a create is exactly 1.3.x, generation 2.
console.log('generation-3 factory:', sdk.manifest.contracts.factoryG3 ?? 'none on this chain');
try {
  // bps of the WHOLE quote side / of the whole token side; buybackBps must be 0 (not live yet)
  const t = await sdk.launch.target({ feeSplit: { holdersBps: 1500, buybackBps: 0, tokenHoldersBps: 2500 } });
  console.log(`would create on generation ${t.generation} via ${t.factory}`, t.feeSplit);
} catch (e) {
  // BadInput (contractReason BadSplit / BuybackUnavailable / HoldersUnavailable) before any
  // signature, or NetworkUnavailable (retriable) while the config cannot be reached
  console.log(`fee split refused: ${e.code}${e.contractReason ? ` (${e.contractReason})` : ''} – ${e.message}`);
}

// Pay a paired launch in ETH through OpenZap (null where the zap is not deployed –
// zapQuote / buyWithEth / sellForEth then throw ZapUnavailable instead of guessing).
// Since 1.4.0 the zap is chosen per launch by its factory(): `zap` for generation 2,
// `zapG3` for generation 3 – each serves only its own factory's launches.
console.log('OpenZap:', sdk.manifest.contracts.zap ?? 'not deployed on this chain',
  '| generation 3:', sdk.manifest.contracts.zapG3 ?? 'none');
//   const q = await sdk.tokens.zapQuote('0xPairedCurveToken', { ethIn: 10n ** 16n }); // 0.01 ETH
//   q.zap (the OpenZap it routes through), q.poolFee (500 / 3000 / 10000),
//   q.quoteOut (pair asset the swap delivers), q.amountOut (curve tokens)
//   await sdk.tokens.buyWithEth('0xPairedCurveToken', { ethIn: 10n ** 16n, slippageBps: 200 });

// Verify you are talking to the real factory (the result carries its `generation` since 1.4.0):
console.log(await sdk.contracts.verifyDeployment());
