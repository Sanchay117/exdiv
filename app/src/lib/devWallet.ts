// DEV ONLY: stand-in wallets for exercising the app without a browser extension. Never active in a production build.
//  - VITE_DEV_ANVIL=1: uses an unlocked anvil account on a local fork (VITE_RPC_URL).
//  - VITE_DEV_PRIVATE_KEY: signs locally with a throwaway testnet key (used to record the demo video).
import { createWalletClient, http, numberToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodTestnet } from './chain';

const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

async function rpc(url: string, method: string, params: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
  return json.result;
}

export function installDevWallet() {
  if (!import.meta.env.DEV || window.ethereum) return;
  const url = robinhoodTestnet.rpcUrls.default.http[0];

  if (import.meta.env.VITE_DEV_ANVIL === '1') {
    window.ethereum = {
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ANVIL_ACCOUNT];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        return rpc(url, method, params);
      },
    };
    return;
  }

  const key = import.meta.env.VITE_DEV_PRIVATE_KEY as Hex | undefined;
  if (!key) return;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: http(url) });
  window.ethereum = {
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account.address];
      if (method === 'eth_chainId') return numberToHex(robinhoodTestnet.id);
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') {
        const [tx] = params as [{ to: Hex; data?: Hex; value?: Hex }];
        const value = tx.value ? BigInt(tx.value) : undefined;
        // Headroom for the L1 data cost in Arbitrum gas estimates.
        const gas = await rpc(url, 'eth_estimateGas', [{ from: account.address, to: tx.to, data: tx.data, value: tx.value }]);
        return wallet.sendTransaction({ to: tx.to, data: tx.data, value, gas: (BigInt(gas) * 13n) / 10n });
      }
      return rpc(url, method, params);
    },
  };
}
