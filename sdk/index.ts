// openfair SDK bundle entry: window.Openfair (headless) + <openfair-create>.
// Served from https://openfair.app/sdk/openfair.js (latest) and
// /sdk/v<semver>/openfair.js (pinned) — deliberately unlisted; shared
// privately with integration partners.
import { Openfair, OpenfairError, SDK_VERSION, CHAIN_MANIFESTS } from './core';
import { OpenfairCreateElement } from './element';

declare global {
  interface Window {
    Openfair: typeof Openfair & {
      version: string;
      OpenfairError: typeof OpenfairError;
      chains: typeof CHAIN_MANIFESTS;
    };
  }
}

(Openfair as unknown as { version: string }).version = SDK_VERSION;
(Openfair as unknown as { OpenfairError: typeof OpenfairError }).OpenfairError = OpenfairError;
(Openfair as unknown as { chains: typeof CHAIN_MANIFESTS }).chains = CHAIN_MANIFESTS;
window.Openfair = Openfair as Window['Openfair'];

if (!customElements.get('openfair-create')) {
  customElements.define('openfair-create', OpenfairCreateElement);
}
