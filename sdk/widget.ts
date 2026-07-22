// @openfair/sdk/widget – registers <openfair-create> (side-effectful entry).
import { OpenfairCreateElement } from './element';

if (typeof customElements !== 'undefined' && !customElements.get('openfair-create')) {
  customElements.define('openfair-create', OpenfairCreateElement);
}

export { OpenfairCreateElement };
