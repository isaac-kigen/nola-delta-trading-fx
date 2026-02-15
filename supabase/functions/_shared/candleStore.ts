import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface CandleRowInput {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

async function upsertCandlesByRpc(params: {
  supabase: SupabaseClient;
  symbol: string;
  candles: CandleRowInput[];
  batchSize: number;
  rpcName: "upsert_price_candles_1h" | "upsert_price_candles_1m";
  source?: string;
}): Promise<number> {
  if (!Array.isArray(params.candles) || params.candles.length === 0) {
    return 0;
  }

  const normalizedSymbol = params.symbol.trim().toUpperCase();
  let totalChanged = 0;
  const batchSize = Math.max(1, Math.trunc(params.batchSize || 1000));

  for (let index = 0; index < params.candles.length; index += batchSize) {
    const batch = params.candles.slice(index, index + batchSize);
    const rpcParams: Record<string, unknown> = {
      p_symbol: normalizedSymbol,
      p_rows: batch,
    };
    if (params.rpcName === "upsert_price_candles_1m") {
      rpcParams.p_source = params.source ?? "finnhub";
    }

    const { data, error } = await params.supabase.rpc(params.rpcName, rpcParams);
    if (error) {
      throw new Error(`Failed to upsert candle batch via ${params.rpcName}: ${error.message}`);
    }

    totalChanged += Number(data ?? 0);
  }

  return totalChanged;
}

export async function upsertHourlyCandles(
  supabase: SupabaseClient,
  symbol: string,
  candles: CandleRowInput[],
  batchSize = 1000,
): Promise<number> {
  return upsertCandlesByRpc({
    supabase,
    symbol,
    candles,
    batchSize,
    rpcName: "upsert_price_candles_1h",
  });
}

export async function upsertMinuteCandles(
  supabase: SupabaseClient,
  symbol: string,
  candles: CandleRowInput[],
  batchSize = 1000,
  source = "finnhub",
): Promise<number> {
  return upsertCandlesByRpc({
    supabase,
    symbol,
    candles,
    batchSize,
    rpcName: "upsert_price_candles_1m",
    source,
  });
}
