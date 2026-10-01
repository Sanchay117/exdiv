import { useEffect, useState } from 'react';
import { useWallet } from '../lib/wallet';
import { shortAddress } from '../lib/format';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M14.5 3a13 13 0 0 0 0 26z" fill="var(--principal)" />
      <path d="M17.5 3a13 13 0 0 1 0 26z" fill="var(--dividend)" />
    </svg>
  );
}

export function WalletButton() {
  const { account, hasWallet, onChain, connect, switchChain } = useWallet();
  if (!hasWallet) {
    return (
      <a className="btn btn-light btn-nav" href="https://rabby.io" target="_blank" rel="noreferrer">
        Get a wallet
      </a>
    );
  }
  if (!account) return <button className="btn btn-light btn-nav" onClick={connect}>Connect <span aria-hidden="true">→</span></button>;
  if (!onChain) return <button className="btn btn-warn btn-nav" onClick={switchChain}>Switch network</button>;
  return (
    <span className="account-chip mono">
      <i className="dot-live" /> {shortAddress(account)}
    </span>
  );
}

export function Header({ page }: { page: string }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const link = (href: string, label: string, key: string) => (
    <a href={href} className={page === key ? 'active' : undefined}>
      {label}
    </a>
  );
  return (
    <header className={`nav-wrap ${scrolled ? 'is-scrolled' : ''}`}>
      <nav className="nav">
        <a href="#/" className="brand" aria-label="Exdiv home">
          <Logo />
          <span>Exdiv</span>
        </a>
        <div className="nav-links">
          {link('#/', 'Markets', 'home')}
          {link('#/research', 'Research', 'research')}
          {link('#/how', 'How it works', 'how')}
        </div>
        <div className="nav-right">
          <span className="net-chip">Testnet</span>
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
