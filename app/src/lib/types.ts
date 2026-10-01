// Shape of public/data/research.json, written by scripts/research.ts.

export interface ReplayRow {
  symbol: string;
  token: string;
  block: number;
  tx: string;
  effectiveAt: number;
  multiplier: number;
  stepBps: number;
  kind: 'dividend' | 'split' | 'repeat' | 'freeze';
}

export interface ReinvestRow {
  symbol: string;
  exDate: string;
  effective: string;
  dividend: number;
  close: number;
  grossBps: number;
  stepBps: number;
  ratio: number;
}

export interface DilutionRow {
  symbol: string;
  recordDate: string;
  appliedDate: string;
  supplyAtRecord: number;
  supplyAtApply: number;
  ratio: number;
}

export interface AssetResearch {
  symbol: string;
  mainnetAddress: string;
  multiplier: number;
  sharePrice: number;
  tokenPrice: number;
  quotedAt: string;
  tradingHalt: boolean;
  dividends12m: { date: string; amount: number }[];
  annualDividend: number;
  grossYield: number;
  netYield: number;
  projected: { date: string; amount: number; net: number }[];
  reinvestedSoFar: { date: string; stepBps: number }[];
  /** Testnet DEMO stock: nominal price, dividends on demand. */
  synthetic?: boolean;
}

export interface Research {
  generatedAt: string;
  netRatio: number;
  replay: {
    tokens: number;
    events: number;
    dividends: number;
    splits: number;
    freezes: number;
    maxDividendStepBps: number;
    rows: ReplayRow[];
  };
  reinvested: { medianRatio: number; exDateCount: number; typicalCount: number; rows: ReinvestRow[] };
  dilution?: DilutionRow[];
  assets: Record<string, AssetResearch>;
}
