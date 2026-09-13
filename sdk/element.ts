// <openfair-create> – a stylable, iframe-free token-creation widget.
// Lives in the host page's DOM: inherits its fonts, and every color/radius is
// a CSS custom property (--of-*) the host can override.
// Events: of-ready, of-mode-change, of-pair-change, of-wallet-connected,
// of-progress, of-tx-submitted, of-indexed, of-error, of-created.
// i18n: built-in en/ru; any string is overridable via the `dict` attribute
// (JSON) or the `.dictionary` property.
import { Openfair, type LaunchResult, type ProgressEvent, type QuoteAsset } from './core';

type Lang = 'en' | 'ru';

const T: Record<Lang, Record<string, string>> = {
  en: {
    modeInstant: 'Instant listing', modeFair: 'Fair launch',
    flowInstant: 'Launch → DEX', flowFair: 'Launch → Bonding curve ({target} {cur}) → DEX',
    logo: 'Logo (optional)', name: 'Token name', ticker: 'Ticker', supply: 'Total supply',
    desc: 'Description', descPh: 'What is this token about?', optional: 'optional',
    website: 'Website', twitter: 'X / Twitter', telegram: 'Telegram',
    create: 'Create token', connect: 'Connect wallet', busy: 'Creating…',
    fee: 'creation fee', free: 'free for supporters',
    created: 'Token created 🎉', copy: 'copy', copied: 'copied ✓',
    trade: 'Trade on Uniswap', open: 'Open on openfair',
    errRequired: 'Fill in the token name and ticker.',
    stMetadata: 'Pinning metadata…', stSimulating: 'Simulating…', stWallet: 'Confirm in your wallet…',
    stConfirming: 'Waiting for the chain…', stIndexing: 'Indexing…',
    pair: 'Pair with', pairNative: '{cur} – the chain coin',
    stApproving: 'Approving {sym}…',
    pairNote: 'Two signatures: the factory pulls {sym} from your wallet, so it asks for an approval first.',
  },
  ru: {
    modeInstant: 'Мгновенный листинг', modeFair: 'Честный запуск',
    flowInstant: 'Запуск → DEX', flowFair: 'Запуск → Бондинг-кривая ({target} {cur}) → DEX',
    logo: 'Логотип (необязательно)', name: 'Название токена', ticker: 'Тикер', supply: 'Общий выпуск',
    desc: 'Описание', descPh: 'О чём этот токен?', optional: 'необязательно',
    website: 'Сайт', twitter: 'X / Twitter', telegram: 'Telegram',
    create: 'Создать токен', connect: 'Подключить кошелёк', busy: 'Создаём…',
    fee: 'комиссия создания', free: 'бесплатно для саппортеров',
    created: 'Токен создан 🎉', copy: 'копировать', copied: 'скопировано ✓',
    trade: 'Торговать на Uniswap', open: 'Открыть на openfair',
    errRequired: 'Заполните название токена и тикер.',
    stMetadata: 'Загружаем метаданные…', stSimulating: 'Симулируем…', stWallet: 'Подтвердите в кошельке…',
    stConfirming: 'Ждём сеть…', stIndexing: 'Индексируем…',
    pair: 'Пара с', pairNative: '{cur} – монета сети',
    stApproving: 'Разрешаем списание {sym}…',
    pairNote: 'Две подписи: фабрика списывает {sym} с вашего кошелька, поэтому сначала просит разрешение.',
  },
};

const STYLE = `
:host {
  display: block;
  color: var(--of-text, #efe9f4);
  background: var(--of-bg, #17131c);
  border: 1px solid var(--of-border, #2c2434);
  border-radius: var(--of-radius, 16px);
  padding: var(--of-padding, 20px);
  font-family: var(--of-font, inherit);
  max-width: var(--of-max-width, 640px);
  box-sizing: border-box;
}
*, *::before, *::after { box-sizing: inherit; }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
.mode {
  border: 1px solid var(--of-border, #2c2434); border-radius: calc(var(--of-radius, 16px) * .6);
  background: transparent; color: inherit; padding: 10px 8px; cursor: pointer; text-align: center;
  font: inherit; font-size: 13px;
}
.mode small { display: block; opacity: .6; font-size: 10.5px; margin-top: 3px; }
.mode.sel { border-color: var(--of-accent, #f6b23c); background: var(--of-accent-wash, rgba(246,178,60,.09)); }
label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; margin: 12px 0 5px; }
input, textarea, select {
  width: 100%; background: var(--of-field-bg, #211a29); color: inherit;
  border: 1px solid var(--of-border, #2c2434); border-radius: calc(var(--of-radius, 16px) * .5);
  padding: 10px 12px; font: inherit; font-size: 14px;
}
input:focus, textarea:focus, select:focus { outline: 2px solid var(--of-accent, #f6b23c); outline-offset: 1px; }
.hint { font-size: 11.5px; opacity: .6; margin-top: 6px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
@media (max-width: 480px) { .row, .row3 { grid-template-columns: 1fr; } }
.logo-drop {
  display: flex; align-items: center; gap: 12px; justify-content: center; cursor: pointer;
  border: 1px dashed var(--of-border, #2c2434); border-radius: calc(var(--of-radius, 16px) * .6);
  padding: 14px; opacity: .8; font-size: 13px;
}
.logo-drop img { width: 42px; height: 42px; border-radius: 10px; object-fit: cover; }
.submit {
  width: 100%; margin-top: 16px; padding: 13px; cursor: pointer; font: inherit; font-weight: 600; font-size: 15px;
  background: var(--of-accent, #f6b23c); color: var(--of-accent-text, #1d1405);
  border: 0; border-radius: calc(var(--of-radius, 16px) * .6);
}
.submit:disabled { opacity: .55; cursor: default; }
.feeline { text-align: center; font-size: 11.5px; opacity: .6; margin-top: 8px; }
.err { color: var(--of-error, #ff7a7a); font-size: 12.5px; margin-top: 10px; }
.card { text-align: center; }
.card img { width: 68px; height: 68px; border-radius: 14px; object-fit: cover; margin-bottom: 8px; }
.card h3 { margin: 0 0 4px; font-size: 20px; }
.card .sym { opacity: .6; font-family: ui-monospace, monospace; }
.card p { font-size: 13px; opacity: .75; margin: 6px 0 0; }
.addr {
  width: 100%; margin-top: 14px; padding: 9px 10px; cursor: pointer; font-family: ui-monospace, monospace;
  font-size: 11.5px; overflow-wrap: anywhere; background: var(--of-field-bg, #211a29); color: inherit;
  border: 1px solid var(--of-border, #2c2434); border-radius: calc(var(--of-radius, 16px) * .5);
}
.btns { display: grid; gap: 8px; margin-top: 12px; }
.btns a {
  display: block; text-decoration: none; text-align: center; padding: 11px; font-weight: 600; font-size: 14px;
  border-radius: calc(var(--of-radius, 16px) * .6);
}
.btn-secondary { border: 1px solid var(--of-border, #2c2434); color: var(--of-text, #efe9f4); }
.btn-primary { background: var(--of-accent, #f6b23c); color: var(--of-accent-text, #1d1405); }
.powered { text-align: center; font-size: 10px; opacity: .45; margin-top: 14px; font-family: ui-monospace, monospace; }
.powered a { color: inherit; }
`;

// SSR-safe base: the module must be importable in Node (Next.js renders it
// server-side) where HTMLElement does not exist; the element only registers
// in a real DOM anyway.
const HTMLElementBase = (typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

export class OpenfairCreateElement extends HTMLElementBase {
  private sdk!: Openfair;
  private mode: 'instant' | 'fair' = 'instant';
  private logoDataUrl: string | null = null;
  private busy = false;
  private feeText = '';
  private result: LaunchResult | null = null;
  private lastForm = { name: '', symbol: '', description: '', website: '', twitter: '', telegram: '', supply: 1_000_000_000 };
  private error = '';
  private stageText = '';
  // Quote pairs: empty on a chain without a registry, which is every chain the
  // widget could target before 1.3.0 – then nothing below renders and the
  // launch is native, exactly as it was.
  private pairs: QuoteAsset[] = [];
  private pair = ''; // '' = the chain's native coin
  /** Custom translation overrides (also settable via the `dict` attribute as JSON). */
  dictionary: Partial<Record<string, string>> | null = null;

  static get observedAttributes() { return ['ref', 'lang', 'mode', 'pair', 'api-base', 'dict']; }

  private fire(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  connectedCallback() {
    const apiBase = this.getAttribute('api-base') ?? 'https://openfair.app';
    this.sdk = new Openfair({ referrer: this.getAttribute('ref') ?? undefined, apiBase });
    const m = this.getAttribute('mode');
    if (m === 'fair' || m === 'instant') this.mode = m;
    this.pair = this.getAttribute('pair') ?? '';
    this.attachShadow({ mode: 'open' });
    this.render();
    this.fire('of-ready', { mode: this.mode });
    this.refreshFee();
    // The allow-list, when the target chain has one. A failure here is not the
    // user's problem: the widget keeps working as a native-only form.
    this.sdk.quotes.list().then((items) => {
      // All THREE registry figures, because quotes.require() throws
      // QuotePriceStale when any one of them is null – offering a pair the
      // launch would then abort on is worse than not offering it.
      this.pairs = items.filter((q) => q.enabled
        && q.deployFeeWei !== null && q.targetWei !== null && q.startFdvWei !== null);
      if (this.pair && !this.pairs.some((q) => q.address.toLowerCase() === this.pair.toLowerCase())) this.pair = '';
      if (this.pairs.length) { this.refreshFee(); this.render(); }
    }).catch(() => {});
  }

  /** The selected pair, or null while the launch is native. */
  private selected(): QuoteAsset | null {
    const want = this.pair.toLowerCase();
    return this.pairs.find((q) => q.address.toLowerCase() === want) ?? null;
  }

  /** Fee line under the button, in the unit the launch actually pays in. */
  private refreshFee() {
    const t = this.t();
    const lang = (this.getAttribute('lang') as Lang) ?? 'en';
    const fmt = (wei: bigint, decimals: number) => new Intl.NumberFormat(
      lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 },
    ).format(Number(wei) / 10 ** decimals);
    const qa = this.selected();
    if (qa) {
      // The registry's fee, discounted by the same supporter rule the factory
      // applies to it – read from the factory, never assumed to be half.
      this.sdk.supporterFeeBps().then((bps) => {
        const fee = qa.deployFeeWei! * BigInt(bps) / 10000n;
        this.feeText = fee === 0n ? `${t.fee}: ${t.free}` : `${t.fee}: ${fmt(fee, qa.decimals)} ${esc(qa.symbol ?? '')}`;
        this.render();
      }).catch(() => {});
      return;
    }
    this.sdk.fees().then(({ supporterFeeWei }) => {
      const cur = this.sdk.manifest.currency.symbol;
      this.feeText = supporterFeeWei === 0n ? `${t.fee}: ${t.free}` : `${t.fee}: ${fmt(supporterFeeWei, 18)} ${cur}`;
      this.render();
    }).catch(() => {});
  }

  private t(): Record<string, string> {
    const base = T[(this.getAttribute('lang') as Lang) ?? 'en'] ?? T.en;
    let attrDict: Record<string, string> | null = null;
    const raw = this.getAttribute('dict');
    if (raw) { try { attrDict = JSON.parse(raw); } catch { /* malformed dict attr – ignore */ } }
    const merged = { ...base, ...(attrDict ?? {}), ...(this.dictionary ?? {}) } as Record<string, string>;
    // AUDIT L-5: labels land in innerHTML in a dozen places. Custom dictionaries
    // come from the host page (attribute or property), so they are escaped once
    // here rather than at every interpolation site.
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) safe[k] = esc(String(v));
    return safe;
  }
  private modeLocked() { const m = this.getAttribute('mode'); return m === 'fair' || m === 'instant'; }

  private async submit() {
    const t = this.t();
    const f = this.lastForm;
    if (!f.name.trim() || !f.symbol.trim()) { this.error = t.errRequired; this.render(); return; }
    this.busy = true; this.error = ''; this.stageText = ''; this.render();
    try {
      const qa = this.selected();
      const common = {
        name: f.name.trim(), symbol: f.symbol.trim().toUpperCase().slice(0, 8),
        totalSupply: f.supply, description: f.description.trim(), logoDataUrl: this.logoDataUrl,
        website: f.website.trim(), twitter: f.twitter.trim(), telegram: f.telegram.trim(),
        // Omitted entirely when native, so the params keep the pre-1.3.0 shape.
        ...(qa ? { quote: qa.address } : {}),
      };
      const wasConnected = !!this.sdk.account;
      const onProgress = (e: ProgressEvent) => {
        this.fire('of-progress', e);
        if (e.stage === 'transaction_submitted') this.fire('of-tx-submitted', { txHash: e.txHash, mode: this.mode });
        if (!wasConnected && e.stage === 'preparing_metadata' && this.sdk.account) {
          this.fire('of-wallet-connected', { account: this.sdk.account });
        }
        this.stageText = ({
          preparing_metadata: t.stMetadata, simulating: t.stSimulating, awaiting_wallet: t.stWallet,
          approving: t.stApproving.replace('{sym}', esc(qa?.symbol ?? '')),
          transaction_submitted: t.stConfirming, confirming: t.stConfirming, indexing: t.stIndexing,
        } as Record<string, string>)[e.stage] ?? '';
        this.render();
      };
      this.result = await this.sdk.launch.run({ mode: this.mode, ...common }, { onProgress, waitForIndexer: true });
      if (this.result.indexed) this.fire('of-indexed', { address: this.result.tokenAddress });
      this.fire('of-created', { address: this.result.token, txHash: this.result.txHash, mode: this.mode });
    } catch (e) {
      this.error = (e as Error).message;
      const oe = e as { code?: string; stage?: string; retriable?: boolean };
      this.fire('of-error', { code: oe.code ?? 'Error', stage: oe.stage, retriable: oe.retriable, message: this.error });
    } finally {
      this.busy = false; this.stageText = ''; this.render();
    }
  }

  private async pickLogo(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    try { this.logoDataUrl = await this.sdk.prepareLogo(file); this.render(); }
    catch (e) { this.error = (e as Error).message; this.render(); }
  }

  private field(id: keyof typeof this.lastForm, label: string, opts: { ph?: string; type?: string } = {}) {
    return `<label part="label" for="${id}">${label}</label>
      <input part="input" id="${id}" type="${opts.type ?? 'text'}" placeholder="${opts.ph ?? ''}" value="${String(this.lastForm[id]).replace(/"/g, '&quot;')}" />`;
  }

  private render() {
    const t = this.t();
    const sh = this.shadowRoot!;
    const ref = this.sdk?.referrer;
    const refLine = ref ? ` · ref ${ref.slice(0, 6)}…${ref.slice(-4)}` : '';
    if (this.result) {
      const r = this.result;
      const f = this.lastForm;
      sh.innerHTML = `<style>${STYLE}</style>
        <div class="card" part="card">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--of-accent,#f6b23c);margin-bottom:10px">${t.created}</div>
          ${this.logoDataUrl ? `<img src="${attr(this.logoDataUrl)}" alt="${attr(f.name)} logo">` : ''}
          <h3>${esc(f.name)} <span class="sym">$${esc(f.symbol.toUpperCase())}</span></h3>
          ${f.description ? `<p>${esc(f.description)}</p>` : ''}
          ${r.token ? `<button class="addr" part="address" id="copy">${esc(r.token)} ⧉</button>` : ''}
          <div class="btns">
            ${r.uniswapUrl ? `<a class="btn-secondary" part="button-secondary" href="${r.uniswapUrl}" target="_blank" rel="noreferrer">${t.trade} ↗</a>` : ''}
            <a class="btn-primary" part="button-primary" href="${r.openfairUrl}" target="_blank" rel="noreferrer">${t.open} ↗</a>
          </div>
          <div class="powered"><a href="https://openfair.app" target="_blank" rel="noreferrer">powered by openfair</a>${refLine}</div>
        </div>`;
      sh.getElementById('copy')?.addEventListener('click', (ev) => {
        navigator.clipboard.writeText(r.token!).then(() => {
          (ev.target as HTMLElement).textContent = t.copied;
        }).catch(() => {});
      });
      return;
    }
    // Curve target in the launch's own unit: a pair's target comes from the
    // registry's USD anchor, not from the chain's economics.
    const qa = this.selected();
    const unit = qa ? esc(qa.symbol ?? short(qa.address)) : this.sdk.manifest.currency.symbol;
    const target = qa && qa.targetWei !== null
      ? String(+(Number(qa.targetWei) / 10 ** qa.decimals).toFixed(4))
      : String(this.sdk.manifest.economics.target);
    sh.innerHTML = `<style>${STYLE}</style>
      ${this.modeLocked() ? '' : `
      <div class="modes" part="modes">
        <button class="mode ${this.mode === 'fair' ? 'sel' : ''}" id="m-fair" part="mode">${t.modeFair}<small>${t.flowFair
          .replace('{target}', target)
          .replace('{cur}', unit)}</small></button>
        <button class="mode ${this.mode === 'instant' ? 'sel' : ''}" id="m-instant" part="mode">${t.modeInstant}<small>${t.flowInstant}</small></button>
      </div>`}
      ${this.pairs.length && !this.getAttribute('pair') ? `
      <label part="label" for="pair">${t.pair}</label>
      <select part="input" id="pair">
        <option value=""${this.pair ? '' : ' selected'}>${t.pairNative.replace('{cur}', this.sdk.manifest.currency.symbol)}</option>
        ${this.pairs.map((q) => `<option value="${attr(q.address)}"${q.address === this.pair ? ' selected' : ''}>${esc(q.symbol ?? short(q.address))}${
          q.priceUsd != null ? ` · $${esc(q.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 }))}` : ''
        }</option>`).join('')}
      </select>
      ${qa ? `<div class="hint" part="hint">${t.pairNote.replace('{sym}', unit)}</div>` : ''}` : ''}
      <label part="label">${t.logo}</label>
      <div class="logo-drop" id="logodrop" part="logo">
        ${this.logoDataUrl ? `<img src="${this.logoDataUrl}" alt="">` : '⬆'}
        <span>${t.logo}</span>
        <input id="logofile" type="file" accept="image/*" hidden />
      </div>
      <div class="row">
        <div>${this.field('name', t.name)}</div>
        <div>${this.field('symbol', t.ticker, { ph: 'TCKR' })}</div>
      </div>
      ${this.field('supply', t.supply, { type: 'number' })}
      <label part="label" for="description">${t.desc}</label>
      <textarea part="input" id="description" rows="2" placeholder="${t.descPh}">${esc(this.lastForm.description)}</textarea>
      <div class="row3">
        <div>${this.field('website', t.website, { ph: t.optional })}</div>
        <div>${this.field('twitter', t.twitter, { ph: t.optional })}</div>
        <div>${this.field('telegram', t.telegram, { ph: t.optional })}</div>
      </div>
      <button class="submit" part="submit" id="go" ${this.busy ? 'disabled' : ''}>${this.busy ? (this.stageText || t.busy) : t.create}</button>
      ${this.feeText ? `<div class="feeline" part="feeline">${this.feeText}</div>` : ''}
      <div role="status" aria-live="polite">${this.error ? `<div class="err" part="error">${esc(this.error)}</div>` : ''}</div>
      <div class="powered"><a href="https://openfair.app" target="_blank" rel="noreferrer">powered by openfair</a>${refLine}</div>`;

    const bind = (id: keyof typeof this.lastForm) => {
      const el = sh.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      el?.addEventListener('input', () => {
        (this.lastForm as Record<string, string | number>)[id] = id === 'supply' ? Number(el.value) || 0 : el.value;
      });
    };
    (['name', 'symbol', 'supply', 'description', 'website', 'twitter', 'telegram'] as const).forEach(bind);
    sh.getElementById('pair')?.addEventListener('change', (ev) => {
      this.pair = (ev.target as HTMLSelectElement).value;
      this.fire('of-pair-change', { quote: this.pair || null, symbol: this.selected()?.symbol ?? null });
      this.refreshFee();
      this.render();
    });
    sh.getElementById('m-fair')?.addEventListener('click', () => { this.mode = 'fair'; this.fire('of-mode-change', { mode: 'fair' }); this.render(); });
    sh.getElementById('m-instant')?.addEventListener('click', () => { this.mode = 'instant'; this.fire('of-mode-change', { mode: 'instant' }); this.render(); });
    sh.getElementById('go')?.addEventListener('click', () => this.submit());
    const drop = sh.getElementById('logodrop');
    const file = sh.getElementById('logofile') as HTMLInputElement;
    drop?.addEventListener('click', () => file.click());
    file?.addEventListener('change', () => this.pickLogo(file));
  }
}

// AUDIT L-5: every value interpolated into innerHTML goes through esc() (text)
// or attr() (attribute context). The widget renders on PARTNER domains, so even
// self-inflicted markup from the host page's `dict` must not become executable.
function attr(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Fallback label for a quote asset the registry lists without a symbol. */
function short(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
