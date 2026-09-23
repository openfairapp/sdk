import { parseAbi } from 'viem';
// The argument and the event are transcribed ONCE, in lib/feeSplit.ts, next to
// the arithmetic that fills them in. This module only composes the two
// generation-3 entry points around them.
// Explicit .ts extension, as in lib/createPayload.ts: `node --test` imports
// this module directly (type stripping) and node does not resolve an
// extensionless specifier.
import { FEE_SPLIT_STRUCT, FEE_SPLIT_SET_EVENT } from './feeSplit.ts';

/*
 * The generation-3 factory surface: the two create entry points that take the
 * enforced fee split, and the one event they emit (FEE_SPLIT_DESIGN §D15,
 * §D21).
 *
 * Generation 3 appends ONE argument to both create entry points – the
 * `FeeSplit` the harvester is built with – and emits `FeeSplitSet` beside the
 * existing creation event. Nothing else moves: the params structs are the
 * generation the chain already runs, byte for byte, because a new field INSIDE
 * them would change `LaunchCreated`'s topic0 and cost a hand-written legacy
 * decoder in nine places across the backend, this bundle and the SDK. A
 * separate argument changes only the function SELECTOR, so every existing
 * decoder in lib/abi.ts stays valid and untouched.
 *
 * That selector change is also why these are separate exports rather than a
 * flag on the generation-2 ones: a generation-3 tuple sent to the live
 * generation-2 factory does not revert with a wrong split, it does not decode
 * at all. The create path picks by ADDRESS (lib/feeSplit.ts g3LaunchFactoryFor)
 * – the extra argument travels only to the generation-3 factory, and only
 * while the backend says features.storefrontG3 and names this build's own
 * generation-3 address (option B: `contracts.launchFactory` stays generation 2
 * for ever).
 *
 * ITS OWN MODULE, NOT AN ADDITION TO lib/abi.ts, and the reason is mechanical
 * rather than tidy – it is the same one lib/holdersVaultAbi.ts, lib/crowdAbi.ts
 * and lib/airdropAbi.ts each state at length. `sdk/core.ts` imports lib/abi.ts;
 * `parseAbi([...])` is a top-level call with no side-effect annotation, so
 * esbuild cannot drop it from the SDK bundle even though the SDK calls none of
 * these; and public/sdk/openfair.js is pinned byte for byte against
 * public/sdk/v<SDK_VERSION>/ by `verify:sdk-pins`. Three tuples added to
 * lib/abi.ts therefore rewrite a RELEASED, immutable artefact under an
 * unchanged SDK_VERSION – measured at 2 874 bytes of generation-3 ABI in a
 * bundle that references none of it – and `release:sdk` then throws until the
 * version is bumped.
 *
 * TWO LINEAGES, as in lib/abi.ts: the shared lineage (Robinhood 4663) carries
 * the quote fields appended last to both structs, the stable one (Arc 5042,
 * Stable 988) has no `quote` field at all in either. Each keeps the struct
 * shape of its own lineage and adds the same argument.
 * tests/fee-split-create.test.mjs re-reads contracts/src/**\/LaunchFactory.sol
 * and fails on a transcription slip.
 */

/** Generation 3, STABLE lineage: the pre-quote structs plus the FeeSplit. */
export const factoryG3Abi = parseAbi([
  FEE_SPLIT_STRUCT,
  'struct CreateParams3 { string name; string symbol; uint256 totalSupply; uint256 saleSupply; uint8 curveType; uint256 priceMultiple; uint256 targetEth; uint16 buyFeeBps; uint16 sellFeeBps; uint16 platformShareBps; address feeRecipient; bool sellsEnabled; uint64 startTime; uint256 walletCapFloor; uint256 walletCapPerSec; uint256 globalRampPerSec; uint24 poolFeeTier; uint256 teamAllocation; address teamBeneficiary; uint64 teamVestingDuration; uint256 devBuyEth; bytes32 salt; uint256 vanityFeeWei; }',
  'function createLaunch(CreateParams3 p, FeeSplit s, address referrer, string metadataCID) payable returns (address, address, address)',
  'struct DirectParams3 { string name; string symbol; uint256 totalSupply; uint16 poolBps; address feeRecipient; uint24 poolFeeTier; uint256 startPriceWei; bytes32 salt; uint256 vanityFeeWei; uint16 platformShareBps; address referrer; }',
  'function createDirectListing(DirectParams3 p, FeeSplit s, string metadataCID) payable returns (address, address, address)',
  'error WrongPayment(uint256 sent, uint256 required)',
  'error VanityNotAllowed()',
  'error BadConfig()',
  'error SelfReferral()',
  'error EthSendFailed()',
  'error BadSplit()',
  'error BuybackUnavailable()',
  'error HoldersUnavailable()',
]);

/** Generation 3, SHARED lineage: the quote-pairs structs plus the FeeSplit. */
export const factoryQuoteG3Abi = parseAbi([
  FEE_SPLIT_STRUCT,
  'struct CreateParamsQ3 { string name; string symbol; uint256 totalSupply; uint256 saleSupply; uint8 curveType; uint256 priceMultiple; uint256 targetEth; uint16 buyFeeBps; uint16 sellFeeBps; uint16 platformShareBps; address feeRecipient; bool sellsEnabled; uint64 startTime; uint256 walletCapFloor; uint256 walletCapPerSec; uint256 globalRampPerSec; uint24 poolFeeTier; uint256 teamAllocation; address teamBeneficiary; uint64 teamVestingDuration; uint256 devBuyEth; bytes32 salt; uint256 vanityFeeWei; address quote; }',
  'function createLaunch(CreateParamsQ3 p, FeeSplit s, address referrer, string metadataCID) payable returns (address, address, address)',
  'struct DirectParamsQ3 { string name; string symbol; uint256 totalSupply; uint16 poolBps; address feeRecipient; uint24 poolFeeTier; uint256 startPriceWei; bytes32 salt; uint256 vanityFeeWei; uint16 platformShareBps; address referrer; address quote; uint256 liquidityQuote; }',
  'function createDirectListing(DirectParamsQ3 p, FeeSplit s, string metadataCID) payable returns (address, address, address)',
  'error WrongPayment(uint256 sent, uint256 required)',
  'error VanityNotAllowed()',
  'error BadConfig()',
  'error SelfReferral()',
  'error EthSendFailed()',
  'error QuoteNotAllowed(address quote)',
  'error QuoteTransferMismatch()',
  'error BadSplit()',
  'error BuybackUnavailable()',
  'error HoldersUnavailable()',
]);

/** The one new log a generation-3 create emits, and only when the split routes
 *  something: absence means "this launch routed nothing", and on the old fleet
 *  – which never had the question put to it – the event does not exist at all
 *  (§D22: absence and zero must never render alike). */
export const feeSplitSetEventAbi = parseAbi([FEE_SPLIT_SET_EVENT]);
