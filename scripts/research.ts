// Builds app/public/data/research.json: what Robinhood Chain's own multipliers say about dividends, and the
// inputs the app and market maker use to value dividend tokens.
//
//  - replay:      every UIMultiplierUpdated event on mainnet (contracts/test/fixtures), classified the way
//                 DividendIndex does it.
//  - reinvested:  how much of each dividend Robinhood actually reinvests, from the multiplier step vs the
//                 dividend and price on Yahoo Finance (answer: about 69%, i.e. after 30% US withholding).
//  - assets:      price (Robinhood's own token quote), the last year of dividends and a projected schedule for
//                 each mirrored asset, so D can be valued per maturity.
//
//   node scripts/research.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAINNET_TOKENS, fetchJson, mainnet, root, sleep } from './lib.ts';

const DAY = 86_400;
const MAX_DIVIDEND_STEP = 0.05;
const KNOWN_SPLITS = [2, 3, 4, 5, 10, 20, 1.5, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 8, 1 / 10, 1 / 15, 1 / 20, 1 / 25];

interface Fixture {
  symbols: string[];
  tokens: string[];
  blocks: number[];
  txs: string[];
  oldMultipliers: string[];
  newMultipliers: string[];
  effectiveAts: number[];
}

interface YahooChart {
  chart: {
    result: {
      timestamp: number[];
      indicators: { quote: { close: (number | null)[] }[] };
      events?: { dividends?: Record<string, { amount: number; date: number }> };
    }[];
  };
}

async function yahoo(symbol: string, from: number, to: number) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${from}&period2=${to}&interval=1d&events=div`;
  const r = (await fetchJson<YahooChart>(url)).chart.result[0];
  const closes = r.timestamp.map((t, i) => ({ t, close: r.indicators.quote[0].close[i] })).filter((x) => x.close != null);
  const dividends = Object.values(r.events?.dividends ?? {}).sort((a, b) => a.date - b.date);
  return { closes: closes as { t: number; close: number }[], dividends };
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---------------------------------------------------------------- replay
const fx: Fixture = JSON.parse(readFileSync(join(root, 'contracts/test/fixtures/mainnet-multipliers.json'), 'utf8'));
const lastSeen = new Map<string, number>();
const replay = fx.symbols.map((symbol, i) => {
  const prev = lastSeen.get(fx.tokens[i]) ?? 1;
  const next = Number(fx.newMultipliers[i]) / 1e18;
  lastSeen.set(fx.tokens[i], next);
  const step = next / prev;
  let kind: 'dividend' | 'split' | 'repeat' | 'freeze';
  if (step === 1) kind = 'repeat';
  else if (step > 1 && step - 1 <= MAX_DIVIDEND_STEP) kind = 'dividend';
  else if (KNOWN_SPLITS.some((k) => Math.abs(step / k - 1) < 1e-9)) kind = 'split';
  else kind = 'freeze';
  return {
    symbol, token: fx.tokens[i], block: fx.blocks[i], tx: fx.txs[i], effectiveAt: fx.effectiveAts[i],
    multiplier: next, stepBps: (step - 1) * 10_000, kind,
  };
});
const dividends = replay.filter((r) => r.kind === 'dividend');
console.log(`replay: ${dividends.length} dividends, ${replay.filter((r) => r.kind === 'split').length} splits, ${replay.filter((r) => r.kind === 'freeze').length} freezes`);

// ---------------------------------------------------------------- how much is reinvested
const reinvested = [];
for (const ev of dividends) {
  try {
    const { closes, dividends: divs } = await yahoo(ev.symbol, ev.effectiveAt - 50 * DAY, ev.effectiveAt + 3 * DAY);
    // The dividend this step pays: the latest ex-date on or before the effective time (Robinhood applies some on
    // the ex-date, some on the pay date up to ~4 weeks later).
    const div = [...divs].reverse().find((d) => d.date <= ev.effectiveAt + DAY);
    const before = [...closes].reverse().find((c) => c.t < Math.min(ev.effectiveAt, div ? div.date : Infinity) - 3600);
    if (!div || !before) continue;
    const grossBps = (div.amount / before.close) * 10_000;
    reinvested.push({
      symbol: ev.symbol, exDate: iso(div.date), effective: iso(ev.effectiveAt), dividend: div.amount,
      close: before.close, grossBps, stepBps: ev.stepBps, ratio: ev.stepBps / grossBps,
    });
  } catch (e) {
    console.warn(`  ${ev.symbol}: ${(e as Error).message}`);
  }
  await sleep(250);
}
const typical = reinvested.filter((r) => r.ratio > 0.5 && r.ratio < 0.8);
// Dividends applied on the ex-date are the clean measurement; pay-date ones are distorted by supply changes (below).
const onExDate = reinvested.filter((r) => Date.parse(r.effective) - Date.parse(r.exDate) <= 3 * DAY * 1000);
const netRatio = median(onExDate.map((r) => r.ratio));
console.log(`reinvested: median ${netRatio.toFixed(3)} of the dividend over ${onExDate.length} ex-date events (${reinvested.length} matched in all)`);

// ---------------------------------------------------------------- pay-date dilution
// Some dividends are applied weeks after the ex-date, on the pay date. The multiplier step then spreads the cash
// over every token alive on that day, including tokens minted after the record date. Rebuild each token's supply
// from mint and burn events and compare it on the ex-date and on the day the multiplier moved.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = `0x${'0'.repeat(64)}` as const;
const latestBlock = await mainnet.getBlockNumber();
const blockCache = new Map<number, bigint>();
async function blockAt(ts: number) {
  if (blockCache.has(ts)) return blockCache.get(ts)!;
  let lo = 1n, hi = latestBlock;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await mainnet.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n;
    else hi = mid;
  }
  blockCache.set(ts, lo);
  return lo;
}
async function supplyLogs(token: `0x${string}`, topics: (string | null)[]) {
  const out: { blockNumber: string; data: string }[] = [];
  for (let from = 0n; from <= latestBlock; from += 10_000_000n) {
    const to = from + 9_999_999n > latestBlock ? latestBlock : from + 9_999_999n;
    for (let attempt = 0; ; attempt++) {
      try {
        out.push(...((await mainnet.request({
          method: 'eth_getLogs',
          params: [{ address: token, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: topics as never }],
        })) as { blockNumber: string; data: string }[]));
        break;
      } catch (e) {
        if (attempt > 6) throw e;
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  return out;
}
const dilution = [];
for (const row of reinvested) {
  const ev = dividends.find((d) => d.symbol === row.symbol && iso(d.effectiveAt) === row.effective)!;
  const exTs = Date.parse(`${row.exDate}T00:00:00Z`) / 1000;
  if (ev.effectiveAt - exTs < 3 * DAY) continue;
  try {
    const token = ev.token as `0x${string}`;
    const [mints, burns] = await Promise.all([supplyLogs(token, [TRANSFER, ZERO_TOPIC]), supplyLogs(token, [TRANSFER, null, ZERO_TOPIC])]);
    const at = async (ts: number) => {
      const b = await blockAt(ts);
      const sum = (logs: typeof mints) => logs.filter((l) => BigInt(l.blockNumber) <= b).reduce((s, l) => s + BigInt(l.data), 0n);
      return Number(sum(mints) - sum(burns)) / 1e18;
    };
    const [before, after] = [await at(exTs), await at(ev.effectiveAt)];
    if (before <= 0) continue;
    dilution.push({
      symbol: row.symbol, recordDate: row.exDate, appliedDate: row.effective,
      supplyAtRecord: before, supplyAtApply: after, ratio: row.ratio, growth: after / before, adjustedRatio: row.ratio * (after / before),
    });
    console.log(`  ${row.symbol}: supply x${(after / before).toFixed(2)} between ex-date and pay date; ${row.ratio.toFixed(3)} x growth = ${(row.ratio * after / before).toFixed(3)}`);
  } catch (e) {
    console.warn(`  ${row.symbol} dilution: ${(e as Error).message.slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------- assets
interface RhQuote { quotes: { bid: string; ask: string; tokenBid: string; tokenAsk: string; isTradingHalt: boolean; generatedAt: string }[] }
const scaledUiAbi = [
  { type: 'function', name: 'uiMultiplier', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const now = Math.floor(Date.now() / 1000);
const assets: Record<string, unknown> = {};
for (const [symbol, address] of Object.entries(MAINNET_TOKENS)) {
  const [{ quotes }, multiplier, history] = await Promise.all([
    fetchJson<RhQuote>(`https://api.robinhood.com/rhj/prices/${symbol}`),
    mainnet.readContract({ address, abi: scaledUiAbi, functionName: 'uiMultiplier' }),
    yahoo(symbol, now - 400 * DAY, now),
  ]);
  const q = quotes[0];
  const sharePrice = (Number(q.bid) + Number(q.ask)) / 2;
  const tokenPrice = (Number(q.tokenBid) + Number(q.tokenAsk)) / 2;
  const lastYear = history.dividends.filter((d) => d.date > now - 365 * DAY);
  const annual = lastYear.reduce((s, d) => s + d.amount, 0);
  // The next two years: each of the last 12 months' dividends again, 52 and 104 weeks later.
  const projected = [364, 728]
    .flatMap((days) => lastYear.map((d) => ({ date: d.date + days * DAY, amount: d.amount })))
    .filter((d) => d.date > now);
  assets[symbol] = {
    symbol, mainnetAddress: address, multiplier: Number(multiplier) / 1e18,
    sharePrice, tokenPrice, quotedAt: q.generatedAt, tradingHalt: q.isTradingHalt,
    dividends12m: lastYear.map((d) => ({ date: iso(d.date), amount: d.amount })),
    annualDividend: annual, grossYield: annual / sharePrice, netYield: (annual * netRatio) / sharePrice,
    projected: projected.map((d) => ({ date: iso(d.date), amount: d.amount, net: d.amount * netRatio })),
    reinvestedSoFar: replay.filter((r) => r.symbol === symbol && r.kind === 'dividend').map((r) => ({ date: iso(r.effectiveAt), stepBps: r.stepBps })),
  };
  console.log(`${symbol}: $${sharePrice.toFixed(2)}, ${(annual / sharePrice * 100).toFixed(2)}% gross yield, ${projected.length} projected payments`);
}

// Testnet's own stock tokens pay no dividends; record their prices so P can be valued.
for (const symbol of ['AMZN', 'TSLA', 'AMD', 'PLTR', 'NFLX']) {
  try {
    const { quotes } = await fetchJson<RhQuote>(`https://api.robinhood.com/rhj/prices/${symbol}`);
    const q = quotes[0];
    const sharePrice = (Number(q.bid) + Number(q.ask)) / 2;
    assets[symbol] = {
      symbol, mainnetAddress: '', multiplier: 1, sharePrice, tokenPrice: sharePrice, quotedAt: q.generatedAt,
      tradingHalt: q.isTradingHalt, dividends12m: [], annualDividend: 0, grossYield: 0, netYield: 0, projected: [], reinvestedSoFar: [],
    };
  } catch (e) {
    console.warn(`  ${symbol}: ${(e as Error).message}`);
  }
}

// The testnet DEMO stock pays dividends on demand, so it has no schedule; a nominal $100 share price values P.
assets.DEMO = {
  symbol: 'DEMO', mainnetAddress: '', multiplier: 1, sharePrice: 100, tokenPrice: 100, quotedAt: new Date().toISOString(),
  tradingHalt: false, dividends12m: [], annualDividend: 0, grossYield: 0, netYield: 0, projected: [], reinvestedSoFar: [],
  synthetic: true,
};

const outDir = join(root, 'app/public/data');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'research.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    netRatio,
    replay: {
      tokens: 195, events: replay.length, dividends: dividends.length,
      splits: replay.filter((r) => r.kind === 'split').length,
      freezes: replay.filter((r) => r.kind === 'freeze').length,
      maxDividendStepBps: Math.max(...dividends.map((d) => d.stepBps)),
      rows: replay,
    },
    reinvested: { medianRatio: netRatio, exDateCount: onExDate.length, typicalCount: typical.length, rows: reinvested },
    dilution,
    assets,
  }, null, 1),
);
console.log('wrote app/public/data/research.json');
