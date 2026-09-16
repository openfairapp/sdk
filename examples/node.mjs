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

// Pay a paired launch in ETH through OpenZap (null where the zap is not deployed –
// zapQuote / buyWithEth / sellForEth then throw ZapUnavailable instead of guessing):
console.log('OpenZap:', sdk.manifest.contracts.zap ?? 'not deployed on this chain');
//   const q = await sdk.tokens.zapQuote('0xPairedCurveToken', { ethIn: 10n ** 16n }); // 0.01 ETH
//   q.poolFee (500 / 3000 / 10000), q.quoteOut (pair asset the swap delivers), q.amountOut (curve tokens)
//   await sdk.tokens.buyWithEth('0xPairedCurveToken', { ethIn: 10n ** 16n, slippageBps: 200 });

// Verify you are talking to the real factory:
console.log(await sdk.contracts.verifyDeployment());
