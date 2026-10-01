// Exdiv keeper for Robinhood Chain testnet. Safe to run on a schedule; every step is idempotent.
//
//  1. mirror  - copies each mainnet stock token's multiplier (and any scheduled change) onto its testnet mirror,
//               so testnet dividends land when and as Robinhood pays them on mainnet.
//  2. attest  - announces upcoming splits, reverse splits and stock dividends from Robinhood's corporate-actions
//               feed, so DividendIndex never mistakes them for cash dividends.
//  3. sync    - classifies any multiplier change the index hasn't seen yet.
//  4. settle  - fixes the index of vaults that have matured.
//
//   node scripts/keeper.ts [--dry-run]
import { type Address, getAddress } from 'viem';
import { dividendIndexAbi, mockStockTokenAbi, vaultAbi } from '../app/src/generated/abis.ts';
import { MAINNET_TOKENS, fetchJson, loadDeployment, mainnet, testnet, wallet } from './lib.ts';

const dryRun = process.argv.includes('--dry-run');
const deployment = loadDeployment();
const client = wallet();
const me = client.account.address;

const scaledUiAbi = [
  { type: 'function', name: 'uiMultiplier', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'newUIMultiplier', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'effectiveAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

async function send(label: string, request: Parameters<typeof client.writeContract>[0]) {
  if (dryRun) return console.log(`  [dry-run] ${label}`);
  // Arbitrum gas estimates include an L1 data cost that can rise before inclusion, so leave headroom.
  const gas = await testnet.estimateContractGas({ ...request, account: client.account } as never);
  const hash = await client.writeContract({ ...request, gas: (gas * 13n) / 10n } as never);
  const receipt = await testnet.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${receipt.status} ${hash}`);
}

async function multipliers(client_: typeof testnet, token: Address) {
  const [ui, next, at] = await Promise.all(
    (['uiMultiplier', 'newUIMultiplier', 'effectiveAt'] as const).map((functionName) =>
      client_.readContract({ address: token, abi: scaledUiAbi, functionName }),
    ),
  );
  return { ui, next, at };
}

async function symbolOf(token: Address) {
  return testnet.readContract({ address: token, abi: mockStockTokenAbi, functionName: 'symbol' });
}

async function mirror() {
  console.log('mirror');
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const token of deployment.tokens) {
    const symbol = await symbolOf(token);
    const source = MAINNET_TOKENS[symbol];
    if (!source) continue;
    const owner = await testnet.readContract({ address: token, abi: mockStockTokenAbi, functionName: 'owner' });
    if (getAddress(owner) !== getAddress(me)) continue;

    const [main, test] = await Promise.all([multipliers(mainnet, source), multipliers(testnet, token)]);
    const scheduled = main.at > now && main.next !== main.ui;
    if (test.ui !== main.ui) {
      await send(`${symbol} multiplier ${test.ui} -> ${main.ui}`, {
        address: token, abi: mockStockTokenAbi, functionName: 'updateMultiplier', args: [main.ui],
      } as never);
    }
    if (scheduled && (test.next !== main.next || test.at !== main.at)) {
      await send(`${symbol} schedule ${main.next} at ${main.at}`, {
        address: token, abi: mockStockTokenAbi, functionName: 'updateMultiplier', args: [main.next, main.at],
      } as never);
    }
    if (test.ui === main.ui && !scheduled) console.log(`  ${symbol} in sync (${main.ui})`);
  }
}

interface CorporateAction {
  type: string;
  status: string;
  tokenSymbol: string;
  details: Record<string, { oldRate?: string; newRate?: string; rate?: string }>;
}

/** "1.5" -> [3n, 2n]: a rate as a small integer fraction. */
function fraction(rate: string): [bigint, bigint] {
  const [whole, frac = ''] = rate.split('.');
  let num = BigInt(whole + frac);
  let den = 10n ** BigInt(frac.length);
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const g = gcd(num, den);
  return [num / g, den / g];
}

async function attest() {
  console.log('attest');
  const { corpActions } = await fetchJson<{ corpActions: CorporateAction[] }>(
    'https://api.robinhood.com/rhj/corporate-actions',
  );
  const pending = corpActions.filter(
    (a) => a.status.endsWith('IN_PROGRESS') && !a.type.endsWith('CASH_DIVIDEND'),
  );
  if (!pending.length) return console.log('  no splits or stock dividends announced');
  const bySymbol = new Map<string, Address>();
  for (const token of deployment.tokens) bySymbol.set(await symbolOf(token), token);

  for (const action of pending) {
    const token = bySymbol.get(action.tokenSymbol);
    if (!token || !MAINNET_TOKENS[action.tokenSymbol]) continue;
    const detail = Object.values(action.details)[0];
    let num: bigint, den: bigint;
    if (detail.oldRate && detail.newRate) {
      const [a, b] = fraction(detail.newRate);
      const [c, e] = fraction(detail.oldRate);
      [num, den] = [a * e, b * c];
    } else if (detail.rate) {
      // Stock dividend of `rate` new shares per share held.
      const [a, b] = fraction(detail.rate);
      [num, den] = [b + a, b];
    } else continue;
    const [curNum, curDen] = await testnet.readContract({
      address: deployment.dividendIndex, abi: dividendIndexAbi, functionName: 'pendingSplit', args: [token],
    });
    if (curNum === num && curDen === den) continue;
    await send(`${action.tokenSymbol} ${action.type} ${num}:${den}`, {
      address: deployment.dividendIndex, abi: dividendIndexAbi, functionName: 'attestSplit', args: [token, num, den],
    } as never);
  }
}

async function sync() {
  console.log('sync');
  for (const token of deployment.tokens) {
    const [current, recorded, frozen] = await Promise.all([
      testnet.readContract({ address: token, abi: scaledUiAbi, functionName: 'uiMultiplier' }),
      testnet.readContract({
        address: deployment.dividendIndex, abi: dividendIndexAbi, functionName: 'recordedMultiplier', args: [token],
      }),
      testnet.readContract({
        address: deployment.dividendIndex, abi: dividendIndexAbi, functionName: 'isFrozen', args: [token],
      }),
    ]);
    const symbol = await symbolOf(token);
    if (frozen) console.log(`  ${symbol} FROZEN: needs owner resolve()`);
    else if (current !== recorded) {
      await send(`${symbol} sync ${recorded} -> ${current}`, {
        address: deployment.dividendIndex, abi: dividendIndexAbi, functionName: 'sync', args: [token],
      } as never);
    }
  }
}

async function settle() {
  console.log('settle');
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const vault of deployment.vaults) {
    const [maturity, settled] = await Promise.all([
      testnet.readContract({ address: vault, abi: vaultAbi, functionName: 'maturity' }),
      testnet.readContract({ address: vault, abi: vaultAbi, functionName: 'settledIndex' }),
    ]);
    if (now >= maturity && settled === 0n) {
      await send(`settle ${vault}`, { address: vault, abi: vaultAbi, functionName: 'sync' } as never);
    }
  }
}

console.log(`keeper ${me}${dryRun ? ' (dry run)' : ''}`);
await mirror();
await attest();
await sync();
await settle();
