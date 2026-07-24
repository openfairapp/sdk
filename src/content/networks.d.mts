export interface NetworkEntry {
  key: string;
  chainId: number;
  hexId: string;
  name: string;
  testnet: boolean;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorer: string;
  origin: string;
  api: string;
  mcp: string;
  sdk: string;
  embed: string;
  factoryVersion: string;
  contracts: { factory: string; simpleTokenDeployer: string; fairTokenDeployer: string; weth: string };
  economics: { deployFee: number; target: number; startFdv: number };
  dexSwapUrl: string;
}
export const NETWORKS: NetworkEntry[];
export function networkByChainId(id: number | string): NetworkEntry | undefined;
