import type { ReinvestRow } from '../../lib/types';
import { useTip } from './Tooltip';

const DAY = 86_400_000;

/** Gross dividend yield (x) vs multiplier step (y), log-log, with 100% and 70% reinvestment lines. Two series:
 *  dividends applied on the ex-date, and dividends applied weeks later on the pay date. */
export function ReinvestScatter({ rows }: { rows: ReinvestRow[] }) {
  const { setTip, node } = useTip();
  const W = 720, H = 360, padL = 64, padR = 20, padT = 20, padB = 40;
  // Log scales: dividend yields run 1 to ~300 bps; steps run from 0.01 bps (heavily diluted) to ~300.
  const xLo = 0, xHi = 2.5, yLo = -2, yHi = 2.5;
  const sx = (v: number) => padL + ((Math.log10(Math.max(v, 1)) - xLo) / (xHi - xLo)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (Math.log10(Math.max(v, 0.01)) - yLo) / (yHi - yLo)) * (H - padT - padB);
  const late = (r: ReinvestRow) => Date.parse(r.effective) - Date.parse(r.exDate) > 3 * DAY;
  const yTicks = [0.01, 0.1, 1, 10, 100];
  const xTicks = [1, 10, 100];
  const line = (k: number) => `M${sx(1)},${sy(k)} L${sx(316)},${sy(316 * k)}`;
  return (
    <div className="chart">
      <div className="legend">
        <span><i className="swatch s1" /> Applied on the ex-date</span>
        <span><i className="swatch s2" /> Applied on the pay date, weeks later</span>
        <span><i className="line-key line-strong" /> 70% reinvested: what 30% US withholding leaves</span>
        <span><i className="line-key" /> 100% reinvested</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dividend yield against multiplier step for every reinvested dividend">
        <defs>
          <clipPath id="plot"><rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} /></clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={padL - 8} y={sy(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={padT} y2={H - padB} className="grid" />
            <text x={sx(t)} y={H - padB + 16} className="axis" textAnchor="middle">{t}</text>
          </g>
        ))}
        <text x={(W + padL) / 2} y={H - 4} className="axis" textAnchor="middle">Dividend ÷ prior close (bps)</text>
        <text x={14} y={(H - padB) / 2} className="axis" textAnchor="middle" transform={`rotate(-90 14 ${(H - padB) / 2})`}>Multiplier step (bps)</text>
        <g clipPath="url(#plot)">
          <path d={line(1)} className="ref" />
          <path d={line(0.7)} className="ref ref-strong" />
        </g>
        {rows.map((r) => (
          <circle key={r.symbol + r.effective} cx={sx(r.grossBps)} cy={sy(r.stepBps)} r={4.5} className={`dot ${late(r) ? 'dot-2' : 'dot-1'}`}
            onMouseEnter={(e) => {
              const svg = e.currentTarget.ownerSVGElement!;
              setTip({
                x: (sx(r.grossBps) / W) * svg.clientWidth, y: (sy(r.stepBps) / H) * svg.clientHeight,
                content: <><strong>{r.symbol}</strong><span>${r.dividend.toFixed(3)} on ${r.close.toFixed(2)} · ex {r.exDate}, applied {r.effective}</span><span>{(r.ratio * 100).toFixed(1)}% reinvested</span></>,
              });
            }}
            onMouseLeave={() => setTip(null)} />
        ))}
      </svg>
      {node}
    </div>
  );
}
