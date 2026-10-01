import { formatUnits } from 'viem';

export function usd(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function bps(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)} bps`;
}

/** A token amount (18 decimals by default) with sensible precision. */
export function amount(v: bigint | undefined, decimals = 18, digits = 4) {
  if (v == null) return '—';
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return '0';
  if (Math.abs(n) < 10 ** -digits) return `<${10 ** -digits}`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function multiplier(v: bigint | number) {
  const n = typeof v === 'bigint' ? Number(v) / 1e18 : v;
  return `${n.toFixed(6)}×`;
}

export function date(t: number | string) {
  const d = typeof t === 'number' ? new Date(t * 1000) : new Date(`${t}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function daysUntil(t: number, now = Date.now() / 1000) {
  return Math.max(0, Math.round((t - now) / 86_400));
}

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
