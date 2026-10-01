import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Market } from '../../lib/data';
import type { Research } from '../../lib/types';
import { fairValue } from '../../lib/valuation';
import { date, usd } from '../../lib/format';
import { Laurel } from './Laurel';

function useWebGL() {
  const [ok] = useState(() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  });
  return ok;
}

function Scene() {
  const ref = useRef<HTMLCanvasElement>(null);
  const webgl = useWebGL();
  useEffect(() => {
    if (!webgl || !ref.current) return;
    let handle: { dispose(): void } | undefined;
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Loaded on demand so the three.js bundle never blocks first paint.
    import('./tokenScene').then(({ mountTokenScene }) => {
      if (!cancelled && ref.current) handle = mountTokenScene(ref.current, reduced);
    });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [webgl]);
  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />;
}

/** In-page scrolling without touching the hash, which the router owns. */
export const scrollTo = (id: string) => (e: MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function Hero({ research, spy }: { research?: Research; spy?: Market }) {
  const asset = research?.assets.SPY;
  const maturity = spy?.maturity ?? Date.parse('2026-12-31T00:00:00Z') / 1000;
  const fair = fairValue(asset, Math.floor(Date.now() / 1000), maturity);
  const replayed = research ? research.replay.dividends + research.replay.splits : 46;

  return (
    <section className="hero">
      <Scene />
      <div className="hero-shade" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <span className="badge">
            <span className="dot-live" /> Live on Robinhood Chain · settles in USDG
          </span>
          <h1 className="display">
            Take the dividends <em>off</em> your stocks.
          </h1>
          <p className="hero-lede">
            Robinhood stock tokens reinvest every dividend, automatically. Exdiv splits a token into its{' '}
            <span className="hl-p">price</span> and its <span className="hl-d">dividends</span>, so you can keep one
            and sell the other for USDG.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-light btn-lg" href={spy ? `#/market/${spy.vault}` : '#/'} onClick={spy ? undefined : scrollTo('markets')}>
              Strip SPY <span aria-hidden="true">→</span>
            </a>
            <a className="btn btn-glass btn-lg" href="#/how">How it works</a>
          </div>

          <a className="quote-pill" href={spy ? `#/market/${spy.vault}` : '#/'} onClick={spy ? undefined : scrollTo('markets')}>
            <span className="quote-whole">
              <span className="mono-label">1 SPY</span>
              <strong>{asset ? usd(asset.sharePrice) : '…'}</strong>
            </span>
            <span className="quote-eq" aria-hidden="true">=</span>
            <span className="quote-part">
              <i className="key key-p" />
              <span className="mono-label">Price</span>
              <strong>{fair ? usd(fair.principal) : '…'}</strong>
            </span>
            <span className="quote-eq" aria-hidden="true">+</span>
            <span className="quote-part">
              <i className="key key-d" />
              <span className="mono-label">Dividends to {date(maturity).replace(/, \d{4}$/, '')}</span>
              <strong>{fair ? usd(fair.dividend) : '…'}</strong>
            </span>
            <span className="quote-go" aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="laurels">
          <Laurel top={`${replayed}/${replayed}`} bottom={'Mainnet multiplier\nchanges classified'} />
          <Laurel top="0" bottom={'Oracles, admins or\nliquidations in the vault'} />
          <Laurel top={research ? `${Math.round(research.netRatio * 100)}%` : '69%'} bottom={'Of each dividend\nreaches token holders'} />
        </div>
      </div>
      <a className="scroll-hint" href="#/" onClick={scrollTo('problem')} aria-label="Scroll to learn more">
        <span />
      </a>
    </section>
  );
}
