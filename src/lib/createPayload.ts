/* The exact factory arguments a draft produces.
 *
 * ONE builder feeds both the Review step and the transaction, so the summary
 * the creator approves is literally the struct that is signed (ACCEPTANCE.md:
 * "Review совпадает с реальным payload"). Nothing here reads React state or the
 * network: give it a normalized draft plus the live economics and it is pure.
 *
 * Every amount is base units of the asset the launch is denominated in – the
 * chain's coin (18) or the quote asset's own decimals. Token amounts are always
 * 18-decimal: that is what our token contracts mint.
 */
import { parseEther, parseUnits } from 'viem';
// Explicit .ts extension: `node --test` imports this module directly (type
// stripping), and node does not resolve extensionless specifiers.
import { num, teamVestingDaysOf, CROWD_MIN_DAYS, type CreateDraft } from './createValidate.ts';
import { DEADLINE_MARGIN } from './crowdMath.ts';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
export const ZERO_SALT = `0x${'0'.repeat(64)}` as `0x${string}`;
/** The UI counts "Ethereum blocks"; the contract counts seconds. */
export const ETH_BLOCK_SEC = 12;

const PLAIN_DECIMAL = /^\d*\.?\d*$/;

/** A typed amount as base units, without ever throwing on a half-typed field.
 *  Digits the asset cannot represent are dropped, not rounded up: the factory
 *  is never asked for more than the creator saw. */
export function amountUnits(raw: string | number, decimals: number): bigint {
  const s = String(raw).trim();
  if (s === '') return 0n;
  if (PLAIN_DECIMAL.test(s)) {
    const [whole, frac = ''] = s.split('.');
    return parseUnits(`${whole || '0'}.${frac.slice(0, decimals)}`, decimals);
  }
  const n = num(s);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return parseUnits(n.toFixed(decimals), decimals);
}

/** Whole tokens -> 18-decimal base units. A half-typed field renders as 0 here
 *  (the Review runs on every keystroke); the submit path is gated by
 *  validateDraft, so 0 can never be signed by accident. */
const tokens = (whole: number): bigint =>
  (Number.isFinite(whole) ? parseEther(String(Math.max(0, Math.floor(whole)))) : 0n);

/** A field's number, or 0 while it is empty / half-typed. */
const n0 = (v: string | number): number => {
  const n = num(v);
  return Number.isFinite(n) ? n : 0;
};

/** The two optional anti-snipe layers as whole tokens/second. 0 = layer off. */
export function antiSnipe(draft: CreateDraft, saleSupply: number): { ramp: number; capRate: number } {
  const totalSupply = num(draft.supply);
  const typed = num(draft.rampRate);
  const presetRamp = Math.ceil(saleSupply / (draft.antiPreset === 'hardcore' ? 86400 : 41400));
  const ramp = draft.rampEnabled ? (Number.isFinite(typed) && typed > 0 ? typed : presetRamp) : 0;
  const capPct = num(draft.walletCap);
  const capBlocks = num(draft.capBlocks);
  const capRate = draft.capEnabled && Number.isFinite(capPct) && capBlocks > 0
    ? Math.floor((capPct / 100) * totalSupply / (capBlocks * ETH_BLOCK_SEC))
    : 0;
  return { ramp, capRate };
}

/** UI "Creator share" -> the contract's platform share. The names are inverses:
 *  the form shows what the creator keeps, the factory stores what the platform
 *  gets (docs/INTEGRATION-MAP.md §3). */
export const platformShareBps = (creatorShare: string | number): number =>
  Math.min(10000, Math.max(0, Math.round((100 - n0(creatorShare)) * 100)));

/** A `datetime-local` value as a UTC unix second. 0 = start at deployment, and
 *  an unparseable value is 0 too – validateDraft refuses to submit it. */
export function startSeconds(local: string): number {
  if (!local) return 0;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export interface PayloadInput {
  /** MUST be normalizeDraft(draft) – inactive fields at their defaults. */
  draft: CreateDraft;
  /** Decimals of the asset the launch is paid in (18 native). */
  decimals: number;
  /** null = native launch; otherwise the quote asset's address. */
  quoteAddress: `0x${string}` | null;
  /** Connected wallet – the default fee recipient / team beneficiary. */
  account: `0x${string}` | null;
  referrer: `0x${string}` | null;
  /** Mined CREATE2 salt, or null for the zero salt. */
  salt: `0x${string}` | null;
  /** Vanity tier price in the paying asset's base units (0 when free/unused). */
  vanityFeeWei: bigint;
  poolFeeTier: number;
  // ---- fair launch only ----
  saleSupply: number;
  priceMultiple: number;
  /** Listing target in NATIVE units. Quote launches send 0: the factory reads
   *  the registry and rejects a caller-supplied target (spec §11c). */
  targetEth: number;
  /** Starting FDV in the paying asset – the token-only instant start price. */
  startFdv: number;
}

export interface CurveParams {
  name: string; symbol: string;
  totalSupply: bigint; saleSupply: bigint;
  curveType: 0 | 1 | 2; priceMultiple: bigint; targetEth: bigint;
  buyFeeBps: number; sellFeeBps: number; platformShareBps: number;
  feeRecipient: `0x${string}`; sellsEnabled: boolean; startTime: bigint;
  walletCapFloor: bigint; walletCapPerSec: bigint; globalRampPerSec: bigint;
  poolFeeTier: number;
  teamAllocation: bigint; teamBeneficiary: `0x${string}`; teamVestingDuration: bigint;
  devBuyEth: bigint;
  salt: `0x${string}`; vanityFeeWei: bigint;
}

export interface DirectParams {
  name: string; symbol: string;
  totalSupply: bigint; poolBps: number;
  feeRecipient: `0x${string}`; poolFeeTier: number;
  startPriceWei: bigint;
  salt: `0x${string}`; vanityFeeWei: bigint;
  platformShareBps: number; referrer: `0x${string}`;
}

export function buildCurveParams(input: PayloadInput): CurveParams {
  const d = input.draft;
  const total = num(d.supply);
  const teamPct = num(d.teamAllocation);
  const { ramp, capRate } = antiSnipe(d, input.saleSupply);
  return {
    name: d.name.trim(),
    symbol: d.ticker.trim().toUpperCase(),
    totalSupply: tokens(total),
    saleSupply: tokens(input.saleSupply),
    curveType: d.curveType,
    priceMultiple: BigInt(Math.round(input.priceMultiple)),
    targetEth: input.quoteAddress ? 0n : parseEther(String(input.targetEth)),
    buyFeeBps: Math.round(n0(d.buyFee) * 100),
    sellFeeBps: Math.round(n0(d.sellFee) * 100),
    platformShareBps: platformShareBps(d.creatorShare),
    feeRecipient: (d.feeRecipient.trim() || ZERO_ADDRESS) as `0x${string}`,
    sellsEnabled: d.allowSells,
    startTime: BigInt(startSeconds(d.startTime)),
    walletCapFloor: 0n,
    walletCapPerSec: tokens(capRate),
    globalRampPerSec: tokens(ramp),
    poolFeeTier: input.poolFeeTier,
    teamAllocation: tokens(total * n0(teamPct) / 100),
    teamBeneficiary: (d.teamWallet.trim() || input.account || ZERO_ADDRESS) as `0x${string}`,
    teamVestingDuration: BigInt(teamPct > 0 ? Math.round(n0(d.vestingMonths)) * 30 * 86400 : 0),
    devBuyEth: amountUnits(d.developerBuy, input.decimals),
    salt: input.salt ?? ZERO_SALT,
    vanityFeeWei: input.vanityFeeWei,
  };
}

export function buildDirectParams(input: PayloadInput): DirectParams {
  const d = input.draft;
  const total = num(d.supply);
  const seed = amountUnits(d.seedLiquidity, input.decimals);
  return {
    name: d.name.trim(),
    symbol: d.ticker.trim().toUpperCase(),
    totalSupply: tokens(total),
    poolBps: Math.round(n0(d.poolSupply) * 100),
    feeRecipient: (d.feeRecipient.trim() || ZERO_ADDRESS) as `0x${string}`,
    poolFeeTier: input.poolFeeTier,
    // A seeded pool prices itself from the liquidity ratio; a token-only pool
    // takes the platform's starting FDV. Base units per WHOLE token.
    startPriceWei: seed > 0n || !(total > 0)
      ? 0n
      : BigInt(Math.round(input.startFdv * 10 ** input.decimals / total)),
    salt: input.salt ?? ZERO_SALT,
    vanityFeeWei: input.vanityFeeWei,
    platformShareBps: platformShareBps(d.creatorShare),
    referrer: (input.referrer ?? ZERO_ADDRESS) as `0x${string}`,
  };
}

/** Seeded liquidity in base units – the value/allowance leg of an instant
 *  listing, kept next to the struct it belongs to. */
export const seedUnits = (input: PayloadInput): bigint =>
  amountUnits(input.draft.seedLiquidity, input.decimals);

// ------------------------------------------------------------------- crowd --

/**
 * `CrowdParams`, all 26 fields in DECLARATION ORDER (CrowdFactory.sol:155-187).
 * A tuple is positional: one field moved is a different launch, not a type
 * error, so this interface is written in the contract's order and read straight
 * into `crowdFactoryAbi`'s struct.
 */
export interface CrowdParams {
  name: string;
  symbol: string;
  salt: `0x${string}`;
  quote: `0x${string}`;
  feeRecipient: `0x${string}`;
  teamBeneficiary: `0x${string}`;
  pricePerToken: bigint;
  hardCap: bigint;
  softCap: bigint;
  minContribution: bigint;
  perWalletCap: bigint;
  totalSupply: bigint;
  allowlistRoot: `0x${string}`;
  metadataHash: `0x${string}`;
  deadline: bigint;
  extensionSeconds: bigint;
  vestingDuration: bigint;
  vestingInterval: bigint;
  teamVestingDuration: bigint;
  participantVesting: bigint;
  extensionMinBps: number;
  poolBps: number;
  crowdTokensBps: number;
  listingPremiumBps: number;
  teamTokensBps: number;
  poolFeeTier: number;
}

export interface CrowdPayloadInput {
  /** MUST be normalizeDraft(draft). */
  draft: CreateDraft;
  /** Decimals of the raise currency (18 native). */
  decimals: number;
  /** null = the raise is denominated in the chain's coin. */
  quoteAddress: `0x${string}` | null;
  /**
   * keccak256 of exactly the bytes the metadata endpoint pinned. The field is
   * immutable on chain, so it is never computed here from a re-serialised copy
   * of the form: a hash that does not match the pinned document makes the
   * binding decorative (plan §3.1, Q3).
   */
  metadataHash: `0x${string}`;
  /**
   * `block.timestamp` of a FRESHLY read block – not Date.now(). The factory
   * checks the deadline against the block that mines the create, and the
   * browser's clock is not that clock.
   */
  chainNow: number;
  poolFeeTier: number;
  /**
   * Is the raise currency volatile? It bounds the WHOLE announced window –
   * 14 days instead of 60 – and it comes from `termsFor(quote).volatileQuote`,
   * never from "is a pair selected": `nativeQuoteVolatile` is true on the live
   * factory, so a native raise is a volatile one.
   *
   * Omitting it assumes the SHORTER ceiling on purpose: the only thing the
   * ceiling does here is clip the safety margin, and clipping it when it was
   * not needed costs half an hour of raise, while not clipping it when it was
   * needed is a `BadConfig()` on the upper bound.
   */
  volatileQuote?: boolean;
}

const MAX_CROWD_DURATION = 60 * 86_400;
const MAX_CROWD_DURATION_VOLATILE = 14 * 86_400;

/** Whole days of a crowd raise, floored at CROWD_MIN_DAYS. */
const crowdDays = (raw: string | number): number => {
  const n = num(raw);
  return Number.isFinite(n) ? Math.max(CROWD_MIN_DAYS, Math.floor(n)) : CROWD_MIN_DAYS;
};
const days = (raw: string | number): bigint => {
  const n = num(raw);
  return BigInt(Number.isFinite(n) && n > 0 ? Math.floor(n) * 86_400 : 0);
};
const bps = (raw: string | number): number => Math.round(n0(raw) * 100);

/**
 * The 26 arguments a crowd launch is created with – the ONE builder, so the
 * Review step and the transaction cannot disagree (plan §3.1).
 *
 * Three of the fields are not the form's numbers and are worth naming:
 *  - `totalSupply` is ALWAYS 0. The factory derives the supply from the price
 *    and the shares and rejects any other value outright (`_derive`'s first
 *    line); the draft's `supply` belongs to the other two modes and must not
 *    travel here.
 *  - `deadline` is ABSOLUTE, and built with DEADLINE_MARGIN of slack on top of
 *    the chosen length. The margin beats the launch session's TTL, not the
 *    block time: the gap between reading a block and mining the create is
 *    minutes, not seconds, and the whole cost of missing it is paid AFTER the
 *    metadata, the approval and the simulation. It is CLIPPED at the ceiling,
 *    because the two bounds of CrowdFactory.sol:566 pull in opposite
 *    directions: staleness only ever helps the upper one, so a raise asked for
 *    at the maximum length gets the maximum length and no slack.
 *  - `teamVestingDuration` equals `vestingDuration`. The contract demands
 *    `>=` and this slice has no separate control (`teamVestingDaysOf`).
 */
export function buildCrowdParams(input: CrowdPayloadInput): CrowdParams {
  const d = input.draft;
  const dec = input.decimals;
  const vesting = days(d.crowdVestingDays);
  return {
    name: d.name.trim(),
    symbol: d.ticker.trim().toUpperCase(),
    // No vanity for a crowd launch in this slice: CrowdTokenDeployer salts with
    // keccak256(abi.encode(creator, salt)), which the current miner cannot
    // invert – reusing its output would buy an address the deployer never
    // produces (plan §3.1).
    salt: ZERO_SALT,
    quote: input.quoteAddress ?? ZERO_ADDRESS,
    // address(0) = msg.sender, which is what the factory substitutes.
    feeRecipient: ZERO_ADDRESS,
    teamBeneficiary: (d.teamWallet.trim() || ZERO_ADDRESS) as `0x${string}`,
    pricePerToken: amountUnits(d.pricePerToken, dec),
    hardCap: amountUnits(d.hardCap, dec),
    softCap: amountUnits(d.softCap, dec),
    minContribution: amountUnits(d.minContribution, dec),
    perWalletCap: amountUnits(d.perWalletCap, dec),
    totalSupply: 0n,
    allowlistRoot: (d.allowlistRoot.trim() || ZERO_SALT) as `0x${string}`,
    metadataHash: input.metadataHash,
    deadline: BigInt(input.chainNow + Math.min(
      crowdDays(d.crowdDays) * 86_400 + DEADLINE_MARGIN,
      input.volatileQuote === false ? MAX_CROWD_DURATION : MAX_CROWD_DURATION_VOLATILE,
    )),
    // A prepaid extension is not sold in this slice, so both of its fields are
    // zero – and with them the extra 14-day rule of CrowdFactory.sol:577.
    extensionSeconds: 0n,
    vestingDuration: vesting,
    vestingInterval: days(d.crowdVestingInterval),
    teamVestingDuration: days(teamVestingDaysOf(d)),
    participantVesting: days(d.participantVesting),
    extensionMinBps: 0,
    poolBps: bps(d.crowdPool),
    crowdTokensBps: bps(d.crowdTokens),
    listingPremiumBps: bps(d.listingPremium),
    teamTokensBps: bps(d.crowdTeamTokens),
    poolFeeTier: input.poolFeeTier,
  };
}
