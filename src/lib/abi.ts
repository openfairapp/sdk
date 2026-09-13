import { parseAbi } from 'viem';

export const launchCreatedEventAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256) params)',
]);

export const factoryAbi = parseAbi([
  'struct CreateParams { string name; string symbol; uint256 totalSupply; uint256 saleSupply; uint8 curveType; uint256 priceMultiple; uint256 targetEth; uint16 buyFeeBps; uint16 sellFeeBps; uint16 platformShareBps; address feeRecipient; bool sellsEnabled; uint64 startTime; uint256 walletCapFloor; uint256 walletCapPerSec; uint256 globalRampPerSec; uint24 poolFeeTier; uint256 teamAllocation; address teamBeneficiary; uint64 teamVestingDuration; uint256 devBuyEth; bytes32 salt; uint256 vanityFeeWei; }',
  'function createLaunch(CreateParams p, address referrer, string metadataCID) payable returns (address, address, address)',
  // v1.9: + referrer (instant-listing referral – half of the platform's LP-fee cut)
  'struct DirectParams { string name; string symbol; uint256 totalSupply; uint16 poolBps; address feeRecipient; uint24 poolFeeTier; uint256 startPriceWei; bytes32 salt; uint256 vanityFeeWei; uint16 platformShareBps; address referrer; }',
  'function createDirectListing(DirectParams p, string metadataCID) payable returns (address, address, address)',
  'function deployFee() view returns (uint256)',
  'function supporterFeeBps() view returns (uint16)', // v1.9 knob: 5000 = half, 0 = free
  'function updateMetadata(address token, string metadataCID)',
  // custom errors – so viem can decode a reverted simulate into a real reason
  'error WrongPayment(uint256 sent, uint256 required)',
  'error VanityNotAllowed()',
  'error BadConfig()',
  'error SelfReferral()',
  'error EthSendFailed()',
]);

// Quote-pairs factory (spec §2): the same two entry points with the quote
// fields appended LAST to both structs, so an encoder written for the ABI above
// stays byte-valid. Used ONLY for a launch paired with an allow-listed ERC-20 –
// a native launch keeps encoding against `factoryAbi`, unchanged.
// In quote mode targetEth must be 0 (the registry sets the target), msg.value
// must be 0, and devBuyEth / vanityFeeWei / liquidityQuote are amounts of the
// quote asset, which the factory pulls with transferFrom.
export const factoryQuoteAbi = parseAbi([
  'struct CreateParamsQ { string name; string symbol; uint256 totalSupply; uint256 saleSupply; uint8 curveType; uint256 priceMultiple; uint256 targetEth; uint16 buyFeeBps; uint16 sellFeeBps; uint16 platformShareBps; address feeRecipient; bool sellsEnabled; uint64 startTime; uint256 walletCapFloor; uint256 walletCapPerSec; uint256 globalRampPerSec; uint24 poolFeeTier; uint256 teamAllocation; address teamBeneficiary; uint64 teamVestingDuration; uint256 devBuyEth; bytes32 salt; uint256 vanityFeeWei; address quote; }',
  'function createLaunch(CreateParamsQ p, address referrer, string metadataCID) payable returns (address, address, address)',
  'struct DirectParamsQ { string name; string symbol; uint256 totalSupply; uint16 poolBps; address feeRecipient; uint24 poolFeeTier; uint256 startPriceWei; bytes32 salt; uint256 vanityFeeWei; uint16 platformShareBps; address referrer; address quote; uint256 liquidityQuote; }',
  'function createDirectListing(DirectParamsQ p, string metadataCID) payable returns (address, address, address)',
  'error WrongPayment(uint256 sent, uint256 required)',
  'error VanityNotAllowed()',
  'error BadConfig()',
  'error SelfReferral()',
  'error EthSendFailed()',
  'error QuoteNotAllowed(address quote)',
  'error QuoteTransferMismatch()',
]);

export const launchAbi = parseAbi([
  'function buy(uint256 minTokensOut) payable',
  'function sell(uint256 tokensIn, uint256 minEthOut)',
  'function refund(uint256 tokensIn, uint256 minEthOut)',
  'function sweepUnclaimed()',
  'function graduate()',
  'function claimFees(address account)',
  'function quoteBuy(uint256 ethAmount) view returns (uint256)',
  'function quoteSell(uint256 tokensIn) view returns (uint256)',
  'function tokensSold() view returns (uint256)',
  'function ethCollected() view returns (uint256)',
  'function currentPrice() view returns (uint256)',
  'function saleProceeds() view returns (uint256)',
  'function currentWalletCap() view returns (uint256)',
  'function currentGlobalAvailable() view returns (uint256)',
  'function bought(address) view returns (uint256)',
  'function feesAccrued(address) view returns (uint256)',
  'function readyToGraduate() view returns (bool)',
  'function graduated() view returns (bool)',
]);

// Quote-mode entry points of OpenLaunch (spec §3). Kept apart from launchAbi so
// a native launch can never be encoded against them: in native mode buyQuote*
// reverts QuoteNotAccepted, and in quote mode buy()/buyFor() revert
// NativeNotAccepted. Amounts are the quote asset's base units, pulled with
// transferFrom, so a buy needs an allowance on the launch first.
export const launchQuoteAbi = parseAbi([
  'function buyQuote(uint256 amountIn, uint256 minTokensOut)',
  'function buyQuoteFor(address recipient, uint256 amountIn, uint256 minTokensOut)',
  'function quote() view returns (address)',
  'function isNative() view returns (bool)',
  // true while the issuer has paused the asset or blocklisted this launch –
  // every state-changing call reverts QuoteFrozen until it is lifted.
  'function quoteFrozen() view returns (bool)',
  'function lastFrozenSeen() view returns (uint64)',
  'error QuoteFrozen()',
  'error QuoteNotAccepted()',
  'error NativeNotAccepted()',
  'error QuoteTransferMismatch()',
]);

// Quote-pairs factory events. Needed in quote mode for two reasons: the params
// tuple grew (different topic, so the v2.1 event ABIs cannot match it), and a
// quote create pulls the asset with transferFrom BEFORE it deploys the token –
// so receipt.logs[0] is the quote's Transfer, not the mint the native path
// reads. `token` is indexed in both events.
export const quoteCreatedEventAbi = parseAbi([
  'event LaunchCreated(address indexed creator, address indexed token, address launch, address harvester, address teamVesting, address referrer, string metadataCID, (string,string,uint256,uint256,uint8,uint256,uint256,uint16,uint16,uint16,address,bool,uint64,uint256,uint256,uint256,uint24,uint256,address,uint64,uint256,bytes32,uint256,address) params)',
  'event DirectListingCreated(address indexed creator, address indexed token, address harvester, address pool, uint256 liquidityEth, uint256 poolTokens, string metadataCID, (string,string,uint256,uint16,address,uint24,uint256,bytes32,uint256,uint16,address,address,uint256) params)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// Issuer controls of a quote asset, probed the way the indexer's freeze watch
// does. Neither view is part of ERC-20: every read is best-effort behind a
// try/catch and any failure means "not frozen", never an error to the user.
export const issuerTokenAbi = parseAbi([
  'function paused() view returns (bool)',
  'function ACCESS_CONTROLLED_REGISTRY() view returns (address)',
]);

// The issuer's blocklist registry, reached through ACCESS_CONTROLLED_REGISTRY().
// paused() does NOT reflect a per-address block, so both have to be asked.
export const issuerRegistryAbi = parseAbi([
  'function isBlocked(address account) view returns (bool)',
]);

export const promotionsAbi = parseAbi([
  'function boost(address token) payable',
  'function buyTopSlot(address token) payable',
]);

export const harvesterAbi = parseAbi([
  'function harvest()',
  'function positionTokenId() view returns (uint256)',
  // Quote mode (spec §4): a payout the quote asset refuses is parked instead of
  // reverting the whole harvest. claim() is permissionless and can only ever pay
  // `to`, so any connected wallet may release someone else's parked amount.
  'function claim(address to)',
  'function claimable(address) view returns (uint256)',
]);

// Uniswap SwapRouter02 (no deadline in the struct; multicall for unwrap).
// exactInput takes a PACKED path (token, fee, token, fee, token …) and is the
// only way to reach a graduated quote-paired token from the native coin: its
// pool is token/quote, so the route is WETH -> quote -> token in one call.
// exactOutputSingle buys an EXACT amount of the quote asset (the create page's
// "get the fee in <SYMBOL>" helper); the ETH it does not spend comes back
// through refundETH in the same multicall.
export const swapRouterAbi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
  'struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
  'struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }',
  'function exactOutputSingle(ExactOutputSingleParams params) payable returns (uint256 amountIn)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function refundETH() payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
]);

// QuoterV2 – declared view so eth_call works via readContract.
// quoteExactInput prices a packed multi-hop path; quoteExactOutputSingle sizes
// the ETH a fixed amount of the quote asset costs.
export const quoterAbi = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactOutputSingle(QuoteExactOutputSingleParams params) view returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

// OpenZap (spec §10/§12): one signature to pay the native coin for a launch
// that collects an ERC-20, and the reverse. The zap is permissionless and
// ownerless and holds nothing between calls; a buy needs NO approval (the coin
// is msg.value), a sell needs the launch token approved to the zap.
// Every error below is declared so viem decodes a revert into a real reason.
export const zapAbi = parseAbi([
  'function buyWithEth(address launch, uint24 poolFee, uint256 minQuoteOut, uint256 minTokensOut, uint256 deadline) payable',
  'function sellForEth(address launch, uint256 tokensIn, uint256 minQuoteOut, uint24 poolFee, uint256 minEthOut, uint256 deadline)',
  'error Expired()',
  'error ZeroValue()',
  'error BadFee()',
  'error Slippage()',
  'error NothingReceived()',
  'error NotQuoteLaunch()',
  'error UnknownLaunch()',
  'error TokenNotConsumed()',
  'error EthSendFailed()',
]);
