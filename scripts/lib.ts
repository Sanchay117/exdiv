// Shared chain setup for the keeper, market maker and research scripts.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const root = join(import.meta.dirname, '..');

export const robinhoodTestnet = defineChain({
  id: 46_630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  // TESTNET_RPC points the scripts at a local fork (anvil --fork-url ... --chain-id 46630) for dry runs.
  rpcUrls: { default: { http: [process.env.TESTNET_RPC ?? 'https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' } },
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

/** Mainnet Robinhood stock tokens that the testnet mirrors copy, by symbol. */
export const MAINNET_TOKENS: Record<string, Address> = {
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  SCHD: '0xd63ABB2C13d7a8421a8017a712802053568e3C1D',
  MSFT: '0xe93237C50D904957Cf27E7B1133b510C669c2e74',
  UPS: '0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2',
};

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

export function loadDeployment(): Deployment {
  const file = join(root, 'contracts/deployments/robinhood-testnet.json');
  if (!existsSync(file)) throw new Error('No deployment yet: run contracts/script/Deploy.s.sol first');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Reads contracts/.env (PRIVATE_KEY etc.) without a dotenv dependency. */
export function loadEnv(): Record<string, string> {
  const file = join(root, 'contracts/.env');
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  }
  return env;
}

export const testnet = createPublicClient({ chain: robinhoodTestnet, transport: http(undefined, { retryCount: 5 }) });
export const mainnet = createPublicClient({ chain: robinhoodMainnet, transport: http(undefined, { retryCount: 5 }) });

export function wallet() {
  const key = loadEnv().PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error('PRIVATE_KEY missing (contracts/.env)');
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: robinhoodTestnet, transport: http(undefined, { retryCount: 5 }) });
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (exdiv research)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
