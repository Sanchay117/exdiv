import { useState, type ReactNode } from 'react';

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Shared hover tooltip for the SVG charts: position is in the chart container's pixel space. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const node = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  ) : null;
  return { tip, setTip, node };
}
