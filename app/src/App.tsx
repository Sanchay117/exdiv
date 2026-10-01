import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { TxToast } from './lib/wallet';
import { Home } from './views/Home';
import { MarketView } from './views/Market';
import { Research } from './views/Research';
import { How } from './views/How';
import { addressUrl, deployment } from './lib/chain';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const [page, param] = useHashRoute();
  let view;
  if (page === 'market' && param) view = <MarketView vault={param as `0x${string}`} />;
  else if (page === 'research') view = <Research />;
  else if (page === 'how') view = <How />;
  else view = <Home />;

  return (
    <>
      <Header page={page || 'home'} />
      <main className="container">{view}</main>
      <footer className="container footer">
        <span>
          Exdiv runs on Robinhood Chain testnet. Test assets only: the SPY, SCHD, MSFT and UPS tokens are mirrors that copy
          mainnet multipliers. Not investment advice.
        </span>
        <span>
          <a href={addressUrl(deployment.factory)} target="_blank" rel="noreferrer">Contracts</a>
          {' · '}
          <a href="https://github.com/Sanchay117/exdiv" target="_blank" rel="noreferrer">Source</a>
        </span>
      </footer>
      <TxToast />
    </>
  );
}
