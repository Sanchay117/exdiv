import type { ExpectedDividend } from '../../lib/valuation';
import { date, usd } from '../../lib/format';
import { useTip } from './Tooltip';

/** Columns: projected net dividend per share at each ex-date in the vault's term. One series. */
export function ScheduleBars({ payments }: { payments: ExpectedDividend[] }) {
  const { setTip, node } = useTip();
  const W = 640, H = 200, padL = 48, padB = 28, padT = 16;
  const max = Math.max(...payments.map((p) => p.net)) * 1.15 || 1;
  const band = (W - padL) / payments.length;
  const barW = Math.min(24, band * 0.5);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Projected dividends per share until maturity">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">{usd(t)}</text>
          </g>
        ))}
        {payments.map((p, i) => {
          const cx = padL + band * (i + 0.5);
          const top = y(p.net);
          const h = y(0) - top;
          return (
            <g key={p.date}
              onMouseEnter={(e) => setTip({ x: (cx / W) * (e.currentTarget.ownerSVGElement?.clientWidth ?? W), y: (top / H) * (e.currentTarget.ownerSVGElement?.clientHeight ?? H), content: <><strong>{date(p.date)}</strong><span>{usd(p.amount, 4)} declared · {usd(p.net, 4)} reinvested</span></> })}
              onMouseLeave={() => setTip(null)}>
              <rect x={cx - band / 2} y={padT} width={band} height={H - padT - padB} fill="transparent" />
              <path d={`M${cx - barW / 2},${y(0)} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${y(0)} Z`} fill="var(--dividend)" style={{ height: h }} />
              <text x={cx} y={top - 6} className="value" textAnchor="middle">{usd(p.net)}</text>
              <text x={cx} y={H - 8} className="axis" textAnchor="middle">{date(p.date).replace(/, \d{4}$/, '')}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="baseline" />
      </svg>
      {node}
    </div>
  );
}
