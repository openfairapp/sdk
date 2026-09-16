/* Create-form draft: shape, defaults, mode normalization and validation.
 *
 * Dependency-free on purpose – no viem, no config, no React – so the rules can
 * be imported and executed by `node --test` instead of being asserted by
 * reading the source. Everything numeric is kept as the STRING the creator
 * typed: a half-written "0.0" must not become 0, and the submit paths parse the
 * string with parseUnits so no amount ever passes through a JS float.
 *
 * The limits below are OUR limits (contract + registry), not the prototype's:
 * see docs/REDESIGN_SPEC.md §0.5 and docs/CROWD_LAUNCH_SPEC.md §2.1.
 *
 * The crowd block is the whole rulebook of `CrowdFactory._derive`
 * (contracts/src/CrowdFactory.sol:549-648) transcribed field by field, because
 * the factory answers ~20 different breaches with ONE `BadConfig()` selector:
 * a rule left out here does not become a lenient form, it becomes a revert
 * after the metadata is pinned, after the approval is signed and after the
 * simulation was paid for, with nothing naming the field (plan §3.1).
 */
// `lib/crowdMath.ts` is the shared, equally dependency-free transcription of
// the contract's arithmetic – the same functions the campaign page uses – so
// the form checks the split with the divisions that will actually run.
// Explicit .ts extension: `node --test` imports this module directly.
import { ONE, BPS, mulDiv, derivedSupply, listingPrice } from './crowdMath.ts';

/** Launch method. `curve` = fair launch (bonding curve), `direct` = instant
 *  listing – the two names the factory's two entry points use. `crowd` has no
 *  contract yet and is gated (see Create.tsx). */
export type LaunchMode = 'curve' | 'direct' | 'crowd';

export interface CreateDraft {
  mode: LaunchMode;
  // identity
  name: string;
  ticker: string;
  description: string;
  /** Data URI of the downscaled meme, or '' – the IPFS CID is minted at submit. */
  logo: string;
  website: string;
  twitter: string;
  telegram: string;
  // pair + supply
  /** '' = the chain's native coin; otherwise the quote asset's address. */
  quote: string;
  supply: string;
  // fair launch
  curveType: 0 | 1 | 2;
  buyFee: string;
  sellFee: string;
  antiPreset: 'standard' | 'normal' | 'hardcore';
  rampEnabled: boolean;
  rampRate: string;
  capEnabled: boolean;
  walletCap: string;
  capBlocks: string;
  allowSells: boolean;
  startTime: string;
  developerBuy: string;
  teamAllocation: string;
  teamWallet: string;
  vestingMonths: string;
  // instant listing
  seedLiquidity: string;
  poolSupply: string;
  // fair + instant
  feeRecipient: string;
  /** What the CREATOR keeps, 0–100. platformShareBps = (100 − this) × 100. */
  creatorShare: string;
  vanity: string;
  vanityPosition: 'prefix' | 'suffix';
  // crowd launch (docs/CROWD_LAUNCH_SPEC.md v2) – no contract yet
  pricePerToken: string;
  hardCap: string;
  softCap: string;
  crowdDays: string;
  crowdPool: string;
  crowdTokens: string;
  listingPremium: string;
  crowdVestingDays: string;
  crowdVestingInterval: string;
  crowdTeamTokens: string;
  participantVesting: string;
  minContribution: string;
  perWalletCap: string;
  allowlistRoot: string;
  promises: string;
  contactTwitter: string;
  contactTelegram: string;
  contactReddit: string;
  contactEmail: string;
}

export const DEFAULT_DRAFT: CreateDraft = {
  mode: 'direct',
  name: '',
  ticker: '',
  description: '',
  logo: '',
  website: '',
  twitter: '',
  telegram: '',
  quote: '',
  supply: '1000000000',
  curveType: 0,
  buyFee: '1',
  sellFee: '1',
  antiPreset: 'standard',
  rampEnabled: false,
  rampRate: '',
  capEnabled: false,
  walletCap: '1.5',
  capBlocks: '75',
  allowSells: true,
  startTime: '',
  developerBuy: '0',
  teamAllocation: '0',
  teamWallet: '',
  vestingMonths: '6',
  seedLiquidity: '0',
  poolSupply: '100',
  feeRecipient: '',
  creatorShare: '50',
  vanity: '',
  vanityPosition: 'prefix',
  pricePerToken: '',
  hardCap: '',
  softCap: '',
  crowdDays: '14',
  crowdPool: '40',
  crowdTokens: '60',
  listingPremium: '0',
  crowdVestingDays: '180',
  crowdVestingInterval: '30',
  crowdTeamTokens: '0',
  participantVesting: '0',
  minContribution: '',
  perWalletCap: '0',
  allowlistRoot: '',
  promises: '',
  contactTwitter: '',
  contactTelegram: '',
  contactReddit: '',
  contactEmail: '',
};

/** Fields that belong to exactly one mode. Switching mode resets the others to
 *  their defaults so an abandoned fair-launch fee can never ride along in an
 *  instant listing's payload (ACCEPTANCE.md, LAUNCH-FIELDS.md §"Смена режима").
 */
// `teamWallet` is deliberately NOT here: a crowd launch has a team beneficiary
// too (CrowdParams.teamBeneficiary), and wiping it on every non-curve draft
// sent `0x0` to the factory, which answers `BadConfig()` without naming the
// field whenever team tokens are asked for (plan §3.1). It is reset by the two
// allocation rules at the end of normalizeDraft instead – both of them.
const FAIR_ONLY = [
  'curveType', 'buyFee', 'sellFee', 'antiPreset', 'rampEnabled', 'rampRate',
  'capEnabled', 'walletCap', 'capBlocks', 'allowSells', 'startTime',
  'developerBuy', 'teamAllocation', 'vestingMonths',
] as const;
const INSTANT_ONLY = ['seedLiquidity', 'poolSupply'] as const;
const CROWD_ONLY = [
  'pricePerToken', 'hardCap', 'softCap', 'crowdDays', 'crowdPool', 'crowdTokens',
  'listingPremium', 'crowdVestingDays', 'crowdVestingInterval', 'crowdTeamTokens',
  'participantVesting', 'minContribution', 'perWalletCap', 'allowlistRoot',
  'promises', 'contactTwitter', 'contactTelegram', 'contactReddit', 'contactEmail',
] as const;
/** Only the two on-chain modes carry a fee split and a vanity address. */
const NON_CROWD_ONLY = ['feeRecipient', 'creatorShare', 'vanity', 'vanityPosition'] as const;

type Key = keyof CreateDraft;

function resetKeys(d: CreateDraft, keys: readonly Key[]): void {
  // One loop over a heterogeneous key list – the per-key types are checked by
  // `Key` itself, so the write goes through an index signature.
  const bag = d as unknown as Record<string, unknown>;
  for (const k of keys) bag[k] = DEFAULT_DRAFT[k];
}

/** The draft as it is actually submitted: every field the chosen mode does not
 *  use is back at its default. Review and payload both read THIS. */
export function normalizeDraft(draft: CreateDraft): CreateDraft {
  const d: CreateDraft = { ...DEFAULT_DRAFT, ...draft };
  if (d.mode !== 'curve') resetKeys(d, FAIR_ONLY);
  if (d.mode !== 'direct') resetKeys(d, INSTANT_ONLY);
  if (d.mode !== 'crowd') resetKeys(d, CROWD_ONLY);
  if (d.mode === 'crowd') resetKeys(d, NON_CROWD_ONLY);
  if (!d.rampEnabled) resetKeys(d, ['rampRate'] as const);
  if (!d.capEnabled) resetKeys(d, ['walletCap', 'capBlocks'] as const);
  // An allocation of zero carries no beneficiary – in EITHER mode, and by the
  // mode's own allocation field. The unconditional form of this rule was the
  // second half of the bug above: `teamAllocation` is fair-launch-only, so on a
  // crowd draft it is always back at its default '0' and the address the
  // creator typed for `teamBeneficiary` was erased right after being kept.
  if (d.mode !== 'crowd' && num(d.teamAllocation) === 0) resetKeys(d, ['teamWallet', 'vestingMonths'] as const);
  if (d.mode === 'crowd' && num(d.crowdTeamTokens) === 0) resetKeys(d, ['teamWallet'] as const);
  return d;
}

export const num = (v: string | number): number => {
  const s = String(v).trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const PLAIN_DECIMAL = /^\d*\.?\d*$/;

/** The shortest crowd raise this site offers, in days.
 *
 *  The contract's floor is 1 (`MIN_CROWD_DURATION`), but it is measured in the
 *  block that MINES the create while the form measures it from a block it has
 *  already read – so a one-day raise reverts `BadConfig()` every single time,
 *  after the metadata, the approval and the simulation (plan §3.1). Two days
 *  is the shortest length that survives `DEADLINE_MARGIN`. */
export const CROWD_MIN_DAYS = 2;

/** A typed decimal as base units, with no float in the middle and no throw on a
 *  half-written field. Digits the asset cannot represent are dropped, never
 *  rounded up – the same rule `amountUnits` follows in lib/createPayload.ts,
 *  reimplemented here only so this module stays free of viem. */
export function unitsOf(raw: string | number, decimals: number): bigint {
  const s = String(raw).trim();
  if (s === '' || !PLAIN_DECIMAL.test(s)) return 0n;
  const [whole, frac = ''] = s.split('.');
  return BigInt(`${whole || '0'}${frac.slice(0, decimals).padEnd(decimals, '0')}`);
}

/** Optional HTTPS link, restricted to the platform's own host for X/Telegram.
 *  Creator links are UGC: a scheme other than https, or credentials in the
 *  URL, is refused here rather than rendered with rel="nofollow ugc" later. */
export function isSafeSocial(value: string, kind: 'website' | 'x' | 'telegram'): boolean {
  if (!value.trim()) return true;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (kind === 'website') return true;
    const hosts = kind === 'x'
      ? ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']
      : ['t.me', 'www.t.me'];
    return hosts.includes(u.hostname);
  } catch {
    return false;
  }
}

export type Errors = Record<string, string>;

export interface ValidateContext {
  /** Message factory – the page passes t()/ti() so every error is localized. */
  msg: (key: string, vars?: Record<string, string | number>) => string;
  /** A crowd deadline is capped at 14 days when the raise currency can move.
   *  Native and stable quotes get the full 60 (CROWD_LAUNCH_SPEC §2.1).
   *
   *  It is NOT "is a pair selected": `nativeQuoteVolatile` is true on the live
   *  factory, so a native raise on Robinhood is bounded at 14 days too. The
   *  page reads it from `termsFor(quote).volatileQuote` (plan §3.1). */
  volatileQuote?: boolean;
  /** Decimals of the raise currency – 18 for the chain's coin. */
  quoteDecimals?: number;
  /** `termsFor(quote).minContribution`: the protocol's own floor under the
   *  minimum contribution, in base units as a decimal string. Absent while the
   *  read is in flight, and then the rule is not checked at all rather than
   *  guessed at. */
  minContributionFloor?: string;
  /** That same floor formatted for the message, and the currency's symbol. */
  minContributionFloorLabel?: string;
  /** The smallest NON-ZERO instant-listing seed the factory accepts, in the
   *  paying asset's base units as a decimal string.
   *
   *  The stable lineage (Arc 5042, Stable 988) deposits the seed quantized to
   *  the 6-decimal quote face – `liquidityEth / NATIVE_TO_ERC20` – and reverts
   *  `BadConfig()` when that quotient is zero
   *  (contracts/src/stable/LaunchFactory.sol:441-442). A seed of 0.0000001 USDC
   *  is therefore not a cheap listing, it is a create that cannot be mined; it
   *  used to pass validation and reach a signature. Absent = the rule is not
   *  checked, the same convention `minContributionFloor` follows. */
  minSeedUnits?: string;
  /** That floor as the exact decimal the field would hold, for the message. */
  minSeedLabel?: string;
  unit?: string;
}

/**
 * Errors for the whole draft, keyed by the FIELD ID so the caller can open the
 * collapsed block that holds it and move focus there.
 * `step` limits the check: 0 = the method choice only, 1+ = everything.
 */
export function validateDraft(draft: CreateDraft, ctx: ValidateContext, step = 1): Errors {
  const { msg } = ctx;
  const e: Errors = {};
  const d = normalizeDraft(draft);

  if (!d.mode) e.mode = msg('create.v.mode');
  if (step < 1) return e;

  const range = (key: Key, min: number, max: number, whole = false) => {
    const n = num(d[key] as string);
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) {
      e[key] = msg(whole ? 'create.v.whole' : 'create.v.range', { min, max });
    }
  };
  const address = (key: Key) => {
    const v = String(d[key]).trim();
    if (v && !ADDRESS.test(v)) e[key] = msg('create.v.address');
  };

  // ---- identity (every mode) ----
  const name = d.name.trim();
  if (name.length < 2 || name.length > 40) e.name = msg('create.v.name');
  const ticker = d.ticker.trim();
  if (!/^[A-Za-z0-9]{2,10}$/.test(ticker)) e.ticker = msg('create.v.ticker');
  if (d.description.length > 280) e.description = msg('create.v.description');
  if (!isSafeSocial(d.website, 'website')) e.website = msg('create.v.website');
  if (!isSafeSocial(d.twitter, 'x')) e.twitter = msg('create.v.twitter');
  if (!isSafeSocial(d.telegram, 'telegram')) e.telegram = msg('create.v.telegram');

  // ---- supply: whole tokens, scaled to base units by the caller ----
  if (d.mode !== 'crowd') {
    const supply = num(d.supply);
    if (!Number.isFinite(supply) || !Number.isInteger(supply) || supply < 1 || supply > 1e15) {
      e.supply = msg('create.v.supply');
    }
  }

  if (d.mode !== 'crowd') {
    address('feeRecipient');
    range('creatorShare', 0, 100);
    if (d.vanity.trim() && !/^[0-9a-fA-F]{3,8}$/.test(d.vanity.trim())) e.vanity = msg('create.v.vanity');
    if (!['prefix', 'suffix'].includes(d.vanityPosition)) e.vanityPosition = msg('create.v.vanityPosition');
  }

  if (d.mode === 'curve') {
    if (![0, 1, 2].includes(d.curveType)) e.curveType = msg('create.v.curve');
    range('buyFee', 0, 10);
    range('sellFee', 0, 10);
    // A BLANK ramp rate means "auto": antiSnipe() derives it from the preset,
    // and the field says so in its placeholder. Only a typed value is checked –
    // requiring one made the Normal and Hardcore presets unsubmittable, because
    // choosing either enables the layer and resets the rate to blank.
    if (d.rampEnabled && String(d.rampRate).trim() !== '') range('rampRate', 1, 1e15, true);
    if (d.capEnabled) {
      range('walletCap', 0.01, 100);
      range('capBlocks', 1, 10_000_000, true);
    }
    range('developerBuy', 0, 1e9);
    range('teamAllocation', 0, 20);
    if (num(d.teamAllocation) > 0) {
      address('teamWallet');
      range('vestingMonths', 1, 120, true);
    }
    if (d.startTime && !Number.isFinite(new Date(d.startTime).getTime())) {
      e.startTime = msg('create.v.startTime');
    }
  }

  if (d.mode === 'direct') {
    range('seedLiquidity', 0, 1e9);
    range('poolSupply', 1, 100);
    // Zero is legal – that is the token-only listing. Anything between zero and
    // the factory's own floor is not: see `minSeedUnits`. Compared in base
    // units, because the floor is a quantization of them and "0.0000005" is a
    // string until it is.
    const seedUnits = unitsOf(d.seedLiquidity, ctx.quoteDecimals ?? 18);
    const minSeed = ctx.minSeedUnits ? BigInt(ctx.minSeedUnits) : null;
    if (!e.seedLiquidity && minSeed !== null && seedUnits > 0n && seedUnits < minSeed) {
      e.seedLiquidity = msg('create.v.seedMin', {
        amt: ctx.minSeedLabel ?? '', sym: ctx.unit ?? '',
      });
    }
  }

  if (d.mode === 'crowd') {
    // Contract limits from docs/CROWD_LAUNCH_SPEC.md §2.1 and the rulebook of
    // CrowdFactory._derive – every one of them, because the factory's answer to
    // any of them is the same anonymous BadConfig().
    const maxDays = ctx.volatileQuote ? 14 : 60;
    range('pricePerToken', 1e-18, 1e18);
    range('hardCap', 1e-18, 1e15);
    range('softCap', 1e-18, 1e15);
    const hard = num(d.hardCap);
    const soft = num(d.softCap);
    if (!e.softCap && Number.isFinite(hard) && Number.isFinite(soft)) {
      if (soft < hard * 0.2) e.softCap = msg('create.v.softCapMin');
      else if (soft > hard) e.softCap = msg('create.v.softCapMax');
    }
    // The lower bound is TWO days, not the contract's one – see CROWD_MIN_DAYS.
    const days = num(d.crowdDays);
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < CROWD_MIN_DAYS || days > maxDays) {
      e.crowdDays = msg('create.v.crowd.deadline', { min: CROWD_MIN_DAYS, max: maxDays });
    }
    range('crowdPool', 30, 100);
    range('crowdTokens', 10, 90);
    range('listingPremium', 0, 50);
    range('crowdVestingDays', 90, 730, true);
    const interval = num(d.crowdVestingInterval);
    const duration = num(d.crowdVestingDays);
    if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(interval)
      || (interval !== 0 && (interval < 30 || interval > duration))) {
      e.crowdVestingInterval = msg('create.v.vestingInterval');
    } else if (interval !== 0 && Number.isFinite(duration) && duration % interval !== 0) {
      // CrowdFactory.sol:593. A step that does not divide the period ends the
      // escrow at floor(duration/interval)·interval – the announced end date
      // would be a date on which nothing more is released.
      e.crowdVestingInterval = msg('create.v.crowd.intervalDivide');
    }
    // `teamVestingDuration >= vestingDuration` (CrowdFactory.sol:594) holds by
    // CONSTRUCTION: there is no separate control in this slice and
    // buildCrowdParams sets the two equal, which `teamVestingDaysOf` states in
    // one place. The day a control for it appears, the rule needs a check here
    // and a message key of its own – it is not covered by anything below.
    range('crowdTeamTokens', 0, 45);
    if (!e.crowdTeamTokens && num(d.crowdTeamTokens) * 2 > num(d.crowdTokens)) {
      e.crowdTeamTokens = msg('create.v.teamTokens');
    }
    range('participantVesting', 0, 180, true);
    range('minContribution', 1e-18, 1e15);
    range('perWalletCap', 0, 1e15);
    const root = d.allowlistRoot.trim();
    if (root && !BYTES32.test(root)) e.allowlistRoot = msg('create.v.allowlistRoot');
    if (d.promises.length > 2000) e.promises = msg('create.v.promises');
    const mail = d.contactEmail.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) e.contactEmail = msg('create.v.email');

    // ---- the money rules, in base units and with the contract's rounding ----
    const dec = ctx.quoteDecimals ?? 18;
    const price = unitsOf(d.pricePerToken, dec);
    const hardWei = unitsOf(d.hardCap, dec);
    const softWei = unitsOf(d.softCap, dec);
    const minWei = unitsOf(d.minContribution, dec);
    const capWei = unitsOf(d.perWalletCap, dec);
    const poolBps = Math.round(num(d.crowdPool) * 100);
    const crowdBps = Math.round(num(d.crowdTokens) * 100);
    const premiumBps = Math.round(num(d.listingPremium) * 100);
    const teamBps = Math.round(num(d.crowdTeamTokens) * 100);

    // The protocol's own floor under the minimum contribution (~5 USD), read
    // from termsFor. Never guessed: without the read the rule is skipped.
    const floorWei = ctx.minContributionFloor ? BigInt(ctx.minContributionFloor) : null;
    if (!e.minContribution && floorWei !== null && minWei < floorWei) {
      e.minContribution = msg('create.v.crowd.minFloor', {
        amt: ctx.minContributionFloorLabel ?? '', sym: ctx.unit ?? '',
      });
    }
    // …and never above the hard cap itself, which would make every legal
    // contribution illegal (CrowdFactory.sol:598).
    if (!e.minContribution && hardWei > 0n && minWei > hardWei) {
      e.minContribution = msg('create.v.range', {
        min: ctx.minContributionFloorLabel ?? '0', max: d.hardCap.trim(),
      });
    }
    // perWalletCap: 0, or between the minimum contribution and the hard cap.
    if (!e.perWalletCap && capWei !== 0n && (capWei < minWei || capWei > hardWei)) {
      e.perWalletCap = msg('create.v.crowd.walletCap');
    }
    // The entitlement threshold (CrowdFactory.sol:631): the smallest legal
    // contribution has to buy at least two wei of allocation, or a settled raise
    // hands its participants nothing and has no refund path left.
    if (!e.pricePerToken && price > 0n && minWei > 0n && mulDiv(minWei, ONE, price) < 2n) {
      e.pricePerToken = msg('create.v.crowd.entitlement');
    }
    if (price > 0n && hardWei > 0n && crowdBps > 0 && poolBps > 0) {
      const pricePool = listingPrice(price, premiumBps);
      // Seedable at the SOFT cap – the worst case, since poolTokens only grows
      // with the raise (CrowdFactory.sol:641).
      if (!e.crowdPool && mulDiv(mulDiv(softWei, BigInt(poolBps), BPS), ONE, pricePool) === 0n) {
        e.crowdPool = msg('create.v.crowd.poolSeed');
      }
      // …and the three allocations have to fit the derived supply at fill = 1
      // (CrowdFactory.sol:629, :647). Both breaches are the same fix – less to
      // the team, or a smaller listing premium – so they share a message.
      const supply = derivedSupply(price, hardWei, crowdBps);
      const crowd1 = mulDiv(hardWei, ONE, price);
      const pool1 = mulDiv(mulDiv(hardWei, BigInt(poolBps), BPS), ONE, pricePool);
      const team1 = mulDiv(supply, BigInt(teamBps), BPS);
      if (!e.crowdTeamTokens && (team1 * 2n > pool1 || crowd1 + pool1 + team1 > supply)) {
        e.crowdTeamTokens = msg('create.v.crowd.split');
      }
    }
    // A team allocation needs somewhere to vest to (CrowdFactory.sol:608).
    if (teamBps > 0 && !ADDRESS.test(d.teamWallet.trim())) {
      e.teamWallet = msg('create.v.crowd.beneficiary');
    }
  }

  return e;
}

/** The team safe's vesting length in days. The contract demands only that it is
 *  not SHORTER than the author's (CrowdFactory.sol:594) and this slice offers no
 *  separate control, so the two are one number – stated here once, and read by
 *  buildCrowdParams so the two files cannot drift apart. */
export const teamVestingDaysOf = (d: CreateDraft): number => num(d.crowdVestingDays);

/** Upload gate: PNG / JPEG / WebP up to 2 MB (ACCEPTANCE.md). Returns a message
 *  key, or null when the file is acceptable. Pixel bounds are checked after the
 *  decode, where the dimensions are actually known. */
export function uploadError(file: { type: string; size: number } | null | undefined): string | null {
  if (!file) return 'create.upload.none';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'create.upload.type';
  if (file.size === 0) return 'create.upload.empty';
  if (file.size > 2 * 1024 * 1024) return 'create.upload.tooBig';
  return null;
}

/** Anti-snipe preset -> the two optional layers, exactly as Create.tsx applies
 *  them. `standard` leaves both off (fast open trading, no Fair Launch seal). */
export function presetValues(preset: CreateDraft['antiPreset']): {
  rampEnabled: boolean; capEnabled: boolean; walletCap: string; capBlocks: string;
} {
  if (preset === 'standard') {
    return { rampEnabled: false, capEnabled: false, walletCap: DEFAULT_DRAFT.walletCap, capBlocks: DEFAULT_DRAFT.capBlocks };
  }
  if (preset === 'hardcore') return { rampEnabled: true, capEnabled: true, walletCap: '0.5', capBlocks: '100' };
  return { rampEnabled: true, capEnabled: true, walletCap: '1.5', capBlocks: '75' };
}
