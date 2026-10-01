// Chain and research reads, cached and refreshed by React Query.
import { useQuery } from '@tanstack/react-query';
import { erc20Abi, parseAbiItem, type Address } from 'viem';
import { bookAbi, dividendIndexAbi, exdivTokenAbi, factoryAbi, mockStockTokenAbi, vaultAbi } from '../generated/abis';
import { deployment, publicClient } from './chain';
import type { Research } from './types';

const REFRESH = 15_000;

export interface Market {
  vault: Address;
  asset: Address;
  symbol: string;
  assetName: string;
  maturity: number;
  principal: Address;
  dividend: Address;
  principalSymbol: string;
  dividendSymbol: string;
  /** Share units per raw token, as the vault will use it next. */
  index: bigint;
  reliable: boolean;
  settledIndex: bigint;
  multiplier: bigint;
  principalSupply: bigint;
  dividendSupply: bigint;
  vaultAssets: bigint;
  /** Testnet mirror of a mainnet dividend payer (has a faucet). */
  isMirror: boolean;
}

async function readMarkets(): Promise<Market[]> {
  const vaults = await publicClient.readContract({
    address: deployment.factory, abi: factoryAbi, functionName: 'allVaults',
  });
  const base = await Promise.all(
    vaults.map(async (vault) => {
      const v = { address: vault, abi: vaultAbi } as const;
      const [asset, maturity, principal, dividend, settledIndex, preview] = await Promise.all([
        publicClient.readContract({ ...v, functionName: 'asset' }),
        publicClient.readContract({ ...v, functionName: 'maturity' }),
        publicClient.readContract({ ...v, functionName: 'principal' }),
        publicClient.readContract({ ...v, functionName: 'dividend' }),
        publicClient.readContract({ ...v, functionName: 'settledIndex' }),
        publicClient.readContract({ ...v, functionName: 'previewIndex' }),
      ]);
      return { vault, asset, maturity, principal, dividend, settledIndex, preview };
    }),
  );
  return Promise.all(
    base.map(async (b) => {
      const t = (address: Address) => ({ address, abi: exdivTokenAbi }) as const;
      const [symbol, assetName, multiplier, principalSymbol, dividendSymbol, principalSupply, dividendSupply, vaultAssets, owner] =
        await Promise.all([
          publicClient.readContract({ ...t(b.asset), functionName: 'symbol' }),
          publicClient.readContract({ ...t(b.asset), functionName: 'name' }),
          publicClient.readContract({ address: b.asset, abi: mockStockTokenAbi, functionName: 'uiMultiplier' }),
          publicClient.readContract({ ...t(b.principal), functionName: 'symbol' }),
          publicClient.readContract({ ...t(b.dividend), functionName: 'symbol' }),
          publicClient.readContract({ ...t(b.principal), functionName: 'totalSupply' }),
          publicClient.readContract({ ...t(b.dividend), functionName: 'totalSupply' }),
          publicClient.readContract({ address: b.asset, abi: erc20Abi, functionName: 'balanceOf', args: [b.vault] }),
          publicClient
            .readContract({ address: b.asset, abi: mockStockTokenAbi, functionName: 'owner' })
            .catch(() => null),
        ]);
      return {
        vault: b.vault, asset: b.asset, symbol, assetName, maturity: Number(b.maturity),
        principal: b.principal, dividend: b.dividend, principalSymbol, dividendSymbol,
        index: b.preview[0], reliable: b.preview[1], settledIndex: b.settledIndex, multiplier,
        principalSupply, dividendSupply, vaultAssets, isMirror: owner != null,
      };
    }),
  );
}

export function useMarkets() {
  return useQuery({ queryKey: ['markets'], queryFn: readMarkets, refetchInterval: REFRESH });
}

export interface Position {
  asset: bigint;
  principal: bigint;
  dividend: bigint;
  claimable: bigint;
  usdg: bigint;
  routerIsOperator: boolean;
  allowance: { assetVault: bigint; assetRouter: bigint; assetBook: bigint; principalBook: bigint; dividendBook: bigint; usdgBook: bigint };
  nextFaucet: number | null;
}

export function usePosition(market: Market | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['position', market?.vault, account],
    enabled: !!market && !!account,
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Position> => {
      const m = market!;
      const a = account!;
      const bal = (token: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
      const allow = (token: Address, spender: Address) =>
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [a, spender] });
      const [asset, principal, dividend, claimable, usdg, routerIsOperator, av, ar, ab, pb, db, ub, lastFaucet] = await Promise.all([
        bal(m.asset), bal(m.principal), bal(m.dividend),
        publicClient.readContract({ address: m.vault, abi: vaultAbi, functionName: 'claimable', args: [a] }),
        bal(deployment.usdg),
        publicClient.readContract({ address: m.vault, abi: vaultAbi, functionName: 'isOperator', args: [a, deployment.router] }),
        allow(m.asset, m.vault), allow(m.asset, deployment.router), allow(m.asset, deployment.book),
        allow(m.principal, deployment.book), allow(m.dividend, deployment.book), allow(deployment.usdg, deployment.book),
        m.isMirror
          ? publicClient.readContract({ address: m.asset, abi: mockStockTokenAbi, functionName: 'lastFaucet', args: [a] })
          : Promise.resolve(null),
      ]);
      return {
        asset, principal, dividend, claimable, usdg, routerIsOperator,
        allowance: { assetVault: av, assetRouter: ar, assetBook: ab, principalBook: pb, dividendBook: db, usdgBook: ub },
        nextFaucet: lastFaucet == null ? null : lastFaucet === 0n ? 0 : Number(lastFaucet) + 86_400,
      };
    },
  });
}

export interface Order {
  id: bigint;
  maker: Address;
  base: Address;
  isBid: boolean;
  /** USDG (6 decimals) per 1e18 base units. */
  price: bigint;
  remaining: bigint;
}

const orderPlaced = parseAbiItem(
  'event OrderPlaced(uint256 indexed id, address indexed maker, address indexed base, bool isBid, uint256 price, uint256 amount)',
);

async function readOrders(): Promise<Order[]> {
  const latest = await publicClient.getBlockNumber();
  const ids: bigint[] = [];
  const span = 5_000_000n;
  for (let from = BigInt(deployment.deployedAtBlock); from <= latest; from += span) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    const logs = await publicClient.getLogs({ address: deployment.book, event: orderPlaced, fromBlock: from, toBlock: to });
    for (const l of logs) ids.push(l.args.id!);
  }
  if (!ids.length) return [];
  const orders = await publicClient.readContract({ address: deployment.book, abi: bookAbi, functionName: 'getOrders', args: [ids] });
  return orders
    .map((o, i) => ({ id: ids[i], maker: o.maker, base: o.base, isBid: o.isBid, price: o.price, remaining: o.remaining }))
    .filter((o) => o.maker !== '0x0000000000000000000000000000000000000000' && o.remaining > 0n);
}

export function useOrders() {
  return useQuery({ queryKey: ['orders'], queryFn: readOrders, refetchInterval: REFRESH });
}

/** Best bids first (highest price), best asks first (lowest price). */
export function bookFor(orders: Order[] | undefined, base: Address) {
  const mine = (orders ?? []).filter((o) => o.base.toLowerCase() === base.toLowerCase());
  return {
    bids: mine.filter((o) => o.isBid).sort((a, b) => (b.price > a.price ? 1 : b.price < a.price ? -1 : Number(a.id - b.id))),
    asks: mine.filter((o) => !o.isBid).sort((a, b) => (a.price > b.price ? 1 : a.price < b.price ? -1 : Number(a.id - b.id))),
  };
}

export function useResearch() {
  return useQuery({
    queryKey: ['research'],
    staleTime: Infinity,
    queryFn: async (): Promise<Research> => (await fetch('./data/research.json')).json(),
  });
}

export function useIndexState(token: Address | undefined) {
  return useQuery({
    queryKey: ['index', token],
    enabled: !!token,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const t = token!;
      const di = { address: deployment.dividendIndex, abi: dividendIndexAbi } as const;
      const count = await publicClient.readContract({ ...di, functionName: 'checkpointCount', args: [t] });
      const checkpoints = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) =>
          publicClient.readContract({ ...di, functionName: 'checkpointAt', args: [t, i] }),
        ),
      );
      const [frozen, pendingSplit] = await Promise.all([
        publicClient.readContract({ ...di, functionName: 'isFrozen', args: [t] }),
        publicClient.readContract({ ...di, functionName: 'pendingSplit', args: [t] }),
      ]);
      return { checkpoints: checkpoints.map(([time, index]) => ({ time: Number(time), index })), frozen, pendingSplit };
    },
  });
}
