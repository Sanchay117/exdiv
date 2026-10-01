import type { ReplayRow } from '../../lib/types';
import { date } from '../../lib/format';
import { useTip } from './Tooltip';

/**
 * Every dividend Robinhood has reinvested on mainnet: when it took effect (x) and how far it moved the multiplier
 * (y, log scale), against the 5% line above which DividendIndex refuses to assume a dividend. One series.
 */
export function StepChart({ rows }: { rows: ReplayRow[] }) {
  const { setTip, node } = useTip();
  const divs = rows.filter((r) => r.kind === 'dividend');
  const W = 720, H = 300, padL = 64, padR = 16, padT = 20, padB = 30;
  const t0 = Math.min(...divs.map((r) => r.effectiveAt)) - 5 * 86_400;
  const t1 = Math.max(...divs.map((r) => r.effectiveAt)) + 5 * 86_400;
  const lo = Math.log10(0.01), hi = Math.log10(1000);
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (bps: number) => padT + (1 - (Math.log10(Math.max(bps, 0.01)) - lo) / (hi - lo)) * (H - padT - padB);
  const ticks = [0.01, 0.1, 1, 10, 100, 500];
  const months = [Date.UTC(2026, 6, 1), Date.UTC(2026, 7, 1), Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1)].map((ms) => ms / 1000).filter((t) => t >= t0 && t <= t1);
  const label = (bps: number) => `${bps} bps`;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Multiplier step of every reinvested dividend on Robinhood Chain">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 500 ? 'threshold' : 'grid'} />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">{t === 500 ? '5%' : label(t)}</text>
          </g>
        ))}
        <text x={W - padR} y={y(500) - 6} className="axis" textAnchor="end">Above 5%: not assumed to be a dividend, index freezes</text>
        {months.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="axis" textAnchor="middle">{new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text>
        ))}
        {divs.map((r) => (
          <circle key={r.tx + r.symbol} cx={x(r.effectiveAt)} cy={y(r.stepBps)} r={4.5} className="dot dot-1"
            onMouseEnter={(e) => {
              const svg = e.currentTarget.ownerSVGElement!;
              setTip({ x: (x(r.effectiveAt) / W) * svg.clientWidth, y: (y(r.stepBps) / H) * svg.clientHeight, content: <><strong>{r.symbol}</strong><span>{date(r.effectiveAt)} · +{r.stepBps.toFixed(2)} bps</span></> });
            }}
            onMouseLeave={() => setTip(null)} />
        ))}
        {(() => {
          const top = [...divs].sort((a, b) => b.stepBps - a.stepBps)[0];
          return top && <text x={x(top.effectiveAt) + 8} y={y(top.stepBps) + 4} className="value">{top.symbol} +{top.stepBps.toFixed(0)} bps, the largest</text>;
        })()}
      </svg>
      {node}
    </div>
  );
}
