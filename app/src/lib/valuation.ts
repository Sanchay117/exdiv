// Pricing a vault's two halves from the research data. Pure functions, unit-tested.
import type { AssetResearch } from './types';

const DAY = 86_400;
const YEAR = 365 * DAY;

export interface ExpectedDividend {
  date: string;
  /** Gross dividend per share, USD. */
  amount: number;
  /** What Robinhood reinvests (after withholding), USD per share. */
  net: number;
}

/** Projected dividends with an ex-date after `now` and on or before `maturity` (unix seconds). */
export function dividendsInTerm(asset: AssetResearch | undefined, now: number, maturity: number): ExpectedDividend[] {
  if (!asset) return [];
  return asset.projected.filter((d) => {
    const t = Date.parse(`${d.date}T00:00:00Z`) / 1000;
    return t > now && t <= maturity;
  });
}

export interface FairValue {
  /** Expected net dividends per unit until maturity: what one D should be worth (undiscounted). */
  dividend: number;
  /** Share price minus the dividends it gives up. */
  principal: number;
  sharePrice: number;
  payments: ExpectedDividend[];
}

export function fairValue(asset: AssetResearch | undefined, now: number, maturity: number): FairValue | null {
  if (!asset) return null;
  const payments = dividendsInTerm(asset, now, maturity);
  const dividend = payments.reduce((s, d) => s + d.net, 0);
  return { dividend, principal: asset.sharePrice - dividend, sharePrice: asset.sharePrice, payments };
}

/** Annualized yield implied by paying `dividendPrice` today for the dividends until `maturity`. */
export function impliedYield(dividendPrice: number, sharePrice: number, now: number, maturity: number): number | null {
  const term = maturity - now;
  if (term <= 0 || sharePrice <= 0) return null;
  return (dividendPrice / sharePrice) * (YEAR / term);
}

/** Discount of a principal price to the share price, annualized. */
export function principalDiscount(principalPrice: number, sharePrice: number, now: number, maturity: number) {
  const term = maturity - now;
  if (term <= 0 || principalPrice <= 0) return null;
  return { discount: 1 - principalPrice / sharePrice, annualized: (sharePrice / principalPrice - 1) * (YEAR / term) };
}

/** USDG per 1e18 units -> dollars per unit. */
export const bookPrice = (price: bigint) => Number(price) / 1e6;
/** Dollars per unit -> USDG (6 decimals) per 1e18 units. */
export const toBookPrice = (usd: number) => BigInt(Math.round(usd * 1e6));
