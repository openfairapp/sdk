/*
 * Crowd launch arithmetic – ONE pure module, no network, no chain, no i18n.
 *
 * Both /create (the review step, before anything exists on chain) and the
 * campaign page (after it does) compute the same six things from it, because a
 * split preview that disagrees with the page it links to is worse than no
 * preview: docs/CROWD_SITE_PLAN.md §3.3 asks for one implementation, and §2.4
 * asks the checklist thresholds to be the same on both sides of the wire.
 *
 * Everything is bigint in base units. `pricePerToken` is quote units per 1e18
 * tokens – the same unit the contract uses – so "tokens for X" is always
 * mulDiv(X, 1e18, price) and never a float. Rounding is transcribed from
 * contracts/src/OpenCrowd.sol and contracts/src/CrowdFactory.sol, division by
 * division: `Math.mulDiv` floors, `Math.Rounding.Ceil` rounds up, and getting
 * one of them backwards is a preview that promises a wei nobody gets.
 *
 * ---------------------------------------------------------------------------
 * The owner's example (docs/CROWD_LAUNCH_SPEC.md §2.1/§3.1), reproduced here so
 * the numbers in the spec and the numbers this file returns can be compared by
 * eye. hardCap 100 000, pricePerToken 0,1, poolBps 4000, crowdTokensBps 4000,
 * teamTokensBps 500, listingPremiumBps 0, raiseFeeBps 200, vesting 180 days in
 * 30-day steps:
 *
 *   crowd1        = 100 000 · 1e18 / 0,1        = 1 000 000 tokens
 *   supply        = ceil(1 000 000 · 10000/4000) = 2 500 000 tokens
 *   pricePool     = 0,1 (no listing premium)
 *
 *   at fill = 1   (raised 100 000)        at fill = 0,5 (raised 50 000)
 *   crowdTokens   1 000 000               500 000
 *   poolFunds        40 000                20 000
 *   poolTokens      400 000               200 000
 *   teamTokens      125 000                62 500
 *   surviving     1 525 000               762 500
 *   burned          975 000             1 737 500
 *   valuation       152 500                76 250   (nominal is 250 000 in both)
 *
 *   participantShare = 1 000 000 / 1 525 000 = 65,57 % at EVERY fill – not the
 *   40 % of crowdTokensBps, which sizes the nominal supply and nothing else.
 *   liquidityRatio   = 40 000 / 152 500 = 26,2 % (2622 bps, floored).
 *   escrow           = 60 000, paid in 6 steps of 10 000; the platform takes
 *                      200 (2 %) out of each, so the author receives 9 800 six
 *                      times and the platform 1 200 in all.
 *   floorAtListing   = 60 000 / 1 000 000 = 0,06 per token = 0,6 × the price,
 *                      and it falls to ZERO by vestStart + 180 days.
 *
 * One deviation from the plan's prose, resolved in favour of the source: plan
 * §3.3 writes `supply = ceil(ceil(hardCap·1e18/price)·10000/crowdTokensBps)`,
 * while CrowdFactory.sol:619 floors the inner division and only rounds the
 * outer one up. This file follows the contract, which is what will actually
 * mint.
 */

// ---------------------------------------------------------------- constants

/** 1e18 – the token scale `pricePerToken` is quoted against. */
export const ONE = 10n ** 18n;
export const BPS = 10_000n;

/**
 * Seconds of slack every crowd deadline is built with (plan §2.4).
 *
 * `deadline >= block.timestamp + MIN_CROWD_DURATION` is checked in the block
 * that MINES the create, not in the block that priced it, and a launch session
 * lives 20 minutes with a 5-minute config hash inside it. So the margin has to
 * beat the session TTL, not the block time: 1800 s, one number, used by the
 * form, by the backend's prepare and by the review step.
 */
export const DEADLINE_MARGIN = 1800;

/** OpenCrowd.sol:244-294 – the clock constants the panel reasons about. */
export const CLAIM_DELAY = 15 * 60;
export const WITHDRAW_LOCK = 24 * 3600;
export const FINALIZE_GRACE = 7 * 86_400;
export const SEED_GRACE = 14 * 86_400;
export const WRITEOFF_NOTICE = 7 * 86_400;
export const FREEZE_GRACE = 3 * 86_400;
export const MAX_FREEZE_EXTENSION = 30 * 86_400;
export const ABANDON_BACKSTOP = 180 * 86_400;
export const SWEEP_DELAY = 365 * 86_400;
/** The creator side may put up at most 10 % of the hard cap (MAX_CREATOR_SELF_BPS). */
export const MAX_CREATOR_SELF_BPS = 1000n;

/** Checklist thresholds – docs/CROWD_SITE_PLAN.md §2.4. The backend keeps the
 *  same five numbers in one place and a test compares the two answers, so
 *  moving one here without moving it there is a caught bug, not a drift. */
export const STRICT_MIN_POOL_BPS = 3000;
export const STRICT_MIN_VESTING = 7_776_000; // 90 days
export const STRICT_MAX_TEAM_BPS = 1000;
export const STRICT_MAX_WALLET_CAP_BPS = 500n;

// ------------------------------------------------------------------ helpers

const abs = (v: bigint) => (v < 0n ? -v : v);
/** floor(a·b/d) – `Math.mulDiv` in the contracts. */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  return (a * b) / d;
}
/** ceil(a·b/d) – `Math.mulDiv(..., Math.Rounding.Ceil)`. */
export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const n = a * b;
  return n === 0n ? 0n : (n + d - 1n) / d;
}
/** Tokens (1e18-scaled) that `amount` of the quote buys at `price`. */
export const tokensFor = (amount: bigint, price: bigint): bigint => mulDiv(amount, ONE, price);
/** A ratio as basis points, floored – never a float in a money position. */
export const ratioBps = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number(mulDiv(part, BPS, whole));
/** A ratio as a float, for a progress bar and nothing that is paid out. */
export const ratio = (part: bigint, whole: bigint): number => {
  if (whole === 0n) return 0;
  return Number(mulDiv(abs(part), 1_000_000n, abs(whole))) / 1_000_000;
};

// -------------------------------------------------------------------- phase

/** `phase()` is a uint8: 0 Raising, 1 Failed, 2 Succeeded (OpenCrowd.sol:185). */
export type CrowdPhase = 'raising' | 'failed' | 'succeeded';
export const CROWD_PHASES: readonly CrowdPhase[] = ['raising', 'failed', 'succeeded'];

export function phaseOf(raw: number | bigint | CrowdPhase | null | undefined): CrowdPhase {
  if (typeof raw === 'string') return CROWD_PHASES.includes(raw) ? raw : 'raising';
  const i = Number(raw ?? 0);
  return CROWD_PHASES[i] ?? 'raising';
}

/**
 * What the page shows as the state of the raise. Five, not three: a succeeded
 * raise that has a pool and a succeeded raise that never will are not the same
 * screen (plan §2.4, `written_off` is TERMINAL – no pool, no transferable
 * token, no claim, and the author's clock stopped), and a raise sitting past
 * its deadline waiting for someone to call settle() is not still raising.
 */
export type CrowdStage = 'raising' | 'awaitingSettle' | 'succeeded' | 'seeded' | 'writtenOff' | 'failed';

export interface RaiseInput {
  phase: number | bigint | CrowdPhase;
  /** Unix seconds. The caller passes chain time where it has it. */
  now: number;
  /** `deadline()` – already moved if extend() was used. */
  deadline: number;
  /** `lastFrozenSeen()`; 0/null = never observed frozen. */
  lastFrozenSeen?: number | null;
  extended?: boolean;
  extensionSeconds?: number;
  extensionMinBps?: number;
  raised: bigint;
  hardCap: bigint;
  softCap: bigint;
  /** `eligibleRaised()` = raised − creatorContributed. Defaults to raised. */
  eligibleRaised?: bigint;
  capReached?: boolean;
  poolSeeded?: boolean;
  poolWrittenOff?: boolean;
  /** `quoteFrozen()` right now – always false for a native raise. */
  frozen?: boolean;
}

export interface RaiseStatus {
  phase: CrowdPhase;
  stage: CrowdStage;
  /** `deadlineEff()` – the announced deadline, pushed by an observed freeze. */
  deadlineEffective: number;
  closed: boolean;
  secondsLeft: number;
  withdrawLocked: boolean;
  /** When withdrawals close; null while an extension keeps them open. */
  withdrawLockedFrom: number | null;
  settleable: boolean;
  settleableAt: number;
  /** The stalled branch of abandon(): deadlineEff + 7 days. A DECIDABLE raise
   *  also needs a live freeze, or the 180-day backstop – see abandonable. */
  abandonableAt: number;
  abandonable: boolean;
  extensionAvailable: boolean;
  cancellable: boolean;
  softCapMet: boolean;
  hardCapPct: number;
  softCapPct: number;
}

/**
 * `deadlineEff()` transcribed: an observed freeze pushes the deadline out by
 * FREEZE_GRACE from the moment it was seen, and never past
 * deadline + MAX_FREEZE_EXTENSION.
 */
export function deadlineEffective(deadline: number, lastFrozenSeen?: number | null): number {
  let eff = deadline;
  if (lastFrozenSeen) {
    const pushed = lastFrozenSeen + FREEZE_GRACE;
    if (pushed > eff) eff = pushed;
  }
  const cap = deadline + MAX_FREEZE_EXTENSION;
  return eff > cap ? cap : eff;
}

/** Where the raise stands and which of its calls are open right now. */
export function raisePhase(input: RaiseInput): RaiseStatus {
  const phase = phaseOf(input.phase);
  const eff = deadlineEffective(input.deadline, input.lastFrozenSeen);
  const eligible = input.eligibleRaised ?? input.raised;
  const softCapMet = input.softCap === 0n ? input.raised > 0n : eligible >= input.softCap;
  const capReached = input.capReached ?? input.raised >= input.hardCap;
  const closed = input.now >= eff;
  const raising = phase === 'raising';

  const stage: CrowdStage = phase === 'failed'
    ? 'failed'
    : phase === 'succeeded'
      ? (input.poolWrittenOff ? 'writtenOff' : input.poolSeeded ? 'seeded' : 'succeeded')
      : (closed || input.raised >= input.hardCap) ? 'awaitingSettle' : 'raising';

  // withdrawContribution(): open the whole raise except its last 24 hours, and
  // open again for the entire length of an announced extension.
  const withdrawLockedFrom = input.extended ? null : eff - WITHDRAW_LOCK;
  const withdrawLocked = !raising
    || input.now >= eff
    || (!input.extended && input.now + WITHDRAW_LOCK >= eff);

  // settle(): the hard cap is FULL right now, or the effective deadline passed.
  // A frozen quote blocks it, which is exactly what abandon() is for.
  const settleable = raising && (input.raised >= input.hardCap || closed) && !input.frozen;

  // abandon(): the stalled branch, minus the carve-out for a raise settle()
  // would carry to success – that one needs a live freeze or the backstop.
  const stalled = input.now >= eff + FINALIZE_GRACE;
  const decidable = input.raised >= input.hardCap || softCapMet;
  const backstop = input.now >= input.deadline + ABANDON_BACKSTOP;
  const frozenOut = (input.lastFrozenSeen ?? 0) > input.deadline
    && (input.lastFrozenSeen ?? 0) - input.deadline >= MAX_FREEZE_EXTENSION;
  const abandonable = raising
    && (frozenOut || (stalled && (!decidable || backstop || input.frozen === true)));

  const extensionAvailable = raising
    && !input.extended
    && (input.extensionSeconds ?? 0) > 0
    && input.now < input.deadline
    && eligible * BPS >= input.softCap * BigInt(input.extensionMinBps ?? 0);

  return {
    phase,
    stage,
    deadlineEffective: eff,
    closed,
    secondsLeft: Math.max(0, eff - input.now),
    withdrawLocked,
    withdrawLockedFrom,
    settleable,
    settleableAt: eff,
    abandonableAt: eff + FINALIZE_GRACE,
    abandonable,
    extensionAvailable,
    cancellable: raising && !capReached && !softCapMet,
    softCapMet,
    hardCapPct: ratio(input.raised, input.hardCap),
    softCapPct: input.softCap === 0n ? 1 : Math.min(1, ratio(eligible, input.softCap)),
  };
}

// ------------------------------------------------------------- contribution

/** Machine-readable reason a contribution cannot be signed – the same
 *  vocabulary the API returns in `blockedBy.contribute` (plan §2.4), so the
 *  button's caption is chosen once. */
export type ContributeBlock =
  | 'notRaising' | 'closed' | 'frozen' | 'belowMin' | 'notAllowlisted'
  | 'capFilled' | 'walletCap' | 'entitlementFloor' | 'selfCap';

export interface ContributionInput {
  /** What the wallet typed, in quote base units. */
  offered: bigint;
  raised: bigint;
  hardCap: bigint;
  minContribution: bigint;
  /** 0 = no per-wallet limit. */
  perWalletCap: bigint;
  pricePerToken: bigint;
  /** This wallet's contribution so far. */
  contributed?: bigint;
  /** `creatorContributed()` – the creator SIDE's total, not this wallet's. */
  creatorContributed?: bigint;
  /** creator, feeRecipient or teamBeneficiary – the three addresses capped at
   *  10 % of the hard cap between them. */
  isCreatorSide?: boolean;
  /** Non-zero root = the raise is allow-listed. */
  allowlistRoot?: string | null;
  /** null = not known yet (no proof loaded); false blocks, true passes. */
  allowlisted?: boolean | null;
  phase: number | bigint | CrowdPhase;
  now: number;
  deadline: number;
  lastFrozenSeen?: number | null;
  frozen?: boolean;
}

export interface ContributionQuote {
  /** The largest amount that would be ACCEPTED from this wallet right now:
   *  min(hardCap − raised, perWalletCap − contributed, creator-side room).
   *  The amount field is clamped to it, so "gas estimation failed" never has to
   *  stand in for an answer that was known before signing. */
  maxAcceptable: bigint;
  /** What the raise keeps of `offered` (the rest is refunded in the same tx on
   *  a native raise, and never pulled at all on a quote raise). */
  accepted: bigint;
  refunded: bigint;
  /** The wallet's contribution after this one lands. */
  walletTotal: bigint;
  /** Crowd tokens the accepted part buys at the announced price. Indicative:
   *  the on-chain entitlement divides by the raise's own settled total. */
  tokens: bigint;
  blockedBy: ContributeBlock | null;
}

/**
 * One contribution, checked in the order `_contribute` checks it
 * (OpenCrowd.sol:688-733) so the reason shown is the reason that would revert.
 * The one reordering: a frozen quote is reported before the amount rules,
 * because on a quote raise `contributeQuote` guards the freeze before it pulls.
 */
export function quoteContribution(input: ContributionInput): ContributionQuote {
  const phase = phaseOf(input.phase);
  const eff = deadlineEffective(input.deadline, input.lastFrozenSeen);
  const contributed = input.contributed ?? 0n;
  const room = input.hardCap > input.raised ? input.hardCap - input.raised : 0n;
  const walletRoom = input.perWalletCap === 0n
    ? room
    : (input.perWalletCap > contributed ? input.perWalletCap - contributed : 0n);
  const selfRoom = input.isCreatorSide
    ? (() => {
      const allowance = mulDiv(input.hardCap, MAX_CREATOR_SELF_BPS, BPS);
      const used = input.creatorContributed ?? 0n;
      return allowance > used ? allowance - used : 0n;
    })()
    : room;
  const maxAcceptable = [room, walletRoom, selfRoom].reduce((a, b) => (b < a ? b : a));

  const accepted = input.offered > room ? room : input.offered;
  const walletTotal = contributed + accepted;
  const tokens = tokensFor(accepted, input.pricePerToken);
  const at = (blockedBy: ContributeBlock | null): ContributionQuote => ({
    maxAcceptable,
    accepted,
    refunded: input.offered > accepted ? input.offered - accepted : 0n,
    walletTotal,
    tokens,
    blockedBy,
  });

  if (phase !== 'raising') return at('notRaising');
  if (input.now >= eff) return at('closed');
  if (input.frozen) return at('frozen');
  if (input.offered < input.minContribution) return at('belowMin');
  if (isAllowlisted(input.allowlistRoot) && input.allowlisted === false) return at('notAllowlisted');
  if (accepted === 0n) return at('capFilled');
  if (input.perWalletCap !== 0n && walletTotal > input.perWalletCap) return at('walletCap');
  // Two wei of allocation at the announced price is one wei of entitlement at
  // every fill the raise can settle on; below it the wallet would hold a share
  // of a successful raise worth no tokens at all.
  if (tokensFor(walletTotal, input.pricePerToken) < 2n) return at('entitlementFloor');
  if (input.isCreatorSide) {
    const self = (input.creatorContributed ?? 0n) + accepted;
    if (self * BPS > input.hardCap * MAX_CREATOR_SELF_BPS) return at('selfCap');
  }
  return at(null);
}

/** A root of 0x00…00 (or absent) means the raise is open to anyone. */
export function isAllowlisted(root?: string | null): boolean {
  if (!root) return false;
  return /[1-9a-f]/i.test(root.slice(2));
}

// ------------------------------------------------------------ split preview

export interface CrowdEconomics {
  pricePerToken: bigint;
  hardCap: bigint;
  softCap: bigint;
  poolBps: number;
  crowdTokensBps: number;
  listingPremiumBps: number;
  teamTokensBps: number;
  raiseFeeBps: number;
  /** Absolute ceiling on the platform's cut over the life of the raise, in
   *  quote units; 0/absent = no cap known (the create page before termsFor). */
  feeCapQuote?: bigint;
  vestingDurationSeconds: number;
  vestingIntervalSeconds: number;
}

export interface SplitPreview {
  raised: bigint;
  /** The supply the factory derives from price and shares – the number the
   *  event carries, and the one `crowdTokensBps` is a share OF. */
  nominalSupply: bigint;
  /** Listing price: the raise price plus the listing premium, rounded up. */
  pricePool: bigint;
  crowdTokens: bigint;
  poolFunds: bigint;
  poolTokens: bigint;
  teamTokens: bigint;
  /** What survives settle(): the three amounts above and nothing else. */
  survivingSupply: bigint;
  burned: bigint;
  /** crowdTokens / survivingSupply – a launch CONSTANT, and not crowdTokensBps. */
  participantShareBps: number;
  participantShare: number;
  /** price × survivingSupply – arithmetic on the author's parameters, shown
   *  next to the nominal one, which is the same number before the burn. */
  impliedValuation: bigint;
  nominalValuation: bigint;
  /** poolFunds / impliedValuation. Red under 5 %, amber under 10 % (§3.3). */
  liquidityRatioBps: number;
  /** raised − poolFunds: the author's escrow, out of which the redemption
   *  floor is paid and out of which the platform fee is taken. */
  escrow: bigint;
  /** unvestedPot/redeemableSupply on listing day = (10000−poolBps)/10000 × price.
   *  A value at ONE moment: it falls to zero by vestStart + vestingDuration. */
  floorAtListing: bigint;
  /** The escrow's payout schedule. `installments` is 1 when the vesting is
   *  per-second (interval 0), where there is no schedule to draw. */
  installments: number;
  installmentGross: bigint;
  installmentFee: bigint;
  installmentNet: bigint;
  raiseFeeTotal: bigint;
  authorNet: bigint;
}

/** The derived (nominal) supply – CrowdFactory.sol:619, floors then rounds up. */
export function derivedSupply(pricePerToken: bigint, hardCap: bigint, crowdTokensBps: number): bigint {
  if (pricePerToken === 0n || crowdTokensBps === 0) return 0n;
  const crowd1 = mulDiv(hardCap, ONE, pricePerToken);
  return mulDivUp(crowd1, BPS, BigInt(crowdTokensBps));
}

/** The listing price – CrowdFactory.sol:635, rounded UP. */
export const listingPrice = (pricePerToken: bigint, listingPremiumBps: number): bigint =>
  mulDivUp(pricePerToken, BPS + BigInt(listingPremiumBps), BPS);

/**
 * The whole distribution at one fill level, floored exactly where settle()
 * floors (OpenCrowd.sol:906-980). settle() additionally clamps poolTokens and
 * teamTokens to the balance it actually holds; the clamp can only ever absorb a
 * wei or two of rounding, so it is not modelled here.
 */
export function splitPreview(terms: CrowdEconomics, raised: bigint): SplitPreview {
  const price = terms.pricePerToken;
  const nominalSupply = derivedSupply(price, terms.hardCap, terms.crowdTokensBps);
  const pricePool = listingPrice(price, terms.listingPremiumBps);

  const crowdTokens = price === 0n ? 0n : mulDiv(raised, ONE, price);
  const poolFunds = mulDiv(raised, BigInt(terms.poolBps), BPS);
  const poolTokens = pricePool === 0n ? 0n : mulDiv(poolFunds, ONE, pricePool);
  const teamTokens = terms.hardCap === 0n
    ? 0n
    : mulDiv(mulDiv(nominalSupply, BigInt(terms.teamTokensBps), BPS), raised, terms.hardCap);
  const survivingSupply = crowdTokens + poolTokens + teamTokens;
  const burned = nominalSupply > survivingSupply ? nominalSupply - survivingSupply : 0n;

  const impliedValuation = mulDiv(price, survivingSupply, ONE);
  const nominalValuation = mulDiv(price, nominalSupply, ONE);
  const escrow = raised - poolFunds;

  // The platform's cut is taken out of each release() and nowhere else: ceil of
  // the instalment, never more than the remaining head-room under feeCapQuote.
  const steps = terms.vestingIntervalSeconds > 0 && terms.vestingDurationSeconds > 0
    ? Math.max(1, Math.floor(terms.vestingDurationSeconds / terms.vestingIntervalSeconds))
    : 1;
  const installmentGross = escrow / BigInt(steps);
  const cap = terms.feeCapQuote ?? 0n;
  let feeTotal = 0n;
  let installmentFee = 0n;
  for (let i = 0; i < steps; i++) {
    const gross = i === steps - 1 ? escrow - installmentGross * BigInt(steps - 1) : installmentGross;
    let fee = mulDivUp(gross, BigInt(terms.raiseFeeBps), BPS);
    if (cap > 0n && feeTotal + fee > cap) fee = cap > feeTotal ? cap - feeTotal : 0n;
    if (fee > gross) fee = gross;
    feeTotal += fee;
    if (i === 0) installmentFee = fee;
  }

  return {
    raised,
    nominalSupply,
    pricePool,
    crowdTokens,
    poolFunds,
    poolTokens,
    teamTokens,
    survivingSupply,
    burned,
    participantShareBps: ratioBps(crowdTokens, survivingSupply),
    participantShare: ratio(crowdTokens, survivingSupply),
    impliedValuation,
    nominalValuation,
    liquidityRatioBps: ratioBps(poolFunds, impliedValuation),
    escrow,
    floorAtListing: crowdTokens === 0n ? 0n : mulDiv(escrow, ONE, crowdTokens),
    installments: steps,
    installmentGross,
    installmentFee,
    installmentNet: installmentGross - installmentFee,
    raiseFeeTotal: feeTotal,
    authorNet: escrow - feeTotal,
  };
}

// ------------------------------------------------------------ strict terms

export interface StrictInput {
  poolBps: number;
  vestingDurationSeconds: number;
  crowdTokensBps: number;
  teamTokensBps: number;
  perWalletCap: bigint;
  hardCap: bigint;
  /** After settlement the redemption test is the escrow that actually exists. */
  phase?: number | bigint | CrowdPhase;
  /** `unvestedPot()` – the escrow the redemption pays from.
   *
   *  Three states, and they are three: a positive value, a zero, and NULL for
   *  "the read did not answer". Null is NOT zero. The backend's own
   *  `crowdChecklist` falls back to `poolBps < 10000` when it has no pot, and
   *  coercing an unknown to 0n here instead would make the page print 4/5 for a
   *  raise the API calls 5/5 – the divergence plan §2.4 forbids by name. */
  unvestedPot?: bigint | null;
}

export interface StrictChecklist {
  poolBps: boolean;
  vesting: boolean;
  redeem: boolean;
  teamTokens: boolean;
  walletCap: boolean;
  passed: number;
  total: number;
}

/**
 * The five strictness tests of docs/CROWD_LAUNCH_SPEC.md §6, with the exact
 * thresholds plan §2.4 fixes. THE source of truth: the backend keeps the same
 * five in one place and a test compares them, because a checklist that reads
 * 5/5 on the page and 4/5 in the API is the "verified" badge this product
 * removed on purpose.
 *
 * Two of them are easy to get wrong, so they are spelled out:
 *  - `teamTokens` needs BOTH the spec's `teamTokensBps <= 1000` and the
 *    contract's `teamTokensBps·2 <= crowdTokensBps`. The contract rule alone
 *    passes a 20 % team allocation against a 60 % crowd share.
 *  - `redeem` is NOT a constant true. The redemption is unconditional in the
 *    contract, but it pays out of the author's escrow: with poolBps = 10000
 *    that escrow is empty from settlement onward and the floor is zero forever.
 */
export function strictTerms(terms: StrictInput): StrictChecklist {
  const phase = phaseOf(terms.phase ?? 'raising');
  const out = {
    poolBps: terms.poolBps >= STRICT_MIN_POOL_BPS,
    vesting: terms.vestingDurationSeconds >= STRICT_MIN_VESTING,
    // `unvestedPot == null` means the chain read is missing, not that the pot
    // is empty: fall back to the same question the pre-settlement branch asks,
    // exactly as backend/src/api.js `crowdChecklist` does.
    redeem: phase === 'succeeded' && terms.unvestedPot != null
      ? terms.unvestedPot > 0n
      : terms.poolBps < 10_000,
    teamTokens: terms.teamTokensBps <= STRICT_MAX_TEAM_BPS
      && terms.teamTokensBps * 2 <= terms.crowdTokensBps,
    walletCap: terms.perWalletCap !== 0n
      && terms.perWalletCap * BPS <= terms.hardCap * STRICT_MAX_WALLET_CAP_BPS,
  };
  const keys = ['poolBps', 'vesting', 'redeem', 'teamTokens', 'walletCap'] as const;
  return { ...out, passed: keys.filter((k) => out[k]).length, total: keys.length };
}

// ------------------------------------------------------- the redemption floor

export interface EscrowClock {
  phase: number | bigint | CrowdPhase;
  /** `unvestedPot()` – what has NOT matured to the author, and is therefore
   *  what redemption pays out of. */
  unvestedPot: bigint;
  /** `redeemableSupply()` – crowd tokens still capable of being redeemed. */
  redeemableSupply: bigint;
  vestStart: number;
  vestingDuration: number;
  vestingInterval: number;
  /** `lastAccrual()` – the clock's last stamp; the preview measures from it. */
  lastAccrual: number;
  poolWrittenOff?: boolean;
}

const stepsAt = (e: EscrowClock, t: number): bigint => {
  if (t <= e.vestStart) return 0n;
  const elapsed = BigInt(t - e.vestStart);
  const interval = BigInt(Math.max(0, e.vestingInterval));
  const s = interval === 0n ? elapsed : elapsed / interval;
  const total = totalSteps(e);
  return s > total ? total : s;
};

const totalSteps = (e: EscrowClock): bigint => {
  const interval = BigInt(Math.max(0, e.vestingInterval));
  const duration = BigInt(Math.max(0, e.vestingDuration));
  return interval === 0n ? duration : duration / interval;
};

/**
 * `_previewAccrual()` at an ARBITRARY moment (OpenCrowd.sol:1442-1459): the
 * share of the pot that would move to the author by `at`. It is a share of the
 * POT, not of a fixed nominal, which is why a redemption lowers every future
 * payout in proportion.
 */
export function previewAccrual(e: EscrowClock, at: number): bigint {
  if (phaseOf(e.phase) !== 'succeeded' || e.unvestedPot === 0n || e.poolWrittenOff) return 0n;
  if (at >= e.vestStart + e.vestingDuration) return e.unvestedPot;
  const done = stepsAt(e, e.lastAccrual);
  const now = stepsAt(e, at);
  const d = now > done ? now - done : 0n;
  const r = totalSteps(e) - done;
  if (d === 0n || r <= 0n) return 0n;
  return mulDiv(e.unvestedPot, d, r);
}

/**
 * `floorPerToken()` at an arbitrary moment – quote units paid per 1e18 crowd
 * tokens burned. This is the number the page draws as a DECAYING curve and the
 * number a redemption's minAmountOut is set from; it is not a constant of the
 * listing.
 *
 * Three special cases, and all three come from the contract:
 *  - at or past vestStart + vestingDuration the whole pot has matured to the
 *    author and the floor is zero;
 *  - with an interval the floor is a STAIRCASE – between steps it does not
 *    move at all;
 *  - a written-off pool stops the clock: the preview is zero and the floor
 *    FREEZES where it stood, so the zero date never arrives.
 */
export function floorAt(e: EscrowClock, at: number): bigint {
  if (e.redeemableSupply === 0n) return 0n;
  const moving = previewAccrual(e, at);
  const left = e.unvestedPot > moving ? e.unvestedPot - moving : 0n;
  return mulDiv(left, ONE, e.redeemableSupply);
}

/** When the floor reaches zero: the end of the author's vesting. null while the
 *  raise has not settled (the clock starts at settlement) and null on a
 *  written-off pool, whose clock will never run again. */
export function floorZeroAt(e: EscrowClock): number | null {
  if (phaseOf(e.phase) !== 'succeeded' || !e.vestStart) return null;
  if (e.poolWrittenOff) return null;
  return e.vestStart + e.vestingDuration;
}

// ---------------------------------------------------------------- wire glue

/** The `terms` block of GET /api/v1/crowd/:token, as it arrives on the wire. */
export interface WireTerms {
  pricePerTokenWei: string;
  hardCapWei: string;
  softCapWei: string;
  poolBps: number;
  crowdTokensBps: number;
  listingPremiumBps: number;
  teamTokensBps: number;
  raiseFeeBps: number;
  feeCapQuoteWei?: string | null;
  vestingDurationSeconds: number;
  vestingIntervalSeconds: number;
}

/** One conversion, so /create and the campaign page cannot disagree about which
 *  string is which bigint. */
export function economicsFromWire(t: WireTerms): CrowdEconomics {
  return {
    pricePerToken: BigInt(t.pricePerTokenWei),
    hardCap: BigInt(t.hardCapWei),
    softCap: BigInt(t.softCapWei),
    poolBps: t.poolBps,
    crowdTokensBps: t.crowdTokensBps,
    listingPremiumBps: t.listingPremiumBps,
    teamTokensBps: t.teamTokensBps,
    raiseFeeBps: t.raiseFeeBps,
    feeCapQuote: t.feeCapQuoteWei ? BigInt(t.feeCapQuoteWei) : 0n,
    vestingDurationSeconds: t.vestingDurationSeconds,
    vestingIntervalSeconds: t.vestingIntervalSeconds,
  };
}
