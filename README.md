# Exdiv

**Take the dividends off your stocks.** Exdiv splits a Robinhood stock token into its price and its dividends until a maturity date, so you can keep one and sell the other for USDG.

Built on Robinhood Chain for the Arbitrum Open House Singapore buildathon, with Paxos USDG as the quote currency.

- **App:** https://sanchay117.github.io/exdiv/ (Robinhood Chain testnet)
- **Demo video:** _link_
- **Contracts:** [Robinhood Chain testnet](#deployed-contracts), verified on Blockscout

![Exdiv](docs/hero.png)

## The problem

A Robinhood stock token is a total-return asset. It implements ERC-8056: one raw token stands for `uiMultiplier` shares, and when a stock pays a dividend Robinhood raises the multiplier to reinvest it. SPY's token has gone from 1.0 to 1.0017 this way; 42 tokens have had at least one dividend reinvested onchain.

That is neat for compounding and a dead end for everything else:

- **No income.** In the Robinhood app you can turn dividend reinvestment off. Onchain there is no switch, so anyone who wants dividends as cash has to sell slivers of stock by hand.
- **No way to sell or hedge dividends on their own.** In traditional markets dividends trade separately: dividend futures on the S&P 500 and Euro Stoxx 50, dividend swaps, and the same idea for bonds in Treasury STRIPS. Onchain the dividend stream is locked inside the token.
- **Integrators get the units wrong.** One token is not one share (CRWD's token is four, after a split), and a split and a dividend both just move the multiplier.

## What Exdiv does

Deposit stock tokens into a vault for a maturity date and get two tokens per share unit:

| Token | What it is | Example (SPY, to 31 Dec 2026) |
|---|---|---|
| **P** (principal) | The stock without its dividends. At maturity, one P redeems for exactly one share unit's worth of the stock token. | `SPY-P-31DEC2026`, worth about the share price minus the dividends it gives up |
| **D** (dividends) | Every dividend Robinhood reinvests until maturity, claimable any time, as stock tokens or as USDG. | `SPY-D-31DEC2026`, worth about one quarterly dividend after withholding |

Before maturity, one P and one D always redeem back into the stock. Three things this makes possible:

1. **Dividend advance.** Strip SPY and sell the D half on the USDG order book in one transaction: next year's dividends in cash today, full price exposure kept.
2. **Income mode.** Hold both halves and claim each dividend as it lands, straight into USDG. The reinvestment off switch the token doesn't have.
3. **Stock at a discount.** Buy P below the share price; the discount is your return at maturity.

## What we found on Robinhood Chain

Exdiv prices dividends from the multiplier, so we read every multiplier change Robinhood has made on mainnet: 47 `UIMultiplierUpdated` events across all 195 stock tokens (`scripts/research.ts`; the app's Research page has the charts).

1. **Dividends and splits are easy to tell apart, with a wide margin.** The 45 reinvested dividends moved the multiplier by 0.02 to 215 bps (CCL's was the largest). The one split, CRWD 4:1, multiplied it by exactly 4. A 5% line separates them with more than 2x headroom over the largest real dividend.
2. **Holders get about 69% of each dividend, not 100%.** When Robinhood applies a dividend on its ex-date, the multiplier step is a median 68.7% of the dividend yield (21 events, tightly clustered): what a 30% US withholding tax leaves. SPY's 18 Sep dividend was $1.889 on a $762.60 close (24.8 bps); its multiplier rose 17.2 bps. D tokens are valued on that basis.
3. **Dividends applied on the pay date follow the token, not the record date.** About half the dividends are applied weeks after the ex-date. The multiplier then spreads the cash over everyone holding on the pay date. Rebuilding supply from mint and burn events: LLY's supply grew 466x between ex-date and pay date, so record-date holders got 0.2% of their dividend; JNJ 160x, 0.4%; MSFT 3.1x, 22%. Scaled by the supply change, these land back on ~70% too. Where supply shrank (CCL, 0.2x), holders who stayed collected about four times their dividend. Tokens minted after the record date can collect dividends their buyers never earned. Applying every dividend on the ex-date, as Robinhood already does for half of them, would close this.

## How it works

```
                 DividendIndex (one per chain)
   stock token ─▶ classifies every multiplier change as split or dividend,
   uiMultiplier   keeps a dividend index I and its history by effective time
                          │
                          ▼
   deposit n tokens ─▶ ExdivVault (one per token and maturity) ─▶ n·I units of P and D
                          │  dividend: I0 → I1, each unit needs 1/I1 tokens instead of 1/I0
                          │            the surplus, units·(1/I0 − 1/I1), belongs to D holders
                          │  maturity: I fixed at I_T, each P redeems for 1/I_T tokens
                          ▼
                    ExdivBook (USDG limit order book) ◀── ExdivRouter (strip and sell D; claim as USDG)
```

| Contract | Role |
|---|---|
| [`DividendIndex`](contracts/src/DividendIndex.sol) | Splits each multiplier change into a split part and a dividend part. Keeps a dividend index per token (share units per raw token, moved by dividends only) with checkpoints by effective time. |
| [`ExdivVault`](contracts/src/ExdivVault.sol) | Mints P and D, accrues dividends to D holders (settled on every D transfer), redeems pairs before maturity and P alone after. No owner, no oracle, no liquidations. |
| [`ExdivFactory`](contracts/src/ExdivFactory.sol) | One vault per (token, maturity), CREATE2, permissionless for registered tokens. Token names and symbols are generated onchain (`SPY-D-31DEC2026`). |
| [`ExdivBook`](contracts/src/ExdivBook.sol) | Escrowed limit order book, every market quoted in USDG. Takers pass order ids and a slippage bound. No fees, no matching engine. |
| [`ExdivRouter`](contracts/src/ExdivRouter.sol) | `stripAndSellDividends` and `claimDividendsForQuote`. Holds nothing between calls; only accepts vaults the factory made. |
| [`MockStockToken`](contracts/src/mocks/MockStockToken.sol) | Testnet only: an ERC-8056 token whose multiplier a keeper copies from the mainnet token. |

### Telling a dividend from a split

Each multiplier change is classified the first time anyone syncs it:

1. a split the attester announced in advance (a dividend paid in the same step is kept as a dividend);
2. otherwise, a rise of at most 5% is a reinvested dividend;
3. otherwise, an exact known ratio (2:1, 3:2, 1:10, ...) is a split;
4. anything else freezes the token at its last index until the owner classifies it.

The index never decreases. Changes are recorded at the token's `effectiveAt`, so a vault settles on the index as it stood at maturity even if nobody touched it for weeks, and a dividend that lands after maturity goes to P holders (it rides on the tokens they take home).

### What you have to trust

| Role | Can | Can't |
|---|---|---|
| Vault | Hold tokens, mint and burn P and D | Be paused, upgraded or drained. It has no owner and reads no prices. |
| Index owner | Register tokens; classify a step that froze the index | Set the index. It picks a split ratio, and the dividend left over must be 0 to 20%. |
| Attester (keeper) | Announce an upcoming split or stock dividend | Anything else. An announcement only applies to a step it explains within 5%. |
| Order book | Hold makers' escrow | Fill a taker at a worse price than their limit. |

## Testing

```bash
cd contracts && forge test
```

63 tests, all passing; 98% line coverage on `src` (`forge coverage`); `forge lint src` clean, with the excluded rules justified in `foundry.toml`.

- **Mainnet replay** ([`MainnetReplay.t.sol`](contracts/test/MainnetReplay.t.sol)): every `UIMultiplierUpdated` event on Robinhood Chain mainnet runs through `DividendIndex`. All 45 dividends and CRWD's split are classified correctly, with no freeze and no manual input.
- **Invariants** ([`ExdivInvariant.t.sol`](contracts/test/ExdivInvariant.t.sol)): random deposits, redemptions, P and D transfers, claims, dividends, splits and time jumps, 25,600 calls per run. The vault always holds enough for every P and every dividend owed; tokens are never created or lost; P and D supplies match before maturity; rounding dust stays below 1e-12 tokens.
- **Fuzzing**: conservation over random dividend paths, the index tracking dividends but not splits, order-book escrow always covering fills.
- **Unit tests** for each classification rule, freezes and owner bounds, scheduled multipliers, settlement before and after maturity, operators, the order book and the router.
- The app's pricing and order planning have their own tests (`cd app && npm test`).

## Deployed contracts

Robinhood Chain testnet (chain id 46630):

| Contract | Address |
|---|---|
| DividendIndex | _pending_ |
| ExdivFactory | _pending_ |
| ExdivBook | _pending_ |
| ExdivRouter | _pending_ |
| USDG (Paxos) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |

Testnet's own stock tokens (AMZN, TSLA, AMD, PLTR, NFLX) implement ERC-8056 but pay no dividends, so they get vaults with nothing to collect. The dividend payers are mirrors of mainnet SPY, SCHD, MSFT and UPS: a keeper copies each mainnet multiplier change, so testnet dividends arrive when and as Robinhood pays them.

## Run it

Requires Node 22.18+ and Foundry.

```bash
npm install && (cd app && npm install)
cd contracts && forge test && cd ..
npm run research          # rebuilds app/public/data/research.json from mainnet + Yahoo Finance
cd app && npm run dev     # http://localhost:5173, reads Robinhood Chain testnet
```

Deploying your own copy (`contracts/.env` holds `PRIVATE_KEY`):

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --verify \
  --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/
cd .. && npm run abis      # copies ABIs and addresses into the app
npm run keeper             # mirror mainnet multipliers, announce splits, sync, settle
npm run market-maker       # seed the USDG order book around fair value
```

## Limits and next steps

- **Mainnet.** The contracts need no oracle, so pointing a factory at the real SPY token on Robinhood Chain mainnet is a deployment, not a rewrite.
- **Pricing D.** Fair values roll last year's dividends forward, undiscounted. A real market for D (and an AMM designed for assets that converge at maturity, as Pendle built for yield) is where dividend expectations get priced.
- **Pay-date dilution** (finding 3) affects D like any holder. Ex-date application on Robinhood's side would fix it for everyone.
- **Keeper decentralization.** Split announcements come from one attester today; the bounds above limit what it can do, and Chainlink's corporate-action handling or a multisig could replace it.
- The contracts are unaudited.

## License

MIT
