import { useWallet } from '../lib/wallet';
import { shortAddress } from '../lib/format';

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M15 3a13 13 0 0 0 0 26z" fill="var(--principal)" />
      <path d="M18 3a13 13 0 0 1 0 26z" fill="var(--dividend)" />
    </svg>
  );
}

export function WalletButton() {
  const { account, hasWallet, onChain, connect, switchChain } = useWallet();
  if (!hasWallet) {
    return (
      <a className="btn btn-ghost" href="https://rabby.io" target="_blank" rel="noreferrer">
        Install a wallet
      </a>
    );
  }
  if (!account) return <button className="btn" onClick={connect}>Connect wallet</button>;
  if (!onChain) return <button className="btn btn-warn" onClick={switchChain}>Switch to Robinhood testnet</button>;
  return <span className="chip mono">{shortAddress(account)}</span>;
}

export function Header({ page }: { page: string }) {
  const link = (href: string, label: string, key: string) => (
    <a href={href} className={page === key ? 'active' : undefined}>
      {label}
    </a>
  );
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="#/" className="brand">
          <Logo />
          <span>Exdiv</span>
        </a>
        <nav>
          {link('#/', 'Markets', 'home')}
          {link('#/research', 'Research', 'research')}
          {link('#/how', 'How it works', 'how')}
        </nav>
        <div className="header-right">
          <span className="chip net">Robinhood Chain testnet</span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
