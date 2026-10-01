// Client-side planning for takers: which orders a market buy or sell would fill, and for how much.
// Mirrors ExdivBook's rounding (sellers' proceeds round down, buyers' costs round up).
import type { Order } from './data';

const SCALE = 10n ** 18n;

export interface Fill {
  ids: bigint[];
  filled: bigint;
  quote: bigint;
}

/** Sell `amount` into `bids` (best first). */
export function planSell(bids: Order[], amount: bigint): Fill {
  const ids: bigint[] = [];
  let filled = 0n;
  let quote = 0n;
  for (const o of bids) {
    if (filled >= amount) break;
    const take = amount - filled < o.remaining ? amount - filled : o.remaining;
    ids.push(o.id);
    filled += take;
    quote += (take * o.price) / SCALE;
  }
  return { ids, filled, quote };
}

/** Buy `amount` from `asks` (best first). */
export function planBuy(asks: Order[], amount: bigint): Fill {
  const ids: bigint[] = [];
  let filled = 0n;
  let quote = 0n;
  for (const o of asks) {
    if (filled >= amount) break;
    const take = amount - filled < o.remaining ? amount - filled : o.remaining;
    ids.push(o.id);
    filled += take;
    quote += (take * o.price + SCALE - 1n) / SCALE;
  }
  return { ids, filled, quote };
}

/** Applies a slippage tolerance in basis points. */
export const minusBps = (v: bigint, bps: bigint) => (v * (10_000n - bps)) / 10_000n;
export const plusBps = (v: bigint, bps: bigint) => (v * (10_000n + bps) + 9_999n) / 10_000n;
