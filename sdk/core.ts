// openfair SDK core – headless token creation for third-party sites.
// Everything that matters is enforced by the on-chain contracts (fees,
// referral, LP lock); this library only makes calling them convenient:
// quotes, simulation, a staged launch pipeline with progress events,
// metadata pinning, curve math, token/referral registries and
// human-readable errors. v1.1.0 – see docs/SDK_CHANGELOG.md.
import {
  createPublicClient, createWalletClient, custom, http, fallback, defineChain,
  parseEther, parseEventLogs, parseAbi, BaseError, ContractFunctionRevertedError,
  keccak256, concat, encodeAbiParameters, getCreate2Address,
  type Address, type WalletClient, type PublicClient,
} from 'viem';
import { CHAIN, ADDR, POOL_FEE_TIER, START_FDV_ETH, TARGET_ETH, SUPPORTER_SHARE_BPS } from '../src/lib/config';
import { factoryAbi } from '../src/lib/abi';

export const SDK_VERSION = '1.1.1';

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const ZERO_SALT = ('0x' + '0'.repeat(64)) as `0x${string}`;

const launchCreatedAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256) params)',
]);
const launchAbi = parseAbi([
  'function feesAccrued(address) view returns (uint256)',
  'function claimFees(address account)',
]);

// ---------------------------------------------------------------------------
// Chain manifest (versioned): every deployment the SDK can target.
// Robinhood Chain only for now; the structure is multichain-ready and new
// chains ship by adding a manifest here.
// ---------------------------------------------------------------------------
export interface ChainManifest {
  chainId: number; hexId: string; name: string; testnet: boolean;
  rpcUrls: string[]; explorer: string;
  currency: { name: string; symbol: string; decimals: number };
  factoryVersion: string;
  contracts: { factory: Address; simpleTokenDeployer: Address; fairTokenDeployer: Address; weth: Address };
  dexSwapUrl: ((token: string) => string) | null;
}

export const CHAIN_MANIFESTS: Record<number, ChainManifest> = {
  [CHAIN.id]: {
    chainId: CHAIN.id, hexId: CHAIN.hexId, name: CHAIN.name, testnet: false,
    rpcUrls: [CHAIN.rpcUrl], explorer: CHAIN.explorer, currency: CHAIN.currency,
    factoryVersion: '2.0',
    contracts: {
      factory: ADDR.factory as Address,
      simpleTokenDeployer: ADDR.simpleTokenDeployer as Address,
      fairTokenDeployer: ADDR.fairTokenDeployer as Address,
      weth: ADDR.weth as Address,
    },
    dexSwapUrl: (token) => `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${token}`,
  },
};

function chainFromManifest(m: ChainManifest) {
  return defineChain({
    id: m.chainId, name: m.name, nativeCurrency: m.currency,
    rpcUrls: { default: { http: m.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: m.explorer } },
  });
}

/** Back-compat export: the default (Robinhood Chain) viem chain. */
export const chain = chainFromManifest(CHAIN_MANIFESTS[CHAIN.id]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type LaunchStage =
  | 'validating' | 'preparing_metadata' | 'quoting' | 'simulating'
  | 'awaiting_wallet' | 'transaction_submitted' | 'confirming'
  | 'indexing' | 'completed' | 'failed';

export class OpenfairError extends Error {
  code: string;
  stage: LaunchStage | 'setup';
  retriable: boolean;
  transactionHash?: `0x${string}`;
  contractReason?: string;
  suggestedAction?: string;
  cause?: unknown;
  constructor(code: string, message: string, extra: Partial<Pick<OpenfairError,
    'stage' | 'retriable' | 'transactionHash' | 'contractReason' | 'suggestedAction' | 'cause'>> = {}) {
    super(message);
    this.code = code;
    this.stage = extra.stage ?? 'setup';
    this.retriable = extra.retriable ?? false;
    this.transactionHash = extra.transactionHash;
    this.contractReason = extra.contractReason;
    this.suggestedAction = extra.suggestedAction;
    this.cause = extra.cause;
  }
}

function explainRevert(e: unknown, stage: LaunchStage = 'simulating'): OpenfairError {
  if (e instanceof OpenfairError) return e;
  if (e instanceof BaseError) {
    const rev = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) {
      const name = rev.data.errorName;
      const msgs: Record<string, [string, string]> = {
        WrongPayment: ['sent value does not match the required fee', 'refresh fees via quote() and retry'],
        VanityNotAllowed: ['vanity addresses require a platform share of at least 15%', 'raise platformShareBps or drop the salt'],
        SelfReferral: ['the referrer cannot be the creator or the fee recipient', 'omit the referrer for self-launches'],
        BadConfig: ['invalid launch parameters', 'check supply/fees/curve inputs'],
        EthSendFailed: ['native transfer inside the contract failed', 'retry'],
        PoolSquatted: ['a mispriced pool already exists for this token/WETH pair', 'retry – a different token address avoids the squatted pool'],
      };
      const [msg, action] = msgs[name] ?? [`contract reverted: ${name}`, 'check the parameters'];
      return new OpenfairError('SimulationFailed', msg, { stage, contractReason: name, suggestedAction: action, cause: e, retriable: name === 'WrongPayment' || name === 'EthSendFailed' });
    }
    if (/user (rejected|denied)|4001/i.test(e.message)) {
      return new OpenfairError('UserRejected', 'the user rejected the transaction in the wallet', { stage: 'awaiting_wallet', retriable: true, cause: e });
    }
    if (/insufficient funds/i.test(e.message)) {
      return new OpenfairError('InsufficientFunds', 'wallet balance too low for fee + gas', { stage, retriable: false, cause: e, suggestedAction: 'top up the wallet' });
    }
    if (/request limit|rate limit|429/i.test(e.message)) {
      return new OpenfairError('RpcRateLimited', 'the RPC endpoint rate-limited the request', { stage, retriable: true, cause: e, suggestedAction: 'wait a few seconds and retry, or pass your own rpcUrls' });
    }
    if (/timeout|timed out/i.test(e.message)) {
      return new OpenfairError('RpcTimeout', 'the RPC endpoint timed out', { stage, retriable: true, cause: e, suggestedAction: 'retry, or pass fallback rpcUrls' });
    }
    if (/fetch|network|failed to fetch/i.test(e.message)) {
      return new OpenfairError('NetworkUnavailable', 'network request failed', { stage, retriable: true, cause: e });
    }
    return new OpenfairError('TxError', e.shortMessage, { stage, cause: e });
  }
  const m = (e as Error)?.message ?? 'unknown error';
  if (/user (rejected|denied)|4001/i.test(m)) return new OpenfairError('UserRejected', 'the user rejected the request in the wallet', { stage: 'awaiting_wallet', retriable: true, cause: e });
  if (/abort/i.test(m)) return new OpenfairError('Aborted', 'the operation was aborted', { stage, retriable: true, cause: e });
  return new OpenfairError('Error', m.split('\n')[0], { stage, cause: e });
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface OpenfairOptions {
  /** Wallet that receives the on-chain referral share of every launch made
   * through this integration. Optional but the point of the exercise. */
  referrer?: string;
  /** EIP-1193 provider; defaults to window.ethereum. Pass a WalletConnect v2
   * or Coinbase Wallet provider here – the SDK treats them identically. */
  provider?: Eip1193;
  /** openfair origin for metadata pinning + links. */
  apiBase?: string;
  /** Target chain (Robinhood Chain 4663 — the only supported network). */
  chainId?: number;
  /** Override / extend RPC endpoints; more than one enables fallback. */
  rpcUrls?: string[];
  /** Per-request RPC timeout, ms (default 10000). */
  rpcTimeoutMs?: number;
  /** Don't switch the wallet's network automatically on connect(). */
  autoSwitchChain?: boolean;
  /** Privacy-safe observability hook (no addresses are ever passed). Off unless provided. */
  onEvent?: (e: { name: string; correlationId?: string; stage?: string; ms?: number }) => void;
}

export type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (arg: unknown) => void) => void;
  removeListener?: (event: string, cb: (arg: unknown) => void) => void;
};

export interface SocialLinks { website?: string; twitter?: string; telegram?: string; discord?: string }

/** The three real on-chain anti-snipe knobs (presets are sugar over these). */
export interface AntiSnipeCustom {
  /** Seconds for the global ramp to release the full sale (0 = off). */
  rampSeconds?: number;
  /** Per-wallet cap growth: reach `walletCapPct` % of supply over `walletCapWindowBlocks` Ethereum blocks (12s each). 0 = off. */
  walletCapPct?: number;
  walletCapWindowBlocks?: number;
}

export interface InstantParams extends SocialLinks {
  name: string;
  symbol: string;
  /** Whole tokens, default 1_000_000_000. */
  totalSupply?: number;
  description?: string;
  /** data: URL of the logo (use Openfair.prepareLogo to downscale a File). */
  logoDataUrl?: string | null;
  /** % of supply into the pool (1–100, default 100). */
  poolPct?: number;
  /** Native amount to seed the pool with (default 0 = token-only listing). */
  seedEth?: number;
  /** Share of LP fees left to the platform, bps. >=5000 = Supporter perks. */
  platformShareBps?: number;
  feeRecipient?: string;
  /** CREATE2 vanity salt (mine it yourself or on openfair.app/create). */
  salt?: `0x${string}`;
  /** Vanity fee in wei, per the published tier table. */
  vanityFeeWei?: bigint;
  /** Extra metadata fields, pinned alongside the standard ones. */
  extraMetadata?: Record<string, unknown>;
}

export interface FairLaunchParams extends SocialLinks {
  name: string;
  symbol: string;
  totalSupply?: number;
  description?: string;
  logoDataUrl?: string | null;
  /** 0 classic · 1 linear · 2 exponential (default 0). */
  curveType?: 0 | 1 | 2;
  buyFeePct?: number;   // default 1
  sellFeePct?: number;  // default 1
  /** Preset or the raw on-chain knobs (default 'normal' – seal-worthy). */
  antiSnipe?: 'standard' | 'normal' | 'hardcore' | AntiSnipeCustom;
  platformShareBps?: number;
  feeRecipient?: string;
  /** Unix seconds; 0/undefined = trading opens immediately. */
  startTime?: number;
  sellsEnabled?: boolean; // default true
  /** Team allocation: % of supply (≤20) locked in immutable linear vesting. */
  teamPct?: number;
  teamMonths?: number;      // default 6
  teamBeneficiary?: string; // default creator
  /** Creator buy inside the creation tx (forfeits the Fair Launch seal). */
  devBuyEth?: number;
  salt?: `0x${string}`;
  vanityFeeWei?: bigint;
  extraMetadata?: Record<string, unknown>;
}

export type LaunchConfig = ({ mode: 'instant' } & InstantParams) | ({ mode: 'fair' } & FairLaunchParams);

export interface LaunchQuote {
  mode: 'instant' | 'fair';
  chainId: number;
  factory: Address;
  deployFeeWei: bigint;
  supporterDiscountWei: bigint;
  gasEstimateWei: bigint;
  /** msg.value the transaction must carry (fee + seed/dev-buy + vanity). */
  requiredValueWei: bigint;
  /** requiredValueWei + gasEstimateWei. */
  estimatedTotalWei: bigint;
  platformShareBps: number;
  /** Referral share of the platform's take (fixed 50% when a referrer rides). */
  referralShareBps: number;
  expiresAt: number;
  /** Normalized on-chain params – exactly what execute() will send. */
  params: Record<string, unknown>;
  config: LaunchConfig;
}

export interface SimulationResult {
  success: boolean;
  error?: OpenfairError;
  gasEstimate?: bigint;
}

export interface TokenMetadata extends SocialLinks { name: string; description?: string; logoDataUrl?: string | null }

export interface LaunchResult {
  mode: 'instant' | 'fair';
  tokenAddress: Address;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  creator: Address;
  referrer: Address | null;
  poolAddress: Address | null;
  openfairUrl: string;
  explorerUrl: string;
  dexUrl: string | null;
  indexed: boolean;
  metadata: TokenMetadata;
  // ---- legacy aliases (v1.0) ----
  token: Address;
  txHash: `0x${string}`;
  uniswapUrl: string | null;
}

/** @deprecated v1.0 name – use LaunchResult. */
export type CreateResult = Pick<LaunchResult, 'token' | 'txHash' | 'openfairUrl' | 'uniswapUrl' | 'explorerUrl'>;

export interface ProgressEvent { stage: LaunchStage; progress: number; correlationId: string; txHash?: `0x${string}` }

export interface FairPreview {
  saleSupply: number;
  priceMultiple: number;
  startPriceEth: number;
  finalPriceEth: number;
  startFdvEth: number;
  graduationFdvEth: number;
  targetEth: number;
  buyExamples: { eth: number; tokens: number; pctOfSale: number; priceImpactPct: number }[];
}

export interface TokenListItem {
  address: Address; name: string; symbol: string; mode: 'instant' | 'fair';
  createdAt: number; graduated: boolean; creator: Address; referrer: Address | null;
  logoUrl: string | null; openfairUrl: string; explorerUrl: string;
}

export interface LaunchStatus {
  phase: 'upcoming' | 'curve' | 'readyToGraduate' | 'graduated' | 'instant';
  progress: number;
  ethCollected?: string;
  targetEth?: string;
}

export interface ReferralPosition {
  token: Address; name: string; symbol: string; mode: 'instant' | 'fair';
  launch: Address | null; claimableWei: bigint;
}

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------
type Events = 'launch:progress' | 'accountChanged' | 'chainChanged' | 'disconnect';

export class Openfair {
  readonly referrer: Address | null;
  readonly apiBase: string;
  readonly manifest: ChainManifest;
  readonly chain: ReturnType<typeof defineChain>;
  account: Address | null = null;
  private provider: Eip1193 | undefined;
  private wallet: WalletClient | null = null;
  readonly public: PublicClient;
  private autoSwitch: boolean;
  private onEvent?: OpenfairOptions['onEvent'];
  private listeners = new Map<Events, Set<(arg: unknown) => void>>();
  private inflight = false;
  private lastOp: { correlationId: string; stages: { stage: string; at: number }[] } | null = null;

  readonly launch: LaunchApi;
  readonly tokens: TokensApi;
  readonly referrals: ReferralsApi;
  readonly contracts: ContractsApi;

  constructor(opts: OpenfairOptions = {}) {
    const m = CHAIN_MANIFESTS[opts.chainId ?? CHAIN.id];
    if (!m) throw new OpenfairError('BadConfig', `unsupported chainId ${opts.chainId} – known: ${Object.keys(CHAIN_MANIFESTS).join(', ')}`);
    this.manifest = opts.rpcUrls?.length ? { ...m, rpcUrls: opts.rpcUrls } : m;
    this.chain = chainFromManifest(this.manifest);
    this.referrer = opts.referrer && /^0x[0-9a-fA-F]{40}$/.test(opts.referrer) ? (opts.referrer as Address) : null;
    this.apiBase = (opts.apiBase ?? 'https://openfair.app').replace(/\/$/, '');
    this.provider = opts.provider;
    this.autoSwitch = opts.autoSwitchChain ?? true;
    this.onEvent = opts.onEvent;
    const timeout = opts.rpcTimeoutMs ?? 10_000;
    const transports = this.manifest.rpcUrls.map((u) => http(u, { timeout, retryCount: 2 }));
    this.public = createPublicClient({
      chain: this.chain,
      transport: transports.length > 1 ? fallback(transports) : transports[0],
    }) as unknown as PublicClient;
    this.launch = new LaunchApi(this);
    this.tokens = new TokensApi(this);
    this.referrals = new ReferralsApi(this);
    this.contracts = new ContractsApi(this);
  }

  // ---- events ----
  on(event: Events, cb: (arg: never) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as (arg: unknown) => void);
    return () => this.off(event, cb);
  }
  off(event: Events, cb: (arg: never) => void) { this.listeners.get(event)?.delete(cb as (arg: unknown) => void); }
  /** @internal */
  emit(event: Events, arg: unknown) {
    this.listeners.get(event)?.forEach((cb) => { try { cb(arg); } catch { /* listener errors are not ours */ } });
    if (event === 'launch:progress' && this.onEvent) {
      const p = arg as ProgressEvent;
      this.onEvent({ name: event, correlationId: p.correlationId, stage: p.stage });
    }
  }
  /** @internal */
  track(correlationId: string, stage: string) {
    if (!this.lastOp || this.lastOp.correlationId !== correlationId) this.lastOp = { correlationId, stages: [] };
    this.lastOp.stages.push({ stage, at: Date.now() });
  }

  /** @internal */
  getProvider(): Eip1193 {
    const p = this.provider ?? (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!p) throw new OpenfairError('NoWallet', 'no wallet found – install a browser wallet, open in a wallet dapp-browser, or pass a provider (e.g. WalletConnect) to the constructor');
    return p;
  }

  /** Connect the wallet; switches/adds the target chain unless autoSwitchChain=false. */
  async connect(): Promise<Address> {
    const eth = this.getProvider();
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
    const m = this.manifest;
    if (this.autoSwitch) {
      const current = (await eth.request({ method: 'eth_chainId' })) as string;
      if (parseInt(current, 16) !== m.chainId) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: m.hexId }] });
        } catch {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: m.hexId, chainName: m.name, nativeCurrency: m.currency, rpcUrls: m.rpcUrls, blockExplorerUrls: [m.explorer] }],
          });
        }
      }
    }
    this.wallet = createWalletClient({ chain: this.chain, transport: custom(eth) });
    this.account = accounts[0];
    // Forward wallet lifecycle events once (idempotent via marker).
    const p = eth as Eip1193 & { _ofBound?: boolean };
    if (p.on && !p._ofBound) {
      p._ofBound = true;
      p.on('accountsChanged', (a) => { this.account = (a as Address[])[0] ?? null; this.emit('accountChanged', this.account); });
      p.on('chainChanged', (c) => this.emit('chainChanged', parseInt(String(c), 16)));
      p.on('disconnect', () => { this.account = null; this.wallet = null; this.emit('disconnect', undefined); });
    }
    return this.account;
  }

  /** @internal */
  walletClient(): WalletClient {
    if (!this.wallet || !this.account) throw new OpenfairError('NoWallet', 'call connect() first');
    return this.wallet;
  }

  /** Live creation fees from the factory (both are on-chain knobs). */
  async fees(): Promise<{ deployFeeWei: bigint; supporterFeeWei: bigint }> {
    const f = this.manifest.contracts.factory;
    // Sequential + backoff: public RPCs rate-limit bursts, and a
    // rate-limited supporterFeeBps read must not silently misquote the fee.
    const read = async (functionName: 'deployFee' | 'supporterFeeBps'): Promise<bigint | number> => {
      for (let i = 0; ; i++) {
        try { return await this.public.readContract({ address: f, abi: factoryAbi, functionName }) as bigint | number; }
        catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
      }
    };
    const fee = await read('deployFee');
    const bps = await read('supporterFeeBps').catch(() => 5000); // pre-v1.9 factories: fixed half price
    return { deployFeeWei: fee as bigint, supporterFeeWei: (fee as bigint) * BigInt(Number(bps)) / 10000n };
  }

  /** Downscale a logo File exactly like openfair.app does (≤512px). */
  async prepareLogo(file: File, opts: { square?: boolean; maxSize?: number; quality?: number } = {}): Promise<string> {
    return (await this.prepareLogoDetailed(file, opts)).dataUrl;
  }

  /** prepareLogo + preview facts: final MIME, byte size and dimensions. */
  prepareLogoDetailed(file: File, opts: { square?: boolean; maxSize?: number; quality?: number } = {}):
    Promise<{ dataUrl: string; mime: string; bytes: number; width: number; height: number }> {
    const maxSize = opts.maxSize ?? 512;
    const quality = opts.quality ?? 0.85;
    return new Promise((resolve, reject) => {
      if (file.size > 5 * 1024 * 1024) return reject(new OpenfairError('LogoTooBig', 'logo file over 5MB'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        if (opts.square) {
          const side = Math.min(img.width, img.height);
          const out = Math.min(maxSize, side);
          canvas.width = canvas.height = Math.max(1, out);
          // center cover-crop
          canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
        } else {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        const webp = canvas.toDataURL('image/webp', quality);
        const png = canvas.toDataURL('image/png');
        const jpg = canvas.toDataURL('image/jpeg', quality);
        let dataUrl: string;
        if (webp.startsWith('data:image/webp') && webp.length < Math.min(png.length, jpg.length)) dataUrl = webp;
        else dataUrl = png.length <= jpg.length * 1.4 ? png : jpg;
        const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
        const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
        resolve({ dataUrl, mime, bytes, width: canvas.width, height: canvas.height });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new OpenfairError('LogoReadFail', 'could not read the image')); };
      img.src = url;
    });
  }

  /** @internal Metadata pinning – content-addressed (same body → same CID), so
   * retries are naturally idempotent. Two retries on 5xx/network failures. */
  async metadataCid(p: TokenMetadata & { extraMetadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<string> {
    const body = JSON.stringify({
      name: p.name, description: p.description ?? '', logoDataUrl: p.logoDataUrl ?? null,
      website: p.website ?? '', twitter: p.twitter ?? '', telegram: p.telegram ?? '', discord: p.discord ?? '',
      ...(p.extraMetadata ? { extra: p.extraMetadata } : {}),
    });
    let lastErr: OpenfairError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(signal, 'preparing_metadata');
      try {
        const res = await fetch(`${this.apiBase}/api/metadata`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          signal: signal ?? AbortSignal.timeout(20_000),
        });
        if (res.status === 429) throw new OpenfairError('MetadataRateLimited', 'metadata endpoint rate limit hit', { stage: 'preparing_metadata', retriable: true, suggestedAction: 'wait a minute and retry' });
        if (res.status >= 500) throw new OpenfairError('MetadataError', `metadata pinning failed (${res.status})`, { stage: 'preparing_metadata', retriable: true });
        if (!res.ok) throw new OpenfairError('MetadataError', `metadata pinning failed (${res.status})`, { stage: 'preparing_metadata' });
        return (await res.json()).cid as string;
      } catch (e) {
        lastErr = e instanceof OpenfairError ? e : new OpenfairError('NetworkUnavailable', 'metadata upload failed – network error', { stage: 'preparing_metadata', retriable: true, cause: e });
        if (!lastErr.retriable || attempt === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastErr!;
  }

  /** @internal */
  txReferrer(): Address {
    if (this.referrer && this.referrer.toLowerCase() !== (this.account ?? '').toLowerCase()) return this.referrer;
    return ZERO;
  }

  /** @internal Second concurrent execute() is almost always a double-click. */
  guardInflight() {
    if (this.inflight) throw new OpenfairError('OperationInProgress', 'a launch is already in progress – wait for it to finish', { retriable: true });
    this.inflight = true;
  }
  /** @internal */
  releaseInflight() { this.inflight = false; }

  /** Diagnostic snapshot – versions, chain health, last operation timings.
   * Contains no addresses or personal data; safe to attach to bug reports. */
  async diagnostics(): Promise<Record<string, unknown>> {
    const rpcOk = await this.public.getChainId().then((id) => id === this.manifest.chainId).catch(() => false);
    const factoryOk = await this.public.readContract({
      address: this.manifest.contracts.factory, abi: factoryAbi, functionName: 'deployFee',
    }).then(() => true).catch(() => false);
    return {
      sdkVersion: SDK_VERSION,
      chainId: this.manifest.chainId,
      factoryVersion: this.manifest.factoryVersion,
      rpcOk, factoryOk,
      walletConnected: !!this.account,
      lastOperation: this.lastOp ? {
        correlationId: this.lastOp.correlationId,
        stages: this.lastOp.stages.map((s, i, a) => ({ stage: s.stage, ms: i ? s.at - a[i - 1].at : 0 })),
      } : null,
    };
  }

  // ---- v1.0 back-compat: one-call creation (now runs the full pipeline) ----
  /** Instant listing: straight to a locked Uniswap V3 pool. */
  async createInstant(p: InstantParams): Promise<LaunchResult> {
    return this.launch.run({ mode: 'instant', ...p });
  }
  /** Fair launch: bonding curve that collects the target, then auto-lists. */
  async createFairLaunch(p: FairLaunchParams): Promise<LaunchResult> {
    return this.launch.run({ mode: 'fair', ...p });
  }
}

// ---------------------------------------------------------------------------
// Launch pipeline: quote → simulate → execute → wait
// ---------------------------------------------------------------------------
export class LaunchOperation {
  readonly correlationId: string;
  readonly txHash: `0x${string}`;
  private sdk: Openfair;
  private quote: LaunchQuote;
  private metadata: TokenMetadata;
  constructor(sdk: Openfair, quote: LaunchQuote, txHash: `0x${string}`, correlationId: string, metadata: TokenMetadata) {
    this.sdk = sdk; this.quote = quote; this.txHash = txHash; this.correlationId = correlationId; this.metadata = metadata;
  }

  /** Wait for confirmations (and optionally the openfair indexer). */
  async wait(opts: { confirmations?: number; waitForIndexer?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<LaunchResult> {
    const { sdk, quote } = this;
    const emit = (stage: LaunchStage, progress: number) => {
      sdk.track(this.correlationId, stage);
      sdk.emit('launch:progress', { stage, progress, correlationId: this.correlationId, txHash: this.txHash } satisfies ProgressEvent);
    };
    try {
      emit('confirming', 0.7);
      const receipt = await sdk.public.waitForTransactionReceipt({
        hash: this.txHash, confirmations: opts.confirmations ?? 1, timeout: opts.timeoutMs ?? 180_000,
      });
      if (receipt.status !== 'success') {
        throw new OpenfairError('TransactionReverted', 'the transaction reverted on-chain', { stage: 'confirming', transactionHash: this.txHash, suggestedAction: 'inspect the tx on the explorer' });
      }
      let tokenAddress: Address | null;
      if (quote.mode === 'fair') {
        const events = parseEventLogs({ abi: launchCreatedAbi, logs: receipt.logs });
        tokenAddress = (events[0]?.args.token as Address) ?? null;
      } else {
        tokenAddress = (receipt.logs[0]?.address as Address) ?? null;
      }
      if (!tokenAddress) throw new OpenfairError('TxError', 'could not find the token address in the receipt', { stage: 'confirming', transactionHash: this.txHash });

      let indexed = false;
      if (opts.waitForIndexer) {
        emit('indexing', 0.9);
        indexed = await sdk.tokens.waitUntilIndexed(tokenAddress, { timeoutMs: 60_000, signal: opts.signal }).then(() => true).catch(() => false);
      }
      const m = sdk.manifest;
      emit('completed', 1);
      const result: LaunchResult = {
        mode: quote.mode,
        tokenAddress,
        transactionHash: this.txHash,
        blockNumber: receipt.blockNumber,
        creator: sdk.account!,
        referrer: sdk.txReferrer() === ZERO ? null : sdk.txReferrer(),
        poolAddress: null,
        openfairUrl: `${sdk.apiBase}/token/${tokenAddress}`,
        explorerUrl: `${m.explorer}/token/${tokenAddress}`,
        dexUrl: quote.mode === 'instant' && m.dexSwapUrl ? m.dexSwapUrl(tokenAddress) : null,
        indexed,
        metadata: this.metadata,
        token: tokenAddress, txHash: this.txHash,
        uniswapUrl: quote.mode === 'instant' && m.dexSwapUrl ? m.dexSwapUrl(tokenAddress) : null,
      };
      return result;
    } catch (e) {
      emit('failed', 1);
      throw explainRevert(e, 'confirming');
    } finally {
      sdk.releaseInflight();
    }
  }
}

class LaunchApi {
  constructor(private sdk: Openfair) {}

  /** Normalize a config into the exact on-chain params + full cost quote. */
  async quote(config: LaunchConfig): Promise<LaunchQuote> {
    const sdk = this.sdk;
    if (!config.name || !config.symbol) throw new OpenfairError('BadInput', 'name and symbol are required', { stage: 'validating' });
    const shareBps = config.platformShareBps ?? 5000;
    const { deployFeeWei, supporterFeeWei } = await sdk.fees();
    const fee = shareBps >= SUPPORTER_SHARE_BPS ? supporterFeeWei : deployFeeWei;
    const vanityFee = config.vanityFeeWei ?? 0n;
    let params: Record<string, unknown>;
    let value: bigint;
    if (config.mode === 'instant') {
      const totalSupply = config.totalSupply ?? 1_000_000_000;
      const seedEth = config.seedEth ?? 0;
      params = {
        name: config.name, symbol: config.symbol,
        totalSupply: parseEther(String(totalSupply)),
        poolBps: Math.round((config.poolPct ?? 100) * 100),
        feeRecipient: (config.feeRecipient ?? ZERO) as Address,
        poolFeeTier: POOL_FEE_TIER,
        startPriceWei: seedEth > 0 ? 0n : BigInt(Math.round(START_FDV_ETH * 1e18 / totalSupply)),
        salt: config.salt ?? ZERO_SALT,
        vanityFeeWei: vanityFee,
        platformShareBps: shareBps,
        referrer: sdk.txReferrer(),
      };
      value = fee + parseEther(String(seedEth)) + vanityFee;
    } else {
      const totalSupply = config.totalSupply ?? 1_000_000_000;
      const curveType = config.curveType ?? 0;
      const { multiple, saleSupply } = deriveCurve(curveType, totalSupply);
      const anti = antiSnipeNumbers(config.antiSnipe ?? 'normal', saleSupply, totalSupply);
      const teamPct = Math.min(config.teamPct ?? 0, 20);
      const devBuy = config.devBuyEth ?? 0;
      params = {
        name: config.name, symbol: config.symbol,
        totalSupply: parseEther(String(totalSupply)),
        saleSupply: parseEther(String(saleSupply)),
        curveType,
        priceMultiple: BigInt(multiple),
        targetEth: parseEther(String(TARGET_ETH)),
        buyFeeBps: Math.round((config.buyFeePct ?? 1) * 100),
        sellFeeBps: Math.round((config.sellFeePct ?? 1) * 100),
        platformShareBps: shareBps,
        feeRecipient: (config.feeRecipient ?? ZERO) as Address,
        sellsEnabled: config.sellsEnabled ?? true,
        startTime: BigInt(config.startTime ?? 0),
        walletCapFloor: 0n,
        walletCapPerSec: parseEther(String(anti.capRate)),
        globalRampPerSec: parseEther(String(anti.ramp)),
        poolFeeTier: POOL_FEE_TIER,
        teamAllocation: parseEther(String(Math.floor((config.totalSupply ?? 1_000_000_000) * teamPct / 100))),
        teamBeneficiary: (config.teamBeneficiary ?? sdk.account ?? ZERO) as Address,
        teamVestingDuration: BigInt(teamPct > 0 ? (config.teamMonths ?? 6) * 30 * 86400 : 0),
        devBuyEth: parseEther(String(devBuy)),
        salt: config.salt ?? ZERO_SALT,
        vanityFeeWei: vanityFee,
      };
      value = fee + parseEther(String(devBuy)) + vanityFee;
    }
    // Gas estimate: same calldata shape with a placeholder CID (CIDs are
    // fixed-length, so the estimate matches the real tx within noise).
    let gasWei = 0n;
    try {
      const gas = await sdk.public.estimateContractGas(this.callFor({ params, value, mode: config.mode }, 'bafkreicfxudbe2wjpnyecchmyaa2ufnpiss4ht24uvxgamqit67r7ybc3a') as unknown as Parameters<PublicClient['estimateContractGas']>[0]);
      const gasPrice = await sdk.public.getGasPrice();
      gasWei = gas * gasPrice * 12n / 10n; // +20% headroom
    } catch { /* без кошелька или при реверте оценка недоступна – квота всё равно полезна */ }
    return {
      mode: config.mode,
      chainId: sdk.manifest.chainId,
      factory: sdk.manifest.contracts.factory,
      deployFeeWei,
      supporterDiscountWei: deployFeeWei - supporterFeeWei,
      gasEstimateWei: gasWei,
      requiredValueWei: value,
      estimatedTotalWei: value + gasWei,
      platformShareBps: shareBps,
      referralShareBps: sdk.txReferrer() === ZERO ? 0 : 5000,
      expiresAt: Date.now() + 60_000,
      params,
      config,
    };
  }

  private callFor(q: { params: Record<string, unknown>; value: bigint; mode: 'instant' | 'fair' }, cid: string):
    { chain: typeof chain; account?: Address; address: Address; abi: typeof factoryAbi; functionName: 'createDirectListing' | 'createLaunch'; args: readonly unknown[]; value: bigint } {
    const sdk = this.sdk;
    return q.mode === 'instant'
      ? {
          chain: sdk.chain, account: sdk.account ?? undefined,
          address: sdk.manifest.contracts.factory, abi: factoryAbi,
          functionName: 'createDirectListing' as const, args: [q.params as never, cid] as const, value: q.value,
        }
      : {
          chain: sdk.chain, account: sdk.account ?? undefined,
          address: sdk.manifest.contracts.factory, abi: factoryAbi,
          functionName: 'createLaunch' as const, args: [q.params as never, sdk.txReferrer(), cid] as const, value: q.value,
        };
  }

  /** Dry-run the exact transaction (balance + eth_call) BEFORE the wallet opens. */
  async simulate(quote: LaunchQuote): Promise<SimulationResult> {
    const sdk = this.sdk;
    if (!sdk.account) return { success: false, error: new OpenfairError('NoWallet', 'call connect() first', { stage: 'simulating' }) };
    try {
      const bal = await sdk.public.getBalance({ address: sdk.account });
      const headroom = quote.gasEstimateWei > 0n ? quote.gasEstimateWei : parseEther('0.001');
      if (bal < quote.requiredValueWei + headroom) {
        return {
          success: false,
          error: new OpenfairError('InsufficientFunds',
            `wallet needs ~${fmtNative(quote.requiredValueWei + headroom)} ${sdk.manifest.currency.symbol} (value + gas), has ${fmtNative(bal)}`,
            { stage: 'simulating', suggestedAction: 'top up the wallet' }),
        };
      }
      // The CID string length never changes the revert outcome – placeholder is fine here.
      const call = this.callFor({ params: quote.params, value: quote.requiredValueWei, mode: quote.mode }, 'bafkreicfxudbe2wjpnyecchmyaa2ufnpiss4ht24uvxgamqit67r7ybc3a');
      const gas = await sdk.public.estimateContractGas(call as unknown as Parameters<PublicClient['estimateContractGas']>[0]);
      return { success: true, gasEstimate: gas };
    } catch (e) {
      return { success: false, error: explainRevert(e, 'simulating') };
    }
  }

  /** Fair-launch economics before any transaction: prices, FDV, buy examples. */
  preview(config: { curveType?: 0 | 1 | 2; totalSupply?: number }): FairPreview {
    const curveType = config.curveType ?? 0;
    const totalSupply = config.totalSupply ?? 1_000_000_000;
    const { multiple: M, saleSupply: S } = deriveCurve(curveType, totalSupply);
    // Relative price shape p(s), s = sold fraction 0..1, p(0)=1, p(1)=M.
    const rel = (s: number): number => {
      if (curveType === 1) return 1 + (M - 1) * s;
      if (curveType === 2) return 1 + (M - 1) * s * s;
      const r = Math.sqrt(M) / (Math.sqrt(M) - 1);
      return 1 / Math.pow(1 - s / r, 2);
    };
    // Scale p0 so that ∫ p(s)·S ds over 0..1 equals TARGET_ETH.
    const n = 2000;
    let integ = 0;
    for (let i = 0; i < n; i++) integ += rel((i + 0.5) / n) / n;
    const p0 = TARGET_ETH / (S * integ);
    const buyExamples = [0.1, 0.5, 1].map((eth) => {
      let spent = 0, s = 0;
      const ds = 1 / n;
      while (s < 1 && spent < eth) { spent += rel(s + ds / 2) * p0 * S * ds; s += ds; }
      const tokens = Math.min(1, s) * S;
      return { eth, tokens: Math.round(tokens), pctOfSale: +(Math.min(1, s) * 100).toFixed(2), priceImpactPct: +((rel(Math.min(1, s)) - 1) * 100).toFixed(2) };
    });
    return {
      saleSupply: S, priceMultiple: M,
      startPriceEth: p0, finalPriceEth: p0 * M,
      startFdvEth: p0 * totalSupply, graduationFdvEth: p0 * M * totalSupply,
      targetEth: TARGET_ETH, buyExamples,
    };
  }

  /** Pin metadata + send the transaction. Returns an operation to wait() on. */
  async execute(quote: LaunchQuote, opts: { signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void } = {}): Promise<LaunchOperation> {
    const sdk = this.sdk;
    sdk.guardInflight();
    const correlationId = `of-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const emit = (stage: LaunchStage, progress: number, txHash?: `0x${string}`) => {
      sdk.track(correlationId, stage);
      const ev: ProgressEvent = { stage, progress, correlationId, txHash };
      sdk.emit('launch:progress', ev);
      opts.onProgress?.(ev);
    };
    try {
      emit('validating', 0.05);
      if (!sdk.account) await sdk.connect();
      throwIfAborted(opts.signal, 'validating');
      if (Date.now() > quote.expiresAt) quote = await this.quote(quote.config); // fees may have moved – refresh silently

      emit('preparing_metadata', 0.15);
      const c = quote.config;
      const metadata: TokenMetadata = {
        name: c.name, description: c.description, logoDataUrl: c.logoDataUrl,
        website: c.website, twitter: c.twitter, telegram: c.telegram, discord: c.discord,
      };
      const cid = await sdk.metadataCid({ ...metadata, extraMetadata: c.extraMetadata }, opts.signal);
      throwIfAborted(opts.signal, 'preparing_metadata');

      emit('simulating', 0.3);
      const sim = await this.simulate(quote);
      if (!sim.success) throw sim.error;
      throwIfAborted(opts.signal, 'simulating');

      emit('awaiting_wallet', 0.45);
      const call = this.callFor({ params: quote.params, value: quote.requiredValueWei, mode: quote.mode }, cid);
      const txHash = await sdk.walletClient().writeContract(call as unknown as Parameters<WalletClient['writeContract']>[0]);
      emit('transaction_submitted', 0.6, txHash);
      return new LaunchOperation(sdk, quote, txHash, correlationId, metadata);
    } catch (e) {
      emit('failed', 1);
      sdk.releaseInflight();
      throw explainRevert(e, 'awaiting_wallet');
    }
  }

  /** quote → simulate → execute → wait, in one call (used by createInstant/createFairLaunch). */
  async run(config: LaunchConfig, opts: { signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void; confirmations?: number; waitForIndexer?: boolean } = {}): Promise<LaunchResult> {
    const q = await this.quote(config);
    const op = await this.execute(q, opts);
    return op.wait({ confirmations: opts.confirmations, waitForIndexer: opts.waitForIndexer, signal: opts.signal });
  }

  /** Predict the CREATE2 token address for a salt (verify mined vanity salts). */
  async predictAddress(config: LaunchConfig, salt: `0x${string}`): Promise<Address> {
    const sdk = this.sdk;
    const mode = config.mode;
    const contractName = mode === 'fair' ? 'OpenFairToken' : 'OpenSimpleToken';
    const res = await fetch(`${sdk.apiBase}/api/bytecode/${contractName}`);
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', 'could not fetch token bytecode');
    const { bytecode } = await res.json() as { bytecode: `0x${string}` };
    const totalSupply = config.totalSupply ?? 1_000_000_000;
    const holder = mode === 'fair' ? sdk.manifest.contracts.fairTokenDeployer : sdk.manifest.contracts.factory;
    const deployer = mode === 'fair' ? sdk.manifest.contracts.fairTokenDeployer : sdk.manifest.contracts.simpleTokenDeployer;
    const args = encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'address' }],
      [config.name, config.symbol, parseEther(String(totalSupply)), holder],
    );
    return getCreate2Address({ from: deployer, salt, bytecodeHash: keccak256(concat([bytecode, args])) });
  }
}

// ---------------------------------------------------------------------------
// Read-only token registry (openfair public API, normalized + typed)
// ---------------------------------------------------------------------------
interface RawSummary {
  token: string; kind: 'curve' | 'direct'; name: string; symbol: string; createdAt: number;
  graduated: boolean; creator: string; referrer: string | null; logoUrl: string | null;
  launch: string; startTime: number; readyToGraduate: boolean;
}

class TokensApi {
  constructor(private sdk: Openfair) {}

  private normalize(r: RawSummary): TokenListItem {
    const sdk = this.sdk;
    return {
      address: r.token as Address, name: r.name, symbol: r.symbol,
      mode: r.kind === 'direct' ? 'instant' : 'fair',
      createdAt: r.createdAt, graduated: !!r.graduated,
      creator: r.creator as Address, referrer: (r.referrer as Address) ?? null,
      logoUrl: r.logoUrl ? `${sdk.apiBase}${r.logoUrl}` : null,
      openfairUrl: `${sdk.apiBase}/token/${r.token}`,
      explorerUrl: `${sdk.manifest.explorer}/token/${r.token}`,
    };
  }

  /** Cursor-paginated token list. `referrer`/`mode` filters are applied
   * client-side (the public API has no server-side filter yet). */
  async list(opts: { referrer?: string; mode?: 'instant' | 'fair'; cursor?: string; limit?: number } = {}):
    Promise<{ items: TokenListItem[]; nextCursor: string | null; total: number }> {
    const limit = Math.min(opts.limit ?? 24, 100);
    const offset = opts.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const res = await fetch(`${this.sdk.apiBase}/api/launches?sort=new&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', `token list failed (${res.status})`, { retriable: true });
    const { items, total } = await res.json() as { items: RawSummary[]; total: number };
    let out = items.map((r) => this.normalize(r));
    if (opts.referrer) out = out.filter((t) => t.referrer?.toLowerCase() === opts.referrer!.toLowerCase());
    if (opts.mode) out = out.filter((t) => t.mode === opts.mode);
    const next = offset + items.length;
    return { items: out, nextCursor: items.length === limit && next < total ? String(next) : null, total };
  }

  /** Full detail for one token (typed passthrough of /api/tokens/:address). */
  async get(address: string): Promise<(TokenListItem & { raw: Record<string, unknown> }) | null> {
    const res = await fetch(`${this.sdk.apiBase}/api/tokens/${address}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new OpenfairError('NetworkUnavailable', `token fetch failed (${res.status})`, { retriable: true });
    const raw = await res.json() as RawSummary & Record<string, unknown>;
    return { ...this.normalize(raw), raw };
  }

  /** Poll until the indexer knows the token (default 60s, ~3s per check). */
  async waitUntilIndexed(address: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TokenListItem> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      throwIfAborted(opts.signal, 'indexing');
      const t = await this.get(address).catch(() => null);
      if (t) return t;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new OpenfairError('IndexerTimeout', 'the indexer did not pick the token up in time', { stage: 'indexing', retriable: true, suggestedAction: 'the token exists on-chain; check again later' });
  }

  /** Launch phase + curve progress. */
  async getLaunchStatus(address: string): Promise<LaunchStatus | null> {
    const t = await this.get(address);
    if (!t) return null;
    const raw = t.raw as { kind: string; graduated: boolean; readyToGraduate: boolean; startTime: number; state?: { progress?: number; ethCollected?: string; saleProceeds?: string } | null; targetEth?: string };
    if (raw.kind === 'direct') return { phase: 'instant', progress: 1 };
    if (raw.graduated) return { phase: 'graduated', progress: 1 };
    if (raw.readyToGraduate) return { phase: 'readyToGraduate', progress: 1 };
    if (raw.startTime > Date.now() / 1000) return { phase: 'upcoming', progress: 0 };
    return { phase: 'curve', progress: raw.state?.progress ?? 0, ethCollected: raw.state?.ethCollected, targetEth: raw.targetEth };
  }
}

// ---------------------------------------------------------------------------
// Referral revenue (on-chain accruals; instant LP fees are auto-paid)
// ---------------------------------------------------------------------------
class ReferralsApi {
  constructor(private sdk: Openfair) {}

  /** Launches attributed to the referrer (scans the public list, ≤500 newest). */
  async getPositions(referrer?: string): Promise<ReferralPosition[]> {
    const sdk = this.sdk;
    const who = (referrer ?? sdk.referrer ?? sdk.account)?.toLowerCase();
    if (!who) throw new OpenfairError('BadInput', 'pass a referrer or construct the SDK with one');
    const found: ReferralPosition[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const { items, nextCursor } = await sdk.tokens.list({ limit: 100, cursor: cursor ?? undefined });
      for (const t of items) {
        if (t.referrer?.toLowerCase() !== who) continue;
        const raw = (await sdk.tokens.get(t.address))?.raw as { launch?: string } | undefined;
        const launch = raw?.launch && raw.launch.startsWith('0x') ? raw.launch as Address : null;
        let claimable = 0n;
        if (t.mode === 'fair' && launch) {
          claimable = await sdk.public.readContract({ address: launch, abi: launchAbi, functionName: 'feesAccrued', args: [who as Address] }).catch(() => 0n) as bigint;
        }
        found.push({ token: t.address, name: t.name, symbol: t.symbol, mode: t.mode, launch, claimableWei: claimable });
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return found;
  }

  /** Positions with a claimable balance (curve-phase accruals only – instant
   * LP-fee referral cuts are paid automatically on every harvest). */
  async getClaimable(referrer?: string): Promise<ReferralPosition[]> {
    return (await this.getPositions(referrer)).filter((p) => p.claimableWei > 0n);
  }

  async getStats(referrer?: string): Promise<{ launches: number; fairLaunches: number; instantLaunches: number; claimableWei: bigint }> {
    const pos = await this.getPositions(referrer);
    return {
      launches: pos.length,
      fairLaunches: pos.filter((p) => p.mode === 'fair').length,
      instantLaunches: pos.filter((p) => p.mode === 'instant').length,
      claimableWei: pos.reduce((a, p) => a + p.claimableWei, 0n),
    };
  }

  /** Claim accrued curve fees from one launch contract. */
  async claim(launch: Address): Promise<`0x${string}`> {
    const sdk = this.sdk;
    if (!sdk.account) await sdk.connect();
    const hash = await sdk.walletClient().writeContract({
      chain: sdk.chain, account: sdk.account!,
      address: launch, abi: launchAbi, functionName: 'claimFees', args: [sdk.account!],
    });
    await sdk.public.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Claim everything claimable, sequentially. Returns tx hashes. */
  async claimAll(referrer?: string): Promise<`0x${string}`[]> {
    const claimable = await this.getClaimable(referrer);
    const hashes: `0x${string}`[] = [];
    for (const p of claimable) {
      if (p.launch) hashes.push(await this.claim(p.launch));
    }
    return hashes;
  }
}

// ---------------------------------------------------------------------------
// Contract registry + deployment verification
// ---------------------------------------------------------------------------
class ContractsApi {
  constructor(private sdk: Openfair) {}

  /** Addresses, versions and the factory ABI for the active (or any) chain. */
  info(chainId?: number): { manifest: ChainManifest; abi: typeof factoryAbi; sdkVersion: string } {
    const m = CHAIN_MANIFESTS[chainId ?? this.sdk.manifest.chainId];
    if (!m) throw new OpenfairError('BadConfig', `unknown chainId ${chainId}`);
    return { manifest: m, abi: factoryAbi, sdkVersion: SDK_VERSION };
  }

  /** All chains the SDK ships manifests for. */
  deployments(): ChainManifest[] { return Object.values(CHAIN_MANIFESTS); }

  /** Check that the factory at `address` (default: active manifest) is a live
   * openfair deployment: has code, answers deployFee(), carries provenance. */
  async verifyDeployment(address?: Address): Promise<{ verified: boolean; factory: Address; deployFeeWei?: bigint; reason?: string }> {
    const sdk = this.sdk;
    const factory = address ?? sdk.manifest.contracts.factory;
    const code = await sdk.public.getCode({ address: factory }).catch(() => undefined);
    if (!code || code === '0x') return { verified: false, factory, reason: 'no contract code at the address' };
    try {
      const fee = await sdk.public.readContract({ address: factory, abi: factoryAbi, functionName: 'deployFee' }) as bigint;
      return { verified: true, factory, deployFeeWei: fee };
    } catch {
      return { verified: false, factory, reason: 'the contract does not answer the factory ABI' };
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function throwIfAborted(signal: AbortSignal | undefined, stage: LaunchStage) {
  if (signal?.aborted) throw new OpenfairError('Aborted', 'the operation was aborted', { stage, retriable: true });
}

function fmtNative(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

/** Price-multiple + sale-supply derivation, mirrored from openfair.app:
 * every launch starts at the fixed START_FDV, so M is fully determined. */
function deriveCurve(curveType: 0 | 1 | 2, totalSupply: number): { multiple: number; saleSupply: number } {
  const T = totalSupply;
  let best = 2, bestErr = Infinity;
  const per = (M: number) => curveType === 0
    ? (() => { const r = Math.sqrt(M) / (Math.sqrt(M) - 1); return 1 / (1 + (r - 1) / r); })()
    : curveType === 1 ? 1 / (1 + (M + 1) / (2 * M)) : 1 / (1 + (M + 2) / (3 * M));
  for (let M = 2; M <= 400; M++) {
    const S = T * per(M) * 0.98;
    const p0 = curveType === 0 ? TARGET_ETH / (S * Math.sqrt(M))
      : curveType === 1 ? 2 * TARGET_ETH / (S * (M + 1))
      : 3 * TARGET_ETH / (S * (M + 2));
    const err = Math.abs(p0 * T - START_FDV_ETH);
    if (err < bestErr) { bestErr = err; best = M; }
  }
  const saleSupply = Math.floor(T * per(best) * 0.98);
  return { multiple: best, saleSupply };
}

/** Anti-snipe: presets mirrored from the site, or the raw on-chain knobs. */
function antiSnipeNumbers(cfg: 'standard' | 'normal' | 'hardcore' | AntiSnipeCustom, saleSupply: number, totalSupply: number) {
  if (cfg === 'standard') return { ramp: 0, capRate: 0 };
  if (typeof cfg === 'object') {
    const ramp = cfg.rampSeconds && cfg.rampSeconds > 0 ? Math.ceil(saleSupply / cfg.rampSeconds) : 0;
    const capRate = cfg.walletCapPct && cfg.walletCapPct > 0
      ? Math.floor((cfg.walletCapPct / 100) * totalSupply / ((cfg.walletCapWindowBlocks ?? 75) * 12))
      : 0;
    return { ramp, capRate };
  }
  const ramp = Math.ceil(saleSupply / (cfg === 'hardcore' ? 86400 : 41400));
  const capPct = cfg === 'hardcore' ? 0.5 : 1.5;
  const capBlocks = cfg === 'hardcore' ? 100 : 75;
  const capRate = Math.floor((capPct / 100) * totalSupply / (capBlocks * 12));
  return { ramp, capRate };
}
