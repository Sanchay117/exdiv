import type { Market } from '../lib/data';
import type { Research } from '../lib/types';
import { fairValue } from '../lib/valuation';
import { date, multiplier, usd } from '../lib/format';

/** One SPY share, taken apart: what the price half and the dividend half are worth until maturity. */
export function SplitHero({ research, market }: { research?: Research; market?: Market }) {
  const spy = research?.assets.SPY;
  const maturity = market?.maturity ?? Date.parse('2026-12-31T00:00:00Z') / 1000;
  const fair = fairValue(spy, Math.floor(Date.now() / 1000), maturity);
  return (
    <figure className="split-hero" aria-label="One SPY share split into price and dividends">
      <div className="whole">
        <span className="muted small">1 SPY share · Robinhood token</span>
        <span className="big">{spy ? usd(spy.sharePrice) : '…'}</span>
        <span className="muted small">multiplier {spy ? multiplier(spy.multiplier) : '…'}</span>
      </div>
      <svg className="split-lines" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 0 C100 30 50 30 50 60" stroke="var(--principal)" strokeWidth="2" fill="none" />
        <path d="M100 0 C100 30 150 30 150 60" stroke="var(--dividend)" strokeWidth="2" fill="none" />
      </svg>
      <div className="halves">
        <div className="half half-p">
          <span className="tag">SPY-P</span>
          <span className="big">{fair ? usd(fair.principal) : '…'}</span>
          <span className="muted small">the price, redeemable for 1 share's worth on {date(maturity)}</span>
        </div>
        <div className="half half-d">
          <span className="tag">SPY-D</span>
          <span className="big">{fair ? usd(fair.dividend) : '…'}</span>
          <span className="muted small">
            every dividend until then
            {fair && fair.payments.length > 0 && <> ({fair.payments.map((p) => date(p.date)).join(', ')})</>}
          </span>
        </div>
      </div>
      <figcaption className="muted small">
        Fair values: projected SPY dividends × {research ? Math.round(research.netRatio * 100) : 69}% (what Robinhood reinvests after withholding).
      </figcaption>
    </figure>
  );
}
