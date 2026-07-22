// Node / bots / AI agents: read-only registry + referral accounting.
// (Launching from Node requires an EIP-1193 provider you control.)
import { Openfair } from '@openfair/sdk';

const sdk = new Openfair();

// Curve economics before any transaction:
const preview = sdk.launch.preview({ curveType: 0 });
console.log(`M=${preview.priceMultiple}, 0.1 ETH buys ~${preview.buyExamples[0].tokens.toLocaleString()} tokens (${preview.buyExamples[0].priceImpactPct}% impact)`);

// Token registry with cursor pagination:
const { items, nextCursor } = await sdk.tokens.list({ limit: 10 });
console.log(items.map((t) => `${t.symbol} (${t.mode})`).join(', '), '| next:', nextCursor);

// Referral revenue of a wallet:
const stats = await sdk.referrals.getStats('0xYourReferralWallet');
console.log(`${stats.launches} referred launches, claimable: ${stats.claimableWei} wei`);

// Verify you are talking to the real factory:
console.log(await sdk.contracts.verifyDeployment());
