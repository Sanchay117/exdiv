import { useMarkets, useOrders, useResearch, bookFor, type Market, type Order } from '../lib/data';
import { fairValue, impliedYield, bookPrice } from '../lib/valuation';
import { date, daysUntil, pct, usd } from '../lib/format';
import type { Research } from '../lib/types';
import { SplitHero } from '../components/SplitHero';

const now = () => Math.floor(Date.now() / 1000);

function best(orders: Order[] | undefined, base: `0x${string}`) {
  const { bids, asks } = bookFor(orders, base);
  return { bid: bids[0] ? bookPrice(bids[0].price) : null, ask: asks[0] ? bookPrice(asks[0].price) : null };
}

function MarketsTable({ markets, research, orders }: { markets: Market[]; research?: Research; orders?: Order[] }) {
  const sorted = [...markets].sort((a, b) => Number(b.isMirror) - Number(a.isMirror) || a.symbol.localeCompare(b.symbol) || a.maturity - b.maturity);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Stock token</th>
            <th>Maturity</th>
            <th className="num">Share price</th>
            <th className="num" title="Projected dividends until maturity, after 30% withholding">
              <span className="key key-d" /> Dividends to maturity
            </th>
            <th className="num">
              <span className="key key-d" /> D bid / ask
            </th>
            <th className="num">
              <span className="key key-p" /> P bid / ask
            </th>
            <th className="num">Implied yield</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const asset = research?.assets[m.symbol];
            const fair = fairValue(asset, now(), m.maturity);
            const d = best(orders, m.dividend);
            const p = best(orders, m.principal);
            const dRef = d.bid ?? fair?.dividend ?? null;
            const y = dRef != null && asset ? impliedYield(dRef, asset.sharePrice, now(), m.maturity) : null;
            return (
              <tr key={m.vault} onClick={() => (window.location.hash = `#/market/${m.vault}`)} className="clickable">
                <td>
                  <div className="asset-cell">
                    <strong>{m.symbol}</strong>
                    <span className="muted">{m.isMirror ? 'mainnet mirror' : 'testnet token, no dividend'}</span>
                  </div>
                </td>
                <td className="nowrap">
                  {date(m.maturity)}
                  <div className="muted small">{daysUntil(m.maturity)} days</div>
                </td>
                <td className="num">{asset ? usd(asset.sharePrice) : '—'}</td>
                <td className="num">
                  {fair ? usd(fair.dividend) : usd(0)}
                  {fair && <div className="muted small">{fair.payments.length} payment{fair.payments.length === 1 ? '' : 's'}</div>}
                </td>
                <td className="num mono">
                  {d.bid != null ? usd(d.bid) : '—'} / {d.ask != null ? usd(d.ask) : '—'}
                </td>
                <td className="num mono">
                  {p.bid != null ? usd(p.bid) : '—'} / {p.ask != null ? usd(p.ask) : '—'}
                </td>
                <td className="num">{y != null && y > 0 ? pct(y) : '—'}</td>
                <td className="num">
                  <a className="btn btn-small" href={`#/market/${m.vault}`}>Open</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Home() {
  const markets = useMarkets();
  const research = useResearch();
  const orders = useOrders();
  const r = research.data;
  const spy = markets.data?.find((m) => m.symbol === 'SPY');

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Dividend strips for Robinhood stock tokens</p>
          <h1>Take the dividends off your stocks.</h1>
          <p className="lede">
            Robinhood stock tokens reinvest every dividend automatically. There is no switch to take them as cash, and no
            way to sell them on their own. Exdiv splits a stock token into its <b className="t-p">price</b> and its{' '}
            <b className="t-d">dividends</b> until a maturity date. Keep one, sell the other for USDG.
          </p>
          <div className="hero-ctas">
            {spy ? (
              <a className="btn btn-lg" href={`#/market/${spy.vault}`}>Strip SPY</a>
            ) : (
              <a className="btn btn-lg" href="#markets">See markets</a>
            )}
            <a className="btn btn-lg btn-ghost" href="#/how">How it works</a>
          </div>
        </div>
        <SplitHero research={r} market={spy} />
      </section>

      {r && (
        <section className="stats">
          <div className="stat">
            <span className="stat-value">{r.replay.dividends}</span>
            <span className="stat-label">dividends Robinhood has reinvested onchain so far, across {new Set(r.replay.rows.filter((x) => x.kind === 'dividend').map((x) => x.symbol)).size} tokens</span>
          </div>
          <div className="stat">
            <span className="stat-value">{pct(r.netRatio, 0)}</span>
            <span className="stat-label">of a dividend actually reaches token holders (30% US withholding)</span>
          </div>
          <div className="stat">
            <span className="stat-value">0</span>
            <span className="stat-label">price oracles, admin keys or liquidations in the vault</span>
          </div>
          <div className="stat">
            <span className="stat-value">{r.replay.dividends + r.replay.splits}/{r.replay.dividends + r.replay.splits}</span>
            <span className="stat-label">real mainnet multiplier changes classified correctly in our replay test</span>
          </div>
        </section>
      )}

      <section className="uses">
        <article className="card">
          <h3>Dividend advance</h3>
          <p>Strip your SPY and sell the dividend half on the USDG order book. You get next year's dividends in cash today and keep every bit of the price exposure.</p>
        </article>
        <article className="card">
          <h3>Income mode</h3>
          <p>Hold both halves and claim each dividend as it lands, as stock tokens or straight into USDG. It's the dividend-reinvestment off switch the token doesn't have.</p>
        </article>
        <article className="card">
          <h3>Stock at a discount</h3>
          <p>Buy the price half below the share price. At maturity, one P redeems for exactly one share's worth of the stock token, so the discount is your return.</p>
        </article>
      </section>

      <section id="markets">
        <div className="section-head">
          <h2>Markets</h2>
          <p className="muted">Prices in USDG per share unit. Fair dividend values come from each stock's last 12 months of dividends, rolled forward and taken net of withholding.</p>
        </div>
        {markets.isLoading && <p className="muted">Loading markets from Robinhood Chain…</p>}
        {markets.error && <p className="error">Couldn't read the chain: {(markets.error as Error).message}</p>}
        {markets.data && <MarketsTable markets={markets.data} research={r} orders={orders.data} />}
      </section>
    </>
  );
}
