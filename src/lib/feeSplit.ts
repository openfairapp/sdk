/* The enforced answer to "where does the fee go?" – the create flow's half.
 *
 * FEE_SPLIT_DESIGN.md, variant B. The creator supplies NUMBERS and nothing
 * else: `holdersVault` and `buyback` are built by the platform's own deployer
 * inside the create transaction, and there is no calldata field on any path
 * through which a creator could name either (D3). So everything this module
 * does is convert percentages a person typed into the three `uint16`s the
 * factory takes, refuse the ones the factory would refuse, and convert back.
 *
 * TWO DENOMINATORS, NEVER MIXED (D1, and the harvester says it in as many
 * words at OpenLPHarvester.sol:83-88):
 *
 *   quote side:  platformShareBps + holdersBps + buybackBps + treasury(rest)
 *   token side:  tokenHoldersBps + burn(rest)
 *
 * `platformShareBps` is creator-chosen (0..10000, UI default 50 %), which is
 * why the quote side's shares are bps of the WHOLE quote side rather than of
 * the creator's remainder: under the remainder framing "Holders 30 %" is 15 %
 * of the quote side at the shipping default and 3 % at a 90 % platform share –
 * a number that is true and communicates something false. One denominator is
 * what makes the figure on the token page true for the person reading it.
 *
 * WHAT THE CREATOR ACTUALLY MOVES (D2). The form asks three creator-side
 * percentages that sum to exactly 100 – Treasury / Holders / Burn – and this
 * module converts them with ONE formula, both ways. The third column is the
 * buy-back-and-burn leg, and D11 keeps it at zero on every chain in v1: the
 * factory reverts `BuybackUnavailable` for a non-zero `buybackBps` while its
 * chain has no `swapRouter`, and all three chains have none. So the column is
 * carried through the arithmetic (it is what makes the trio sum to 100, and it
 * is the shape the leg ships in later) and refused by `validateFeeSplit`.
 *
 * The burn a creator CAN move in v1 is the token side, and it is a separate
 * lever on its own denominator: `tokenHoldersBps` is bps of the whole token
 * side paid to the holders' vault instead of being burned, so
 *
 *   Burn % of the {sym} side = 100 - tokenHolders %
 *
 * and the shipping default – `tokenHoldersPct = 0` – is the 100 % burn every
 * openfair launch ever created already performs. That is why the token side is
 * a fact BESIDE the donut with its own control and never a fourth slice inside
 * it: a donut whose 100 % spanned two denominators would be the exact
 * product-legal-15 failure variant B exists to close.
 *
 * NOTHING HERE READS THE NETWORK, THE BROWSER OR REACT STATE. Give it a choice and
 * a platform share and it is pure, which is what lets tests/fee-split-create.
 * test.mjs run the same arithmetic the wallet signs.
 */

/** One whole, in basis points. */
export const BPS = 10_000;

/**
 * Floor for ANY non-zero share, 1 % (D17, `LaunchFactory.MIN_LIVE_SHARE_BPS`).
 *
 * A share of a few bps exists only to fill a marketing donut: it renders beside
 * a claim button that pays less than its own gas. Zero stays legal – zero makes
 * no claim. Validated here as well as on chain because the revert costs a
 * signature and this costs a keystroke (D21: the SDK validates the same rules
 * before it ever builds the calldata).
 */
export const MIN_LIVE_SHARE_BPS = 100;

// ---------------------------------------------------------------- the ABI --

/**
 * The factory's new argument, transcribed from `contracts/src/OpenLPHarvester
 * .sol:94-98`. Declared at file level there so both factories and the deployer
 * helper import ONE type; declared once here for the same reason.
 *
 * tests/fee-split-create.test.mjs re-reads the Solidity and fails on a
 * transcription slip – a positional tuple in the wrong order is not a type
 * error and not a revert, it is a different launch.
 */
export const FEE_SPLIT_STRUCT =
  'struct FeeSplit { uint16 holdersBps; uint16 buybackBps; uint16 tokenHoldersBps; }';

/**
 * `FeeSplitSet`, transcribed from `contracts/src/LaunchFactory.sol:125-133`.
 *
 * A SEPARATE event rather than a field inside the params struct (D15): those
 * structs are emitted whole inside `LaunchCreated` / `DirectListingCreated`, so
 * a new field there would move `topic0` and cost a hand-written legacy decoder
 * in nine places. A separate argument moves the function SELECTOR and nothing
 * else.
 *
 * Not emitted for the default {0, 0, 0}: absence means "this launch routed
 * nothing", and for the OLD fleet – which never had the question put to it –
 * the event does not exist at all. D22: absence and zero must not render alike.
 */
export const FEE_SPLIT_SET_EVENT =
  'event FeeSplitSet(address indexed token, address indexed harvester, uint16 holdersBps, uint16 buybackBps, uint16 tokenHoldersBps, address holdersVault, address buyback)';

/**
 * The three custom errors the new argument can raise, so viem decodes a reverted
 * simulation into a real reason instead of "gas cannot be estimated".
 * `LaunchFactory.sol:56`, `:60`, `:65`.
 */
export const FEE_SPLIT_ERRORS = [
  'error BadSplit()',
  'error BuybackUnavailable()',
  'error HoldersUnavailable()',
] as const;

// -------------------------------------------------------------- the types --

/** The factory's `FeeSplit` argument, ready to encode. */
export interface FeeSplitArg {
  /** Bps of the WHOLE quote side to the holders' vault. */
  holdersBps: number;
  /** Bps of the WHOLE quote side to the buy-back escrow. Zero in v1 (D11). */
  buybackBps: number;
  /** Bps of the WHOLE token side to the holders' vault; the burn takes the
   *  remainder. Zero = today's behaviour, the token side burned 100 %. */
  tokenHoldersBps: number;
}

/** Today's behaviour, and the shipping default: no vault, no escrow, no extra
 *  contract, no extra gas, no new claim (OQ2). */
export const ZERO_FEE_SPLIT: FeeSplitArg = { holdersBps: 0, buybackBps: 0, tokenHoldersBps: 0 };

/** The three creator-side percentages of the QUOTE side, summing to exactly
 *  100. `burnPct` is the buy-back-and-burn column – see the header. */
export interface QuoteSideChoice {
  treasuryPct: number;
  holdersPct: number;
  burnPct: number;
}

/** What the block holds while the creator moves it. */
export interface FeeSplitChoice {
  quote: QuoteSideChoice;
  /** Percent of the TOKEN side routed to holders. The burn takes 100 - this. */
  tokenHoldersPct: number;
}

export const DEFAULT_FEE_SPLIT_CHOICE: FeeSplitChoice = {
  quote: { treasuryPct: 100, holdersPct: 0, burnPct: 0 },
  tokenHoldersPct: 0,
};

/** The row the review step and the token page print FIRST (D2): one
 *  denominator per side, every number as the contract enforces it. */
export interface EnforcedShares {
  platformBps: number;
  treasuryBps: number;
  holdersBps: number;
  buybackBps: number;
  tokenHoldersBps: number;
  tokenBurnBps: number;
}

/** Why a split cannot be signed, in the order the factory checks it
 *  (`LaunchFactory._validateSplit`), so the message names the revert that
 *  would actually fire first – plus `vanished`, which is the one problem the
 *  CHAIN does not have (see `validateFeeSplit`). */
export type FeeSplitProblem = 'sum' | 'tokenSum' | 'dust' | 'buyback' | 'vanished';

// --------------------------------------------------------- the conversion --

const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** The creator's part of the quote side: everything the platform did not take.
 *  Never negative, because `platformShareBps` is clamped 0..10000 upstream. */
export const creatorQuoteBps = (platformShareBps: number): number =>
  Math.max(0, BPS - Math.min(BPS, whole(platformShareBps)));

/**
 * D2's formula, in the one place that owns it.
 *
 *   holdersBps = round((10000 - platformShareBps) x holdersPct / 100)
 *
 * and `buybackBps` likewise. Treasury is never encoded: it is the remainder the
 * harvester computes last so no wei strands (D1).
 *
 * The two rounded legs are CLAMPED to the creator's part rather than trusted to
 * fit. At `platformShareBps = 1499` the creator's part is 8501 bps, and a
 * 50/50 split of it rounds to 4251 + 4251 = 8502 – one bps over, which the
 * factory rejects outright as `BadSplit`. Taking the second leg out of what the
 * first one left keeps the invariant exact at every share, and the bps that
 * rounding loses lands where every other remainder lands: the treasury.
 */
export function toFeeSplit(choice: FeeSplitChoice, platformShareBps: number): FeeSplitArg {
  const creator = creatorQuoteBps(platformShareBps);
  const holdersBps = Math.min(creator, Math.round(creator * whole(choice.quote.holdersPct) / 100));
  const buybackBps = Math.min(creator - holdersBps, Math.round(creator * whole(choice.quote.burnPct) / 100));
  return {
    holdersBps,
    buybackBps,
    // Bps of the WHOLE token side, so a whole percentage is exactly x100.
    tokenHoldersBps: Math.min(BPS, whole(choice.tokenHoldersPct) * 100),
  };
}

/**
 * The same formula backwards – for a draft restored from an old session, for a
 * launch read back off the chain, and for the creator-side row of a token page
 * that only has the enforced bps.
 *
 * Treasury is the remainder of the trio, so the three still sum to 100 exactly
 * even where rounding moved a point.
 */
export function fromFeeSplit(split: FeeSplitArg, platformShareBps: number): FeeSplitChoice {
  const creator = creatorQuoteBps(platformShareBps);
  const pct = (bps: number): number => (creator > 0 ? Math.round(whole(bps) * 100 / creator) : 0);
  const holdersPct = Math.min(100, pct(split.holdersBps));
  const burnPct = Math.min(100 - holdersPct, pct(split.buybackBps));
  return {
    quote: { treasuryPct: 100 - holdersPct - burnPct, holdersPct, burnPct },
    tokenHoldersPct: Math.min(100, Math.round(whole(split.tokenHoldersBps) / 100)),
  };
}

/** Every number the two rows print, on the two denominators they belong to. */
export function enforcedShares(split: FeeSplitArg, platformShareBps: number): EnforcedShares {
  const platformBps = Math.min(BPS, whole(platformShareBps));
  const holdersBps = whole(split.holdersBps);
  const buybackBps = whole(split.buybackBps);
  const tokenHoldersBps = whole(split.tokenHoldersBps);
  return {
    platformBps,
    // Computed last, exactly as the harvester computes it (D1).
    treasuryBps: Math.max(0, BPS - platformBps - holdersBps - buybackBps),
    holdersBps,
    buybackBps,
    tokenHoldersBps,
    tokenBurnBps: Math.max(0, BPS - tokenHoldersBps),
  };
}

/** True for the split that deploys no vault, no escrow and emits no event. */
export const isDefaultFeeSplit = (split: FeeSplitArg): boolean =>
  whole(split.holdersBps) === 0 && whole(split.buybackBps) === 0 && whole(split.tokenHoldersBps) === 0;

/**
 * `LaunchFactory._validateSplit` (`:585-604`), client-side, in its order.
 *
 * V1 the quote side cannot promise more than it takes; V2 the token side has
 * its own whole; V3 no dust share on any leg (D17); V4 no buy-back leg in v1
 * (D11). The D10 gate – no holders' share on a chain with no root registry –
 * is not repeated here: the block is not rendered at all where the backend does
 * not serve the feature (A6), and where it is served without a running
 * publisher (`holdersLegOn` below) the rows that would route to holders are
 * locked and the page encodes the default choice – a stronger answer than an
 * error message on a number the creator could not have moved.
 *
 * AND ONE PROBLEM THE FACTORY CANNOT HAVE, which is why `choice` is taken at
 * all. The conversion is a multiplication by the creator's part, so a share the
 * creator set and can read off the row converts to ZERO bps whenever that part
 * is too small to carry it – at `creatorShare = 0` (a 100 % platform share,
 * which `createValidate.ts` accepts) EVERY holders' percentage becomes 0. The
 * chain is perfectly happy with `{0, 0, 0}`: it is the default, it deploys no
 * vault and it reverts nothing. That is exactly the failure – the block would
 * show "Holders 30 %", raise nothing, and sign a launch that routes nothing.
 * Only the form knows a number was meant, so only this check can catch it, and
 * it runs BEFORE the dust rule because a vanished share is zero and the dust
 * rule exempts zero.
 */
export function validateFeeSplit(
  split: FeeSplitArg,
  platformShareBps: number,
  /** The percentages the creator actually moved, where they are still in hand.
   *  Omitted for a split read back off the chain, which carries no intention to
   *  compare against. */
  choice?: FeeSplitChoice,
): FeeSplitProblem | null {
  const s = enforcedShares(split, platformShareBps);
  if (s.platformBps + s.holdersBps + s.buybackBps > BPS) return 'sum';
  if (s.tokenHoldersBps > BPS) return 'tokenSum';
  if (choice && (
    (whole(choice.quote.holdersPct) > 0 && s.holdersBps === 0)
    || (whole(choice.quote.burnPct) > 0 && s.buybackBps === 0)
    || (whole(choice.tokenHoldersPct) > 0 && s.tokenHoldersBps === 0)
  )) return 'vanished';
  if (
    (s.holdersBps !== 0 && s.holdersBps < MIN_LIVE_SHARE_BPS)
    || (s.buybackBps !== 0 && s.buybackBps < MIN_LIVE_SHARE_BPS)
    || (s.tokenHoldersBps !== 0 && s.tokenHoldersBps < MIN_LIVE_SHARE_BPS)
  ) return 'dust';
  if (s.buybackBps !== 0) return 'buyback';
  return null;
}

// ------------------------------------------------------------- the presets --

/**
 * Four starting points, NAMED BY THEIR PARAMETERS and by nothing else
 * (CROWD_LAUNCH_SPEC.md:1327-1330). Their labels are literally the three
 * numbers they set – treasury / holders / burn – so there is no name to read a
 * promise into, and a label that stopped matching its numbers would be a
 * failing test rather than a marketing decision.
 *
 * They span the two levers, which is what makes four of them distinct while the
 * buy-back column is pinned at zero: the quote side goes to the creator or to
 * holders, and the token side burns whole or does not. `a` is the default and
 * is byte-for-byte today's behaviour – 100 % of the creator's quote part to
 * their own wallet, 100 % of the token side burned.
 */
export const FEE_SPLIT_PRESETS: readonly { id: string; choice: FeeSplitChoice }[] = [
  { id: 'a', choice: DEFAULT_FEE_SPLIT_CHOICE },
  { id: 'b', choice: { quote: { treasuryPct: 70, holdersPct: 30, burnPct: 0 }, tokenHoldersPct: 0 } },
  { id: 'c', choice: { quote: { treasuryPct: 50, holdersPct: 50, burnPct: 0 }, tokenHoldersPct: 25 } },
  { id: 'd', choice: { quote: { treasuryPct: 0, holdersPct: 100, burnPct: 0 }, tokenHoldersPct: 50 } },
];

/** The three numbers a preset's own label prints: treasury / holders / burn.
 *  The burn is the TOKEN side's remainder, which is why it is not simply the
 *  third member of the quote trio – see the header. */
export const presetLabelNumbers = (choice: FeeSplitChoice): [number, number, number] =>
  [choice.quote.treasuryPct, choice.quote.holdersPct, 100 - choice.tokenHoldersPct];

export const presetChoice = (id: string): FeeSplitChoice | null =>
  FEE_SPLIT_PRESETS.find((p) => p.id === id)?.choice ?? null;

/** Which preset a choice currently IS, or null once it has been nudged off one.
 *  Compared field by field rather than by a stored id, so a nudge back onto a
 *  preset's numbers lights that preset up again. */
export function matchPreset(choice: FeeSplitChoice): string | null {
  const same = (a: FeeSplitChoice, b: FeeSplitChoice) =>
    a.quote.treasuryPct === b.quote.treasuryPct
    && a.quote.holdersPct === b.quote.holdersPct
    && a.quote.burnPct === b.quote.burnPct
    && a.tokenHoldersPct === b.tokenHoldersPct;
  return FEE_SPLIT_PRESETS.find((p) => same(p.choice, choice))?.id ?? null;
}

// --------------------------------------------------------------- the nudge --

/** The three columns of the quote side, in the order they are drawn. */
export const QUOTE_ROWS = ['treasuryPct', 'holdersPct', 'burnPct'] as const;
export type QuoteRow = typeof QUOTE_ROWS[number];

/**
 * Move one column by `delta` and take the difference out of (or give it to) the
 * others, ONE POINT AT A TIME, so the three still sum to exactly 100.
 *
 * Buttons rather than a free field, for the reason the allocation step's weight
 * nudger gives: the only way a free field can hold a sum-to-100 invariant is by
 * silently rewriting what somebody typed. A nudge takes its point from a
 * neighbour, visibly.
 *
 * `locked` columns neither move nor contribute – which is how the buy-back
 * column sits at zero in v1 without the other two losing their invariant.
 * The move is TRIMMED rather than refused when the unlocked others cannot cover
 * it: at that point the button simply stops having an effect.
 */
export function nudgeQuoteSide(
  quote: QuoteSideChoice,
  row: QuoteRow,
  delta: number,
  locked: readonly QuoteRow[] = ['burnPct'],
): QuoteSideChoice {
  if (locked.includes(row)) return quote;
  const others = QUOTE_ROWS.filter((k) => k !== row && !locked.includes(k));
  if (others.length === 0) return quote;

  const next: Record<QuoteRow, number> = { ...quote };
  const want = Math.max(0, Math.min(100, next[row] + Math.round(delta)));
  let move = want - next[row];
  if (move === 0) return quote;

  if (move > 0) {
    // Take from the largest first, so a nudge never empties a small column
    // while a large one sits untouched.
    const order = [...others].sort((a, b) => next[b] - next[a]);
    let need = move;
    for (let guard = 0; need > 0 && guard <= 100; guard += 1) {
      let took = 0;
      for (const k of order) {
        if (need === 0) break;
        if (next[k] > 0) { next[k] -= 1; need -= 1; took += 1; }
      }
      if (took === 0) break;
    }
    move -= need;
  } else {
    const order = [...others].sort((a, b) => next[a] - next[b]);
    let give = -move;
    for (let guard = 0; give > 0 && guard <= 100; guard += 1) {
      let gave = 0;
      for (const k of order) {
        if (give === 0) break;
        if (next[k] < 100) { next[k] += 1; give -= 1; gave += 1; }
      }
      if (gave === 0) break;
    }
    move += give;
  }
  next[row] += move;
  return { treasuryPct: next.treasuryPct, holdersPct: next.holdersPct, burnPct: next.burnPct };
}

/** The token side is one number against its own whole, so it clamps rather than
 *  redistributing: the burn IS the remainder and has nothing to take from. */
export const nudgeTokenSide = (tokenHoldersPct: number, delta: number): number =>
  Math.max(0, Math.min(100, whole(tokenHoldersPct) + Math.round(delta)));

// ---------------------------------------------------------------- the gate --

/** As much of GET /api/v1/config as the fee-split predicates read (D21). A
 *  backend that predates the feature answers without these fields, and that
 *  has to read as "off" rather than as a parse error. */
export type FeeSplitConfigLike = {
  features?: Record<string, unknown> | null;
  contracts?: Record<string, unknown> | null;
} | null | undefined;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A config field that has to be an address before it can be one. A backend
 *  answering `false`, `0` or an object for it is answering "off", never "here
 *  is where to send the money". */
const addressField = (bag: Record<string, unknown> | null | undefined, key: string): string | null => {
  const v = bag?.[key];
  return typeof v === 'string' && ADDRESS.test(v) ? v : null;
};

/**
 * THE generation-3 LaunchFactory a first-party create is sent to, or null for
 * "stay on generation 2 exactly as today".
 *
 * WHY A NEW GATE (option B, 2026-09-23). The backend's `contracts.launchFactory`
 * keeps its generation-2 meaning FOR EVER: pinned SDK bundles bake the
 * generation-2 factory in at build time and third parties encode against the
 * published one, so the name can never be repointed. The previous gate here –
 * "`launchFactoryG3` equals the served `launchFactory`" – could therefore never
 * open. First-party clients opt in through ADDITIVE fields instead, and every
 * one of these is load bearing:
 *
 *  1. `features.storefrontG3 === true` – the running backend says first-party
 *     clients should create on generation 3. Absent (a backend from before the
 *     field) is off.
 *  2. `staticG3` – this build's registry names a generation-3 factory for its
 *     chain (lib/config.ts STATIC_LAUNCH_FACTORY_G3). Null on Stable 988, which
 *     has none, whatever its backend says.
 *  3. `contracts.launchFactoryG3` IS that address. The three deployments boot
 *     from one env template, and a backend naming another address (a stale
 *     line, another chain's factory) is "off", never a destination – the same
 *     rule STATIC_CROWD_FACTORY applies to the crowd factory.
 *
 * The selector is what makes this all-or-nothing: generation 3 appends the
 * FeeSplit argument, so a generation-3 tuple sent to the generation-2 factory
 * (or the reverse) does not revert with a wrong split – it does not decode.
 *
 * Case is not identity (a deploy record is lower-case, the registry EIP-55),
 * so the comparison ignores it, and the REGISTRY's spelling comes back: it is
 * the one tests/storefront-g3.test.mjs holds to EIP-55, so a create is never
 * addressed with a checksum the backend mistyped.
 *
 * `staticG3` is a parameter rather than an import so this module stays free of
 * lib/config and `node --test` keeps calling it directly.
 */
export function g3LaunchFactoryFor(cfg: FeeSplitConfigLike, staticG3: string | null | undefined): string | null {
  if (cfg?.features?.storefrontG3 !== true) return null;
  if (typeof staticG3 !== 'string' || !ADDRESS.test(staticG3)) return null;
  const served = addressField(cfg?.contracts, 'launchFactoryG3');
  if (!served || served.toLowerCase() !== staticG3.toLowerCase()) return null;
  return staticG3;
}

/**
 * Is "Where does the pool fee go?" offered at all?
 *
 * The create goes to generation 3 (above) AND the backend has the feature on
 * (`features.feeSplit`) – it is what indexes `FeeSplitSet` and prints the split
 * back on the token page, so a split this host would never show is not a
 * question worth asking. Without it a generation-3 create still happens, with
 * the default {0, 0, 0} and the review rows of today (D22: absence and zero
 * must not render alike).
 *
 * A6 settles what "off" looks like: no block, not a greyed one.
 */
export function feeSplitBlockOn(cfg: FeeSplitConfigLike, staticG3: string | null | undefined): boolean {
  return g3LaunchFactoryFor(cfg, staticG3) !== null && cfg?.features?.feeSplit === true;
}

/**
 * May the block route anything to HOLDERS – the quote side's holders' part or
 * the token side's (D10)?
 *
 * Only where `features.holdersPublisher` says the leg is really paid: the
 * rewards registry is set, the publisher key runs and the Transfer index is on.
 * A holders' part on a chain without that is a vault that accumulates and pays
 * nobody – and the factory itself answers HoldersUnavailable where the registry
 * is missing. Every non-default preset routes to holders and the buy-back leg
 * is refused in v1 (D11), so with this off the block has nothing to offer but
 * the default: it says so in one line and locks the rows that would route.
 */
export function holdersLegOn(cfg: FeeSplitConfigLike, staticG3: string | null | undefined): boolean {
  return feeSplitBlockOn(cfg, staticG3) && cfg?.features?.holdersPublisher === true;
}

/**
 * The owner-set split a generation-3 CrowdFactory creates EVERY raise with,
 * read back from its `feeSplit()` getter (three uint16s), or null for an answer
 * that is not one.
 *
 * `createCrowdLaunch` reverts `BadConfig()` unless the FeeSplit argument equals
 * this field for field (CrowdFactory.sol V8/D15): on a raise even the numbers
 * are the platform's, and the caller states the one it was quoted so the owner
 * cannot move the terms between the quote and the signature. So the page never
 * guesses it – a guessed {0, 0, 0} against a non-zero setting is a revert, and
 * against a zero one it is right only by luck – it reads it next to `termsFor`
 * and passes exactly what came back. viem answers a multi-output view as a
 * tuple; the named-object shape is accepted as well.
 */
export function feeSplitFromTuple(raw: unknown): FeeSplitArg | null {
  const pick = (v: unknown): number | null => {
    const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isInteger(n) && n >= 0 && n <= BPS ? n : null;
  };
  let parts: unknown[] | null = null;
  if (Array.isArray(raw)) parts = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    parts = [o.holdersBps, o.buybackBps, o.tokenHoldersBps];
  }
  if (!parts || parts.length !== 3) return null;
  const [h, b, t] = parts.map(pick);
  if (h === null || b === null || t === null) return null;
  return { holdersBps: h, buybackBps: b, tokenHoldersBps: t };
}

/** Field-for-field equality – the comparison `createCrowdLaunch` makes. */
export const sameFeeSplit = (a: FeeSplitArg | null | undefined, b: FeeSplitArg | null | undefined): boolean =>
  Boolean(a && b)
  && a!.holdersBps === b!.holdersBps
  && a!.buybackBps === b!.buybackBps
  && a!.tokenHoldersBps === b!.tokenHoldersBps;

/**
 * Can the Review print this generation-3 raise split?
 *
 * A split that routes nothing ({0, 0, 0}) prints no row and needs nothing more.
 * A split that routes something is printed on the whole quote side
 * (`enforcedQuoteLine`), so it needs the factory's `platformShareBps()` too.
 * A split the Review cannot print is a split the creator never saw, so the page
 * treats it as no terms at all and disables the button, the same way it treats
 * a `feeSplit()` that did not answer. Hiding the row there instead would let a
 * routed split be signed without ever being shown: it is calldata, so the
 * wallet does not show it either.
 */
export const crowdSplitPrintable = (
  split: FeeSplitArg | null | undefined,
  platformShareBps: number | null | undefined,
): boolean =>
  Boolean(split)
  && (isDefaultFeeSplit(split!)
    || (typeof platformShareBps === 'number' && Number.isInteger(platformShareBps)
      && platformShareBps >= 0 && platformShareBps <= BPS));

/**
 * Is the split a generation-3 raise is about to be signed with the split the
 * Review showed?
 *
 * `createCrowdLaunch` reverts BadConfig() unless the caller states the
 * factory's current split (V8), so the caller has to say which terms it was
 * quoted. That only protects the creator if the stated split is also the one
 * they read. The submit reads `feeSplit()` fresh, so the owner could have moved
 * it after the Review was drawn. It asks this before it builds the call, and
 * on a "no" it redraws the Review with the new split and waits for another
 * press. It never signs a split the creator has not seen.
 */
export function crowdSplitReviewed(
  signing: FeeSplitArg | null | undefined,
  reviewed: { split: FeeSplitArg | null; platformShareBps: number | null } | null | undefined,
): boolean {
  return Boolean(reviewed)
    && sameFeeSplit(signing, reviewed!.split)
    && crowdSplitPrintable(signing, reviewed!.platformShareBps);
}

/**
 * The fee-split half of a REST-prepared launch session (LaunchSession.tsx), or
 * the verdict that it cannot be signed.
 *
 * POST /v1/launches/quote targets the generation-3 factory itself when it is
 * handed a `feeSplit` (option B: `launchFactory` stays generation 2 for every
 * caller that does not ask). The two halves have to arrive TOGETHER – the
 * argument moves the selector, so a split without the generation-3 factory, or
 * that factory without a split, is a call that does not decode rather than a
 * launch with a wrong split. A session is immutable and bound by configHash, so
 * the page does not repair either half: `ok: false` and it refuses.
 *
 * `isG3` is the ADDRESS the session names against this build's registry
 * (lib/config.ts STATIC_LAUNCH_FACTORY_G3, passed in so this stays pure) – never
 * the mere presence of the field. The split may sit at the top level of the
 * session or inside its `quote`, whichever the backend writes.
 *
 * The session's own `generation` (the entry point the backend says `factory`
 * speaks) is a third witness where it is present, and it has to agree with the
 * address: 3 only for this build's generation-3 factory, below 3 only for any
 * other. A session that names one generation and addresses the other – or
 * names one this build does not know – is refused like a split mismatch. A
 * backend that predates the field is judged by the address alone.
 *
 * WHERE THE TWO FIELDS LIVE (agreed 2026-09-23, backend v1.js sessionView): at
 * the session's TOP level – `generation: 3` and `feeSplit` on every
 * generation-3 session, both absent on generation 2, which is served byte for
 * byte as before. The frozen quote keeps its own copy (`quote.generation`,
 * `quote.feeSplit`: 2 / null on generation 2). Either place is read, and where
 * BOTH are present they must say the same thing – two answers to "which split
 * is signed" is a session that is not signed at all.
 */
export function sessionFeeSplit(
  s: { quote: { factory?: unknown; feeSplit?: unknown; generation?: unknown }; feeSplit?: unknown; generation?: unknown },
  staticG3: string | null | undefined,
): { isG3: boolean; split: FeeSplitArg | null; ok: boolean } {
  const factory = s.quote.factory;
  const isG3 = typeof staticG3 === 'string' && ADDRESS.test(staticG3)
    && typeof factory === 'string' && factory.toLowerCase() === staticG3.toLowerCase();
  const top = s.feeSplit, inner = s.quote.feeSplit;
  const raw = top ?? inner ?? null;
  const split = raw == null ? null : feeSplitFromTuple(raw);
  // `undefined` = not written there; `null` = written as "no split".
  const splitsAgree = top === undefined || inner === undefined
    || (top === null ? inner === null : inner !== null && sameFeeSplit(feeSplitFromTuple(top), feeSplitFromTuple(inner)));
  const gensAgree = s.generation === undefined || s.quote.generation === undefined || s.generation === s.quote.generation;
  const gen = s.generation ?? s.quote.generation;
  const genAgrees = gen == null
    || (typeof gen === 'number' && Number.isInteger(gen) && (isG3 ? gen === 3 : gen < 3));
  // A field that is present and does not parse is as good as a wrong one.
  const ok = splitsAgree && gensAgree && genAgrees && (isG3 ? split !== null : raw == null);
  return { isG3, split, ok };
}
