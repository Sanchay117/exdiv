import { useMarkets, useOrders, useResearch, bookFor, type Market, type Order } from '../lib/data';
import { fairValue, impliedYield, bookPrice } from '../lib/valuation';
import { date, pct, usd } from '../lib/format';
import type { Research } from '../lib/types';
import { Hero, scrollTo } from '../components/hero/Hero';
import { Reveal } from '../components/Reveal';

const now = () => Math.floor(Date.now() / 1000);

function best(orders: Order[] | undefined, base: `0x${string}`) {
  const { bids, asks } = bookFor(orders, base);
  return { bid: bids[0] ? bookPrice(bids[0].price) : null, ask: asks[0] ? bookPrice(asks[0].price) : null };
}

function MarketCards({ markets, research, orders }: { markets: Market[]; research?: Research; orders?: Order[] }) {
  const mirrors = markets.filter((m) => m.isMirror);
  const others = markets.filter((m) => !m.isMirror).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const symbols = [...new Set(mirrors.map((m) => m.symbol))].sort((a, b) =>
    a === 'SPY' ? -1 : b === 'SPY' ? 1 : a.localeCompare(b),
  );
  return (
    <>
      <div className="asset-grid">
        {symbols.map((symbol) => {
          const list = mirrors.filter((m) => m.symbol === symbol).sort((a, b) => a.maturity - b.maturity);
          const asset = research?.assets[symbol];
          return (
            <article key={symbol} className="asset-card glass">
              <header className="asset-head">
                <div>
                  <span className="ticker">{symbol}</span>
                  <span className="muted small asset-name">{list[0].assetName.replace(/\s*\(testnet mirror\)/, '')}</span>
                </div>
                <div className="asset-price">
                  <strong>{asset ? usd(asset.sharePrice) : '—'}</strong>
                  <span className="mono-label">{asset ? `${pct(asset.netYield)} net yield` : ''}</span>
                </div>
              </header>
              <ul className="maturities">
                {list.map((m) => {
                  const fair = fairValue(asset, now(), m.maturity);
                  const d = best(orders, m.dividend);
                  const y = d.bid != null && asset ? impliedYield(d.bid, asset.sharePrice, now(), m.maturity) : null;
                  return (
                    <li key={m.vault}>
                      <a href={`#/market/${m.vault}`}>
                        <span className="mat-date">
                          <span className="mono-label">Matures</span>
                          {date(m.maturity)}
                        </span>
                        <span className="mat-d">
                          <span className="mono-label"><i className="key key-d" />Dividends</span>
                          {fair ? usd(fair.dividend) : '—'}
                        </span>
                        <span className="mat-book">
                          <span className="mono-label">D bid / ask</span>
                          <span className="mono">{d.bid != null ? usd(d.bid) : '—'} / {d.ask != null ? usd(d.ask) : '—'}</span>
                        </span>
                        <span className="mat-y">
                          <span className="mono-label">Implied</span>
                          {y != null && y > 0 ? pct(y) : '—'}
                        </span>
                        <span className="mat-go" aria-hidden="true">→</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
      {others.length > 0 && (
        <div className="testnet-row">
          <span className="mono-label">Testnet's own stock tokens, no dividends to strip</span>
          <div className="chips">
            {others.map((m) => (
              <a key={m.vault} className="chip" href={`#/market/${m.vault}`}>{m.symbol}</a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function Home() {
  const markets = useMarkets();
  const research = useResearch();
  const orders = useOrders();
  const r = research.data;
  const spy = markets.data?.find((m) => m.symbol === 'SPY');
  const dilution = r?.dilution?.find((d) => d.symbol === 'LLY');

  return (
    <>
      <Hero research={r} spy={spy} />

      <div className="container">
        <Reveal as="section" id="problem" className="statement">
          <span className="mono-label">The problem</span>
          <p className="statement-text">
            Robinhood reinvests every dividend into the token itself. In the app there is a switch to turn that off.{' '}
            <span className="dim">Onchain there is none. No cash income, no way to sell next year's dividends, no way to hedge them.</span>{' '}
            Wall Street trades dividends on their own. <em>Now stock tokens can too.</em>
          </p>
        </Reveal>

        <Reveal as="section" className="halves">
          <article className="half-card half-p">
            <span className="mono-label">P · principal</span>
            <h3 className="serif">The price.</h3>
            <p>The stock without its dividends. At maturity one P redeems for exactly one share's worth of the token. Buy it below the share price and the discount is your return.</p>
            <code className="sym">SPY-P-31DEC2026</code>
          </article>
          <div className="halves-eq">
            <span className="serif">1 P + 1 D</span>
            <span className="mono-label">= 1 share, any time before maturity</span>
          </div>
          <article className="half-card half-d">
            <span className="mono-label">D · dividends</span>
            <h3 className="serif">The dividends.</h3>
            <p>Every dividend Robinhood reinvests until maturity, claimable whenever it lands, as stock tokens or straight into USDG. Sell it upfront for cash today.</p>
            <code className="sym">SPY-D-31DEC2026</code>
          </article>
        </Reveal>

        <Reveal as="section" className="uses">
          {[
            ['01', 'Dividend advance', "Strip SPY and sell the dividend half on the USDG order book in one transaction. Next year's dividends in cash today, full price exposure kept."],
            ['02', 'Income mode', "Hold both halves and claim each dividend as it lands, straight into USDG. The reinvestment off switch the token doesn't have."],
            ['03', 'Stock at a discount', 'Buy the price half below the share price. At maturity it redeems for a full share unit, so the discount is your yield.'],
          ].map(([n, title, body]) => (
            <article key={n} className="use glass">
              <span className="use-n mono-label">{n}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </Reveal>

        <Reveal as="section" id="markets" className="markets">
          <div className="section-head">
            <div>
              <span className="mono-label">Markets</span>
              <h2 className="serif">Pick a stock and a maturity.</h2>
            </div>
            <p className="muted small">
              Dividend values roll each stock's last twelve months of dividends forward and keep what Robinhood reinvests
              after withholding. Order book prices in USDG per share unit.
            </p>
          </div>
          {markets.isLoading && <p className="muted">Loading markets from Robinhood Chain…</p>}
          {markets.error && <p className="error">Couldn't read the chain: {(markets.error as Error).message}</p>}
          {markets.data && <MarketCards markets={markets.data} research={r} orders={orders.data} />}
        </Reveal>

        {r && (
          <Reveal as="section" className="findings">
            <div className="section-head">
              <div>
                <span className="mono-label">Research</span>
                <h2 className="serif">What {r.replay.events} multiplier changes taught us.</h2>
              </div>
              <a className="btn btn-glass" href="#/research">Read the research <span aria-hidden="true">→</span></a>
            </div>
            <div className="finding-grid">
              <article className="finding glass">
                <span className="figure serif">{r.replay.dividends + r.replay.splits}/{r.replay.dividends + r.replay.splits}</span>
                <p>Every dividend and split Robinhood has made on mainnet, replayed through our classifier in a Foundry test. No freezes, no manual input.</p>
              </article>
              <article className="finding glass">
                <span className="figure serif">{Math.round(r.netRatio * 100)}%</span>
                <p>Of each dividend reaches token holders. The rest is the 30% US withholding tax, so a dividend token is valued on what is actually paid.</p>
              </article>
              <article className="finding glass">
                <span className="figure serif">{dilution ? `${pct(dilution.ratio, 1)}` : '0.2%'}</span>
                <p>Of their dividend reached LLY holders on the record date. Pay-date dividends follow the token supply on the pay date, which grew {dilution ? `${Math.round(dilution.supplyAtApply / dilution.supplyAtRecord)}×` : '466×'}.</p>
              </article>
            </div>
          </Reveal>
        )}

        <Reveal as="section" className="closing">
          <h2 className="display small-display">
            Dividends you can <em>trade</em>.
          </h2>
          <p className="muted">No oracle. No admin over funds. No liquidations. Just the multiplier, taken apart.</p>
          <div className="hero-ctas center">
            <a className="btn btn-light btn-lg" href={spy ? `#/market/${spy.vault}` : '#/'} onClick={spy ? undefined : scrollTo('markets')}>Launch app <span aria-hidden="true">→</span></a>
            <a className="btn btn-glass btn-lg" href="https://github.com/Sanchay117/exdiv" target="_blank" rel="noreferrer">Read the code</a>
          </div>
        </Reveal>
      </div>
    </>
  );
}
