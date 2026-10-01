import { addressUrl, deployment } from '../lib/chain';
import { shortAddress } from '../lib/format';

const CONTRACTS: [keyof typeof deployment, string, string][] = [
  ['dividendIndex', 'DividendIndex', 'Classifies every multiplier change as a split or a dividend; keeps the dividend index and its history.'],
  ['factory', 'ExdivFactory', 'Deploys one vault per stock token and maturity. Permissionless for registered tokens.'],
  ['book', 'ExdivBook', 'Escrowed limit order book; every market quotes in USDG.'],
  ['router', 'ExdivRouter', 'One-transaction flows: strip and sell dividends, claim dividends as USDG.'],
  ['usdg', 'USDG (Paxos)', 'Global Dollar on Robinhood Chain testnet, the quote currency.'],
];

export function How() {
  return (
    <article className="prose-page">
      <p className="eyebrow">How it works</p>
      <h1>One stock token, two claims</h1>
      <p className="lede">
        A Robinhood stock token is a total-return asset: one raw token stands for <code>uiMultiplier</code> shares, and
        Robinhood raises the multiplier to reinvest each dividend. Exdiv splits that return in two, the way Treasury STRIPS
        split a bond into principal and coupons.
      </p>

      <section className="steps">
        <div className="card step">
          <span className="step-n">1</span>
          <h3>Strip</h3>
          <p>Deposit <code>n</code> raw tokens into the vault for a maturity. At dividend index <code>I</code> they are <code>n × I</code> share units. You get that many <b className="t-p">P</b> and <b className="t-d">D</b>.</p>
        </div>
        <div className="card step">
          <span className="step-n">2</span>
          <h3>Dividends land</h3>
          <p>Robinhood raises the multiplier, and with it the index, from <code>I₀</code> to <code>I₁</code>. One unit now needs only <code>1/I₁</code> raw tokens. The surplus, <code>units × (1/I₀ − 1/I₁)</code>, belongs to whoever held D, claimable any time.</p>
        </div>
        <div className="card step">
          <span className="step-n">3</span>
          <h3>Maturity</h3>
          <p>The index is fixed at its value on the maturity date. Each P redeems for <code>1/I_T</code> raw tokens, exactly one share unit's worth. D stops accruing; later dividends ride on the tokens P holders take home.</p>
        </div>
      </section>

      <section>
        <h2>Telling dividends from splits</h2>
        <p>
          A split multiplies the multiplier (CRWD went from 1.0 to 4.0); a dividend nudges it up (SPY went up 0.17%). Both
          arrive as the same event. <code>DividendIndex</code> classifies each change the first time anyone syncs it:
        </p>
        <ol>
          <li>a split the attester announced ahead of time, with any dividend paid in the same step kept as a dividend;</li>
          <li>otherwise a rise of at most 5% is a reinvested dividend (the largest real one so far is 2.1%);</li>
          <li>otherwise an exact known ratio (2:1, 3:2, 1:10, …) is a split;</li>
          <li>anything else freezes the token at its last index until the owner classifies it.</li>
        </ol>
        <p>
          The index records when each change took effect (the token's <code>effectiveAt</code>), so a vault settles on the
          index as it stood at maturity even if nobody touched it for weeks. The keeper announces splits and stock dividends
          from Robinhood's corporate-actions feed and syncs on every multiplier event.
        </p>
      </section>

      <section>
        <h2>What you have to trust</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Piece</th><th>Can</th><th>Can't</th></tr></thead>
            <tbody>
              <tr><td>Vault</td><td>Hold stock tokens, mint and burn P and D</td><td>Be paused, upgraded or drained by anyone. It has no owner and no price oracle, so there is nothing to manipulate and nothing to liquidate.</td></tr>
              <tr><td>Index owner</td><td>Register stock tokens; classify a step that froze the index</td><td>Set the index. It can only pick a split ratio, and the dividend left over must be between 0 and 20%. It can't touch any vault's tokens.</td></tr>
              <tr><td>Attester (keeper)</td><td>Announce an upcoming split or stock dividend</td><td>Change anything else. An announcement only applies to a step it explains, within the same 5% bound.</td></tr>
              <tr><td>Order book</td><td>Hold makers' escrow until filled or cancelled</td><td>Fill at a worse price than the taker's limit. No fees, no matching engine to front-run.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>How it's tested</h2>
        <ul>
          <li><b>Mainnet replay.</b> Every <code>UIMultiplierUpdated</code> event on Robinhood Chain mainnet (45 dividends and CRWD's split) runs through <code>DividendIndex</code>: no freezes, every step classified correctly.</li>
          <li><b>Invariants.</b> Random deposits, redemptions, transfers, claims, dividends, splits and time jumps (25,600 calls per run). The vault always holds enough stock tokens for every P and every dividend owed; tokens are never created or lost; before maturity P and D supplies match; rounding dust stays below 10⁻¹² tokens.</li>
          <li><b>Fuzzing.</b> Conservation across random dividend paths, the index tracking dividends but not splits, and order-book escrow always covering fills.</li>
          <li><b>Unit tests</b> for every classification rule, freezes, owner bounds, scheduled multipliers, settlement before and after maturity, operators, and the router flows.</li>
        </ul>
        <pre className="code">cd contracts && forge test</pre>
      </section>

      <section>
        <h2>Contracts on Robinhood Chain testnet</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {CONTRACTS.map(([key, name, what]) => (
                <tr key={key}>
                  <td><strong>{name}</strong><div className="muted small">{what}</div></td>
                  <td className="num"><a className="mono" href={addressUrl(deployment[key] as string)} target="_blank" rel="noreferrer">{shortAddress(deployment[key] as string)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Testnet's own stock tokens (AMZN, TSLA, AMD, PLTR, NFLX) implement ERC-8056 but never pay dividends, so the
          dividend payers here are mirrors of mainnet SPY, SCHD, MSFT and UPS whose multipliers a keeper copies from mainnet.
          On mainnet the same contracts would point at the real tokens.
        </p>
      </section>

      <section>
        <h2>Limits, honestly</h2>
        <ul>
          <li>D is priced from last year's dividends rolled forward, undiscounted. Dividends get cut and raised; the order book is where that gets priced.</li>
          <li>Pay-date dividends follow the token supply on the pay date (see Research), so D on fast-growing tokens can collect less than the declared dividend.</li>
          <li>Testnet liquidity in the order book is seeded by us. On mainnet, D and P would also want an AMM built for assets that converge at maturity.</li>
          <li>The contracts are unaudited.</li>
        </ul>
      </section>
    </article>
  );
}
