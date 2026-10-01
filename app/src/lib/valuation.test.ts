import { describe, expect, it } from 'vitest';
import { dividendsInTerm, fairValue, impliedYield, principalDiscount, bookPrice, toBookPrice } from './valuation';
import { planBuy, planSell } from './book';
import type { AssetResearch } from './types';
import type { Order } from './data';

const t = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const spy = {
  symbol: 'SPY', sharePrice: 760, projected: [
    { date: '2026-12-18', amount: 1.9, net: 1.31 },
    { date: '2027-03-19', amount: 1.8, net: 1.24 },
  ],
} as unknown as AssetResearch;

describe('valuation', () => {
  it('counts only dividends after now and on or before maturity', () => {
    expect(dividendsInTerm(spy, t('2026-10-01'), t('2026-12-31')).map((d) => d.date)).toEqual(['2026-12-18']);
    expect(dividendsInTerm(spy, t('2026-12-18'), t('2027-12-31')).map((d) => d.date)).toEqual(['2027-03-19']);
    expect(dividendsInTerm(spy, t('2026-10-01'), t('2026-12-18'))).toHaveLength(1);
  });

  it('splits the share price into principal and dividends', () => {
    const f = fairValue(spy, t('2026-10-01'), t('2027-12-31'))!;
    expect(f.dividend).toBeCloseTo(2.55);
    expect(f.principal + f.dividend).toBeCloseTo(760);
    expect(fairValue(undefined, 0, 1)).toBeNull();
  });

  it('annualizes yields and discounts', () => {
    expect(impliedYield(3.8, 760, 0, 365 * 86_400)).toBeCloseTo(0.005);
    expect(impliedYield(1, 760, 10, 10)).toBeNull();
    const d = principalDiscount(756.2, 760, 0, 182.5 * 86_400)!;
    expect(d.discount).toBeCloseTo(0.005);
    expect(d.annualized).toBeCloseTo(0.01005, 4);
  });

  it('converts book prices', () => {
    expect(bookPrice(toBookPrice(1.31))).toBe(1.31);
    expect(toBookPrice(762.39)).toBe(762_390_000n);
  });
});

describe('order planning', () => {
  const o = (id: number, price: number, remaining: number, isBid: boolean) =>
    ({ id: BigInt(id), price: toBookPrice(price), remaining: BigInt(remaining) * 10n ** 18n, isBid }) as Order;

  it('walks bids best first and rounds proceeds down', () => {
    const p = planSell([o(1, 1.3, 5, true), o(2, 1.2, 10, true)], 8n * 10n ** 18n);
    expect(p.ids).toEqual([1n, 2n]);
    expect(p.filled).toBe(8n * 10n ** 18n);
    expect(p.quote).toBe(5n * 1_300_000n + 3n * 1_200_000n);
  });

  it('stops when the book runs out', () => {
    const p = planBuy([o(3, 2, 1, false)], 5n * 10n ** 18n);
    expect(p.filled).toBe(10n ** 18n);
    expect(p.quote).toBe(2_000_000n);
  });

  it('rounds a buyer cost up', () => {
    const p = planBuy([o(4, 0.7, 1, false)], 1n);
    expect(p.quote).toBe(1n);
  });
});
