import { useState } from 'react';
import { erc20Abi, formatUnits, parseUnits, type Address } from 'viem';
import { bookAbi, mockStockTokenAbi, routerAbi, vaultAbi } from '../generated/abis';
import { addressUrl, deployment, FAUCETS } from '../lib/chain';
import { bookFor, useIndexState, useMarkets, useOrders, usePosition, useResearch, type Market, type Order, type Position } from '../lib/data';
import { amount, date, daysUntil, multiplier, pct, shortAddress, usd } from '../lib/format';
import { minusBps, planBuy, planSell, plusBps } from '../lib/book';
import { bookPrice, fairValue, impliedYield, principalDiscount, toBookPrice } from '../lib/valuation';
import { useWallet } from '../lib/wallet';
import { ScheduleBars } from '../components/charts/ScheduleBars';
import type { AssetResearch } from '../lib/types';

const SLIPPAGE_BPS = 100n;
const now = () => Math.floor(Date.now() / 1000);

function parse(v: string) {
  try {
    return v.trim() ? parseUnits(v.trim(), 18) : 0n;
  } catch {
    return 0n;
  }
}

type Run = ReturnType<typeof useWallet>['run'];

/** Approves `spender` for exactly `needed` if the current allowance is short. Returns false if that failed. */
async function ensureAllowance(run: Run, token: Address, symbol: string, spender: Address, needed: bigint, current: bigint) {
  if (current >= needed) return true;
  return run(`Approve ${symbol}`, (w, account) =>
    w.writeContract({ account, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, needed] }),
  );
}

function Amount({ label, value, onChange, max, unit }: { label: string; value: string; onChange: (v: string) => void; max?: bigint; unit: string }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {max != null && (
          <button type="button" className="link small" onClick={() => onChange(formatUnits(max, 18))}>
            Max {amount(max)}
          </button>
        )}
      </span>
      <span className="field-input">
        <input inputMode="decimal" placeholder="0.0" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

function ConnectFirst() {
  const { connect, hasWallet } = useWallet();
  return hasWallet ? (
    <button className="btn btn-block" onClick={connect}>Connect wallet</button>
  ) : (
    <p className="muted small">Install a browser wallet (Rabby, MetaMask) to use the testnet markets. Everything else here is readable without one.</p>
  );
}

// ---------------------------------------------------------------- actions

function Strip({ m, pos }: { m: Market; pos?: Position }) {
  const { run, account } = useWallet();
  const [v, setV] = useState('');
  const assets = parse(v);
  const units = (assets * m.index) / 10n ** 18n;
  const matured = now() >= m.maturity;
  const go = async () => {
    if (!pos || !(await ensureAllowance(run, m.asset, m.symbol, m.vault, assets, pos.allowance.assetVault))) return;
    if (await run(`Strip ${v} ${m.symbol}`, (w, a) => w.writeContract({ account: a, address: m.vault, abi: vaultAbi, functionName: 'mint', args: [assets, a, a] }))) setV('');
  };
  return (
    <div className="action">
      <p className="muted">Deposit stock tokens. You get one <b className="t-p">P</b> and one <b className="t-d">D</b> per share unit; together they redeem for the same tokens any time before maturity.</p>
      <Amount label={`${m.symbol} to strip`} value={v} onChange={setV} max={pos?.asset} unit={m.symbol} />
      <div className="preview">
        <span>You receive</span>
        <span className="mono">
          {amount(units)} {m.principalSymbol}
          <br />
          {amount(units)} {m.dividendSymbol}
        </span>
      </div>
      {!account ? <ConnectFirst /> : (
        <button className="btn btn-block" disabled={matured || assets === 0n || assets > (pos?.asset ?? 0n)} onClick={go}>
          {matured ? 'Matured' : `Strip ${m.symbol}`}
        </button>
      )}
    </div>
  );
}

function Advance({ m, pos, bids, asset }: { m: Market; pos?: Position; bids: Order[]; asset?: AssetResearch }) {
  const { run, account } = useWallet();
  const [v, setV] = useState('');
  const assets = parse(v);
  const units = (assets * m.index) / 10n ** 18n;
  const plan = planSell(bids, units);
  const minOut = minusBps(plan.quote, SLIPPAGE_BPS);
  const usdg = Number(plan.quote) / 1e6;
  const y = asset && units > 0n ? impliedYield(usdg / Number(formatUnits(plan.filled || 1n, 18)), asset.sharePrice, now(), m.maturity) : null;
  const go = async () => {
    if (!pos || !(await ensureAllowance(run, m.asset, m.symbol, deployment.router, assets, pos.allowance.assetRouter))) return;
    const ok = await run(`Sell ${m.symbol} dividends for USDG`, (w, a) =>
      w.writeContract({ account: a, address: deployment.router, abi: routerAbi, functionName: 'stripAndSellDividends', args: [m.vault, assets, plan.ids, minOut, a] }),
    );
    if (ok) setV('');
  };
  return (
    <div className="action">
      <p className="muted">Strip and sell the dividend half in one transaction. You keep the <b className="t-p">price</b> exposure and get the dividends until {date(m.maturity)} in USDG now.</p>
      <Amount label={`${m.symbol} to strip`} value={v} onChange={setV} max={pos?.asset} unit={m.symbol} />
      <div className="preview">
        <span>You keep</span>
        <span className="mono">{amount(units)} {m.principalSymbol}</span>
      </div>
      <div className="preview">
        <span>You get now</span>
        <span className="mono">
          {usd(usdg)} USDG
          {plan.filled < units && units > 0n && <><br /><span className="warn">only {amount(plan.filled)} D has bids; the rest comes back to you</span></>}
        </span>
      </div>
      {y != null && units > 0n && plan.filled > 0n && (
        <div className="preview"><span>Buyer's implied yield</span><span className="mono">{pct(y)} a year</span></div>
      )}
      {!account ? <ConnectFirst /> : (
        <button className="btn btn-block btn-d" disabled={assets === 0n || assets > (pos?.asset ?? 0n) || plan.filled === 0n || now() >= m.maturity} onClick={go}>
          Sell dividends for {usd(usdg)}
        </button>
      )}
    </div>
  );
}

function Claim({ m, pos, assetBids }: { m: Market; pos?: Position; assetBids: Order[] }) {
  const { run, account } = useWallet();
  const claimable = pos?.claimable ?? 0n;
  const plan = planSell(assetBids, claimable);
  const claimStock = () =>
    run(`Claim ${m.symbol} dividends`, (w, a) => w.writeContract({ account: a, address: m.vault, abi: vaultAbi, functionName: 'claimDividends', args: [a, a] }));
  const claimUsdg = async () => {
    if (!pos) return;
    if (!pos.routerIsOperator) {
      const ok = await run('Let the router claim for you', (w, a) =>
        w.writeContract({ account: a, address: m.vault, abi: vaultAbi, functionName: 'setOperator', args: [deployment.router, true] }),
      );
      if (!ok) return;
    }
    await run(`Claim ${m.symbol} dividends as USDG`, (w, a) =>
      w.writeContract({ account: a, address: deployment.router, abi: routerAbi, functionName: 'claimDividendsForQuote', args: [m.vault, plan.ids, minusBps(plan.quote, SLIPPAGE_BPS), a] }),
    );
  };
  return (
    <div className="action">
      <p className="muted">Dividends accrue to whoever holds <b className="t-d">D</b> when Robinhood raises the multiplier. Claim them as {m.symbol} tokens, or sold into the order book as USDG.</p>
      <div className="preview big-preview">
        <span>Claimable</span>
        <span className="mono">{amount(claimable, 18, 6)} {m.symbol}</span>
      </div>
      {!account ? <ConnectFirst /> : (
        <div className="row">
          <button className="btn btn-ghost" disabled={claimable === 0n} onClick={claimStock}>Claim as {m.symbol}</button>
          <button className="btn btn-d" disabled={claimable === 0n || plan.filled === 0n} onClick={claimUsdg}>
            Claim as {usd(Number(plan.quote) / 1e6)} USDG
          </button>
        </div>
      )}
    </div>
  );
}

function Redeem({ m, pos }: { m: Market; pos?: Position }) {
  const { run, account } = useWallet();
  const [v, setV] = useState('');
  const units = parse(v);
  const matured = now() >= m.maturity;
  const max = pos ? (matured ? pos.principal : pos.principal < pos.dividend ? pos.principal : pos.dividend) : undefined;
  const assets = m.index > 0n ? (units * 10n ** 18n) / m.index : 0n;
  return (
    <div className="action">
      <p className="muted">
        {matured
          ? `Matured: each P redeems on its own for one share unit's worth of ${m.symbol}.`
          : `Before maturity, one P plus one D redeem for one share unit's worth of ${m.symbol}. Dividends you've earned stay claimable.`}
      </p>
      <Amount label="Units to redeem" value={v} onChange={setV} max={max} unit={matured ? 'P' : 'P + D'} />
      <div className="preview"><span>You receive</span><span className="mono">{amount(assets)} {m.symbol}</span></div>
      {!account ? <ConnectFirst /> : (
        <button className="btn btn-block btn-ghost" disabled={units === 0n || units > (max ?? 0n) || !m.reliable}
          onClick={async () => { if (await run(`Redeem ${v} units`, (w, a) => w.writeContract({ account: a, address: m.vault, abi: vaultAbi, functionName: 'redeem', args: [units, a] }))) setV(''); }}>
          Redeem
        </button>
      )}
    </div>
  );
}

function Trade({ m, pos, orders, asset }: { m: Market; pos?: Position; orders?: Order[]; asset?: AssetResearch }) {
  const { run, account } = useWallet();
  const [which, setWhich] = useState<'d' | 'p'>('d');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [mode, setMode] = useState<'market' | 'limit'>('market');
  const [v, setV] = useState('');
  const [price, setPrice] = useState('');
  const base = which === 'd' ? m.dividend : m.principal;
  const symbol = which === 'd' ? m.dividendSymbol : m.principalSymbol;
  const held = which === 'd' ? pos?.dividend : pos?.principal;
  const baseAllowance = which === 'd' ? pos?.allowance.dividendBook : pos?.allowance.principalBook;
  const { bids, asks } = bookFor(orders, base);
  const size = parse(v);
  const plan = side === 'buy' ? planBuy(asks, size) : planSell(bids, size);
  const limitPrice = Number(price) > 0 ? toBookPrice(Number(price)) : 0n;
  const limitCost = (size * limitPrice + 10n ** 18n - 1n) / 10n ** 18n;
  const fair = fairValue(asset, now(), m.maturity);
  const ref = which === 'd' ? fair?.dividend : fair?.principal;

  const go = async () => {
    if (!pos || !account) return;
    if (mode === 'market') {
      if (side === 'buy') {
        const max = plusBps(plan.quote, SLIPPAGE_BPS);
        if (!(await ensureAllowance(run, deployment.usdg, 'USDG', deployment.book, max, pos.allowance.usdgBook))) return;
        await run(`Buy ${v} ${symbol}`, (w, a) => w.writeContract({ account: a, address: deployment.book, abi: bookAbi, functionName: 'buy', args: [base, size, plan.ids, max, a] }));
      } else {
        if (!(await ensureAllowance(run, base, symbol, deployment.book, size, baseAllowance ?? 0n))) return;
        await run(`Sell ${v} ${symbol}`, (w, a) => w.writeContract({ account: a, address: deployment.book, abi: bookAbi, functionName: 'sell', args: [base, size, plan.ids, minusBps(plan.quote, SLIPPAGE_BPS), a] }));
      }
    } else {
      const ok = side === 'buy'
        ? await ensureAllowance(run, deployment.usdg, 'USDG', deployment.book, limitCost, pos.allowance.usdgBook)
        : await ensureAllowance(run, base, symbol, deployment.book, size, baseAllowance ?? 0n);
      if (!ok) return;
      await run(`${side === 'buy' ? 'Bid' : 'Offer'} ${v} ${symbol} at ${usd(Number(price))}`, (w, a) =>
        w.writeContract({ account: a, address: deployment.book, abi: bookAbi, functionName: 'placeOrder', args: [base, side === 'buy', limitPrice, size] }));
    }
    setV('');
  };
  const disabled = size === 0n || (mode === 'market' ? plan.filled === 0n : limitPrice === 0n) || (side === 'sell' && size > (held ?? 0n));

  return (
    <div className="action">
      <div className="seg">
        <button className={which === 'd' ? 'on' : ''} onClick={() => setWhich('d')}><span className="key key-d" /> Dividends (D)</button>
        <button className={which === 'p' ? 'on' : ''} onClick={() => setWhich('p')}><span className="key key-p" /> Principal (P)</button>
      </div>
      <div className="seg">
        <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>Buy</button>
        <button className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>Sell</button>
        <button className={mode === 'market' ? 'on' : ''} onClick={() => setMode('market')}>Market</button>
        <button className={mode === 'limit' ? 'on' : ''} onClick={() => setMode('limit')}>Limit</button>
      </div>
      <Amount label={`${symbol} amount`} value={v} onChange={setV} max={side === 'sell' ? held : undefined} unit={which === 'd' ? 'D' : 'P'} />
      {mode === 'limit' && (
        <label className="field">
          <span className="field-label">Price per unit {ref != null && <span className="muted small">fair ≈ {usd(ref)}</span>}</span>
          <span className="field-input"><input inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} /><span className="unit">USDG</span></span>
        </label>
      )}
      <div className="preview">
        <span>{mode === 'market' ? (side === 'buy' ? 'You pay' : 'You get') : side === 'buy' ? 'You escrow' : 'You escrow'}</span>
        <span className="mono">
          {mode === 'market' ? `${usd(Number(plan.quote) / 1e6)} USDG` : side === 'buy' ? `${usd(Number(limitCost) / 1e6)} USDG` : `${amount(size)} ${symbol}`}
          {mode === 'market' && plan.filled < size && size > 0n && <><br /><span className="warn">book only has {amount(plan.filled)}</span></>}
        </span>
      </div>
      {!account ? <ConnectFirst /> : <button className="btn btn-block" disabled={disabled} onClick={go}>{mode === 'market' ? (side === 'buy' ? 'Buy' : 'Sell') : 'Place order'}</button>}
    </div>
  );
}

// ---------------------------------------------------------------- panels

function BookSide({ title, keyClass, bids, asks, fair, account, onCancel }: { title: string; keyClass: string; bids: Order[]; asks: Order[]; fair?: number; account?: Address; onCancel: (id: bigint) => void }) {
  const rows = (list: Order[], side: 'bid' | 'ask') =>
    list.slice(0, 6).map((o) => (
      <tr key={String(o.id)} className={side}>
        <td className="mono">{usd(bookPrice(o.price))}</td>
        <td className="num mono">{amount(o.remaining, 18, 3)}</td>
        <td className="num">
          {account && o.maker.toLowerCase() === account.toLowerCase() ? (
            <button className="link small" onClick={() => onCancel(o.id)}>cancel</button>
          ) : (
            <span className="muted small">{shortAddress(o.maker)}</span>
          )}
        </td>
      </tr>
    ));
  return (
    <div className="card book">
      <div className="book-head">
        <h3><span className={`key ${keyClass}`} /> {title}</h3>
        {fair != null && <span className="muted small">fair ≈ {usd(fair)}</span>}
      </div>
      <table className="table compact">
        <thead><tr><th>Price (USDG)</th><th className="num">Units</th><th /></tr></thead>
        <tbody>
          {[...asks.slice(0, 6)].reverse().length ? rows([...asks.slice(0, 6)].reverse(), 'ask') : <tr><td colSpan={3} className="muted small">No offers</td></tr>}
          <tr className="spread"><td colSpan={3} /></tr>
          {bids.length ? rows(bids, 'bid') : <tr><td colSpan={3} className="muted small">No bids</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PositionCard({ m, pos }: { m: Market; pos?: Position }) {
  const { account, run } = useWallet();
  if (!account) return null;
  const canFaucet = m.isMirror && pos?.nextFaucet != null && pos.nextFaucet <= now();
  return (
    <div className="card">
      <h3>Your position</h3>
      <dl className="kv">
        <dt>{m.symbol}</dt><dd className="mono">{amount(pos?.asset)}</dd>
        <dt><span className="key key-p" /> {m.principalSymbol}</dt><dd className="mono">{amount(pos?.principal)}</dd>
        <dt><span className="key key-d" /> {m.dividendSymbol}</dt><dd className="mono">{amount(pos?.dividend)}</dd>
        <dt>Claimable dividends</dt><dd className="mono">{amount(pos?.claimable, 18, 6)} {m.symbol}</dd>
        <dt>USDG</dt><dd className="mono">{amount(pos?.usdg, 6, 2)}</dd>
      </dl>
      <div className="row">
        {m.isMirror && (
          <button className="btn btn-small btn-ghost" disabled={!canFaucet}
            onClick={() => run(`Get 100 test ${m.symbol}`, (w, a) => w.writeContract({ account: a, address: m.asset, abi: mockStockTokenAbi, functionName: 'faucet' }))}>
            {canFaucet ? `Get 100 test ${m.symbol}` : 'Faucet used today'}
          </button>
        )}
        <a className="btn btn-small btn-ghost" href={FAUCETS.usdg} target="_blank" rel="noreferrer">USDG faucet</a>
        <a className="btn btn-small btn-ghost" href={FAUCETS.eth} target="_blank" rel="noreferrer">Gas faucet</a>
      </div>
    </div>
  );
}

const TABS = ['Strip', 'Sell dividends', 'Claim', 'Redeem', 'Trade'] as const;

export function MarketView({ vault }: { vault: Address }) {
  const markets = useMarkets();
  const research = useResearch();
  const orders = useOrders();
  const { account, run } = useWallet();
  const m = markets.data?.find((x) => x.vault.toLowerCase() === vault.toLowerCase());
  const pos = usePosition(m, account).data;
  const idx = useIndexState(m?.asset).data;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Strip');

  if (markets.isLoading) return <p className="muted">Loading…</p>;
  if (!m) return <p className="error">No Exdiv vault at {vault}.</p>;

  const asset = research.data?.assets[m.symbol];
  const fair = fairValue(asset, now(), m.maturity);
  const dBook = bookFor(orders.data, m.dividend);
  const pBook = bookFor(orders.data, m.principal);
  const assetBook = bookFor(orders.data, m.asset);
  const matured = now() >= m.maturity;
  const bestDBid = dBook.bids[0] ? bookPrice(dBook.bids[0].price) : null;
  const bestPAsk = pBook.asks[0] ? bookPrice(pBook.asks[0].price) : null;
  const disc = bestPAsk != null && asset ? principalDiscount(bestPAsk, asset.sharePrice, now(), m.maturity) : null;
  const cancel = (id: bigint) => run('Cancel order', (w, a) => w.writeContract({ account: a, address: deployment.book, abi: bookAbi, functionName: 'cancelOrder', args: [id] }));

  return (
    <>
      <a href="#/" className="back">← Markets</a>
      <section className="market-head">
        <div>
          <p className="eyebrow">{m.assetName}</p>
          <h1>{m.symbol} <span className="muted">strips to {date(m.maturity)}</span></h1>
          <p className="muted">
            {matured ? 'Matured' : `${daysUntil(m.maturity)} days to maturity`} · vault{' '}
            <a href={addressUrl(m.vault)} target="_blank" rel="noreferrer" className="mono">{shortAddress(m.vault)}</a>
            {' · '}
            <span className={`pill ${m.reliable ? 'pill-ok' : 'pill-warn'}`}>{idx?.frozen ? 'Index frozen: awaiting classification' : matured ? (m.settledIndex > 0n ? 'Settled' : 'Matured') : 'Live'}</span>
          </p>
        </div>
        <dl className="head-stats">
          <div><dt>Share price</dt><dd>{asset ? usd(asset.sharePrice) : '—'}</dd></div>
          <div><dt>Token multiplier</dt><dd className="mono">{multiplier(m.multiplier)}</dd></div>
          <div><dt>Dividend index</dt><dd className="mono">{multiplier(m.index)}</dd></div>
          <div><dt>Stripped</dt><dd>{amount(m.principalSupply, 18, 2)} units</dd></div>
        </dl>
      </section>

      <section className="market-grid">
        <div className="card actions">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          {tab === 'Strip' && <Strip m={m} pos={pos} />}
          {tab === 'Sell dividends' && <Advance m={m} pos={pos} bids={dBook.bids} asset={asset} />}
          {tab === 'Claim' && <Claim m={m} pos={pos} assetBids={assetBook.bids} />}
          {tab === 'Redeem' && <Redeem m={m} pos={pos} />}
          {tab === 'Trade' && <Trade m={m} pos={pos} orders={orders.data} asset={asset} />}
        </div>
        <div className="side">
          <PositionCard m={m} pos={pos} />
          <div className="card">
            <h3>What the halves are worth</h3>
            <dl className="kv">
              <dt><span className="key key-d" /> Dividends to maturity (fair)</dt><dd>{fair ? usd(fair.dividend) : usd(0)}</dd>
              <dt><span className="key key-p" /> Price half (fair)</dt><dd>{fair ? usd(fair.principal) : '—'}</dd>
              <dt>Best D bid, as a yield</dt><dd>{bestDBid != null && asset ? pct(impliedYield(bestDBid, asset.sharePrice, now(), m.maturity)) : '—'}</dd>
              <dt>Best P offer, discount</dt><dd>{disc ? `${pct(disc.discount)} (${pct(disc.annualized)} a year)` : '—'}</dd>
            </dl>
            {!asset && <p className="muted small">This testnet token pays no dividends, so its D is worth nothing and its P is the whole share.</p>}
          </div>
        </div>
      </section>

      <section className="books">
        <BookSide title={`${m.dividendSymbol} / USDG`} keyClass="key-d" bids={dBook.bids} asks={dBook.asks} fair={fair?.dividend} account={account} onCancel={cancel} />
        <BookSide title={`${m.principalSymbol} / USDG`} keyClass="key-p" bids={pBook.bids} asks={pBook.asks} fair={fair?.principal} account={account} onCancel={cancel} />
      </section>

      {fair && fair.payments.length > 0 && (
        <section className="card">
          <h3>Dividends this {m.dividendSymbol} collects</h3>
          <p className="muted small">Each of the last 12 months' {m.symbol} dividends, rolled forward 52 weeks, that falls before maturity. Bars show what Robinhood reinvests per share (after withholding); the D holder gets exactly that.</p>
          <ScheduleBars payments={fair.payments} />
        </section>
      )}

      {idx && (
        <section className="card">
          <h3>Dividend index history</h3>
          <p className="muted small">Every multiplier change the DividendIndex has classified as a dividend for this token. Splits don't appear: they leave the index alone.</p>
          <table className="table compact">
            <thead><tr><th>Effective</th><th className="num">Index</th><th className="num">Step</th></tr></thead>
            <tbody>
              {idx.checkpoints.map((c, i) => (
                <tr key={i}>
                  <td>{i === 0 ? `${date(c.time)} (registered)` : date(c.time)}</td>
                  <td className="num mono">{multiplier(c.index)}</td>
                  <td className="num mono">{i === 0 ? '—' : `+${((Number(c.index) / Number(idx.checkpoints[i - 1].index) - 1) * 10_000).toFixed(2)} bps`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
