// A small EIP-1193 wallet layer on viem: connect, keep the wallet on Robinhood Chain testnet, send a transaction
// and wait for it. No wallet is needed to browse; everything reads through the public RPC.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createWalletClient, custom, numberToHex, type Address, type Hash } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { publicClient, robinhoodTestnet, txUrl } from './chain';

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export interface TxStatus {
  label: string;
  state: 'signing' | 'pending' | 'done' | 'failed';
  hash?: Hash;
  error?: string;
}

interface WalletState {
  account?: Address;
  chainId?: number;
  hasWallet: boolean;
  onChain: boolean;
  connect(): Promise<void>;
  switchChain(): Promise<void>;
  /** Runs `send` (which submits one transaction) and waits for its receipt, reporting progress. */
  run(label: string, send: (wallet: ReturnType<typeof makeWallet>, account: Address) => Promise<Hash>): Promise<boolean>;
  tx?: TxStatus;
  dismissTx(): void;
}

function makeWallet(provider: Eip1193) {
  return createWalletClient({ chain: robinhoodTestnet, transport: custom(provider) });
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [tx, setTx] = useState<TxStatus>();
  const queryClient = useQueryClient();
  const dismissTx = useCallback(() => setTx(undefined), []);

  useEffect(() => {
    if (!provider) return;
    const onAccounts = (a: unknown) => setAccount((a as Address[])[0]);
    const onChain = (id: unknown) => setChainId(Number(id));
    provider.request({ method: 'eth_accounts' }).then(onAccounts).catch(() => {});
    provider.request({ method: 'eth_chainId' }).then(onChain).catch(() => {});
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    const chainIdHex = numberToHex(robinhoodTestnet.id);
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainIdHex,
          chainName: robinhoodTestnet.name,
          nativeCurrency: robinhoodTestnet.nativeCurrency,
          rpcUrls: robinhoodTestnet.rpcUrls.default.http,
          blockExplorerUrls: [robinhoodTestnet.blockExplorers.default.url],
        }],
      });
    }
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
    setAccount(accounts[0]);
    await switchChain();
  }, [provider, switchChain]);

  const run = useCallback<WalletState['run']>(
    async (label, send) => {
      if (!provider || !account) return false;
      try {
        if (chainId !== robinhoodTestnet.id) await switchChain();
        setTx({ label, state: 'signing' });
        const hash = await send(makeWallet(provider), account);
        setTx({ label, state: 'pending', hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const ok = receipt.status === 'success';
        setTx({ label, state: ok ? 'done' : 'failed', hash, error: ok ? undefined : 'Reverted' });
        await queryClient.invalidateQueries();
        return ok;
      } catch (e) {
        const err = e as { shortMessage?: string; message?: string };
        setTx({ label, state: 'failed', error: err.shortMessage ?? err.message?.split('\n')[0] ?? 'Failed' });
        return false;
      }
    },
    [provider, account, chainId, switchChain, queryClient],
  );

  const value = useMemo<WalletState>(
    () => ({
      account, chainId, hasWallet: !!provider, onChain: chainId === robinhoodTestnet.id,
      connect, switchChain, run, tx, dismissTx,
    }),
    [account, chainId, provider, connect, switchChain, run, tx, dismissTx],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}

export function TxToast() {
  const { tx, dismissTx } = useWallet();
  useEffect(() => {
    if (tx?.state !== 'done') return;
    const t = setTimeout(dismissTx, 6000);
    return () => clearTimeout(t);
  }, [tx, dismissTx]);
  if (!tx) return null;
  const text = {
    signing: 'Confirm in your wallet',
    pending: 'Waiting for Robinhood Chain',
    done: 'Confirmed',
    failed: tx.error ?? 'Failed',
  }[tx.state];
  return (
    <div className={`toast toast-${tx.state}`} role="status">
      <div>
        <strong>{tx.label}</strong>
        <span>{text}</span>
      </div>
      {tx.hash && (
        <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
          View tx
        </a>
      )}
      {(tx.state === 'done' || tx.state === 'failed') && (
        <button className="link" onClick={dismissTx} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
