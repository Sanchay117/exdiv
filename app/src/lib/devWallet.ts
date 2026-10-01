// DEV ONLY: with VITE_DEV_ANVIL=1 and no browser wallet, stand in for one using an unlocked anvil account, so the
// transaction flows can be exercised against a local fork. Never active in a production build.
const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

export function installDevWallet() {
  if (!import.meta.env.DEV || import.meta.env.VITE_DEV_ANVIL !== '1' || window.ethereum) return;
  const rpc = import.meta.env.VITE_RPC_URL as string;
  let id = 0;
  window.ethereum = {
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ANVIL_ACCOUNT];
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      const json = await res.json();
      if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
      return json.result;
    },
  };
}
