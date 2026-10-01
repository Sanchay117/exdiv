import { useResearch } from '../lib/data';
import { StepChart } from '../components/charts/StepChart';
import { ReinvestScatter } from '../components/charts/ReinvestScatter';
import { date, pct } from '../lib/format';

const MAINNET_TX = 'https://robinhoodchain.blockscout.com/tx/';

export function Research() {
  const { data: r, isLoading } = useResearch();
  if (isLoading || !r) return <p className="muted">Loading research…</p>;
  const exDate = r.reinvested.rows.filter((x) => Date.parse(x.effective) - Date.parse(x.exDate) <= 3 * 86_400_000);
  const exDateMedian = [...exDate.map((x) => x.ratio)].sort((a, b) => a - b)[exDate.length >> 1];
  const dilution = (r.dilution ?? []).filter((d) => d.symbol !== 'SGOV').sort((a, b) => b.supplyAtApply / b.supplyAtRecord - a.supplyAtApply / a.supplyAtRecord);
  const adjusted = dilution.map((d) => d.ratio * (d.supplyAtApply / d.supplyAtRecord)).sort((a, b) => a - b);
  const adjustedMedian = adjusted[adjusted.length >> 1];
  const split = r.replay.rows.find((x) => x.kind === 'split');

  return (
    <article className="prose-page">
      <p className="eyebrow">Research</p>
      <h1>What Robinhood Chain's multipliers say about dividends</h1>
      <p className="lede">
        Exdiv prices dividends straight from the ERC-8056 multiplier, so we read every multiplier change Robinhood has made
        on mainnet: {r.replay.events} <code>UIMultiplierUpdated</code> events across all {r.replay.tokens} stock tokens, up to
        block 77,396,069. Three things came out of it.
      </p>

      <section>
        <h2>1. Dividends are small steps; splits are big ones. A 5% line separates them with room to spare.</h2>
        <p>
          The {r.replay.dividends} reinvested dividends moved the multiplier by between {Math.min(...r.replay.rows.filter((x) => x.kind === 'dividend').map((x) => x.stepBps)).toFixed(2)} and{' '}
          {r.replay.maxDividendStepBps.toFixed(0)} bps. The one split, CRWD's 4:1{split ? ` on ${date(split.effectiveAt)}` : ''}, multiplied it by exactly 4. DividendIndex
          treats any rise up to 5% as a dividend and anything else as a split only if it matches a known ratio exactly, otherwise it freezes.
          Replayed through the contract in <code>MainnetReplay.t.sol</code>, every one of the {r.replay.events} changes is classified
          correctly with no freeze and no manual input.
        </p>
        <StepChart rows={r.replay.rows} />
      </section>

      <section>
        <h2>2. Token holders get about {pct(exDateMedian, 0)} of each dividend, not 100%.</h2>
        <p>
          Comparing each multiplier step with the dividend and the prior close on Yahoo Finance: when Robinhood applies the
          dividend on the ex-date ({exDate.length} cases), the step is a median {pct(exDateMedian, 1)} of the gross yield. That is
          what a 30% US withholding tax leaves. SPY's 18 Sep dividend was $1.889 on a $762.60 close, 24.8 bps gross; the SPY
          multiplier rose 17.2 bps. So a dividend token is worth about 70% of the declared dividends, and Exdiv's fair values
          use exactly that.
        </p>
        <ReinvestScatter rows={r.reinvested.rows} />
        <p className="muted small">
          Orange points sit off the 70% line in both directions. That is the third finding.
        </p>
      </section>

      <section>
        <h2>3. Pay-date dividends follow the token, not the record date.</h2>
        <p>
          About half the dividends are applied weeks after the ex-date, on the pay date. By then the token supply has
          changed, and the multiplier spreads the cash over whoever holds the token that day. We rebuilt each token's supply
          from its mint and burn events: once the step is scaled by the supply change, these dividends land back at a median{' '}
          {pct(adjustedMedian, 0)} too. So tokens minted after the record date collect part of a dividend their buyers never
          earned, and holders on the record date are diluted. Where supply shrank, the holders who stayed collected more than
          their share.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Token</th><th>Ex-date</th><th>Applied</th>
                <th className="num">Supply on ex-date</th><th className="num">Supply when applied</th>
                <th className="num">Record-date holders got</th><th className="num">Adjusted for supply</th>
              </tr>
            </thead>
            <tbody>
              {dilution.map((d) => (
                <tr key={d.symbol + d.appliedDate}>
                  <td><strong>{d.symbol}</strong></td>
                  <td>{date(d.recordDate)}</td>
                  <td>{date(d.appliedDate)}</td>
                  <td className="num mono">{d.supplyAtRecord.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                  <td className="num mono">{d.supplyAtApply.toLocaleString('en-US', { maximumFractionDigits: 1 })} ({(d.supplyAtApply / d.supplyAtRecord).toFixed(2)}×)</td>
                  <td className="num">{pct(d.ratio, 1)}</td>
                  <td className="num">{pct(d.ratio * (d.supplyAtApply / d.supplyAtRecord), 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          "Got" is the multiplier step as a share of the gross dividend yield. Supply is rebuilt from Transfer events to and
          from the zero address; the record date is taken as the ex-date (T+1 settlement). SGOV is left out: its monthly
          dividends don't line up one-to-one with the steps.
        </p>
        <p>
          What it means for Exdiv: a dividend token collects exactly what the multiplier delivers, whenever it lands, so it
          is exposed to this the same way any holder is. Pricing D from the declared dividend overstates it on pay-date
          payers whose supply is growing fast. A fix on Robinhood's side would be to apply every dividend on the ex-date, as
          it already does for about half of them.
        </p>
      </section>

      <section>
        <h2>Where this comes from</h2>
        <ul>
          <li><code>scripts/research.ts</code> rebuilds all of it: multiplier events from Robinhood Chain mainnet RPC, prices and dividends from Yahoo Finance, current quotes from Robinhood's <code>/rhj/prices</code> API.</li>
          <li>The events are frozen in <code>contracts/test/fixtures/mainnet-multipliers.json</code> for the replay test.</li>
          <li>Example: SPY's dividend step, <a href={`${MAINNET_TX}${r.replay.rows.find((x) => x.symbol === 'SPY')?.tx}`} target="_blank" rel="noreferrer">on Blockscout</a>.</li>
          <li>Generated {new Date(r.generatedAt).toUTCString()}.</li>
        </ul>
      </section>
    </article>
  );
}
