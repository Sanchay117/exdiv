import { createPublicClient, defineChain, http, type Address } from 'viem';
import deploymentJson from '../generated/deployment.json';

export const robinhoodTestnet = defineChain({
  id: 46_630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export interface Deployment {
  chainId: number;
  deployedAtBlock: number;
  usdg: Address;
  dividendIndex: Address;
  factory: Address;
  book: Address;
  router: Address;
  tokens: Address[];
  vaults: Address[];
}

export const deployment = deploymentJson as unknown as Deployment;

export const publicClient = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(undefined, { batch: { wait: 16 }, retryCount: 3 }),
  batch: { multicall: { wait: 16 } },
});

export const explorer = robinhoodTestnet.blockExplorers.default.url;
export const addressUrl = (a: string) => `${explorer}/address/${a}`;
export const txUrl = (h: string) => `${explorer}/tx/${h}`;

export const FAUCETS = {
  eth: 'https://faucet.testnet.chain.robinhood.com/',
  usdg: 'https://faucet.paxos.com/',
};

export const USDG_DECIMALS = 6;
