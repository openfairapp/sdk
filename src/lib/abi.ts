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

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const promotionsAbi = parseAbi([
  'function boost(address token) payable',
  'function buyTopSlot(address token) payable',
]);

export const harvesterAbi = parseAbi([
  'function harvest()',
  'function positionTokenId() view returns (uint256)',
]);

// Uniswap SwapRouter02 (no deadline in the struct; multicall for unwrap).
export const swapRouterAbi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
]);

// QuoterV2 – declared view so eth_call works via readContract.
export const quoterAbi = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
