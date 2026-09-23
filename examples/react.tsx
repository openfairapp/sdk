// React + headless SDK: full control over the UI, staged pipeline underneath.
import { useState } from 'react';
import { Openfair, type ProgressEvent } from '@openfair/sdk';

// Robinhood Chain by default; { chainId: 988 } targets Stable, { chainId: 5042 } Arc.
const sdk = new Openfair({ referrer: '0xYourReferralWallet' });

export function LaunchButton() {
  const [stage, setStage] = useState<string>('');
  const [token, setToken] = useState<string>('');

  async function launch() {
    await sdk.connect();
    // Optional: price the launch in an allow-listed ERC-20 instead of the chain's coin –
    //   const [pair] = await sdk.quotes.list();
    //   ... sdk.launch.quote({ mode: 'instant', name, symbol, quote: pair.address })
    // The quote then reports requiredQuoteWei in the pair asset and execute()
    // adds an `approving` stage when quote.approvalNeeded.
    const quote = await sdk.launch.quote({
      mode: 'instant', name: 'My Token', symbol: 'MTK',
      // Optional (1.4.0): generation 3 – the LP-fee split the factory enforces, in bps of the
      // WHOLE quote side / token side. Granted only while the chain's own backend serves it;
      // a split the chain cannot take is refused before any signature, never silently dropped.
      //   feeSplit: { holdersBps: 1500, buybackBps: 0, tokenHoldersBps: 2500 },
    });
    // show quote.requiredValueWei / quote.gasEstimateWei to the user here;
    // quote.generation (2 | 3), quote.factory (approvals and fees follow it), quote.feeSplit
    const sim = await sdk.launch.simulate(quote);
    if (!sim.success) { setStage(`✗ ${sim.error!.message}`); return; }
    const op = await sdk.launch.execute(quote, {
      onProgress: (e: ProgressEvent) => setStage(e.stage),
    });
    const result = await op.wait({ waitForIndexer: true });
    setToken(result.tokenAddress); // result.generation / result.feeSplit – what the chain recorded
  }

  return (
    <div>
      <button onClick={launch}>Create token</button>
      {stage && <p>{stage}</p>}
      {token && <a href={`https://openfair.app/token/${token}`}>view token ↗</a>}
    </div>
  );
}

// The ready-made widget also works in React (SSR-safe since 1.1.1):
//   import '@openfair/sdk/widget';
//   <openfair-create ref={elRef} lang="en" />  // set `ref` (and `pair`) via setAttribute
//   <openfair-create lang="en" fee-split="1500/0/2500" />  // generation 3 where the chain serves it (1.4.0)
