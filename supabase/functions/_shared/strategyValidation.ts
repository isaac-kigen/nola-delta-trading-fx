import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { evaluatePhotonStructure, type PhotonDirection } from "./photonStructure.ts";

type Direction = "long" | "short" | "none";

interface Candle1m {
  candle_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface StrategyMeta {
  strategy_version: string;
  setup_label: string;
  signal_ttl_hours: number;
  session_start_hour_utc: number;
  session_end_hour_utc: number;
  session_filter_enabled: boolean;
  liquidity_eps_pips: number;
  zone_base_candles: number;
  zone_base_max_pips: number;
  zone_impulse_candles: number;
  zone_impulse_pips: number;
  zone_invalidation_pips: number;
  one_trade_per_cycle: boolean;
}

interface SimulatedSignal {
  signal_time: string;
  direction: Direction;
  setup_score: number;
  result: "win" | "loss" | "breakeven" | "expired";
  entry_time: string | null;
  exit_time: string | null;
  bars_to_entry: number | null;
  bars_in_trade: number | null;
  realized_r: number;
  tp1_before_sl_within_n: boolean;
  exit_reason: string;
}

interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired_untriggered: number;
  win_rate: number;
  expectancy_r: number;
  gross_profit_r: number;
  gross_loss_r: number;
  profit_factor: number | null;
  max_drawdown_r: number;
  longest_win_streak: number;
  longest_loss_streak: number;
  directional_accuracy_tp1_before_sl: number;
}

interface ScoreBucket {
  bucket: string;
  min_score: number;
  max_score: number;
  count: number;
  win_rate: number;
  expectancy_r: number;
  directional_accuracy_tp1_before_sl: number;
}

interface ValidationSummary {
  strategy_name: string;
  strategy_version: string;
  setup_label: string;
  symbol: string;
  timeframe: "1m";
  from_time_utc: string;
  to_time_utc: string;
  walk_forward_split_utc: string;
  total_candles_used: number;
  signals_evaluated: number;
  signals_qualified: number;
  signals_skipped_by_controls: number;
  metrics: {
    overall: BacktestMetrics;
    in_sample: BacktestMetrics;
    out_of_sample: BacktestMetrics;
  };
  calibration: ScoreBucket[];
  assumptions: Record<string, unknown>;
}

export interface StrategyValidationRunResult {
  run_id: number;
  trace_id: string;
  summary: ValidationSummary;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseDateLike(value: string | null | undefined, fallback: Date): Date {
  if (!value || value.trim() === "") return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pipSize(symbol: string): number {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

function isWithinSession(hourUtc: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) {
    return hourUtc >= startHour && hourUtc < endHour;
  }
  return hourUtc >= startHour || hourUtc < endHour;
}

function expand15mToSynthetic1m(rows15mAsc: Candle1m[]): Candle1m[] {
  const out: Candle1m[] = [];
  for (const row of rows15mAsc) {
    const startMs = new Date(row.candle_time).getTime();
    if (!Number.isFinite(startMs)) continue;
    for (let i = 0; i < 15; i += 1) {
      const ts = new Date(startMs + i * MINUTE_MS).toISOString();
      out.push({
        candle_time: ts,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      });
    }
  }
  return out;
}

function mergeSyntheticAndReal1m(params: {
  syntheticAsc: Candle1m[];
  realAsc: Candle1m[];
  maxRows: number;
}): Candle1m[] {
  const byTs = new Map<number, Candle1m>();

  for (const row of params.syntheticAsc) {
    const ts = new Date(row.candle_time).getTime();
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, row);
  }
  for (const row of params.realAsc) {
    const ts = new Date(row.candle_time).getTime();
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, row);
  }

  const asc = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
  if (asc.length <= params.maxRows) return asc;
  return asc.slice(asc.length - params.maxRows);
}

function setupScoreFromRr(rr: number | null): number {
  if (rr === null || !Number.isFinite(rr)) return 0;
  return round(clamp(60 + rr * 20, 0, 100), 2);
}

async function loadStrategyMeta(
  supabase: SupabaseClient,
  symbol: string,
): Promise<StrategyMeta> {
  const defaultMeta: StrategyMeta = {
    strategy_version: "v3.1.0-photon-zones",
    setup_label: "setup_score",
    signal_ttl_hours: 6,
    session_start_hour_utc: 6,
    session_end_hour_utc: 22,
    session_filter_enabled: true,
    liquidity_eps_pips: symbol.includes("JPY") ? 0.2 : 2.0,
    zone_base_candles: 3,
    zone_base_max_pips: 12,
    zone_impulse_candles: 3,
    zone_impulse_pips: 20,
    zone_invalidation_pips: 1,
    one_trade_per_cycle: true,
  };

  const { data: globalData } = await supabase
    .from("strategy_runtime_config")
    .select("value")
    .eq("key", "global")
    .maybeSingle();
  const globalValue = (globalData?.value ?? {}) as Record<string, unknown>;

  const { data: symbolData } = await supabase
    .from("strategy_symbol_config")
    .select(
      "strategy_version,signal_ttl_hours,enabled,session_start_hour_utc,session_end_hour_utc,liquidity_eps_pips,zone_base_candles,zone_base_max_pips,zone_impulse_candles,zone_impulse_pips,zone_invalidation_pips,one_trade_per_cycle",
    )
    .eq("symbol", symbol)
    .maybeSingle();
  const symbolValue = (symbolData ?? {}) as Record<string, unknown>;

  if (toBoolean(symbolValue.enabled, true) === false) {
    throw new Error(`${symbol} is disabled in strategy_symbol_config`);
  }

  return {
    strategy_version: String(
      symbolValue.strategy_version ??
        globalValue.strategy_version ??
        defaultMeta.strategy_version,
    ),
    setup_label: String(globalValue.setup_label ?? defaultMeta.setup_label),
    signal_ttl_hours: Math.max(
      1,
      Math.trunc(
        toFiniteNumber(symbolValue.signal_ttl_hours) ??
          defaultMeta.signal_ttl_hours,
      ),
    ),
    session_start_hour_utc: Math.max(
      0,
      Math.min(
        23,
        Math.trunc(
          toFiniteNumber(symbolValue.session_start_hour_utc) ??
            defaultMeta.session_start_hour_utc,
        ),
      ),
    ),
    session_end_hour_utc: Math.max(
      0,
      Math.min(
        23,
        Math.trunc(
          toFiniteNumber(symbolValue.session_end_hour_utc) ??
            defaultMeta.session_end_hour_utc,
        ),
      ),
    ),
    session_filter_enabled: toBoolean(
      globalValue.session_filter_enabled,
      defaultMeta.session_filter_enabled,
    ),
    liquidity_eps_pips: Math.max(
      0.01,
      toFiniteNumber(symbolValue.liquidity_eps_pips) ?? defaultMeta.liquidity_eps_pips,
    ),
    zone_base_candles: Math.max(
      3,
      Math.min(
        5,
        Math.trunc(
          toFiniteNumber(symbolValue.zone_base_candles) ??
            defaultMeta.zone_base_candles,
        ),
      ),
    ),
    zone_base_max_pips: Math.max(
      1,
      toFiniteNumber(symbolValue.zone_base_max_pips) ?? defaultMeta.zone_base_max_pips,
    ),
    zone_impulse_candles: Math.max(
      1,
      Math.min(
        6,
        Math.trunc(
          toFiniteNumber(symbolValue.zone_impulse_candles) ??
            defaultMeta.zone_impulse_candles,
        ),
      ),
    ),
    zone_impulse_pips: Math.max(
      1,
      toFiniteNumber(symbolValue.zone_impulse_pips) ?? defaultMeta.zone_impulse_pips,
    ),
    zone_invalidation_pips: Math.max(
      0.1,
      toFiniteNumber(symbolValue.zone_invalidation_pips) ?? defaultMeta.zone_invalidation_pips,
    ),
    one_trade_per_cycle: toBoolean(symbolValue.one_trade_per_cycle, defaultMeta.one_trade_per_cycle),
  };
}

function classifyResult(realizedR: number): "win" | "loss" | "breakeven" {
  if (realizedR > 0.0001) return "win";
  if (realizedR < -0.0001) return "loss";
  return "breakeven";
}

function buildEmptyMetrics(): BacktestMetrics {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    expired_untriggered: 0,
    win_rate: 0,
    expectancy_r: 0,
    gross_profit_r: 0,
    gross_loss_r: 0,
    profit_factor: null,
    max_drawdown_r: 0,
    longest_win_streak: 0,
    longest_loss_streak: 0,
    directional_accuracy_tp1_before_sl: 0,
  };
}

function computeMetrics(rows: SimulatedSignal[]): BacktestMetrics {
  if (rows.length === 0) return buildEmptyMetrics();

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let expiredUntriggered = 0;
  let grossProfitR = 0;
  let grossLossR = 0;
  let directionalTp1BeforeSl = 0;

  let equity = 0;
  let equityPeak = 0;
  let maxDrawdown = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;

  for (const row of rows) {
    if (row.result === "win") {
      wins += 1;
      currentWinStreak += 1;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else if (row.result === "loss") {
      losses += 1;
      currentLossStreak += 1;
      currentWinStreak = 0;
      if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
    } else if (row.result === "breakeven") {
      breakeven += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    } else {
      expiredUntriggered += 1;
    }

    if (row.realized_r > 0) grossProfitR += row.realized_r;
    if (row.realized_r < 0) grossLossR += Math.abs(row.realized_r);
    if (row.tp1_before_sl_within_n) directionalTp1BeforeSl += 1;

    equity += row.realized_r;
    if (equity > equityPeak) equityPeak = equity;
    const drawdown = equityPeak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const trades = rows.length;
  const expectancy = trades > 0 ? (grossProfitR - grossLossR) / trades : 0;
  const winRate = trades > 0 ? wins / trades : 0;
  const directionalAccuracy = trades > 0 ? directionalTp1BeforeSl / trades : 0;

  return {
    trades,
    wins,
    losses,
    breakeven,
    expired_untriggered: expiredUntriggered,
    win_rate: round(winRate, 4),
    expectancy_r: round(expectancy, 4),
    gross_profit_r: round(grossProfitR, 4),
    gross_loss_r: round(grossLossR, 4),
    profit_factor: grossLossR > 0 ? round(grossProfitR / grossLossR, 4) : null,
    max_drawdown_r: round(maxDrawdown, 4),
    longest_win_streak: longestWinStreak,
    longest_loss_streak: longestLossStreak,
    directional_accuracy_tp1_before_sl: round(directionalAccuracy, 4),
  };
}

function buildCalibration(rows: SimulatedSignal[]): ScoreBucket[] {
  const buckets = [
    { label: "50-59", min: 50, max: 59.99 },
    { label: "60-69", min: 60, max: 69.99 },
    { label: "70-79", min: 70, max: 79.99 },
    { label: "80-89", min: 80, max: 89.99 },
    { label: "90-100", min: 90, max: 100 },
  ];

  return buckets.map((bucket) => {
    const slice = rows.filter((row) => row.setup_score >= bucket.min && row.setup_score <= bucket.max);
    const metrics = computeMetrics(slice);
    return {
      bucket: bucket.label,
      min_score: bucket.min,
      max_score: bucket.max,
      count: slice.length,
      win_rate: metrics.win_rate,
      expectancy_r: metrics.expectancy_r,
      directional_accuracy_tp1_before_sl: metrics.directional_accuracy_tp1_before_sl,
    };
  });
}

function simulateSignal(params: {
  candles: Candle1m[];
  entryIndex: number;
  side: PhotonDirection;
  entryPrice: number;
  stopLoss: number;
  target: number;
  rr: number;
  ttlBars: number;
  directionalLookaheadBars: number;
}): Omit<SimulatedSignal, "signal_time" | "direction" | "setup_score"> {
  const { candles } = params;
  const risk = Math.abs(params.entryPrice - params.stopLoss);
  const tp1 = params.side === "long" ? params.entryPrice + risk : params.entryPrice - risk;

  let exitIndex = Math.min(candles.length - 1, params.entryIndex + Math.max(1, params.ttlBars));
  let realizedR = 0;
  let exitReason = "ttl_expired";
  let tp1BeforeSl = false;

  const directionalLimit = Math.min(candles.length - 1, params.entryIndex + Math.max(1, params.directionalLookaheadBars));
  for (let i = params.entryIndex; i <= directionalLimit; i += 1) {
    const candle = candles[i];
    const tp1Hit = params.side === "long" ? candle.high >= tp1 : candle.low <= tp1;
    const slHit = params.side === "long" ? candle.low <= params.stopLoss : candle.high >= params.stopLoss;
    if (tp1Hit && !slHit) {
      tp1BeforeSl = true;
      break;
    }
    if (slHit) break;
  }

  for (let i = params.entryIndex; i <= exitIndex; i += 1) {
    const candle = candles[i];
    const slHit = params.side === "long" ? candle.low <= params.stopLoss : candle.high >= params.stopLoss;
    const tpHit = params.side === "long" ? candle.high >= params.target : candle.low <= params.target;

    if (slHit) {
      exitIndex = i;
      realizedR = -1;
      exitReason = "stop_loss";
      break;
    }

    if (tpHit) {
      exitIndex = i;
      realizedR = params.rr;
      exitReason = "target_hit";
      break;
    }
  }

  if (exitReason === "ttl_expired") {
    const finalClose = candles[exitIndex].close;
    const pnl = params.side === "long"
      ? finalClose - params.entryPrice
      : params.entryPrice - finalClose;
    realizedR = risk > 0 ? pnl / risk : 0;
  }

  return {
    result: exitReason === "ttl_expired" ? classifyResult(realizedR) : (exitReason === "target_hit" ? "win" : "loss"),
    entry_time: candles[params.entryIndex].candle_time,
    exit_time: candles[exitIndex].candle_time,
    bars_to_entry: 0,
    bars_in_trade: Math.max(0, exitIndex - params.entryIndex),
    realized_r: round(realizedR, 6),
    tp1_before_sl_within_n: tp1BeforeSl,
    exit_reason: exitReason,
  };
}

function indexByTime(candles: Candle1m[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < candles.length; i += 1) {
    map.set(candles[i].candle_time, i);
  }
  return map;
}

export async function runStrategyValidation(params: {
  supabase: SupabaseClient;
  symbol: string;
  fromTimeUtc?: string | null;
  toTimeUtc?: string | null;
  walkForwardSplitUtc?: string | null;
  walkForwardRatio?: number | null;
  maxCandles?: number | null;
  directionalLookaheadBars?: number | null;
  traceId?: string;
}): Promise<StrategyValidationRunResult> {
  const normalizedSymbol = params.symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error("symbol is required");

  const now = new Date();
  const toTime = parseDateLike(params.toTimeUtc, now);
  const fromTime = parseDateLike(
    params.fromTimeUtc,
    new Date(toTime.getTime() - 365 * 24 * HOUR_MS),
  );
  if (fromTime >= toTime) {
    throw new Error("fromTimeUtc must be before toTimeUtc");
  }

  const walkForwardRatio = toFiniteNumber(params.walkForwardRatio) ?? 0.7;
  const splitFallback = new Date(
    fromTime.getTime() + (toTime.getTime() - fromTime.getTime()) * Math.min(0.95, Math.max(0.5, walkForwardRatio)),
  );
  const walkForwardSplit = parseDateLike(params.walkForwardSplitUtc, splitFallback);

  const maxCandlesRequested = Math.max(5_000, Math.trunc(toFiniteNumber(params.maxCandles) ?? 50_000));
  const maxCandlesCap = Math.max(5_000, Math.trunc(toFiniteNumber(Deno.env.get("PHOTON_VALIDATION_MAX_CANDLES")) ?? 20_000));
  const maxCandles = Math.min(maxCandlesRequested, maxCandlesCap);
  const max15mCandles = Math.max(500, Math.ceil(maxCandles / 15) + 500);
  const validationPageSize = Math.max(
    200,
    Math.min(5_000, Math.trunc(toFiniteNumber(Deno.env.get("VALIDATION_PAGE_SIZE")) ?? 1_000)),
  );
  const directionalLookaheadBars = Math.max(
    1,
    Math.trunc(toFiniteNumber(params.directionalLookaheadBars) ?? 12),
  );
  const minRr = clamp(
    toFiniteNumber(Deno.env.get("PHOTON_MIN_RR")) ?? 2.0,
    0,
    10,
  );

  const meta = await loadStrategyMeta(params.supabase, normalizedSymbol);
  const strategyName = "Photon Structure Continuation (4H/15M/1M + 15M Zones)";

  const paddedFrom = new Date(fromTime.getTime() - 10 * 24 * HOUR_MS);
  const rawCandles: Array<Record<string, unknown>> = [];
  const raw15mCandles: Array<Record<string, unknown>> = [];
  let offset = 0;
  let offset15m = 0;
  let candlePagesFetched = 0;
  let candles15mPagesFetched = 0;

  while (rawCandles.length < maxCandles) {
    const remaining = maxCandles - rawCandles.length;
    const pageSize = Math.min(validationPageSize, remaining);
    const pageFrom = offset;
    const pageTo = offset + pageSize - 1;

    const { data: pageRows, error: candleError } = await params.supabase
      .from("price_candles_1m")
      .select("candle_time, open, high, low, close")
      .eq("symbol", normalizedSymbol)
      .gte("candle_time", paddedFrom.toISOString())
      .lte("candle_time", toTime.toISOString())
      .order("candle_time", { ascending: true })
      .range(pageFrom, pageTo);

    if (candleError) {
      throw new Error(`Failed reading candles for validation: ${candleError.message}`);
    }

    const rows = pageRows ?? [];
    if (rows.length === 0) break;

    candlePagesFetched += 1;
    rawCandles.push(...rows);
    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  while (raw15mCandles.length < max15mCandles) {
    const remaining = max15mCandles - raw15mCandles.length;
    const pageSize = Math.min(validationPageSize, remaining);
    const pageFrom = offset15m;
    const pageTo = offset15m + pageSize - 1;

    const { data: pageRows, error: candleError } = await params.supabase
      .from("price_candles_15m")
      .select("candle_time, open, high, low, close")
      .eq("symbol", normalizedSymbol)
      .gte("candle_time", paddedFrom.toISOString())
      .lte("candle_time", toTime.toISOString())
      .order("candle_time", { ascending: true })
      .range(pageFrom, pageTo);

    if (candleError) {
      throw new Error(`Failed reading 15m candles for validation: ${candleError.message}`);
    }

    const rows = pageRows ?? [];
    if (rows.length === 0) break;

    candles15mPagesFetched += 1;
    raw15mCandles.push(...rows);
    offset15m += rows.length;
    if (rows.length < pageSize) break;
  }

  const candlesAll: Candle1m[] = rawCandles
    .map((row) => ({
      candle_time: String(row.candle_time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    .filter((row) =>
      Number.isFinite(new Date(row.candle_time).getTime()) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close)
    )
    .filter((row) => {
      const ts = new Date(row.candle_time).getTime();
      return ts >= fromTime.getTime() && ts <= toTime.getTime();
    });
  const candles15mAll: Candle1m[] = raw15mCandles
    .map((row) => ({
      candle_time: String(row.candle_time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    .filter((row) =>
      Number.isFinite(new Date(row.candle_time).getTime()) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close)
    )
    .filter((row) => {
      const ts = new Date(row.candle_time).getTime();
      return ts >= paddedFrom.getTime() && ts <= toTime.getTime();
    });

  if (candlesAll.length < 2_500) {
    throw new Error(
      `Insufficient 1m candles for validation (${candlesAll.length}). Need at least 2500.`,
    );
  }
  if (candles15mAll.length < 200) {
    throw new Error(
      `Insufficient 15m candles for validation (${candles15mAll.length}). Need at least 200.`,
    );
  }

  const candles = candlesAll.slice(Math.max(0, candlesAll.length - maxCandles));
  const candles15m = candles15mAll.slice(Math.max(0, candles15mAll.length - max15mCandles));
  const indexMap = indexByTime(candles);
  const ttlBars = Math.max(30, meta.signal_ttl_hours * 60);
  const requireReal1mTrigger = toBoolean(
    Deno.env.get("PHOTON_REQUIRE_REAL_1M_TRIGGER"),
    true,
  );
  const real1mBurstLimit = Math.max(
    60,
    Math.trunc(toFiniteNumber(Deno.env.get("STRUCTURE_REAL_1M_BURST_LIMIT")) ?? 600),
  );
  const real1mFreshnessMinutes = Math.max(
    1,
    Math.trunc(toFiniteNumber(Deno.env.get("PHOTON_REAL_1M_FRESHNESS_MINUTES")) ?? 20),
  );

  const evaluationStride = Math.max(1, Math.trunc(candles.length / 400));
  const windowSize = Math.max(2_500, Math.min(6_000, candles.length));
  const windowSize15m = Math.max(240, Math.ceil(windowSize / 15) + 200);
  const warmupBars = 2_000;

  const simulated: SimulatedSignal[] = [];
  const seenKeys = new Set<string>();
  const seenCycles = new Set<string>();
  let signalsEvaluated = 0;
  let signalsQualified = 0;
  let signalsSkippedByControls = 0;

  for (let i = warmupBars; i < candles.length - 1; i += evaluationStride) {
    const asofCandle = candles[i];
    const asofMs = new Date(asofCandle.candle_time).getTime();
    if (!Number.isFinite(asofMs)) {
      signalsSkippedByControls += 1;
      continue;
    }

    if (
      meta.session_filter_enabled &&
      !isWithinSession(
        new Date(asofMs).getUTCHours(),
        meta.session_start_hour_utc,
        meta.session_end_hour_utc,
      )
    ) {
      signalsSkippedByControls += 1;
      continue;
    }

    const windowStart = Math.max(0, i - windowSize);
    const windowRealCandles = candles.slice(windowStart, i + 1);
    const window15mCandles = candles15m
      .filter((row) => {
        const tsMs = new Date(row.candle_time).getTime();
        return Number.isFinite(tsMs) && tsMs <= asofMs;
      })
      .slice(-windowSize15m);
    const synthetic1m = expand15mToSynthetic1m(window15mCandles);
    const mergedCandles = mergeSyntheticAndReal1m({
      syntheticAsc: synthetic1m,
      realAsc: windowRealCandles,
      maxRows: windowSize,
    });
    const oldestReal1mTs = windowRealCandles.length > 0
      ? new Date(windowRealCandles[0].candle_time).getTime()
      : Number.MAX_SAFE_INTEGER;
    const latestReal1mTs = windowRealCandles.length > 0
      ? new Date(windowRealCandles[windowRealCandles.length - 1].candle_time).getTime()
      : Number.NEGATIVE_INFINITY;
    const latestReal1mAgeMinutes = Number.isFinite(latestReal1mTs)
      ? Math.max(0, (asofMs - latestReal1mTs) / MINUTE_MS)
      : Number.POSITIVE_INFINITY;

    signalsEvaluated += 1;
    const evalResult = evaluatePhotonStructure({
      candles1m: mergedCandles,
      symbol: normalizedSymbol,
      asofUtc: asofCandle.candle_time,
      minRr,
      maxLtfCandles: windowSize,
      ltfMinTsMs: Number.isFinite(oldestReal1mTs) ? oldestReal1mTs : Number.MAX_SAFE_INTEGER,
      minReal1mCandlesForLtf: Math.max(60, Math.trunc(real1mBurstLimit / 3)),
      zoneBaseCandles: meta.zone_base_candles,
      zoneImpulseCandles: meta.zone_impulse_candles,
      zoneBaseMaxPips: meta.zone_base_max_pips,
      zoneImpulsePips: meta.zone_impulse_pips,
      zoneInvalidationPips: meta.zone_invalidation_pips,
      liquidityEpsPips: meta.liquidity_eps_pips,
    });

    if (
      requireReal1mTrigger &&
      (!Number.isFinite(latestReal1mAgeMinutes) || latestReal1mAgeMinutes > real1mFreshnessMinutes)
    ) {
      signalsSkippedByControls += 1;
      continue;
    }

    if (!evalResult.valid || evalResult.side === "none") {
      signalsSkippedByControls += 1;
      continue;
    }
    if (
      evalResult.entry_ts === null ||
      evalResult.entry_price === null ||
      evalResult.sl === null ||
      evalResult.tp === null ||
      evalResult.rr === null
    ) {
      signalsSkippedByControls += 1;
      continue;
    }

    const direction = evalResult.side as Direction;
    const dedupeKey = [
      direction,
      evalResult.cycle_id ?? "no_cycle",
      evalResult.entry_ts,
      round(evalResult.entry_price, 6),
      round(evalResult.sl, 6),
      round(evalResult.tp, 6),
    ].join("|");
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    if (meta.one_trade_per_cycle && evalResult.cycle_id) {
      if (seenCycles.has(evalResult.cycle_id)) {
        signalsSkippedByControls += 1;
        continue;
      }
    }

    const entryIndex = indexMap.get(evalResult.entry_ts);
    if (entryIndex === undefined || entryIndex >= candles.length) {
      signalsSkippedByControls += 1;
      continue;
    }

    const simulatedOutcome = simulateSignal({
      candles,
      entryIndex,
      side: direction,
      entryPrice: evalResult.entry_price,
      stopLoss: evalResult.sl,
      target: evalResult.tp,
      rr: evalResult.rr,
      ttlBars,
      directionalLookaheadBars,
    });

    signalsQualified += 1;
    if (meta.one_trade_per_cycle && evalResult.cycle_id) {
      seenCycles.add(evalResult.cycle_id);
    }
    simulated.push({
      signal_time: asofCandle.candle_time,
      direction,
      setup_score: setupScoreFromRr(evalResult.rr),
      ...simulatedOutcome,
    });
  }

  const inSampleRows = simulated.filter((row) => new Date(row.signal_time) <= walkForwardSplit);
  const outSampleRows = simulated.filter((row) => new Date(row.signal_time) > walkForwardSplit);

  const metricsOverall = computeMetrics(simulated);
  const metricsInSample = computeMetrics(inSampleRows);
  const metricsOutSample = computeMetrics(outSampleRows);
  const calibration = buildCalibration(simulated);

  const summary: ValidationSummary = {
    strategy_name: strategyName,
    strategy_version: meta.strategy_version,
    setup_label: meta.setup_label,
    symbol: normalizedSymbol,
    timeframe: "1m",
    from_time_utc: fromTime.toISOString(),
    to_time_utc: toTime.toISOString(),
    walk_forward_split_utc: walkForwardSplit.toISOString(),
    total_candles_used: candles.length,
    signals_evaluated: signalsEvaluated,
    signals_qualified: signalsQualified,
    signals_skipped_by_controls: signalsSkippedByControls,
    metrics: {
      overall: metricsOverall,
      in_sample: metricsInSample,
      out_of_sample: metricsOutSample,
    },
    calibration,
    assumptions: {
      strategy_family: "photon_structure_only",
      htf_timeframe: "4h",
      mtf_timeframe: "15m",
      ltf_timeframe: "1m",
      htf_pivot: "5-5",
      mtf_pivot: "3-3",
      ltf_pivot: "1-1",
      data_source: "price_candles_15m + price_candles_1m",
      ltf_real_1m_required: requireReal1mTrigger,
      real_1m_burst_limit: real1mBurstLimit,
      real_1m_freshness_minutes: real1mFreshnessMinutes,
      session_filter_enabled: meta.session_filter_enabled,
      session_hours_utc: [meta.session_start_hour_utc, meta.session_end_hour_utc],
      bos_validation: "close_break",
      choch_validation: "wick_break",
      entry_policy: "next_1m_open",
      stop_policy: "last_confirmed_1m_fractal_pivot_opposite",
      target_policy: "nearest_unbroken_4h_weak_target",
      zone_tf: "15m_only",
      zone_base_candles: meta.zone_base_candles,
      zone_base_max_pips: meta.zone_base_max_pips,
      zone_impulse_candles: meta.zone_impulse_candles,
      zone_impulse_pips: meta.zone_impulse_pips,
      zone_invalidation_pips: meta.zone_invalidation_pips,
      liquidity_eps_pips: meta.liquidity_eps_pips,
      liquidity_sweep_required: true,
      zone_mid_mitigation_required: true,
      rr_min: minRr,
      one_trade_per_cycle: meta.one_trade_per_cycle,
      signal_ttl_hours: meta.signal_ttl_hours,
      directional_lookahead_bars: directionalLookaheadBars,
      evaluation_stride_bars: evaluationStride,
      rolling_window_size_bars: windowSize,
      max_candles_requested: maxCandlesRequested,
      max_candles_effective: maxCandles,
      validation_page_size: validationPageSize,
      candle_pages_fetched: candlePagesFetched,
      candles_15m_pages_fetched: candles15mPagesFetched,
      raw_candles_before_filter: rawCandles.length,
      raw_15m_candles_before_filter: raw15mCandles.length,
      pip_size: pipSize(normalizedSymbol),
    },
  };

  const traceId = params.traceId ?? `validate-${normalizedSymbol.replace("/", "")}-${crypto.randomUUID()}`;
  const { data: inserted, error: insertError } = await params.supabase
    .from("strategy_validation_runs")
    .insert({
      trace_id: traceId,
      strategy_version: meta.strategy_version,
      symbol: normalizedSymbol,
      timeframe: "1m",
      from_time: fromTime.toISOString(),
      to_time: toTime.toISOString(),
      walk_forward_split: walkForwardSplit.toISOString(),
      metrics: summary.metrics,
      calibration: summary.calibration,
      notes: `signals_evaluated=${signalsEvaluated}; qualified=${signalsQualified}; skipped=${signalsSkippedByControls}`,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to persist strategy validation run: ${insertError?.message ?? "missing"}`);
  }

  return {
    run_id: Number(inserted.id),
    trace_id: traceId,
    summary,
  };
}
