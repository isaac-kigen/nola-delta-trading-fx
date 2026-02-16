import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { evaluatePhotonStructure } from "./photonStructure.ts";

type Direction = "long" | "short" | "none";
type SignalState =
  | "none"
  | "pending"
  | "active"
  | "triggered"
  | "invalidated"
  | "expired"
  | "executed"
  | "cancelled";

type TriggerPolicy = "market" | "limit" | "confirmation";

interface Candle1h {
  candle_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SignalScoring {
  long_score: number;
  short_score: number;
  threshold: number;
}

interface StrategySymbolConfig {
  symbol: string;
  enabled: boolean;
  strategy_version: string;
  trigger_policy: TriggerPolicy;
  session_start_hour_utc: number;
  session_end_hour_utc: number;
  risk_per_trade_pct: number;
  min_stop_pips: number;
  max_stop_pips: number;
  max_spread_pips: number;
  require_spread: boolean;
  min_atr_pips: number;
  max_atr_pips: number;
  min_trend_strength: number;
  signal_ttl_hours: number;
  reentry_cooldown_hours: number;
  slippage_pips_assumed: number;
  tp1_take_pct: number;
  tp2_take_pct: number;
  tp3_take_pct: number;
  move_sl_to_be_on_tp1: boolean;
  trail_after_tp2: boolean;
  trail_atr_multiple: number;
  liquidity_eps_pips: number;
  zone_base_candles: number;
  zone_base_max_pips: number;
  zone_impulse_candles: number;
  zone_impulse_pips: number;
  zone_invalidation_pips: number;
  one_trade_per_cycle: boolean;
}

interface GlobalStrategyConfig {
  strategy_version: string;
  setup_label: string;
  account_equity_usd: number;
  max_total_risk_pct: number;
  max_open_trades: number;
  max_trades_per_day: number;
  max_symbol_trades_per_day: number;
  max_trades_per_session: number;
  correlation_base_currency_cap: number;
  telegram_max_messages_per_hour: number;
  session_filter_enabled: boolean;
  news_filter_enabled: boolean;
  volatility_filter_enabled: boolean;
  trend_filter_enabled: boolean;
}

interface TradePlan {
  entry_price: number | null;
  stop_loss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  risk_r: number | null;
}

interface RiskGuardResult {
  allowed: boolean;
  reasons: string[];
  risk_amount_usd: number;
  position_size_units: number;
  risk_distance_usd_per_unit: number;
  quote_to_usd_rate: number | null;
  open_risk_usd: number;
  max_total_risk_usd: number;
  open_positions: number;
}

interface ReconciledSignal {
  signal_id: number;
  signal_state: SignalState;
  changed: boolean;
  reason: string;
}

export interface TradingOpportunityResult {
  check_id: number;
  signal_id: number | null;
  trace_id: string;
  dedupe_key: string | null;
  cycle_id: string | null;
  strategy_state: string;
  strategy_reason: string;
  symbol: string;
  strategy_name: string;
  strategy_version: string;
  setup_label: string;
  setup_score: number;
  confidence: number;
  direction: Direction;
  signal: "long_candidate" | "short_candidate" | "none";
  signal_state: SignalState;
  trigger_policy: TriggerPolicy;
  should_notify: boolean;
  latest_price: number;
  latest_candle_time_utc: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  risk_r: number | null;
  expires_at: string | null;
  spread_pips: number | null;
  news_nearby: boolean;
  regime_passed: boolean;
  top_reasons: string[];
  invalidation_conditions: string[];
  primary_plan: Record<string, unknown>;
  details: Record<string, unknown>;
}

export interface TelegramReservationResult {
  allowed: boolean;
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_SYMBOL_CONFIG: StrategySymbolConfig = {
  symbol: "",
  enabled: true,
  strategy_version: "v3.1.0-photon-zones",
  trigger_policy: "market",
  session_start_hour_utc: 6,
  session_end_hour_utc: 22,
  risk_per_trade_pct: 0.55,
  min_stop_pips: 8,
  max_stop_pips: 45,
  max_spread_pips: 2.2,
  require_spread: false,
  min_atr_pips: 4,
  max_atr_pips: 65,
  min_trend_strength: 0.25,
  signal_ttl_hours: 6,
  reentry_cooldown_hours: 4,
  slippage_pips_assumed: 0.4,
  tp1_take_pct: 50,
  tp2_take_pct: 30,
  tp3_take_pct: 20,
  move_sl_to_be_on_tp1: true,
  trail_after_tp2: true,
  trail_atr_multiple: 0.8,
  liquidity_eps_pips: 2,
  zone_base_candles: 3,
  zone_base_max_pips: 12,
  zone_impulse_candles: 3,
  zone_impulse_pips: 20,
  zone_invalidation_pips: 1,
  one_trade_per_cycle: true,
};

const DEFAULT_GLOBAL_CONFIG: GlobalStrategyConfig = {
  strategy_version: "v3.1.0-photon-zones",
  setup_label: "setup_score",
  account_equity_usd: 5_000,
  max_total_risk_pct: 2,
  max_open_trades: 4,
  max_trades_per_day: 10,
  max_symbol_trades_per_day: 2,
  max_trades_per_session: 4,
  correlation_base_currency_cap: 2,
  telegram_max_messages_per_hour: 8,
  session_filter_enabled: true,
  news_filter_enabled: false,
  volatility_filter_enabled: true,
  trend_filter_enabled: true,
};

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

function toPositiveInt(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mapSignal(direction: Direction): "long_candidate" | "short_candidate" | "none" {
  if (direction === "long") return "long_candidate";
  if (direction === "short") return "short_candidate";
  return "none";
}

function pipSize(symbol: string): number {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

function currenciesFromSymbol(symbol: string): { base: string; quote: string } {
  const [baseRaw, quoteRaw] = symbol.split("/");
  return {
    base: (baseRaw ?? "").trim().toUpperCase(),
    quote: (quoteRaw ?? "").trim().toUpperCase(),
  };
}

async function readLatestClose(params: {
  supabase: SupabaseClient;
  symbol: string;
}): Promise<number | null> {
  const { data, error } = await params.supabase
    .from("price_candles_1m")
    .select("close")
    .eq("symbol", params.symbol)
    .order("candle_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed loading FX conversion price for ${params.symbol}: ${error.message}`);
  }

  return toFiniteNumber(data?.close);
}

async function loadRecent1mCandles(params: {
  supabase: SupabaseClient;
  symbol: string;
  limit: number;
  pageSize: number;
}): Promise<Candle1h[]> {
  const target = Math.max(1, Math.trunc(params.limit));
  const pageSize = Math.max(200, Math.min(5_000, Math.trunc(params.pageSize)));
  const rows: Candle1h[] = [];
  let offset = 0;

  while (rows.length < target) {
    const remaining = target - rows.length;
    const fetchCount = Math.min(pageSize, remaining);
    const rangeFrom = offset;
    const rangeTo = offset + fetchCount - 1;

    const { data, error } = await params.supabase
      .from("price_candles_1m")
      .select("candle_time, open, high, low, close")
      .eq("symbol", params.symbol)
      .order("candle_time", { ascending: false })
      .range(rangeFrom, rangeTo);

    if (error) {
      throw new Error(`Failed reading recent 1m candles: ${error.message}`);
    }

    const chunk = (data ?? [])
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
      );

    if (chunk.length === 0) break;
    rows.push(...chunk);

    if (chunk.length < fetchCount) break;
    offset += chunk.length;
  }

  return rows;
}

async function loadRecent15mCandles(params: {
  supabase: SupabaseClient;
  symbol: string;
  limit: number;
  pageSize: number;
}): Promise<Candle1h[]> {
  const target = Math.max(1, Math.trunc(params.limit));
  const pageSize = Math.max(100, Math.min(2_000, Math.trunc(params.pageSize)));
  const rows: Candle1h[] = [];
  let offset = 0;

  while (rows.length < target) {
    const remaining = target - rows.length;
    const fetchCount = Math.min(pageSize, remaining);
    const rangeFrom = offset;
    const rangeTo = offset + fetchCount - 1;

    const { data, error } = await params.supabase
      .from("price_candles_15m")
      .select("candle_time, open, high, low, close")
      .eq("symbol", params.symbol)
      .order("candle_time", { ascending: false })
      .range(rangeFrom, rangeTo);

    if (error) {
      throw new Error(`Failed reading recent 15m candles: ${error.message}`);
    }

    const chunk = (data ?? [])
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
      );

    if (chunk.length === 0) break;
    rows.push(...chunk);

    if (chunk.length < fetchCount) break;
    offset += chunk.length;
  }

  return rows;
}

function expand15mToSynthetic1m(rows15mAsc: Candle1h[]): Candle1h[] {
  const out: Candle1h[] = [];
  for (const row of rows15mAsc) {
    const startMs = new Date(row.candle_time).getTime();
    if (!Number.isFinite(startMs)) continue;
    for (let i = 0; i < 15; i += 1) {
      const ts = new Date(startMs + i * 60_000).toISOString();
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
  syntheticAsc: Candle1h[];
  realDesc: Candle1h[];
  maxRows: number;
}): Candle1h[] {
  const byTs = new Map<number, Candle1h>();

  for (const row of params.syntheticAsc) {
    const ts = new Date(row.candle_time).getTime();
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, row);
  }

  for (const row of params.realDesc) {
    const ts = new Date(row.candle_time).getTime();
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, row);
  }

  const rowsAsc = [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  if (rowsAsc.length <= params.maxRows) return rowsAsc;
  return rowsAsc.slice(rowsAsc.length - params.maxRows);
}

async function resolveQuoteToUsdRate(params: {
  supabase: SupabaseClient;
  symbol: string;
  entryPrice: number;
}): Promise<number | null> {
  const { base, quote } = currenciesFromSymbol(params.symbol);
  if (!base || !quote) return null;

  if (quote === "USD") {
    return 1;
  }

  if (base === "USD" && params.entryPrice > 0) {
    return 1 / params.entryPrice;
  }

  const directPair = `${quote}/USD`;
  const direct = await readLatestClose({
    supabase: params.supabase,
    symbol: directPair,
  });
  if (direct !== null && direct > 0) {
    return direct;
  }

  const inversePair = `USD/${quote}`;
  const inverse = await readLatestClose({
    supabase: params.supabase,
    symbol: inversePair,
  });
  if (inverse !== null && inverse > 0) {
    return 1 / inverse;
  }

  return null;
}

function isWithinSession(hourUtc: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) {
    return hourUtc >= startHour && hourUtc < endHour;
  }
  return hourUtc >= startHour || hourUtc < endHour;
}

function generateTraceId(seed?: string): string {
  const random = crypto.randomUUID();
  return seed ? `${seed}-${random}` : random;
}

async function dispatchBrokerExecutionNow(params: {
  traceId: string;
  signalId: number;
  broker: string;
}): Promise<void> {
  const dispatchOnSignal = toBoolean(
    Deno.env.get("BROKER_EXECUTION_DISPATCH_ON_SIGNAL"),
    true,
  );
  if (!dispatchOnSignal) return;

  const explicitUrl = (Deno.env.get("BROKER_EXECUTION_DISPATCH_URL") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  const dispatchUrl = explicitUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1/execute-broker-orders` : "");
  if (!dispatchUrl) return;

  const timeoutMs = toPositiveInt(
    Deno.env.get("BROKER_EXECUTION_DISPATCH_TIMEOUT_MS"),
    15_000,
    1_000,
    120_000,
  );
  const limit = toPositiveInt(
    Deno.env.get("BROKER_EXECUTION_DISPATCH_LIMIT"),
    5,
    1,
    50,
  );
  const provider = (Deno.env.get("BROKER_EXECUTION_PROVIDER") ?? params.broker).trim();
  const cronSecret = (Deno.env.get("EXECUTE_CRON_SECRET") ?? "").trim();
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-trigger-source": "signal",
  };
  if (cronSecret) {
    headers["x-cron-secret"] = cronSecret;
  } else if (serviceRoleKey) {
    headers.apikey = serviceRoleKey;
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        provider,
        limit,
        signal_id: params.signalId,
        trigger_trace_id: params.traceId,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const clipped = bodyText.length > 300 ? `${bodyText.slice(0, 300)}...` : bodyText;
      throw new Error(`execute-broker-orders dispatch failed (${response.status}): ${clipped}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function generateSignalKey(params: {
  symbol: string;
  strategyVersion: string;
  direction: Direction;
  triggerPolicy: TriggerPolicy;
  cycleId?: string | null;
  latestCandleTimeUtc: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
}): string {
  const cycle = params.cycleId ?? "na";
  const time = params.latestCandleTimeUtc ?? "na";
  const entry = params.entryPrice === null ? "na" : round(params.entryPrice, 5).toFixed(5);
  const stop = params.stopLoss === null ? "na" : round(params.stopLoss, 5).toFixed(5);
  return [
    params.symbol,
    params.strategyVersion,
    params.direction,
    params.triggerPolicy,
    cycle,
    time,
    entry,
    stop,
  ].join("|");
}

function sha1Like(text: string): string {
  // Non-cryptographic hash for deterministic dedupe keys.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function ema(values: number[], period: number): Array<number | null> {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const output: Array<number | null> = new Array(values.length).fill(null);

  let seedSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period) {
      seedSum += values[i];
      if (i === period - 1) {
        output[i] = seedSum / period;
      }
      continue;
    }

    const prev = output[i - 1] ?? values[i - 1];
    output[i] = values[i] * k + prev * (1 - k);
  }

  return output;
}

function rsi(values: number[], period = 14): Array<number | null> {
  const output: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= period) return output;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    output[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return output;
}

function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Array<number | null> {
  const tr: number[] = [];
  for (let i = 0; i < highs.length; i += 1) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
      continue;
    }
    const hL = highs[i] - lows[i];
    const hPc = Math.abs(highs[i] - closes[i - 1]);
    const lPc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hL, hPc, lPc));
  }

  const output: Array<number | null> = new Array(tr.length).fill(null);
  if (tr.length <= period) return output;

  let seed = 0;
  for (let i = 1; i <= period; i += 1) {
    seed += tr[i];
  }
  let prevAtr = seed / period;
  output[period] = prevAtr;

  for (let i = period + 1; i < tr.length; i += 1) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    output[i] = prevAtr;
  }

  return output;
}

function minSlice(values: number[], start: number, endExclusive: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = Math.max(0, start); i < Math.min(values.length, endExclusive); i += 1) {
    if (values[i] < min) min = values[i];
  }
  return min;
}

function maxSlice(values: number[], start: number, endExclusive: number): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = Math.max(0, start); i < Math.min(values.length, endExclusive); i += 1) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

function aggregateTo4h(candlesAsc: Candle1h[]): Candle1h[] {
  const buckets = new Map<string, Candle1h[]>();
  for (const candle of candlesAsc) {
    const d = new Date(candle.candle_time);
    const bucketHour = Math.floor(d.getUTCHours() / 4) * 4;
    const bucketStart = new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        bucketHour,
        0,
        0,
        0,
      ),
    );
    const key = bucketStart.toISOString();
    const arr = buckets.get(key) ?? [];
    arr.push(candle);
    buckets.set(key, arr);
  }

  const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  const output: Candle1h[] = [];
  for (const key of keys) {
    const rows = buckets.get(key)!;
    const first = rows[0];
    const last = rows[rows.length - 1];
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (row.high > high) high = row.high;
      if (row.low < low) low = row.low;
    }

    output.push({
      candle_time: key,
      open: first.open,
      high,
      low,
      close: last.close,
    });
  }

  return output;
}

function scoreSignal(params: {
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  prev20High: number;
  prev20Low: number;
  htfClose: number;
  htfEma20: number;
  htfEma50: number;
}): SignalScoring {
  const {
    close,
    ema20,
    ema50,
    ema200,
    rsi14,
    prev20High,
    prev20Low,
    htfClose,
    htfEma20,
    htfEma50,
  } = params;

  let longScore = 0;
  let shortScore = 0;

  if (ema20 > ema50 && ema50 > ema200) longScore += 2;
  if (ema20 < ema50 && ema50 < ema200) shortScore += 2;

  if (htfClose > htfEma20 && htfEma20 > htfEma50) longScore += 2;
  if (htfClose < htfEma20 && htfEma20 < htfEma50) shortScore += 2;

  if (close > prev20High) longScore += 2;
  if (close < prev20Low) shortScore += 2;

  if (rsi14 >= 52 && rsi14 <= 72) longScore += 1;
  if (rsi14 <= 48 && rsi14 >= 28) shortScore += 1;

  if (close > ema20) longScore += 1;
  if (close < ema20) shortScore += 1;

  return {
    long_score: longScore,
    short_score: shortScore,
    threshold: 6,
  };
}

function directionFromScores(scores: SignalScoring): Direction {
  if (scores.long_score >= scores.threshold && scores.long_score > scores.short_score) {
    return "long";
  }
  if (scores.short_score >= scores.threshold && scores.short_score > scores.long_score) {
    return "short";
  }
  return "none";
}

function setupScoreFromScores(scores: SignalScoring): number {
  const raw = Math.max(scores.long_score, scores.short_score);
  return round(Math.min(100, (raw / 8) * 100), 2);
}

function buildTopReasons(params: {
  direction: Direction;
  ema20: number;
  ema50: number;
  ema200: number;
  close: number;
  prev20High: number;
  prev20Low: number;
  rsi14: number;
  htfClose: number;
  htfEma20: number;
  htfEma50: number;
}): string[] {
  const reasons: string[] = [];
  const {
    direction,
    ema20,
    ema50,
    ema200,
    close,
    prev20High,
    prev20Low,
    rsi14,
    htfClose,
    htfEma20,
    htfEma50,
  } = params;

  if (direction === "long") {
    if (ema20 > ema50 && ema50 > ema200) reasons.push("1H EMA trend alignment bullish");
    if (htfClose > htfEma20 && htfEma20 > htfEma50) reasons.push("4H trend filter bullish");
    if (close > prev20High) reasons.push("Breakout above prior 20H high");
    if (rsi14 >= 52) reasons.push("RSI momentum supports continuation");
  }

  if (direction === "short") {
    if (ema20 < ema50 && ema50 < ema200) reasons.push("1H EMA trend alignment bearish");
    if (htfClose < htfEma20 && htfEma20 < htfEma50) reasons.push("4H trend filter bearish");
    if (close < prev20Low) reasons.push("Breakout below prior 20H low");
    if (rsi14 <= 48) reasons.push("RSI momentum supports downside");
  }

  return reasons.slice(0, 3);
}

function buildInvalidationConditions(params: {
  direction: Direction;
  stopLoss: number | null;
  validUntil: string | null;
  maxSpreadPips: number;
}): string[] {
  const conditions: string[] = [];

  if (params.direction === "long" && params.stopLoss !== null) {
    conditions.push(`Invalidate if 1H low closes below ${round(params.stopLoss, 6)}`);
  }
  if (params.direction === "short" && params.stopLoss !== null) {
    conditions.push(`Invalidate if 1H high closes above ${round(params.stopLoss, 6)}`);
  }
  if (params.validUntil) {
    conditions.push(`Expires at ${params.validUntil}`);
  }
  conditions.push(`Do not execute if spread exceeds ${params.maxSpreadPips} pips`);
  conditions.push("Cancel if high-impact news window is active");
  return conditions;
}

function buildTradePlan(params: {
  symbol: string;
  direction: Direction;
  latestPrice: number;
  atrValue: number;
  lows: number[];
  highs: number[];
  index: number;
  minStopPips: number;
  maxStopPips: number;
  triggerPolicy: TriggerPolicy;
}): TradePlan {
  const {
    symbol,
    direction,
    latestPrice,
    atrValue,
    lows,
    highs,
    index,
    minStopPips,
    maxStopPips,
    triggerPolicy,
  } = params;

  const pips = pipSize(symbol);
  const structureLookback = 6;
  const riskMin = Math.max(0.45 * atrValue, minStopPips * pips);
  const riskMax = Math.max(2.2 * atrValue, maxStopPips * pips);

  const entryOffset = triggerPolicy === "limit" ? 0.15 * atrValue : 0;
  const entry = direction === "long"
    ? latestPrice - entryOffset
    : direction === "short"
    ? latestPrice + entryOffset
    : latestPrice;

  let stop = entry;

  if (direction === "long") {
    const structureLow = minSlice(lows, index - structureLookback + 1, index + 1) - 0.15 * atrValue;
    const atrStop = entry - 1.1 * atrValue;
    stop = Math.max(structureLow, atrStop);

    let risk = entry - stop;
    if (risk < riskMin) stop = entry - riskMin;
    risk = entry - stop;
    if (risk > riskMax) stop = entry - riskMax;

    risk = entry - stop;
    return {
      entry_price: entry,
      stop_loss: stop,
      tp1: entry + risk,
      tp2: entry + 2 * risk,
      tp3: entry + 3 * risk,
      risk_r: risk,
    };
  }

  if (direction === "short") {
    const structureHigh = maxSlice(highs, index - structureLookback + 1, index + 1) + 0.15 * atrValue;
    const atrStop = entry + 1.1 * atrValue;
    stop = Math.min(structureHigh, atrStop);

    let risk = stop - entry;
    if (risk < riskMin) stop = entry + riskMin;
    risk = stop - entry;
    if (risk > riskMax) stop = entry + riskMax;

    risk = stop - entry;
    return {
      entry_price: entry,
      stop_loss: stop,
      tp1: entry - risk,
      tp2: entry - 2 * risk,
      tp3: entry - 3 * risk,
      risk_r: risk,
    };
  }

  return {
    entry_price: null,
    stop_loss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    risk_r: null,
  };
}

function shouldTrigger(params: {
  signalState: string;
  direction: Direction;
  triggerPolicy: TriggerPolicy;
  entryPrice: number | null;
  candle: Candle1h;
}): boolean {
  if (!["pending", "active"].includes(params.signalState)) return false;
  if (params.direction === "none" || params.entryPrice === null) return false;

  if (params.triggerPolicy === "market") return true;

  if (params.triggerPolicy === "limit") {
    if (params.direction === "long") {
      return params.candle.low <= params.entryPrice && params.candle.high >= params.entryPrice;
    }
    return params.candle.high >= params.entryPrice && params.candle.low <= params.entryPrice;
  }

  if (params.triggerPolicy === "confirmation") {
    if (params.direction === "long") return params.candle.close > params.entryPrice;
    return params.candle.close < params.entryPrice;
  }

  return false;
}

function htfBiasFromEma(htfClose: number, htfEma20: number, htfEma50: number): string {
  if (htfClose > htfEma20 && htfEma20 > htfEma50) return "bullish";
  if (htfClose < htfEma20 && htfEma20 < htfEma50) return "bearish";
  return "neutral";
}

function computeTrendStrength(ema20: number, ema50: number, atrValue: number): number {
  if (!Number.isFinite(atrValue) || atrValue <= 0) return 0;
  return Math.abs(ema20 - ema50) / atrValue;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint]
      .filter((v) => typeof v === "string" && v.trim().length > 0)
      .join(" | ");
  }
  return String(error ?? "");
}

function isUniqueViolationFor(error: unknown, marker: string): boolean {
  if (!(error && typeof error === "object")) return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const text = getErrorText(error);
  if (code === "23505") return text.includes(marker) || marker.length === 0;
  return text.toLowerCase().includes("duplicate key value") && text.includes(marker);
}

async function loadGlobalConfig(supabase: SupabaseClient): Promise<GlobalStrategyConfig> {
  const envAccountEquity = toFiniteNumber(Deno.env.get("STRATEGY_ACCOUNT_EQUITY_USD"));
  const { data, error } = await supabase
    .from("strategy_runtime_config")
    .select("value")
    .eq("key", "global")
    .maybeSingle();

  if (error || !data?.value || typeof data.value !== "object") {
    return {
      ...DEFAULT_GLOBAL_CONFIG,
      account_equity_usd: clamp(
        envAccountEquity ?? DEFAULT_GLOBAL_CONFIG.account_equity_usd,
        50,
        100_000_000,
      ),
    };
  }

  const value = data.value as Record<string, unknown>;
  return {
    strategy_version: String(value.strategy_version ?? DEFAULT_GLOBAL_CONFIG.strategy_version),
    setup_label: String(value.setup_label ?? DEFAULT_GLOBAL_CONFIG.setup_label),
    account_equity_usd: clamp(
      envAccountEquity ??
        toFiniteNumber(value.account_equity_usd) ??
        DEFAULT_GLOBAL_CONFIG.account_equity_usd,
      50,
      100_000_000,
    ),
    max_total_risk_pct: toFiniteNumber(value.max_total_risk_pct) ?? DEFAULT_GLOBAL_CONFIG.max_total_risk_pct,
    max_open_trades: Math.max(1, Math.trunc(toFiniteNumber(value.max_open_trades) ?? DEFAULT_GLOBAL_CONFIG.max_open_trades)),
    max_trades_per_day: Math.max(1, Math.trunc(toFiniteNumber(value.max_trades_per_day) ?? DEFAULT_GLOBAL_CONFIG.max_trades_per_day)),
    max_symbol_trades_per_day: Math.max(
      1,
      Math.trunc(toFiniteNumber(value.max_symbol_trades_per_day) ?? DEFAULT_GLOBAL_CONFIG.max_symbol_trades_per_day),
    ),
    max_trades_per_session: Math.max(
      1,
      Math.trunc(toFiniteNumber(value.max_trades_per_session) ?? DEFAULT_GLOBAL_CONFIG.max_trades_per_session),
    ),
    correlation_base_currency_cap: Math.max(
      1,
      Math.trunc(toFiniteNumber(value.correlation_base_currency_cap) ?? DEFAULT_GLOBAL_CONFIG.correlation_base_currency_cap),
    ),
    telegram_max_messages_per_hour: Math.max(
      1,
      Math.trunc(
        toFiniteNumber(value.telegram_max_messages_per_hour) ?? DEFAULT_GLOBAL_CONFIG.telegram_max_messages_per_hour,
      ),
    ),
    session_filter_enabled: toBoolean(value.session_filter_enabled, DEFAULT_GLOBAL_CONFIG.session_filter_enabled),
    news_filter_enabled: toBoolean(value.news_filter_enabled, DEFAULT_GLOBAL_CONFIG.news_filter_enabled),
    volatility_filter_enabled: toBoolean(value.volatility_filter_enabled, DEFAULT_GLOBAL_CONFIG.volatility_filter_enabled),
    trend_filter_enabled: toBoolean(value.trend_filter_enabled, DEFAULT_GLOBAL_CONFIG.trend_filter_enabled),
  };
}

async function loadSymbolConfig(
  supabase: SupabaseClient,
  symbol: string,
): Promise<StrategySymbolConfig> {
  const envRiskPerTradePct = toFiniteNumber(Deno.env.get("STRATEGY_RISK_PER_TRADE_PCT"));
  const { data, error } = await supabase
    .from("strategy_symbol_config")
    .select("*")
    .eq("symbol", symbol)
    .maybeSingle();

  if (error || !data) {
    return {
      ...DEFAULT_SYMBOL_CONFIG,
      symbol,
      risk_per_trade_pct: clamp(
        envRiskPerTradePct ?? DEFAULT_SYMBOL_CONFIG.risk_per_trade_pct,
        0.01,
        5,
      ),
    };
  }

  const row = data as Record<string, unknown>;

  return {
    symbol,
    enabled: toBoolean(row.enabled, true),
    strategy_version: String(row.strategy_version ?? DEFAULT_SYMBOL_CONFIG.strategy_version),
    trigger_policy: String(row.trigger_policy ?? DEFAULT_SYMBOL_CONFIG.trigger_policy) as TriggerPolicy,
    session_start_hour_utc: Math.trunc(
      toFiniteNumber(row.session_start_hour_utc) ?? DEFAULT_SYMBOL_CONFIG.session_start_hour_utc,
    ),
    session_end_hour_utc: Math.trunc(
      toFiniteNumber(row.session_end_hour_utc) ?? DEFAULT_SYMBOL_CONFIG.session_end_hour_utc,
    ),
    risk_per_trade_pct: clamp(
      envRiskPerTradePct ??
        toFiniteNumber(row.risk_per_trade_pct) ??
        DEFAULT_SYMBOL_CONFIG.risk_per_trade_pct,
      0.01,
      5,
    ),
    min_stop_pips: toFiniteNumber(row.min_stop_pips) ?? DEFAULT_SYMBOL_CONFIG.min_stop_pips,
    max_stop_pips: toFiniteNumber(row.max_stop_pips) ?? DEFAULT_SYMBOL_CONFIG.max_stop_pips,
    max_spread_pips: toFiniteNumber(row.max_spread_pips) ?? DEFAULT_SYMBOL_CONFIG.max_spread_pips,
    require_spread: toBoolean(row.require_spread, DEFAULT_SYMBOL_CONFIG.require_spread),
    min_atr_pips: toFiniteNumber(row.min_atr_pips) ?? DEFAULT_SYMBOL_CONFIG.min_atr_pips,
    max_atr_pips: toFiniteNumber(row.max_atr_pips) ?? DEFAULT_SYMBOL_CONFIG.max_atr_pips,
    min_trend_strength: toFiniteNumber(row.min_trend_strength) ?? DEFAULT_SYMBOL_CONFIG.min_trend_strength,
    signal_ttl_hours: Math.max(1, Math.trunc(toFiniteNumber(row.signal_ttl_hours) ?? DEFAULT_SYMBOL_CONFIG.signal_ttl_hours)),
    reentry_cooldown_hours: Math.max(
      0,
      Math.trunc(toFiniteNumber(row.reentry_cooldown_hours) ?? DEFAULT_SYMBOL_CONFIG.reentry_cooldown_hours),
    ),
    slippage_pips_assumed: toFiniteNumber(row.slippage_pips_assumed) ?? DEFAULT_SYMBOL_CONFIG.slippage_pips_assumed,
    tp1_take_pct: toFiniteNumber(row.tp1_take_pct) ?? DEFAULT_SYMBOL_CONFIG.tp1_take_pct,
    tp2_take_pct: toFiniteNumber(row.tp2_take_pct) ?? DEFAULT_SYMBOL_CONFIG.tp2_take_pct,
    tp3_take_pct: toFiniteNumber(row.tp3_take_pct) ?? DEFAULT_SYMBOL_CONFIG.tp3_take_pct,
    move_sl_to_be_on_tp1: toBoolean(row.move_sl_to_be_on_tp1, DEFAULT_SYMBOL_CONFIG.move_sl_to_be_on_tp1),
    trail_after_tp2: toBoolean(row.trail_after_tp2, DEFAULT_SYMBOL_CONFIG.trail_after_tp2),
    trail_atr_multiple: toFiniteNumber(row.trail_atr_multiple) ?? DEFAULT_SYMBOL_CONFIG.trail_atr_multiple,
    liquidity_eps_pips: toFiniteNumber(row.liquidity_eps_pips) ?? DEFAULT_SYMBOL_CONFIG.liquidity_eps_pips,
    zone_base_candles: Math.max(
      3,
      Math.min(5, Math.trunc(toFiniteNumber(row.zone_base_candles) ?? DEFAULT_SYMBOL_CONFIG.zone_base_candles)),
    ),
    zone_base_max_pips: toFiniteNumber(row.zone_base_max_pips) ?? DEFAULT_SYMBOL_CONFIG.zone_base_max_pips,
    zone_impulse_candles: Math.max(
      1,
      Math.min(6, Math.trunc(toFiniteNumber(row.zone_impulse_candles) ?? DEFAULT_SYMBOL_CONFIG.zone_impulse_candles)),
    ),
    zone_impulse_pips: toFiniteNumber(row.zone_impulse_pips) ?? DEFAULT_SYMBOL_CONFIG.zone_impulse_pips,
    zone_invalidation_pips: toFiniteNumber(row.zone_invalidation_pips) ?? DEFAULT_SYMBOL_CONFIG.zone_invalidation_pips,
    one_trade_per_cycle: toBoolean(row.one_trade_per_cycle, DEFAULT_SYMBOL_CONFIG.one_trade_per_cycle),
  };
}

async function recordSignalEvent(params: {
  supabase: SupabaseClient;
  signalId: number;
  traceId: string;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await params.supabase
    .from("trading_signal_events")
    .insert({
      signal_id: params.signalId,
      trace_id: params.traceId,
      event_type: params.eventType,
      from_state: params.fromState ?? null,
      to_state: params.toState ?? null,
      event_reason: params.reason ?? null,
      event_payload: params.payload ?? {},
    });

  if (error) {
    throw new Error(`Failed to write trading_signal_events: ${error.message}`);
  }
}

async function transitionSignalState(params: {
  supabase: SupabaseClient;
  signalId: number;
  traceId: string;
  fromState: string;
  toState: SignalState;
  reason: string;
  patch?: Record<string, unknown>;
}): Promise<void> {
  const nowIso = new Date().toISOString();

  if (params.toState === "triggered") {
    const { data: cycleRow, error: cycleRowError } = await params.supabase
      .from("trading_signals")
      .select("symbol,cycle_id")
      .eq("id", params.signalId)
      .maybeSingle();

    if (cycleRowError) {
      throw new Error(`Failed reading signal cycle guard context: ${cycleRowError.message}`);
    }

    const symbol = String(cycleRow?.symbol ?? "");
    const cycleId = cycleRow?.cycle_id ? String(cycleRow.cycle_id) : "";
    if (symbol && cycleId) {
      const { data: enteredSignal, error: enteredSignalError } = await params.supabase
        .from("trading_signals")
        .select("id,signal_state")
        .eq("symbol", symbol)
        .eq("cycle_id", cycleId)
        .in("signal_state", ["triggered", "executed"])
        .neq("id", params.signalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (enteredSignalError) {
        throw new Error(`Failed reading one-trade-per-cycle guard: ${enteredSignalError.message}`);
      }

      if (enteredSignal) {
        const { error: invalidateError } = await params.supabase
          .from("trading_signals")
          .update({
            signal_state: "invalidated",
            invalidated_at: nowIso,
            invalidation_reason: "one_trade_per_cycle_locked_pretrigger",
            updated_at: nowIso,
            last_evaluated_at: nowIso,
          })
          .eq("id", params.signalId)
          .eq("signal_state", params.fromState);

        if (invalidateError) {
          throw new Error(`Failed invalidating cycle-locked signal: ${invalidateError.message}`);
        }

        await recordSignalEvent({
          supabase: params.supabase,
          signalId: params.signalId,
          traceId: params.traceId,
          eventType: "state_transition",
          fromState: params.fromState,
          toState: "invalidated",
          reason: "one_trade_per_cycle_locked_pretrigger",
          payload: {
            locked_by_signal_id: Number(enteredSignal.id),
            locked_by_state: String(enteredSignal.signal_state),
          },
        });
        return;
      }
    }
  }

  const updatePayload: Record<string, unknown> = {
    signal_state: params.toState,
    updated_at: nowIso,
    last_evaluated_at: nowIso,
    ...params.patch,
  };

  const { error } = await params.supabase
    .from("trading_signals")
    .update(updatePayload)
    .eq("id", params.signalId)
    .eq("signal_state", params.fromState);

  if (error) {
    if (
      params.toState === "triggered" &&
      isUniqueViolationFor(error, "trading_signals_one_trade_per_cycle_triggered_idx")
    ) {
      const { error: invalidateError } = await params.supabase
        .from("trading_signals")
        .update({
          signal_state: "invalidated",
          invalidated_at: nowIso,
          invalidation_reason: "one_trade_per_cycle_locked_at_trigger",
          updated_at: nowIso,
          last_evaluated_at: nowIso,
        })
        .eq("id", params.signalId)
        .eq("signal_state", params.fromState);

      if (!invalidateError) {
        await recordSignalEvent({
          supabase: params.supabase,
          signalId: params.signalId,
          traceId: params.traceId,
          eventType: "state_transition",
          fromState: params.fromState,
          toState: "invalidated",
          reason: "one_trade_per_cycle_locked_at_trigger",
          payload: params.patch,
        });
        return;
      }
    }
    throw new Error(`Failed to transition signal state: ${error.message}`);
  }

  await recordSignalEvent({
    supabase: params.supabase,
    signalId: params.signalId,
    traceId: params.traceId,
    eventType: "state_transition",
    fromState: params.fromState,
    toState: params.toState,
    reason: params.reason,
    payload: params.patch,
  });
}

async function openPositionForSignal(params: {
  supabase: SupabaseClient;
  signalId: number;
  traceId: string;
}): Promise<void> {
  const { data: existingPosition, error: existingPositionError } = await params.supabase
    .from("trading_positions")
    .select("id")
    .eq("signal_id", params.signalId)
    .maybeSingle();

  if (existingPositionError) {
    throw new Error(`Failed checking existing position: ${existingPositionError.message}`);
  }

  if (existingPosition) {
    return;
  }

  const { data: signal, error: signalError } = await params.supabase
    .from("trading_signals")
    .select("symbol,direction,entry_price,stop_loss,tp1,tp2,tp3,risk_amount_usd,position_size_units,management_plan")
    .eq("id", params.signalId)
    .single();

  if (signalError || !signal) {
    throw new Error(`Failed to load signal for position creation: ${signalError?.message ?? "missing"}`);
  }

  const management = (signal.management_plan ?? {}) as Record<string, unknown>;
  const trailAtrMultiple = toFiniteNumber(management.trail_atr_multiple) ?? 0.8;
  const brokerExecutionEnabled = toBoolean(
    Deno.env.get("BROKER_EXECUTION_ENABLED"),
    false,
  );
  const configuredBroker = (Deno.env.get("BROKER_EXECUTION_BROKER") ?? "").trim().toLowerCase();
  const executionBroker = brokerExecutionEnabled
    ? (configuredBroker.length > 0 ? configuredBroker : "paper")
    : "paper";

  if (signal.entry_price === null || signal.stop_loss === null) {
    return;
  }

  const { error: insertError } = await params.supabase
    .from("trading_positions")
    .insert({
      signal_id: params.signalId,
      trace_id: params.traceId,
      symbol: signal.symbol,
      direction: signal.direction,
      status: "open",
      entry_price: signal.entry_price,
      stop_loss: signal.stop_loss,
      current_stop_loss: signal.stop_loss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      risk_amount_usd: signal.risk_amount_usd,
      planned_size_units: signal.position_size_units,
      open_size_units: signal.position_size_units,
      trailing_atr_multiple: trailAtrMultiple,
      execution_payload: {
        broker: executionBroker,
        source: "signal_trigger",
      },
    });

  if (insertError) {
    throw new Error(`Failed creating trading position: ${insertError.message}`);
  }

  await recordSignalEvent({
    supabase: params.supabase,
    signalId: params.signalId,
    traceId: params.traceId,
    eventType: "position_opened",
    reason: "triggered",
  });

  if (brokerExecutionEnabled) {
    const broker = executionBroker;
    let enqueued = false;
    try {
      await params.supabase.rpc("enqueue_broker_order_from_signal", {
        p_signal_id: params.signalId,
        p_trace_id: params.traceId,
        p_broker: broker.length > 0 ? broker : null,
      });
      enqueued = true;
    } catch {
      // Best-effort broker handoff; signal lifecycle should continue.
    }

    if (enqueued) {
      try {
        await recordSignalEvent({
          supabase: params.supabase,
          signalId: params.signalId,
          traceId: params.traceId,
          eventType: "broker_intent_enqueued",
          reason: "broker_execution_enabled",
          payload: {
            broker: broker.length > 0 ? broker : "paper",
          },
        });
      } catch {
        // Event logging is best-effort.
      }

      try {
        await dispatchBrokerExecutionNow({
          traceId: params.traceId,
          signalId: params.signalId,
          broker: broker.length > 0 ? broker : "paper",
        });
        try {
          await recordSignalEvent({
            supabase: params.supabase,
            signalId: params.signalId,
            traceId: params.traceId,
            eventType: "broker_dispatch_requested",
            reason: "on_signal_dispatch",
            payload: {
              broker: broker.length > 0 ? broker : "paper",
            },
          });
        } catch {
          // Event logging is best-effort.
        }
      } catch (dispatchError) {
        const dispatchErrorMessage = dispatchError instanceof Error
          ? dispatchError.message
          : String(dispatchError);
        try {
          await recordSignalEvent({
            supabase: params.supabase,
            signalId: params.signalId,
            traceId: params.traceId,
            eventType: "broker_dispatch_failed",
            reason: "on_signal_dispatch_failed",
            payload: {
              broker: broker.length > 0 ? broker : "paper",
              error: dispatchErrorMessage.slice(0, 400),
            },
          });
        } catch {
          // Event logging is best-effort.
        }
      }
    } else {
      try {
        await recordSignalEvent({
          supabase: params.supabase,
          signalId: params.signalId,
          traceId: params.traceId,
          eventType: "broker_enqueue_failed",
          reason: "enqueue_broker_order_from_signal_failed",
          payload: {
            broker: broker.length > 0 ? broker : "paper",
          },
        });
      } catch {
        // Event logging is best-effort.
      }
    }
  }
}

async function manageTriggeredPosition(params: {
  supabase: SupabaseClient;
  traceId: string;
  signal: Record<string, unknown>;
  candle: Candle1h;
  atrValue: number;
}): Promise<void> {
  const signalId = Number(params.signal.id);
  const direction = String(params.signal.direction) as Direction;
  const managementPlan = (params.signal.management_plan ?? {}) as Record<string, unknown>;
  const moveSlToBe = toBoolean(managementPlan.move_sl_to_be_on_tp1, true);
  const trailAfterTp2 = toBoolean(managementPlan.trail_after_tp2, true);
  const trailAtrMultiple = toFiniteNumber(managementPlan.trail_atr_multiple) ?? 0.8;
  const tp1Pct = (toFiniteNumber(managementPlan.tp1_take_pct) ?? 50) / 100;
  const tp2Pct = (toFiniteNumber(managementPlan.tp2_take_pct) ?? 30) / 100;

  const { data: position, error: positionError } = await params.supabase
    .from("trading_positions")
    .select("*")
    .eq("signal_id", signalId)
    .eq("status", "open")
    .maybeSingle();

  if (positionError) {
    throw new Error(`Failed reading open position: ${positionError.message}`);
  }

  if (!position) {
    return;
  }

  const positionBroker = String(position.broker ?? "paper").trim().toLowerCase() || "paper";
  if (positionBroker !== "paper") {
    // Broker-managed positions are reconciled by broker callbacks/sync,
    // so we avoid paper-side TP/SL lifecycle mutations here.
    return;
  }

  const currentStop = Number(position.current_stop_loss);
  const entry = Number(position.entry_price);
  const openSize = toFiniteNumber(position.open_size_units) ?? 0;
  const plannedSize = toFiniteNumber(position.planned_size_units) ?? openSize;
  const tp1 = toFiniteNumber(position.tp1);
  const tp2 = toFiniteNumber(position.tp2);
  const tp3 = toFiniteNumber(position.tp3);

  const candleHigh = params.candle.high;
  const candleLow = params.candle.low;

  // Conservative intrabar assumption: stop checks first.
  const stopHit = direction === "long"
    ? candleLow <= currentStop
    : candleHigh >= currentStop;

  if (stopHit) {
    const priceDelta = direction === "long" ? currentStop - entry : entry - currentStop;
    const realizedPnl = priceDelta * openSize;
    const riskAmount = toFiniteNumber(position.risk_amount_usd) ?? 0;
    const realizedR = riskAmount > 0 ? realizedPnl / riskAmount : null;

    const { error: closeError } = await params.supabase
      .from("trading_positions")
      .update({
        status: "closed",
        open_size_units: 0,
        closed_size_units: (toFiniteNumber(position.closed_size_units) ?? 0) + openSize,
        close_reason: "stop_loss",
        closed_at: new Date().toISOString(),
        realized_pnl: realizedPnl,
        realized_r: realizedR,
        updated_at: new Date().toISOString(),
      })
      .eq("id", position.id);

    if (closeError) {
      throw new Error(`Failed closing stopped position: ${closeError.message}`);
    }

    await transitionSignalState({
      supabase: params.supabase,
      signalId,
      traceId: params.traceId,
      fromState: "triggered",
      toState: "invalidated",
      reason: "position_stopped",
      patch: {
        invalidated_at: new Date().toISOString(),
        invalidation_reason: "stop_loss_hit",
      },
    });

    return;
  }

  let nextOpenSize = openSize;
  let nextClosedSize = toFiniteNumber(position.closed_size_units) ?? 0;
  let nextStop = currentStop;
  const nowIso = new Date().toISOString();

  const patchPosition: Record<string, unknown> = {
    updated_at: nowIso,
  };

  const tp1AlreadyHit = Boolean(position.tp1_hit_at);
  const tp2AlreadyHit = Boolean(position.tp2_hit_at);
  const tp3AlreadyHit = Boolean(position.tp3_hit_at);

  if (!tp1AlreadyHit && tp1 !== null) {
    const hit = direction === "long" ? candleHigh >= tp1 : candleLow <= tp1;
    if (hit) {
      const take = plannedSize * tp1Pct;
      const reduced = Math.min(nextOpenSize, take);
      nextOpenSize -= reduced;
      nextClosedSize += reduced;
      patchPosition.tp1_hit_at = nowIso;
      if (moveSlToBe) {
        nextStop = entry;
        patchPosition.moved_to_be_at = nowIso;
      }
      await recordSignalEvent({
        supabase: params.supabase,
        signalId,
        traceId: params.traceId,
        eventType: "tp1_hit",
        reason: "scale_out",
      });
    }
  }

  if (!tp2AlreadyHit && tp2 !== null) {
    const hit = direction === "long" ? candleHigh >= tp2 : candleLow <= tp2;
    if (hit) {
      const take = plannedSize * tp2Pct;
      const reduced = Math.min(nextOpenSize, take);
      nextOpenSize -= reduced;
      nextClosedSize += reduced;
      patchPosition.tp2_hit_at = nowIso;
      if (trailAfterTp2 && Number.isFinite(params.atrValue) && params.atrValue > 0) {
        patchPosition.trailing_active = true;
        if (direction === "long") {
          nextStop = Math.max(nextStop, params.candle.close - params.atrValue * trailAtrMultiple);
        } else {
          nextStop = Math.min(nextStop, params.candle.close + params.atrValue * trailAtrMultiple);
        }
      }
      await recordSignalEvent({
        supabase: params.supabase,
        signalId,
        traceId: params.traceId,
        eventType: "tp2_hit",
        reason: "scale_out_and_trail",
      });
    }
  }

  if (!tp3AlreadyHit && tp3 !== null) {
    const hit = direction === "long" ? candleHigh >= tp3 : candleLow <= tp3;
    if (hit) {
      patchPosition.tp3_hit_at = nowIso;
      patchPosition.status = "closed";
      patchPosition.close_reason = "tp3_hit";
      patchPosition.closed_at = nowIso;
      nextClosedSize += nextOpenSize;
      nextOpenSize = 0;
      await recordSignalEvent({
        supabase: params.supabase,
        signalId,
        traceId: params.traceId,
        eventType: "tp3_hit",
        reason: "target_completed",
      });
    }
  }

  patchPosition.current_stop_loss = nextStop;
  patchPosition.open_size_units = nextOpenSize;
  patchPosition.closed_size_units = nextClosedSize;

  const { error: updateError } = await params.supabase
    .from("trading_positions")
    .update(patchPosition)
    .eq("id", position.id);

  if (updateError) {
    throw new Error(`Failed updating managed position: ${updateError.message}`);
  }

  if (patchPosition.status === "closed") {
    await transitionSignalState({
      supabase: params.supabase,
      signalId,
      traceId: params.traceId,
      fromState: "triggered",
      toState: "executed",
      reason: "tp3_completed",
      patch: {
        executed_at: nowIso,
      },
    });
  }
}

async function reconcileSymbolSignals(params: {
  supabase: SupabaseClient;
  symbol: string;
  traceId: string;
  latestCandle: Candle1h;
  atrValue: number;
}): Promise<ReconciledSignal[]> {
  const nowIso = new Date().toISOString();
  const results: ReconciledSignal[] = [];

  try {
    await params.supabase.rpc("expire_stale_signals");
  } catch {
    // Expiry reconciliation is best-effort and should not block checks.
  }

  const { data: activeSignals, error: activeSignalsError } = await params.supabase
    .from("trading_signals")
    .select("*")
    .eq("symbol", params.symbol)
    .in("signal_state", ["pending", "active", "triggered"])
    .order("created_at", { ascending: false })
    .limit(30);

  if (activeSignalsError) {
    throw new Error(`Failed loading active signals for reconciliation: ${activeSignalsError.message}`);
  }

  for (const signal of activeSignals ?? []) {
    const signalId = Number(signal.id);
    const currentState = String(signal.signal_state) as SignalState;
    const direction = String(signal.direction) as Direction;
    const stopLoss = toFiniteNumber(signal.stop_loss);

    if ((currentState === "pending" || currentState === "active") && stopLoss !== null) {
      const invalidated = direction === "long"
        ? params.latestCandle.low <= stopLoss
        : direction === "short"
        ? params.latestCandle.high >= stopLoss
        : false;

      if (invalidated) {
        await transitionSignalState({
          supabase: params.supabase,
          signalId,
          traceId: params.traceId,
          fromState: currentState,
          toState: "invalidated",
          reason: "invalidation_condition_hit",
          patch: {
            invalidated_at: nowIso,
            invalidation_reason: "pre_trigger_stop_cross",
          },
        });
        results.push({
          signal_id: signalId,
          signal_state: "invalidated",
          changed: true,
          reason: "pre_trigger_stop_cross",
        });
        continue;
      }
    }

    if (currentState === "pending" || currentState === "active") {
      const policy = String(signal.trigger_policy) as TriggerPolicy;
      const entryPrice = toFiniteNumber(signal.entry_price);
      if (
        shouldTrigger({
          signalState: currentState,
          direction,
          triggerPolicy: policy,
          entryPrice,
          candle: params.latestCandle,
        })
      ) {
        await transitionSignalState({
          supabase: params.supabase,
          signalId,
          traceId: params.traceId,
          fromState: currentState,
          toState: "triggered",
          reason: "trigger_condition_met",
          patch: {
            triggered_at: nowIso,
          },
        });
        await openPositionForSignal({
          supabase: params.supabase,
          signalId,
          traceId: params.traceId,
        });
        results.push({
          signal_id: signalId,
          signal_state: "triggered",
          changed: true,
          reason: "trigger_condition_met",
        });
        continue;
      }
    }

    if (currentState === "triggered") {
      await manageTriggeredPosition({
        supabase: params.supabase,
        traceId: params.traceId,
        signal,
        candle: params.latestCandle,
        atrValue: params.atrValue,
      });
      results.push({
        signal_id: signalId,
        signal_state: "triggered",
        changed: false,
        reason: "position_managed",
      });
      continue;
    }

    results.push({
      signal_id: signalId,
      signal_state: currentState,
      changed: false,
      reason: "unchanged",
    });
  }

  return results;
}

async function evaluateRiskGuards(params: {
  supabase: SupabaseClient;
  symbol: string;
  direction: Direction;
  now: Date;
  globalConfig: GlobalStrategyConfig;
  symbolConfig: StrategySymbolConfig;
  entryPrice: number;
  stopLoss: number;
}): Promise<RiskGuardResult> {
  const reasons: string[] = [];
  const riskDistance = Math.abs(params.entryPrice - params.stopLoss);
  const riskAmountUsd = params.globalConfig.account_equity_usd * (params.symbolConfig.risk_per_trade_pct / 100);
  const quoteToUsdRate = await resolveQuoteToUsdRate({
    supabase: params.supabase,
    symbol: params.symbol,
    entryPrice: params.entryPrice,
  });
  const riskDistanceUsdPerUnit = quoteToUsdRate !== null && quoteToUsdRate > 0
    ? riskDistance * quoteToUsdRate
    : 0;
  const positionSizeUnits = riskDistanceUsdPerUnit > 0 ? riskAmountUsd / riskDistanceUsdPerUnit : 0;

  if (quoteToUsdRate === null || quoteToUsdRate <= 0) {
    reasons.push("missing_quote_to_usd_rate");
  }

  if (riskDistance <= 0 || riskDistanceUsdPerUnit <= 0 || !Number.isFinite(positionSizeUnits) || positionSizeUnits <= 0) {
    reasons.push("invalid_risk_distance");
  }

  const { data: openPositions, error: openPositionsError } = await params.supabase
    .from("trading_positions")
    .select("symbol,risk_amount_usd,status")
    .eq("status", "open");

  if (openPositionsError) {
    throw new Error(`Failed reading open positions: ${openPositionsError.message}`);
  }

  const openRisk = (openPositions ?? []).reduce((sum, row) => {
    return sum + (toFiniteNumber((row as Record<string, unknown>).risk_amount_usd) ?? 0);
  }, 0);
  const openCount = (openPositions ?? []).length;
  const maxTotalRisk = params.globalConfig.account_equity_usd * (params.globalConfig.max_total_risk_pct / 100);

  if (openRisk + riskAmountUsd > maxTotalRisk) {
    reasons.push("max_total_risk_exceeded");
  }

  if (openCount >= params.globalConfig.max_open_trades) {
    reasons.push("max_open_trades_reached");
  }

  const dayStart = new Date(Date.UTC(
    params.now.getUTCFullYear(),
    params.now.getUTCMonth(),
    params.now.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  const { count: dayTradeCount, error: dayTradeCountError } = await params.supabase
    .from("trading_signals")
    .select("id", { head: true, count: "exact" })
    .gte("created_at", dayStart.toISOString())
    .in("signal_state", ["active", "triggered", "executed"]);

  if (dayTradeCountError) {
    throw new Error(`Failed reading daily trade count: ${dayTradeCountError.message}`);
  }

  if ((dayTradeCount ?? 0) >= params.globalConfig.max_trades_per_day) {
    reasons.push("max_trades_per_day_reached");
  }

  const { count: symbolTradeCount, error: symbolTradeCountError } = await params.supabase
    .from("trading_signals")
    .select("id", { head: true, count: "exact" })
    .eq("symbol", params.symbol)
    .gte("created_at", dayStart.toISOString())
    .in("signal_state", ["active", "triggered", "executed"]);

  if (symbolTradeCountError) {
    throw new Error(`Failed reading symbol daily trade count: ${symbolTradeCountError.message}`);
  }

  if ((symbolTradeCount ?? 0) >= params.globalConfig.max_symbol_trades_per_day) {
    reasons.push("max_symbol_trades_per_day_reached");
  }

  const sessionStart = (() => {
    const start = new Date(Date.UTC(
      params.now.getUTCFullYear(),
      params.now.getUTCMonth(),
      params.now.getUTCDate(),
      params.symbolConfig.session_start_hour_utc,
      0,
      0,
      0,
    ));

    if (params.symbolConfig.session_start_hour_utc <= params.symbolConfig.session_end_hour_utc) {
      if (params.now < start) {
        start.setUTCDate(start.getUTCDate() - 1);
      }
      return start;
    }

    if (params.now.getUTCHours() < params.symbolConfig.session_start_hour_utc) {
      start.setUTCDate(start.getUTCDate() - 1);
    }
    return start;
  })();

  const { count: sessionTradeCount, error: sessionTradeCountError } = await params.supabase
    .from("trading_signals")
    .select("id", { head: true, count: "exact" })
    .gte("created_at", sessionStart.toISOString())
    .in("signal_state", ["active", "triggered", "executed"]);

  if (sessionTradeCountError) {
    throw new Error(`Failed reading session trade count: ${sessionTradeCountError.message}`);
  }

  if ((sessionTradeCount ?? 0) >= params.globalConfig.max_trades_per_session) {
    reasons.push("max_trades_per_session_reached");
  }

  const { base, quote } = currenciesFromSymbol(params.symbol);
  const exposure = new Map<string, number>();
  for (const row of openPositions ?? []) {
    const rowSymbol = String((row as Record<string, unknown>).symbol ?? "");
    const currencies = currenciesFromSymbol(rowSymbol);
    if (currencies.base) {
      exposure.set(currencies.base, (exposure.get(currencies.base) ?? 0) + 1);
    }
    if (currencies.quote) {
      exposure.set(currencies.quote, (exposure.get(currencies.quote) ?? 0) + 1);
    }
  }

  if ((exposure.get(base) ?? 0) >= params.globalConfig.correlation_base_currency_cap) {
    reasons.push(`currency_exposure_cap_${base}`);
  }
  if ((exposure.get(quote) ?? 0) >= params.globalConfig.correlation_base_currency_cap) {
    reasons.push(`currency_exposure_cap_${quote}`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    risk_amount_usd: riskAmountUsd,
    position_size_units: positionSizeUnits,
    risk_distance_usd_per_unit: riskDistanceUsdPerUnit,
    quote_to_usd_rate: quoteToUsdRate,
    open_risk_usd: openRisk,
    max_total_risk_usd: maxTotalRisk,
    open_positions: openCount,
  };
}

async function checkReentryCooldown(params: {
  supabase: SupabaseClient;
  symbol: string;
  direction: Direction;
  now: Date;
  cooldownHours: number;
}): Promise<{ blocked: boolean; until: string | null }> {
  if (params.direction === "none" || params.cooldownHours <= 0) {
    return { blocked: false, until: null };
  }

  const since = new Date(params.now.getTime() - params.cooldownHours * HOUR_MS);

  const { data: lastLossLikeSignal, error } = await params.supabase
    .from("trading_signals")
    .select("created_at,cooldown_until,signal_state")
    .eq("symbol", params.symbol)
    .eq("direction", params.direction)
    .in("signal_state", ["invalidated", "expired", "cancelled"])
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed checking re-entry cooldown: ${error.message}`);
  }

  if (!lastLossLikeSignal) {
    return { blocked: false, until: null };
  }

  const cooldownUntil = lastLossLikeSignal.cooldown_until
    ? String(lastLossLikeSignal.cooldown_until)
    : new Date(
      new Date(String(lastLossLikeSignal.created_at)).getTime() +
        params.cooldownHours * HOUR_MS,
    ).toISOString();

  if (new Date(cooldownUntil) > params.now) {
    return { blocked: true, until: cooldownUntil };
  }

  return { blocked: false, until: cooldownUntil };
}

async function checkOneTradePerCycleLock(params: {
  supabase: SupabaseClient;
  symbol: string;
  cycleId: string | null;
}): Promise<{ blocked: boolean; signalId: number | null; signalState: string | null }> {
  if (!params.cycleId || params.cycleId.trim() === "") {
    return { blocked: false, signalId: null, signalState: null };
  }

  const { data, error } = await params.supabase
    .from("trading_signals")
    .select("id,signal_state")
    .eq("symbol", params.symbol)
    .eq("cycle_id", params.cycleId)
    .in("signal_state", ["triggered", "executed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed checking one-trade-per-cycle lock: ${error.message}`);
  }

  if (!data) {
    return { blocked: false, signalId: null, signalState: null };
  }

  return {
    blocked: true,
    signalId: Number(data.id),
    signalState: String(data.signal_state),
  };
}

async function insertOpsAlert(params: {
  supabase: SupabaseClient;
  traceId: string;
  alertType: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await params.supabase.from("ops_alerts").insert({
      trace_id: params.traceId,
      alert_type: params.alertType,
      severity: params.severity,
      message: params.message,
      payload: params.payload ?? {},
    });
  } catch {
    // Alerting is best-effort and must not break strategy execution.
  }
}

function readNewsFlag(symbol: string): boolean {
  const env = Deno.env.get("HIGH_IMPACT_NEWS_SYMBOLS") ?? "";
  const symbols = env
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v) => v.length > 0);
  return symbols.includes(symbol);
}

function parseLatestSpread(params: {
  value?: number | string | null;
  fallbackRangePips?: number;
}): number | null {
  const explicit = toFiniteNumber(params.value);
  if (explicit !== null) return explicit;
  if (params.fallbackRangePips !== undefined && Number.isFinite(params.fallbackRangePips)) {
    return round(Math.max(0.1, params.fallbackRangePips * 0.12), 4);
  }
  return null;
}

function buildPrimaryPlan(params: {
  symbol: string;
  direction: Direction;
  triggerPolicy: TriggerPolicy;
  setupScore: number;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  ttl: string | null;
  riskAmountUsd: number;
  positionSizeUnits: number;
  setupLabel: string;
}): Record<string, unknown> {
  return {
    symbol: params.symbol,
    direction: params.direction,
    trigger_policy: params.triggerPolicy,
    setup_label: params.setupLabel,
    setup_score: params.setupScore,
    entry: params.entry,
    stop_loss: params.stop,
    take_profits: {
      tp1_1r: params.tp1,
      tp2_2r: params.tp2,
      tp3_3r: params.tp3,
    },
    valid_until: params.ttl,
    risk_amount_usd: round(params.riskAmountUsd, 4),
    position_size_units: round(params.positionSizeUnits, 4),
  };
}

function buildManagementPlan(symbolConfig: StrategySymbolConfig): Record<string, unknown> {
  return {
    tp1_take_pct: symbolConfig.tp1_take_pct,
    tp2_take_pct: symbolConfig.tp2_take_pct,
    tp3_take_pct: symbolConfig.tp3_take_pct,
    move_sl_to_be_on_tp1: symbolConfig.move_sl_to_be_on_tp1,
    trail_after_tp2: symbolConfig.trail_after_tp2,
    trail_atr_multiple: symbolConfig.trail_atr_multiple,
    reentry_cooldown_hours: symbolConfig.reentry_cooldown_hours,
    one_trade_per_cycle: symbolConfig.one_trade_per_cycle,
    liquidity_eps_pips: symbolConfig.liquidity_eps_pips,
    zone_base_candles: symbolConfig.zone_base_candles,
    zone_base_max_pips: symbolConfig.zone_base_max_pips,
    zone_impulse_candles: symbolConfig.zone_impulse_candles,
    zone_impulse_pips: symbolConfig.zone_impulse_pips,
    zone_invalidation_pips: symbolConfig.zone_invalidation_pips,
  };
}

function toSignalStateForNewOpportunity(triggerPolicy: TriggerPolicy): SignalState {
  if (triggerPolicy === "market") return "triggered";
  return "active";
}

export function buildTelegramTradingMessage(
  result: TradingOpportunityResult,
): string {
  const directionText = result.direction === "long"
    ? "LONG"
    : result.direction === "short"
    ? "SHORT"
    : "NONE";

  const spreadText = result.spread_pips === null ? "n/a" : `${result.spread_pips} pips`;
  const invalidation = result.invalidation_conditions.length > 0
    ? result.invalidation_conditions.join(" | ")
    : "n/a";
  const topReasons = result.top_reasons.length > 0 ? result.top_reasons.join(" | ") : "n/a";

  return [
    "FX TRADE OPPORTUNITY",
    `Symbol: ${result.symbol}`,
    `Direction: ${directionText}`,
    `Setup Score: ${result.setup_score}`,
    `Entry: ${result.entry_price ?? "n/a"}`,
    `Stop Loss: ${result.stop_loss ?? "n/a"}`,
    `TP1 (1R): ${result.tp1 ?? "n/a"}`,
    `TP2 (2R): ${result.tp2 ?? "n/a"}`,
    `TP3 (3R): ${result.tp3 ?? "n/a"}`,
    `Spread: ${spreadText}`,
    `Expires: ${result.expires_at ?? "n/a"}`,
    `Top Reasons: ${topReasons}`,
    `Invalidation: ${invalidation}`,
    `State: ${result.signal_state}`,
    `Strategy State: ${result.strategy_state} (${result.strategy_reason})`,
    `Trigger: ${result.trigger_policy}`,
    `Strategy: ${result.strategy_name} (${result.strategy_version})`,
    `Trace: ${result.trace_id}`,
    `Cycle: ${result.cycle_id ?? "n/a"}`,
  ].join("\n");
}

export async function reserveTelegramNotification(params: {
  supabase: SupabaseClient;
  signalId: number | null;
  symbol: string;
  messageHash: string;
  traceId: string;
  maxMessagesPerHour: number;
}): Promise<TelegramReservationResult> {
  const { data: existing, error: existingError } = await params.supabase
    .from("telegram_notification_log")
    .select("status")
    .eq("symbol", params.symbol)
    .eq("message_hash", params.messageHash)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed reading telegram notification dedupe log: ${existingError.message}`);
  }

  if (existing) {
    return { allowed: false, reason: "duplicate_message_hash" };
  }

  const oneHourAgo = new Date(Date.now() - HOUR_MS).toISOString();
  const { count: recentSentCount, error: recentSentCountError } = await params.supabase
    .from("telegram_notification_log")
    .select("id", { head: true, count: "exact" })
    .eq("status", "sent")
    .gte("created_at", oneHourAgo);

  if (recentSentCountError) {
    throw new Error(`Failed reading telegram rate-limit count: ${recentSentCountError.message}`);
  }

  if ((recentSentCount ?? 0) >= params.maxMessagesPerHour) {
    try {
      await params.supabase.from("telegram_notification_log").insert({
        signal_id: params.signalId,
        symbol: params.symbol,
        message_hash: params.messageHash,
        status: "suppressed",
        error: "rate_limit_per_hour",
      });
    } catch {
      // Suppression audit logging is best-effort.
    }

    return { allowed: false, reason: "rate_limit_per_hour" };
  }

  const { error: insertError } = await params.supabase
    .from("telegram_notification_log")
    .insert({
      signal_id: params.signalId,
      symbol: params.symbol,
      message_hash: params.messageHash,
      status: "pending",
      attempt_count: 1,
    });

  if (insertError) {
    throw new Error(`Failed reserving telegram notification: ${insertError.message}`);
  }

  return { allowed: true, reason: "reserved" };
}

export async function finalizeTelegramNotification(params: {
  supabase: SupabaseClient;
  symbol: string;
  messageHash: string;
  sent: boolean;
  errorText?: string | null;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    status: params.sent ? "sent" : "failed",
    updated_at: new Date().toISOString(),
  };
  if (params.sent) {
    payload.sent_at = new Date().toISOString();
    payload.error = null;
  } else {
    payload.error = params.errorText ?? "send_failed";
  }

  const { error } = await params.supabase
    .from("telegram_notification_log")
    .update(payload)
    .eq("symbol", params.symbol)
    .eq("message_hash", params.messageHash);

  if (error) {
    throw new Error(`Failed finalizing telegram notification: ${error.message}`);
  }
}

export async function markOpportunityTelegramNotified(params: {
  supabase: SupabaseClient;
  checkId: number;
  messageId: string | null;
}): Promise<void> {
  const { data: check, error: checkError } = await params.supabase
    .from("trading_opportunity_checks")
    .select("signal_id")
    .eq("id", params.checkId)
    .single();

  if (checkError) {
    throw new Error(`Failed loading opportunity check for notify mark: ${checkError.message}`);
  }

  const nowIso = new Date().toISOString();
  const { error } = await params.supabase
    .from("trading_opportunity_checks")
    .update({
      telegram_notified: true,
      telegram_notified_at: nowIso,
      telegram_message_id: params.messageId,
    })
    .eq("id", params.checkId);

  if (error) {
    throw new Error(`Failed to mark Telegram notification: ${error.message}`);
  }

  if (check?.signal_id) {
    try {
      await recordSignalEvent({
        supabase: params.supabase,
        signalId: Number(check.signal_id),
        traceId: `notify-${params.checkId}`,
        eventType: "telegram_sent",
        reason: "notification_delivered",
        payload: {
          message_id: params.messageId,
        },
      });
    } catch {
      // Notification event logging is best-effort.
    }
  }
}

export async function runTradingOpportunityCheck(params: {
  supabase: SupabaseClient;
  symbol: string;
  latestPrice?: number | string | null;
  latestCandleTimeUtc?: string | null;
  spreadPips?: number | string | null;
  traceId?: string;
}): Promise<TradingOpportunityResult> {
  const normalizedSymbol = params.symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error("symbol is required");

  const now = new Date();
  const traceId = params.traceId ?? generateTraceId(`sig-${normalizedSymbol.replace("/", "")}`);
  const strategyName = "Photon Structure Continuation (4H/15M/1M + 15M Zones)";

  const globalConfig = await loadGlobalConfig(params.supabase);
  const symbolConfig = await loadSymbolConfig(params.supabase, normalizedSymbol);
  const minRr = clamp(
    toFiniteNumber(Deno.env.get("PHOTON_MIN_RR")) ?? 2.0,
    0,
    10,
  );
  const zoneBaseCandles = toPositiveInt(
    Deno.env.get("PHOTON_ZONE_BASE_CANDLES"),
    symbolConfig.zone_base_candles,
    3,
    5,
  );
  const zoneBaseMaxPips = clamp(
    toFiniteNumber(Deno.env.get("PHOTON_ZONE_BASE_MAX_PIPS")) ?? symbolConfig.zone_base_max_pips,
    1,
    200,
  );
  const zoneImpulseCandles = toPositiveInt(
    Deno.env.get("PHOTON_ZONE_IMPULSE_CANDLES"),
    symbolConfig.zone_impulse_candles,
    1,
    6,
  );
  const zoneImpulsePips = clamp(
    toFiniteNumber(Deno.env.get("PHOTON_ZONE_IMPULSE_PIPS")) ?? symbolConfig.zone_impulse_pips,
    1,
    500,
  );
  const zoneInvalidationPips = clamp(
    toFiniteNumber(Deno.env.get("PHOTON_ZONE_INVALIDATION_PIPS")) ?? symbolConfig.zone_invalidation_pips,
    0.1,
    50,
  );
  const isJpyPair = normalizedSymbol.includes("JPY");
  const liquidityEpsPips = clamp(
    toFiniteNumber(
      Deno.env.get(isJpyPair ? "PHOTON_LIQUIDITY_EPS_PIPS_JPY" : "PHOTON_LIQUIDITY_EPS_PIPS"),
    ) ?? symbolConfig.liquidity_eps_pips,
    0.01,
    10,
  );
  const oneTradePerCycle = toBoolean(
    Deno.env.get("PHOTON_ONE_TRADE_PER_CYCLE"),
    symbolConfig.one_trade_per_cycle,
  );
  const maxLtfCandles = toPositiveInt(
    Deno.env.get("STRUCTURE_MAX_1M_CANDLES"),
    12_000,
    2_000,
    120_000,
  );
  const max15mCandles = toPositiveInt(
    Deno.env.get("STRUCTURE_MAX_15M_CANDLES"),
    Math.ceil(maxLtfCandles / 15) + 160,
    160,
    20_000,
  );
  const maxReal1mBurstCandles = toPositiveInt(
    Deno.env.get("STRUCTURE_REAL_1M_BURST_LIMIT"),
    600,
    0,
    8_000,
  );
  const requireReal1mTrigger = toBoolean(
    Deno.env.get("PHOTON_REQUIRE_REAL_1M_TRIGGER"),
    true,
  );
  const real1mFreshnessMinutes = toPositiveInt(
    Deno.env.get("PHOTON_REAL_1M_FRESHNESS_MINUTES"),
    20,
    1,
    240,
  );

  const structureFetchPageSize = toPositiveInt(
    Deno.env.get("STRUCTURE_FETCH_PAGE_SIZE"),
    1_000,
    200,
    5_000,
  );
  const raw15mCandles = await loadRecent15mCandles({
    supabase: params.supabase,
    symbol: normalizedSymbol,
    limit: max15mCandles,
    pageSize: structureFetchPageSize,
  });
  const raw1mCandles = maxReal1mBurstCandles > 0
    ? await loadRecent1mCandles({
      supabase: params.supabase,
      symbol: normalizedSymbol,
      limit: maxReal1mBurstCandles,
      pageSize: structureFetchPageSize,
    })
    : [];

  const candles15mAsc = raw15mCandles.slice().reverse();
  const synthetic1mAsc = expand15mToSynthetic1m(candles15mAsc);
  const candlesAsc = mergeSyntheticAndReal1m({
    syntheticAsc: synthetic1mAsc,
    realDesc: raw1mCandles,
    maxRows: maxLtfCandles,
  });
  const latestReal1mCandle = raw1mCandles.length > 0 ? raw1mCandles[0] : null;
  const latestMergedCandle = candlesAsc.length > 0 ? candlesAsc[candlesAsc.length - 1] : null;

  const latestKnownPrice = toFiniteNumber(params.latestPrice) ??
    toFiniteNumber(latestReal1mCandle?.close) ??
    toFiniteNumber(raw15mCandles[0]?.close) ??
    0;
  const latestKnownTime = params.latestCandleTimeUtc ??
    (latestReal1mCandle?.candle_time
      ? String(latestReal1mCandle.candle_time)
      : raw15mCandles[0]?.candle_time
      ? String(raw15mCandles[0].candle_time)
      : latestMergedCandle?.candle_time
      ? String(latestMergedCandle.candle_time)
      : null);

  if (!symbolConfig.enabled || candlesAsc.length < 2500) {
    const reason = !symbolConfig.enabled ? "symbol_disabled" : "insufficient_15m_or_1m_history";
    const details = {
      reason,
      available_merged_1m_candles: candlesAsc.length,
      available_real_1m_candles: raw1mCandles.length,
      available_15m_candles: raw15mCandles.length,
      latest_known_time_utc: latestKnownTime,
    };

    const { data: inserted, error: insertError } = await params.supabase
      .from("trading_opportunity_checks")
      .insert({
        symbol: normalizedSymbol,
        latest_price: round(latestKnownPrice, 6),
        latest_candle_time: latestKnownTime,
        signal: "none",
        direction: "none",
        confidence: 0,
        strategy_name: strategyName,
        strategy_version: symbolConfig.strategy_version,
        setup_label: globalConfig.setup_label,
        setup_score: 0,
        signal_state: "none",
        cycle_id: null,
        trigger_policy: symbolConfig.trigger_policy,
        details,
        trace_id: traceId,
        top_reasons: [reason],
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(`Failed persisting neutral opportunity check: ${insertError?.message ?? "missing"}`);
    }

    return {
      check_id: Number(inserted.id),
      signal_id: null,
      trace_id: traceId,
      dedupe_key: null,
      cycle_id: null,
      strategy_state: "WAIT_HTF",
      strategy_reason: reason,
      symbol: normalizedSymbol,
      strategy_name: strategyName,
      strategy_version: symbolConfig.strategy_version,
      setup_label: globalConfig.setup_label,
      setup_score: 0,
      confidence: 0,
      direction: "none",
      signal: "none",
      signal_state: "none",
      trigger_policy: symbolConfig.trigger_policy,
      should_notify: false,
      latest_price: round(latestKnownPrice, 6),
      latest_candle_time_utc: latestKnownTime,
      entry_price: null,
      stop_loss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      risk_r: null,
      expires_at: null,
      spread_pips: null,
      news_nearby: false,
      regime_passed: false,
      top_reasons: [reason],
      invalidation_conditions: [],
      primary_plan: {},
      details,
    };
  }

  const latestCandle = candlesAsc[candlesAsc.length - 1];
  const latestReal1mAgeMinutes = latestReal1mCandle
    ? Math.max(
      0,
      (new Date(latestCandle.candle_time).getTime() - new Date(latestReal1mCandle.candle_time).getTime()) / 60_000,
    )
    : null;
  const hasFreshReal1m = latestReal1mAgeMinutes !== null && latestReal1mAgeMinutes <= real1mFreshnessMinutes;
  const latestPrice = toFiniteNumber(params.latestPrice) ?? latestCandle.close;
  const highs = candlesAsc.map((c) => c.high);
  const lows = candlesAsc.map((c) => c.low);
  const closes = candlesAsc.map((c) => c.close);
  const atrSeries = atr(highs, lows, closes, 14);
  const currentAtr = atrSeries[atrSeries.length - 1] ?? (Math.abs(latestCandle.high - latestCandle.low) || pipSize(normalizedSymbol));

  if (latestReal1mCandle) {
    await reconcileSymbolSignals({
      supabase: params.supabase,
      symbol: normalizedSymbol,
      traceId,
      latestCandle: latestReal1mCandle,
      atrValue: currentAtr,
    });
  }

  const photon = evaluatePhotonStructure({
    candles1m: candlesAsc,
    symbol: normalizedSymbol,
    asofUtc: params.latestCandleTimeUtc ?? latestCandle.candle_time,
    minRr,
    maxLtfCandles,
    zoneBaseCandles,
    zoneImpulseCandles,
    zoneBaseMaxPips,
    zoneImpulsePips,
    zoneInvalidationPips,
    liquidityEpsPips,
  });

  const spreadPips = parseLatestSpread({
    value: params.spreadPips,
    fallbackRangePips: Math.abs(latestCandle.high - latestCandle.low) / pipSize(normalizedSymbol),
  });
  const newsNearby = readNewsFlag(normalizedSymbol);
  const sessionPass = globalConfig.session_filter_enabled
    ? isWithinSession(
      new Date(latestCandle.candle_time).getUTCHours(),
      symbolConfig.session_start_hour_utc,
      symbolConfig.session_end_hour_utc,
    )
    : true;
  const newsPass = globalConfig.news_filter_enabled ? !newsNearby : true;
  const spreadPass = symbolConfig.require_spread
    ? spreadPips !== null && spreadPips <= symbolConfig.max_spread_pips
    : spreadPips === null || spreadPips <= symbolConfig.max_spread_pips;

  const regimeFailReasons: string[] = [];
  if (!photon.valid) regimeFailReasons.push(photon.reason);
  if (photon.valid && requireReal1mTrigger && !hasFreshReal1m) {
    regimeFailReasons.push("watch_1m_data_required");
  }
  if (!sessionPass) regimeFailReasons.push("session_filter_blocked");
  if (!newsPass) regimeFailReasons.push("high_impact_news_blocked");
  if (!spreadPass) regimeFailReasons.push("spread_filter_blocked");
  const regimePassed = regimeFailReasons.length === 0;

  const proposedDirection: Direction = photon.valid && (photon.side === "long" || photon.side === "short")
    ? photon.side
    : "none";
  const filteredDirection: Direction = regimePassed ? proposedDirection : "none";
  const cycleId = filteredDirection !== "none" ? photon.cycle_id : null;

  const tradePlan: TradePlan = {
    entry_price: filteredDirection !== "none" ? photon.entry_price : null,
    stop_loss: filteredDirection !== "none" ? photon.sl : null,
    tp1: null,
    tp2: null,
    tp3: filteredDirection !== "none" ? photon.tp : null,
    risk_r: filteredDirection !== "none" ? photon.rr : null,
  };
  if (
    filteredDirection !== "none" &&
    tradePlan.entry_price !== null &&
    tradePlan.stop_loss !== null
  ) {
    const risk = Math.abs(tradePlan.entry_price - tradePlan.stop_loss);
    if (filteredDirection === "long") {
      tradePlan.tp1 = round(tradePlan.entry_price + risk, 6);
      tradePlan.tp2 = round(tradePlan.entry_price + 2 * risk, 6);
    } else {
      tradePlan.tp1 = round(tradePlan.entry_price - risk, 6);
      tradePlan.tp2 = round(tradePlan.entry_price - 2 * risk, 6);
    }
  }

  const setupScore = filteredDirection === "none" || tradePlan.risk_r === null
    ? 0
    : round(
      clamp(
        60 + tradePlan.risk_r * 20 + (photon.top_reasons.length >= 3 ? 5 : 0),
        0,
        100,
      ),
      2,
    );
  const confidence = round(setupScore / 100, 4);
  const validUntil = filteredDirection === "none"
    ? null
    : new Date(new Date(latestCandle.candle_time).getTime() + symbolConfig.signal_ttl_hours * HOUR_MS).toISOString();

  const topReasons = filteredDirection === "none"
    ? [regimeFailReasons[0] ?? "no_signal"]
    : photon.top_reasons;
  const invalidationConditions = [
    ...photon.invalidation_conditions,
    `Do not execute if spread exceeds ${symbolConfig.max_spread_pips} pips`,
    "Cancel if high-impact news window is active",
  ];

  const dedupeKey = filteredDirection === "none"
    ? null
    : generateSignalKey({
      symbol: normalizedSymbol,
      strategyVersion: symbolConfig.strategy_version,
      direction: filteredDirection,
      triggerPolicy: symbolConfig.trigger_policy,
      cycleId,
      latestCandleTimeUtc: photon.entry_ts ?? latestCandle.candle_time,
      entryPrice: tradePlan.entry_price,
      stopLoss: tradePlan.stop_loss,
    });

  let signalId: number | null = null;
  let signalState: SignalState = "none";
  let shouldNotify = false;
  const riskReasons: string[] = [];
  let riskAmountUsd = 0;
  let positionSizeUnits = 0;
  let riskDistanceUsdPerUnit = 0;
  let quoteToUsdRate: number | null = null;
  let openRiskUsd = 0;
  let maxTotalRiskUsd = 0;
  let openPositions = 0;

  if (filteredDirection !== "none" && dedupeKey !== null) {
    const { data: existingSignal, error: existingSignalError } = await params.supabase
      .from("trading_signals")
      .select("id,signal_state")
      .eq("signal_key", dedupeKey)
      .in("signal_state", ["pending", "active", "triggered", "executed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSignalError) {
      throw new Error(`Failed checking duplicate signal: ${existingSignalError.message}`);
    }

    if (existingSignal) {
      signalId = Number(existingSignal.id);
      signalState = String(existingSignal.signal_state) as SignalState;
      shouldNotify = false;
      riskReasons.push("duplicate_signal_key");
    } else {
      if (oneTradePerCycle) {
        const cycleLock = await checkOneTradePerCycleLock({
          supabase: params.supabase,
          symbol: normalizedSymbol,
          cycleId,
        });
        if (cycleLock.blocked) {
          signalState = "invalidated";
          riskReasons.push("one_trade_per_cycle_locked");
          if (cycleLock.signalId !== null) {
            riskReasons.push(`cycle_locked_by_signal_${cycleLock.signalId}`);
          }
        }
      }

      const cooldown = await checkReentryCooldown({
        supabase: params.supabase,
        symbol: normalizedSymbol,
        direction: filteredDirection,
        now,
        cooldownHours: symbolConfig.reentry_cooldown_hours,
      });

      if (cooldown.blocked) {
        signalState = "invalidated";
        riskReasons.push("reentry_cooldown_active");
      }

      if (
        signalState !== "invalidated" &&
        tradePlan.entry_price !== null &&
        tradePlan.stop_loss !== null
      ) {
        const risk = await evaluateRiskGuards({
          supabase: params.supabase,
          symbol: normalizedSymbol,
          direction: filteredDirection,
          now,
          globalConfig,
          symbolConfig,
          entryPrice: tradePlan.entry_price,
          stopLoss: tradePlan.stop_loss,
        });

        riskAmountUsd = risk.risk_amount_usd;
        positionSizeUnits = risk.position_size_units;
        riskDistanceUsdPerUnit = risk.risk_distance_usd_per_unit;
        quoteToUsdRate = risk.quote_to_usd_rate;
        openRiskUsd = risk.open_risk_usd;
        maxTotalRiskUsd = risk.max_total_risk_usd;
        openPositions = risk.open_positions;

        if (!risk.allowed) {
          signalState = "invalidated";
          riskReasons.push(...risk.reasons);
        }
      }

      if (signalState !== "invalidated") {
        signalState = toSignalStateForNewOpportunity(symbolConfig.trigger_policy);
        shouldNotify = true;
      }

      const primaryPlan = buildPrimaryPlan({
        symbol: normalizedSymbol,
        direction: filteredDirection,
        triggerPolicy: symbolConfig.trigger_policy,
        setupScore,
        entry: tradePlan.entry_price,
        stop: tradePlan.stop_loss,
        tp1: tradePlan.tp1,
        tp2: tradePlan.tp2,
        tp3: tradePlan.tp3,
        ttl: validUntil,
        riskAmountUsd,
        positionSizeUnits,
        setupLabel: globalConfig.setup_label,
      });
      const managementPlan = buildManagementPlan(symbolConfig);

      const { data: insertedSignal, error: insertSignalError } = await params.supabase
        .from("trading_signals")
        .insert({
          signal_key: dedupeKey,
          cycle_id: cycleId,
          trace_id: traceId,
          symbol: normalizedSymbol,
          strategy_version: symbolConfig.strategy_version,
          strategy_name: strategyName,
          setup_label: globalConfig.setup_label,
          setup_score: setupScore,
          direction: filteredDirection,
          signal_state: signalState,
          trigger_policy: symbolConfig.trigger_policy,
          entry_price: tradePlan.entry_price,
          stop_loss: tradePlan.stop_loss,
          tp1: tradePlan.tp1,
          tp2: tradePlan.tp2,
          tp3: tradePlan.tp3,
          risk_r: tradePlan.risk_r,
          risk_amount_usd: riskAmountUsd,
          position_size_units: positionSizeUnits,
          spread_pips: spreadPips,
          slippage_pips_assumed: symbolConfig.slippage_pips_assumed,
          news_flag: newsNearby,
          regime_passed: regimePassed,
          valid_from: now.toISOString(),
          valid_until: validUntil,
          triggered_at: signalState === "triggered" ? now.toISOString() : null,
          invalidated_at: signalState === "invalidated" ? now.toISOString() : null,
          invalidation_reason: signalState === "invalidated" ? riskReasons.join(",") : null,
          cooldown_until: signalState === "invalidated"
            ? new Date(now.getTime() + symbolConfig.reentry_cooldown_hours * HOUR_MS).toISOString()
            : null,
          top_reasons: topReasons,
          invalidation_conditions: invalidationConditions,
          management_plan: managementPlan,
          primary_plan: primaryPlan,
          details: {
            photon: photon.details,
            cycle_id: cycleId,
            regime_fail_reasons: regimeFailReasons,
            risk_guard_reasons: riskReasons,
            open_risk_usd: round(openRiskUsd, 4),
            max_total_risk_usd: round(maxTotalRiskUsd, 4),
            open_positions: openPositions,
            quote_to_usd_rate: quoteToUsdRate === null ? null : round(quoteToUsdRate, 8),
            risk_distance_usd_per_unit: round(riskDistanceUsdPerUnit, 8),
          },
        })
        .select("id")
        .single();

      let insertedFreshSignal = false;
      if (insertedSignal && !insertSignalError) {
        signalId = Number(insertedSignal.id);
        insertedFreshSignal = true;
      } else if (insertSignalError && isUniqueViolationFor(insertSignalError, "trading_signals_signal_key_key")) {
        const { data: winner, error: winnerError } = await params.supabase
          .from("trading_signals")
          .select("id,signal_state")
          .eq("signal_key", dedupeKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (winnerError) {
          throw new Error(`Failed resolving signal_key race winner: ${winnerError.message}`);
        }
        if (!winner) {
          throw new Error("Failed resolving signal_key race winner: no winner row");
        }
        signalId = Number(winner.id);
        signalState = String(winner.signal_state) as SignalState;
        shouldNotify = false;
        riskReasons.push("duplicate_signal_key_race");
      } else if (insertSignalError && isUniqueViolationFor(insertSignalError, "trading_signals_one_trade_per_cycle_triggered_idx")) {
        const { data: winner, error: winnerError } = await params.supabase
          .from("trading_signals")
          .select("id,signal_state")
          .eq("symbol", normalizedSymbol)
          .eq("cycle_id", cycleId)
          .in("signal_state", ["triggered", "executed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (winnerError) {
          throw new Error(`Failed resolving cycle race winner: ${winnerError.message}`);
        }
        if (!winner) {
          throw new Error("Failed resolving cycle race winner: no winner row");
        }
        signalId = Number(winner.id);
        signalState = String(winner.signal_state) as SignalState;
        shouldNotify = false;
        riskReasons.push("one_trade_per_cycle_race_locked");
      } else {
        throw new Error(`Failed inserting trading signal: ${insertSignalError?.message ?? "missing"}`);
      }

      if (insertedFreshSignal && signalId !== null) {
        await recordSignalEvent({
          supabase: params.supabase,
          signalId,
          traceId,
          eventType: "signal_created",
          toState: signalState,
          reason: signalState === "invalidated" ? "risk_guard_blocked" : "new_setup",
          payload: {
            setup_score: setupScore,
            regime_fail_reasons: regimeFailReasons,
            risk_guard_reasons: riskReasons,
          },
        });

        if (signalState === "triggered") {
          await openPositionForSignal({
            supabase: params.supabase,
            signalId,
            traceId,
          });
        }
      }
      if (signalState === "invalidated") {
        shouldNotify = false;
      }
    }
  }

  const finalDirection = signalState === "none" || signalState === "invalidated" ? "none" : filteredDirection;
  const finalSignal = mapSignal(finalDirection);
  const primaryPlan = buildPrimaryPlan({
    symbol: normalizedSymbol,
    direction: finalDirection,
    triggerPolicy: symbolConfig.trigger_policy,
    setupScore,
    entry: tradePlan.entry_price,
    stop: tradePlan.stop_loss,
    tp1: tradePlan.tp1,
    tp2: tradePlan.tp2,
    tp3: tradePlan.tp3,
    ttl: validUntil,
    riskAmountUsd,
    positionSizeUnits,
    setupLabel: globalConfig.setup_label,
  });

  const details: Record<string, unknown> = {
    timeframe: "15m_primary_with_1m_watch",
    mtf_timeframe: "15m",
    htf_timeframe: "4h",
    data_source: "price_candles_15m+price_candles_1m_watch",
    available_15m_candles: raw15mCandles.length,
    available_real_1m_candles: raw1mCandles.length,
    latest_real_1m_age_minutes: latestReal1mAgeMinutes === null ? null : round(latestReal1mAgeMinutes, 3),
    real_1m_freshness_minutes: real1mFreshnessMinutes,
    has_fresh_real_1m: hasFreshReal1m,
    available_merged_1m_candles: candlesAsc.length,
    requires_real_1m_trigger: requireReal1mTrigger,
    photon,
    cycle_id: cycleId,
    regime_fail_reasons: regimeFailReasons,
    risk_guard_reasons: riskReasons,
    dedupe_key: dedupeKey,
    setup_label: globalConfig.setup_label,
    quote_to_usd_rate: quoteToUsdRate === null ? null : round(quoteToUsdRate, 8),
    risk_distance_usd_per_unit: round(riskDistanceUsdPerUnit, 8),
    one_trade_per_cycle: oneTradePerCycle,
  };

  const checkPayload = {
    symbol: normalizedSymbol,
    latest_price: round(latestPrice, 6),
    latest_candle_time: latestCandle.candle_time,
    signal: finalSignal,
    direction: finalDirection,
    confidence,
    strategy_name: strategyName,
    strategy_version: symbolConfig.strategy_version,
    htf_timeframe: "4h",
    entry_price: tradePlan.entry_price === null ? null : round(tradePlan.entry_price, 6),
    stop_loss: tradePlan.stop_loss === null ? null : round(tradePlan.stop_loss, 6),
    tp1: tradePlan.tp1 === null ? null : round(tradePlan.tp1, 6),
    tp2: tradePlan.tp2 === null ? null : round(tradePlan.tp2, 6),
    tp3: tradePlan.tp3 === null ? null : round(tradePlan.tp3, 6),
    risk_r: tradePlan.risk_r === null ? null : round(tradePlan.risk_r, 6),
    setup_label: globalConfig.setup_label,
    setup_score: setupScore,
    signal_state: signalState,
    signal_id: signalId,
    cycle_id: cycleId,
    trigger_policy: symbolConfig.trigger_policy,
    expires_at: validUntil,
    dedupe_key: dedupeKey,
    trace_id: traceId,
    top_reasons: topReasons,
    invalidation_conditions: invalidationConditions,
    primary_plan: primaryPlan,
    spread_pips: spreadPips,
    news_nearby: newsNearby,
    regime_passed: regimePassed,
    details,
  };

  const { data: insertedCheck, error: insertCheckError } = await params.supabase
    .from("trading_opportunity_checks")
    .insert(checkPayload)
    .select("id")
    .single();

  if (insertCheckError || !insertedCheck) {
    throw new Error(`Failed to persist opportunity check: ${insertCheckError?.message ?? "missing"}`);
  }

  if (signalId !== null) {
    try {
      await params.supabase
        .from("trading_signals")
        .update({
          check_id: Number(insertedCheck.id),
          updated_at: new Date().toISOString(),
        })
        .eq("id", signalId);
    } catch {
      // Back-link is best-effort.
    }
  }

  if (regimeFailReasons.length > 0) {
    await insertOpsAlert({
      supabase: params.supabase,
      traceId,
      alertType: "regime_filter_block",
      severity: "info",
      message: `${normalizedSymbol} setup blocked by strategy/regime controls`,
      payload: { reasons: regimeFailReasons },
    });
  }

  return {
    check_id: Number(insertedCheck.id),
    signal_id: signalId,
    trace_id: traceId,
    dedupe_key: dedupeKey,
    cycle_id: cycleId,
    strategy_state: photon.state,
    strategy_reason: photon.reason,
    symbol: normalizedSymbol,
    strategy_name: strategyName,
    strategy_version: symbolConfig.strategy_version,
    setup_label: globalConfig.setup_label,
    setup_score: setupScore,
    confidence,
    direction: finalDirection,
    signal: finalSignal,
    signal_state: signalState,
    trigger_policy: symbolConfig.trigger_policy,
    should_notify: shouldNotify,
    latest_price: round(latestPrice, 6),
    latest_candle_time_utc: latestCandle.candle_time,
    entry_price: tradePlan.entry_price === null ? null : round(tradePlan.entry_price, 6),
    stop_loss: tradePlan.stop_loss === null ? null : round(tradePlan.stop_loss, 6),
    tp1: tradePlan.tp1 === null ? null : round(tradePlan.tp1, 6),
    tp2: tradePlan.tp2 === null ? null : round(tradePlan.tp2, 6),
    tp3: tradePlan.tp3 === null ? null : round(tradePlan.tp3, 6),
    risk_r: tradePlan.risk_r === null ? null : round(tradePlan.risk_r, 6),
    expires_at: validUntil,
    spread_pips: spreadPips,
    news_nearby: newsNearby,
    regime_passed: regimePassed,
    top_reasons: topReasons,
    invalidation_conditions: invalidationConditions,
    primary_plan: primaryPlan,
    details,
  };
}
