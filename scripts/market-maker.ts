// Seeds (or refreshes) testnet liquidity in ExdivBook around fair value, so the markets can be tried end to end.
// Fair values come from app/public/data/research.json (run scripts/research.ts first).
//
// For each mirrored vault it: strips some of the mirror token into P and D, offers both just above fair value,
// bids for both just below it, and bids for the stock token itself (so "claim dividends as USDG" has a buyer).
// Existing orders from this wallet are cancelled first, so it is safe to rerun.
//
//   node scripts/market-maker.ts [--dry-run]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { erc20Abi, maxUint256, parseAbiItem, type Address } from 'viem';
import { bookAbi, mockStockTokenAbi, vaultAbi } from '../app/src/generated/abis.ts';
import { loadDeployment, root, testnet, wallet } from './lib.ts';

const dryRun = process.argv.includes('--dry-run');
const deployment = loadDeployment();
const client = wallet();
const me = client.account.address;
const research = JSON.parse(readFileSync(join(root, 'app/public/data/research.json'), 'utf8'));
const now = Math.floor(Date.now() / 1000);

/** Units of each half to strip per vault and offer. */
const INVENTORY = 40n * 10n ** 18n;
/** Share of the USDG balance committed to bids. */
const BID_BUDGET = 0.9;

async function send(label: string, request: object) {
  if (dryRun) return console.log(`  [dry-run] ${label}`);
  // Arbitrum gas estimates include an L1 data cost that can rise before inclusion, so leave headroom.
  const gas = await testnet.estimateContractGas({ ...(request as object), account: client.account } as never);
  const hash = await client.writeContract({ ...(request as object), gas: (gas * 13n) / 10n } as never);
  const receipt = await testnet.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label}`);
}

const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
  testnet.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<T>;

async function approve(token: Address, spender: Address) {
  const allowance = await read<bigint>(token, erc20Abi, 'allowance', [me, spender]);
  if (allowance < maxUint256 / 2n) await send(`approve ${token.slice(0, 8)} for ${spender.slice(0, 8)}`, { address: token, abi: erc20Abi, functionName: 'approve', args: [spender, maxUint256] });
}

const price = (usd: number) => BigInt(Math.max(1, Math.round(usd * 1e6)));

// ---------------------------------------------------------------- cancel our live orders
const placed = await testnet.getLogs({
  address: deployment.book,
  event: parseAbiItem('event OrderPlaced(uint256 indexed id, address indexed maker, address indexed base, bool isBid, uint256 price, uint256 amount)'),
  args: { maker: me },
  fromBlock: BigInt(deployment.deployedAtBlock),
});
for (const log of placed) {
  const order = await read<{ maker: Address }>(deployment.book, bookAbi, 'getOrder', [log.args.id]);
  if (order.maker.toLowerCase() === me.toLowerCase()) {
    await send(`cancel #${log.args.id}`, { address: deployment.book, abi: bookAbi, functionName: 'cancelOrder', args: [log.args.id] });
  }
}

// ---------------------------------------------------------------- plan
interface Quote { base: Address; isBid: boolean; usd: number; units: bigint; label: string }
const quotes: Quote[] = [];
const bids: { base: Address; usd: number; weight: number; label: string }[] = [];
const bidAssets = new Set<Address>();

await approve(deployment.usdg, deployment.book);
for (const vault of deployment.vaults) {
  const [asset, maturity, principal, dividend] = await Promise.all([
    read<Address>(vault, vaultAbi, 'asset'), read<bigint>(vault, vaultAbi, 'maturity'),
    read<Address>(vault, vaultAbi, 'principal'), read<Address>(vault, vaultAbi, 'dividend'),
  ]);
  const symbol = await read<string>(asset, erc20Abi, 'symbol');
  const a = research.assets[symbol];
  const owner = await read<Address>(asset, mockStockTokenAbi, 'owner').catch(() => null);
  if (!a || !owner || owner.toLowerCase() !== me.toLowerCase()) continue;

  const payments = a.projected.filter((d: { date: string }) => {
    const t = Date.parse(`${d.date}T00:00:00Z`) / 1000;
    return t > now && t <= Number(maturity);
  });
  const dFair = payments.reduce((s: number, d: { net: number }) => s + d.net, 0);
  const pFair = a.sharePrice - dFair;
  console.log(`${symbol} to ${new Date(Number(maturity) * 1000).toISOString().slice(0, 10)}: D fair $${dFair.toFixed(3)}, P fair $${pFair.toFixed(2)}`);

  // Inventory: mint mirror tokens and strip them.
  const [index] = await read<[bigint, boolean]>(vault, vaultAbi, 'previewIndex');
  const rawNeeded = (INVENTORY * 10n ** 18n) / index + 1n;
  const held = await read<bigint>(principal, erc20Abi, 'balanceOf', [me]);
  if (held < INVENTORY) {
    await send(`mint ${symbol}`, { address: asset, abi: mockStockTokenAbi, functionName: 'mint', args: [me, rawNeeded] });
    await approve(asset, vault);
    await send(`strip ${symbol}`, { address: vault, abi: vaultAbi, functionName: 'mint', args: [rawNeeded, me, me] });
  }
  await approve(principal, deployment.book);
  await approve(dividend, deployment.book);
  await approve(asset, deployment.book);

  if (dFair > 0) {
    quotes.push({ base: dividend, isBid: false, usd: dFair * 1.06, units: INVENTORY / 2n, label: `${symbol}-D ask` });
    quotes.push({ base: dividend, isBid: false, usd: dFair * 1.15, units: INVENTORY / 2n, label: `${symbol}-D ask 2` });
    // USDG is scarce on testnet (100 a day from the faucet), so SPY's dividend bids get the most: that's the demo.
    const focus = symbol === 'SPY' ? 3 : 1;
    bids.push({ base: dividend, usd: dFair * 0.94, weight: 2 * focus, label: `${symbol}-D bid` });
    bids.push({ base: dividend, usd: dFair * 0.85, weight: focus, label: `${symbol}-D bid 2` });
  }
  // P can't be worth more than the whole share, so offers stay below it.
  quotes.push({ base: principal, isBid: false, usd: Math.min(pFair * 1.002, a.sharePrice * 0.9995), units: INVENTORY / 4n, label: `${symbol}-P ask` });
  bids.push({ base: principal, usd: pFair * 0.995, weight: 0.5, label: `${symbol}-P bid` });
  if (!bidAssets.has(asset)) bids.push({ base: asset, usd: a.tokenPrice * 0.995, weight: 1, label: `${symbol} bid` });
  bidAssets.add(asset);
}

// ---------------------------------------------------------------- place
for (const q of quotes) {
  await send(`${q.label} ${Number(q.units) / 1e18} @ $${q.usd.toFixed(3)}`, {
    address: deployment.book, abi: bookAbi, functionName: 'placeOrder', args: [q.base, false, price(q.usd), q.units],
  });
}
const usdg = await read<bigint>(deployment.usdg, erc20Abi, 'balanceOf', [me]);
const budget = (Number(usdg) / 1e6) * BID_BUDGET;
const totalWeight = bids.reduce((s, b) => s + b.weight, 0);
if (budget < 1) console.log(`only ${Number(usdg) / 1e6} USDG: skipping bids (fund ${me} at faucet.paxos.com)`);
else {
  for (const b of bids) {
    const dollars = (budget * b.weight) / totalWeight;
    const units = BigInt(Math.floor((dollars / b.usd) * 1e18));
    if (units === 0n) continue;
    await send(`${b.label} ${(Number(units) / 1e18).toFixed(4)} @ $${b.usd.toFixed(3)}`, {
      address: deployment.book, abi: bookAbi, functionName: 'placeOrder', args: [b.base, true, price(b.usd), units],
    });
  }
}
console.log('done');
