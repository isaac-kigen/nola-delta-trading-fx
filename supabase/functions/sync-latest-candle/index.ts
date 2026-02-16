import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { upsertFifteenMinuteCandles, upsertMinuteCandles } from "../_shared/candleStore.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { readSymbol, requiredEnv } from "../_shared/config.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  fetchFinnhubCandlesWithRetry,
  FinnhubApiError,
} from "../_shared/finnhub.ts";
import {
  fetchTwelveCandlesWithRetry,
  TwelveApiError,
} from "../_shared/twelveData.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import {
  ProviderRateLimitError,
  waitForProviderCallBudget,
} from "../_shared/rateLimit.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import {
  buildTelegramTradingMessage,
  finalizeTelegramNotification,
  markOpportunityTelegramNotified,
  reserveTelegramNotification,
  runTradingOpportunityCheck,
} from "../_shared/tradingOpportunity.ts";

type MarketProvider = "finnhub" | "twelve_data";

interface SyncLatestRequest {
  symbol?: string;
  symbols?: string[];
  run_opportunity_check?: boolean;
  force_baseline_15m?: boolean;
  force_watch_1m?: boolean;
}

interface RuntimeStateRow {
  symbol: string;
  watch_mode_active: boolean;
  watch_until: string | null;
  watch_started_at: string | null;
  watch_reason: string | null;
  watch_direction: string | null;
  watch_setup_score: number | null;
  last_baseline_15m_candle_time: string | null;
  last_1m_candle_time: string | null;
  last_provider: string | null;
}

interface CandleRow {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

interface BaselineSetupResult {
  candidate: boolean;
  direction: "long" | "short" | "none";
  setupScore: number;
  reason: string;
  atrPips: number;
}

const MINUTE_MS = 60 * 1000;
const FIFTEEN_MIN_MS = 15 * MINUTE_MS;

function parseRequestBody(req: Request): Promise<SyncLatestRequest> {
  if (req.method !== "POST") {
    return Promise.resolve({});
  }
  return req.json().catch(() => ({}));
}

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return defaultValue;
}

function parseInteger(value: unknown, fallback: number, min = 1): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function parseSymbols(body: SyncLatestRequest, url: URL): string[] {
  const fromBodyList = Array.isArray(body.symbols) ? body.symbols : [];
  const fromQueryList = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  let selected: Array<string | null | undefined> = [];
  if (fromBodyList.length > 0) {
    selected = fromBodyList;
  } else if (fromQueryList.length > 0) {
    selected = fromQueryList;
  } else if (body.symbol || url.searchParams.get("symbol")) {
    selected = [body.symbol, url.searchParams.get("symbol")];
  } else {
    const fromEnvList = (Deno.env.get("FINNHUB_DEFAULT_SYMBOLS") ?? Deno.env.get("TWELVE_DEFAULT_SYMBOLS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (fromEnvList.length > 0) {
      selected = fromEnvList;
    } else {
      selected = [Deno.env.get("FINNHUB_DEFAULT_SYMBOL") ?? Deno.env.get("TWELVE_DEFAULT_SYMBOL")];
    }
  }

  const merged = selected
    .map((value) => readSymbol(value))
    .filter((value) => value.length > 0);

  return [...new Set(merged)].slice(0, 20);
}

function latestCompleteMinuteUtc(now = new Date()): Date {
  const minuteStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      0,
      0,
    ),
  );
  return new Date(minuteStart.getTime() - MINUTE_MS);
}

function latestComplete15mUtc(now = new Date()): Date {
  const minuteBucket = Math.floor(now.getUTCMinutes() / 15) * 15;
  const bucketStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      minuteBucket,
      0,
      0,
    ),
  );
  return new Date(bucketStart.getTime() - FIFTEEN_MIN_MS);
}

function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function isMissingLockRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("acquire_pipeline_lock") &&
    (m.includes("could not find the function") || m.includes("does not exist"));
}

function isWithinSession(nowUtc: Date, sessionStartHourUtc: number, sessionEndHourUtc: number): boolean {
  const hour = nowUtc.getUTCHours();
  if (sessionStartHourUtc === sessionEndHourUtc) return true;
  if (sessionStartHourUtc < sessionEndHourUtc) {
    return hour >= sessionStartHourUtc && hour < sessionEndHourUtc;
  }
  return hour >= sessionStartHourUtc || hour < sessionEndHourUtc;
}

function pipSize(symbol: string): number {
  return symbol.includes("JPY") ? 0.01 : 0.0001;
}

function ema(values: number[], period: number): Array<number | null> {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: Array<number | null> = new Array(values.length).fill(null);

  let seed = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period) {
      seed += values[i];
      if (i === period - 1) out[i] = seed / period;
      continue;
    }

    const prev = out[i - 1] ?? values[i - 1];
    out[i] = values[i] * k + prev * (1 - k);
  }
  return out;
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): Array<number | null> {
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

function evaluate15mSetup(symbol: string, rowsAsc: CandleRow[]): BaselineSetupResult {
  if (rowsAsc.length < 60) {
    return {
      candidate: false,
      direction: "none",
      setupScore: 0,
      reason: "insufficient_15m_history",
      atrPips: 0,
    };
  }

  const closes = rowsAsc.map((row) => Number.parseFloat(row.close));
  const highs = rowsAsc.map((row) => Number.parseFloat(row.high));
  const lows = rowsAsc.map((row) => Number.parseFloat(row.low));

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atr14 = atr(highs, lows, closes, 14);

  const index = closes.length - 1;
  const close = closes[index];
  const e20 = ema20[index];
  const e50 = ema50[index];
  const a14 = atr14[index];

  if (!Number.isFinite(close) || e20 === null || e50 === null || a14 === null || a14 <= 0) {
    return {
      candidate: false,
      direction: "none",
      setupScore: 0,
      reason: "indicators_unavailable",
      atrPips: 0,
    };
  }

  const pips = pipSize(symbol);
  const atrPips = a14 / pips;
  const distanceToEma20 = Math.abs(close - e20);
  const pullbackReady = distanceToEma20 <= (0.35 * a14);
  const longTrend = close > e20 && e20 > e50;
  const shortTrend = close < e20 && e20 < e50;
  const volOk = atrPips >= 4 && atrPips <= 90;

  const direction: "long" | "short" | "none" = longTrend ? "long" : shortTrend ? "short" : "none";
  const candidate = direction !== "none" && pullbackReady && volOk;

  let score = 0;
  if (direction !== "none") score += 45;
  if (pullbackReady) score += 35;
  if (volOk) score += 20;

  return {
    candidate,
    direction,
    setupScore: Math.max(0, Math.min(100, score)),
    reason: candidate
      ? "15m_trend_and_pullback_ready"
      : direction === "none"
      ? "15m_trend_not_aligned"
      : !pullbackReady
      ? "15m_pullback_not_near_ema20"
      : "15m_volatility_filter_failed",
    atrPips,
  };
}

function normalizeProvider(input: string | null | undefined): MarketProvider | null {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "finnhub") return "finnhub";
  if (v === "twelve" || v === "twelve_data" || v === "twelvedata") return "twelve_data";
  return null;
}

function resolveProviders(): { primary: MarketProvider; fallback: MarketProvider | null } {
  const explicitPrimary = normalizeProvider(Deno.env.get("MARKET_DATA_PROVIDER") ?? Deno.env.get("DATA_PROVIDER"));
  const explicitFallback = normalizeProvider(Deno.env.get("MARKET_DATA_FALLBACK_PROVIDER"));

  if (explicitPrimary) {
    if (explicitFallback && explicitFallback !== explicitPrimary) {
      return { primary: explicitPrimary, fallback: explicitFallback };
    }
    return { primary: explicitPrimary, fallback: null };
  }

  const hasTwelve = Boolean((Deno.env.get("TWELVE_DATA_API_KEY") ?? "").trim());
  const hasFinnhub = Boolean((Deno.env.get("FINNHUB_API_KEY") ?? "").trim());

  if (hasTwelve && hasFinnhub) {
    return { primary: "twelve_data", fallback: "finnhub" };
  }
  if (hasTwelve) {
    return { primary: "twelve_data", fallback: null };
  }
  return { primary: "finnhub", fallback: null };
}

function providerLimits(provider: MarketProvider): { minuteLimit: number; dayLimit: number } {
  if (provider === "twelve_data") {
    return {
      minuteLimit: parseInteger(Deno.env.get("TWELVE_API_CALLS_PER_MIN"), 8),
      dayLimit: parseInteger(Deno.env.get("TWELVE_API_CALLS_PER_DAY"), 800),
    };
  }

  return {
    minuteLimit: parseInteger(Deno.env.get("FINNHUB_API_CALLS_PER_MIN"), 50),
    dayLimit: parseInteger(Deno.env.get("FINNHUB_API_CALLS_PER_DAY"), 50_000),
  };
}

function requiredProviderKey(provider: MarketProvider): string {
  if (provider === "twelve_data") {
    return requiredEnv("TWELVE_DATA_API_KEY");
  }
  return requiredEnv("FINNHUB_API_KEY");
}

async function fetchLatestCandleFromProvider(params: {
  provider: MarketProvider;
  symbol: string;
  interval: "1m" | "15m";
  targetStart: Date;
  targetEnd: Date;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}): Promise<CandleRow | null> {
  const providerApiKey = requiredProviderKey(params.provider);
  const targetText = formatUtcDateTime(params.targetStart);

  if (params.provider === "finnhub") {
    const candles = await fetchFinnhubCandlesWithRetry({
      apiKey: providerApiKey,
      symbol: params.symbol,
      resolution: params.interval === "1m" ? "1" : "15",
      from: params.targetStart,
      to: new Date(params.targetEnd.getTime() - 1000),
      timeoutMs: params.timeoutMs,
      maxRetries: params.maxRetries,
      baseDelayMs: params.baseDelayMs,
    });
    return candles.find((row) => row.datetime === targetText) ?? null;
  }

  const candles = await fetchTwelveCandlesWithRetry({
    apiKey: providerApiKey,
    symbol: params.symbol,
    interval: params.interval === "1m" ? "1min" : "15min",
    startAt: params.targetStart,
    endAt: new Date(params.targetEnd.getTime() - 1000),
    outputsize: 20,
    timeoutMs: params.timeoutMs,
    maxRetries: params.maxRetries,
    baseDelayMs: params.baseDelayMs,
  });
  return candles.find((row) => row.datetime === targetText) ?? null;
}

async function withProviderFallback(params: {
  primary: MarketProvider;
  fallback: MarketProvider | null;
  symbol: string;
  interval: "1m" | "15m";
  targetStart: Date;
  targetEnd: Date;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  traceId: string;
}): Promise<{ candle: CandleRow | null; providerUsed: MarketProvider }> {
  try {
    const candle = await fetchLatestCandleFromProvider({
      provider: params.primary,
      symbol: params.symbol,
      interval: params.interval,
      targetStart: params.targetStart,
      targetEnd: params.targetEnd,
      timeoutMs: params.timeoutMs,
      maxRetries: params.maxRetries,
      baseDelayMs: params.baseDelayMs,
    });
    return { candle, providerUsed: params.primary };
  } catch (error) {
    const shouldFallback = params.fallback !== null &&
      params.fallback !== params.primary &&
      ((error instanceof FinnhubApiError && error.statusCode === 403) ||
        (error instanceof TwelveApiError && (error.statusCode === 401 || error.statusCode === 403)));

    if (!shouldFallback) throw error;

    await insertOpsAlert({
      supabase: params.supabase,
      traceId: params.traceId,
      alertType: "market_data_provider_fallback",
      severity: "warning",
      message: `Falling back from ${params.primary} to ${params.fallback} for ${params.symbol}`,
      payload: {
        interval: params.interval,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    const candle = await fetchLatestCandleFromProvider({
      provider: params.fallback!,
      symbol: params.symbol,
      interval: params.interval,
      targetStart: params.targetStart,
      targetEnd: params.targetEnd,
      timeoutMs: params.timeoutMs,
      maxRetries: params.maxRetries,
      baseDelayMs: params.baseDelayMs,
    });

    return { candle, providerUsed: params.fallback! };
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authError = enforceSecretAuth({
    req,
    secretEnvNames: ["SYNC_CRON_SECRET"],
    scope: "sync-latest-candle",
  });
  if (authError) return authError;

  const traceId = `sync-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;
  let lockName: string | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    const body = await parseRequestBody(req);
    const url = new URL(req.url);
    const symbols = parseSymbols(body, url);
    const runOpportunityCheck = parseBoolean(
      body.run_opportunity_check ?? url.searchParams.get("run_opportunity_check"),
      true,
    );
    const forceBaseline15m = parseBoolean(
      body.force_baseline_15m ?? url.searchParams.get("force_baseline_15m"),
      false,
    );
    const forceWatch1m = parseBoolean(
      body.force_watch_1m ?? url.searchParams.get("force_watch_1m"),
      false,
    );

    if (symbols.length === 0) {
      return jsonResponse(
        {
          error: "At least one symbol is required (body.symbol/body.symbols, query params, or FINNHUB_DEFAULT_SYMBOL(S)).",
        },
        400,
      );
    }

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "sync-latest-candle",
      traceId,
      payload: {
        symbols_requested: symbols,
        run_opportunity_check: runOpportunityCheck,
        force_baseline_15m: forceBaseline15m,
        force_watch_1m: forceWatch1m,
      },
    });

    const nowUtc = new Date();
    const targetMinuteStart = latestCompleteMinuteUtc(nowUtc);
    const targetMinuteEnd = new Date(targetMinuteStart.getTime() + MINUTE_MS);
    const targetMinuteIso = targetMinuteStart.toISOString();

    const target15mStart = latestComplete15mUtc(nowUtc);
    const target15mEnd = new Date(target15mStart.getTime() + FIFTEEN_MIN_MS);
    const target15mIso = target15mStart.toISOString();

    const sessionStartHourUtc = parseInteger(Deno.env.get("SYNC_BASELINE_SESSION_START_HOUR_UTC"), 6, 0);
    const sessionEndHourUtc = parseInteger(Deno.env.get("SYNC_BASELINE_SESSION_END_HOUR_UTC"), 22, 0);
    const sessionActive = isWithinSession(nowUtc, sessionStartHourUtc % 24, sessionEndHourUtc % 24);

    const watchBurstMinutes = parseInteger(Deno.env.get("SYNC_WATCH_BURST_MINUTES"), 20);
    const maxWatchSymbols = parseInteger(Deno.env.get("SYNC_WATCH_MAX_SYMBOLS"), 1);
    const watchBudgetReserve = parseInteger(Deno.env.get("SYNC_WATCH_MIN_DAY_REMAINING"), 30);

    const { primary: primaryProvider, fallback: fallbackProvider } = resolveProviders();
    const primaryLimits = providerLimits(primaryProvider);

    const lockEnabled = parseBoolean(Deno.env.get("LOCK_ENABLED"), true);
    const lockFailOpen = parseBoolean(Deno.env.get("LOCK_FAIL_OPEN"), true);
    if (lockEnabled) {
      lockName = `sync-latest-candle:${targetMinuteIso}`;
      const syncLockTtlSeconds = parseInteger(Deno.env.get("SYNC_LOCK_TTL_SECONDS"), 1800);
      const { data: lockData, error: lockError } = await supabase
        .rpc("acquire_pipeline_lock", {
          p_lock_name: lockName,
          p_owner_trace_id: traceId,
          p_ttl_seconds: syncLockTtlSeconds,
        })
        .single();
      const lockRow = lockData as Record<string, unknown> | null;

      if (lockError) {
        const canFailOpen = lockFailOpen || isMissingLockRpcError(lockError.message);
        if (canFailOpen) {
          lockName = null;
          await insertOpsAlert({
            supabase,
            traceId,
            alertType: "sync_lock_error_fail_open",
            severity: "warning",
            message: "acquire_pipeline_lock failed; continuing without distributed sync lock",
            payload: {
              rpc_error: lockError.message,
              target_complete_minute_utc: targetMinuteIso,
              lock_fail_open: lockFailOpen,
            },
          });
        } else {
          throw new Error(`Failed acquiring sync lock: ${lockError.message}`);
        }
      }

      const lockAcquired = lockError ? true : Boolean(lockRow?.acquired);
      if (!lockAcquired) {
        runStatus = "partial";
        runPayload = {
          trace_id: traceId,
          reason: "lock_not_acquired",
          lock_name: lockRow?.lock_name ?? lockName,
          lock_owner_trace_id: lockRow?.owner_trace_id ?? null,
          lock_expires_at: lockRow?.expires_at ?? null,
        };
        return jsonResponse(
          {
            error: "Sync already running for target minute",
            reason: "lock_not_acquired",
            trace_id: traceId,
            target_complete_minute_utc: targetMinuteIso,
            lock: {
              lock_name: lockRow?.lock_name ?? lockName,
              owner_trace_id: lockRow?.owner_trace_id ?? null,
              expires_at: lockRow?.expires_at ?? null,
            },
          },
          409,
        );
      }
    }

    const { data: runtimeRows } = await supabase
      .from("sync_symbol_runtime_state")
      .select("symbol,watch_mode_active,watch_until,watch_started_at,watch_reason,watch_direction,watch_setup_score,last_baseline_15m_candle_time,last_1m_candle_time,last_provider")
      .in("symbol", symbols);

    const runtimeMap = new Map<string, RuntimeStateRow>();
    for (const row of runtimeRows ?? []) {
      runtimeMap.set(String(row.symbol), row as RuntimeStateRow);
    }

    let activeWatchCount = symbols.filter((symbol) => {
      const row = runtimeMap.get(symbol);
      if (!row?.watch_mode_active || !row.watch_until) return false;
      return new Date(row.watch_until).getTime() > nowUtc.getTime();
    }).length;

    const fetchMaxRetries = parseInteger(
      Deno.env.get(primaryProvider === "twelve_data" ? "TWELVE_FETCH_MAX_RETRIES" : "FINNHUB_FETCH_MAX_RETRIES"),
      3,
    );
    const fetchBaseDelayMs = parseInteger(
      Deno.env.get(primaryProvider === "twelve_data" ? "TWELVE_FETCH_BASE_DELAY_MS" : "FINNHUB_FETCH_BASE_DELAY_MS"),
      400,
    );
    const fetchTimeoutMs = parseInteger(
      Deno.env.get(primaryProvider === "twelve_data" ? "TWELVE_FETCH_TIMEOUT_MS" : "FINNHUB_FETCH_TIMEOUT_MS"),
      15_000,
    );

    const telegramEnabled = parseBoolean(Deno.env.get("TELEGRAM_ALERTS_ENABLED"), true);
    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
    const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
    const telegramMaxMessagesPerHour = parseInteger(Deno.env.get("TELEGRAM_MAX_MESSAGES_PER_HOUR"), 8);

    const { data: usageRow } = await supabase
      .from("provider_api_usage")
      .select("day_calls")
      .eq("provider", primaryProvider)
      .maybeSingle();
    const dayCallsRaw = usageRow && typeof usageRow === "object"
      ? Number((usageRow as Record<string, unknown>).day_calls ?? 0)
      : 0;
    const dayCallsUsed = Number.isFinite(dayCallsRaw) ? Math.max(0, Math.trunc(dayCallsRaw)) : 0;

    let dayRemainingEstimate = Math.max(0, primaryLimits.dayLimit - dayCallsUsed);
    const results: Array<Record<string, unknown>> = [];
    let apiCallsUsed = 0;
    let baselineCallsUsed = 0;
    let watchCallsUsed = 0;

    const baselineDue = forceBaseline15m || sessionActive;

    for (const symbol of symbols) {
      const symbolResult: Record<string, unknown> = {
        symbol,
        session_active: sessionActive,
      };
      try {

      const runtime = runtimeMap.get(symbol);
      const watchUntilMs = runtime?.watch_until ? new Date(runtime.watch_until).getTime() : 0;
      let watchActive = Boolean(runtime?.watch_mode_active) && watchUntilMs > nowUtc.getTime();
      let watchUntilIso: string | null = runtime?.watch_until ?? null;

      // 15m baseline stage
      if (baselineDue) {
        const { data: existing15m, error: existing15mError } = await supabase
          .from("price_candles_15m")
          .select("candle_time")
          .eq("symbol", symbol)
          .gte("candle_time", target15mStart.toISOString())
          .lt("candle_time", target15mEnd.toISOString())
          .maybeSingle();

        if (existing15mError) {
          throw new Error(`Failed checking existing 15m candle: ${existing15mError.message}`);
        }

        if (!existing15m) {
          const reserve = await waitForProviderCallBudget({
            supabase,
            provider: primaryProvider,
            calls: 1,
            minuteLimit: primaryLimits.minuteLimit,
            dayLimit: primaryLimits.dayLimit,
            maxMinuteRetries: 10,
            maxWaitMs: 15 * 60_000,
          });

          dayRemainingEstimate = reserve.day_remaining;
          const fetched = await withProviderFallback({
            primary: primaryProvider,
            fallback: fallbackProvider,
            symbol,
            interval: "15m",
            targetStart: target15mStart,
            targetEnd: target15mEnd,
            timeoutMs: fetchTimeoutMs,
            maxRetries: fetchMaxRetries,
            baseDelayMs: fetchBaseDelayMs,
            supabase,
            traceId,
          });

          apiCallsUsed += 1;
          baselineCallsUsed += 1;

          if (fetched.candle) {
            const saved15m = await upsertFifteenMinuteCandles(
              supabase,
              symbol,
              [fetched.candle],
              200,
              fetched.providerUsed,
            );
            symbolResult.baseline_15m = {
              fetched: 1,
              saved: saved15m,
              candle_time_utc: fetched.candle.datetime,
              provider: fetched.providerUsed,
            };
          } else {
            symbolResult.baseline_15m = {
              fetched: 0,
              saved: 0,
              reason: "no_target_complete_15m_candle_returned",
            };
          }
        } else {
          symbolResult.baseline_15m = {
            skipped: true,
            reason: "latest_complete_15m_already_saved",
            candle_time_utc: existing15m.candle_time,
          };
        }

        const { data: latest15mRows, error: latest15mError } = await supabase
          .from("price_candles_15m")
          .select("candle_time,open,high,low,close,volume")
          .eq("symbol", symbol)
          .order("candle_time", { ascending: false })
          .limit(140);

        if (latest15mError) {
          throw new Error(`Failed loading 15m candles for setup stage: ${latest15mError.message}`);
        }

        const rowsAsc = (latest15mRows ?? [])
          .map((row) => ({
            datetime: formatUtcDateTime(new Date(String(row.candle_time))),
            open: String(row.open),
            high: String(row.high),
            low: String(row.low),
            close: String(row.close),
            volume: row.volume === null ? null : String(row.volume),
          }))
          .reverse();

        const setup = evaluate15mSetup(symbol, rowsAsc);
        symbolResult.baseline_setup = {
          candidate: setup.candidate,
          direction: setup.direction,
          setup_score: setup.setupScore,
          reason: setup.reason,
          atr_pips: setup.atrPips,
        };

        const canActivateWatch = setup.candidate &&
          dayRemainingEstimate > watchBudgetReserve &&
          (watchActive || activeWatchCount < maxWatchSymbols || forceWatch1m);

        if (canActivateWatch) {
          const watchUntil = new Date(nowUtc.getTime() + watchBurstMinutes * MINUTE_MS).toISOString();
          await supabase
            .from("sync_symbol_runtime_state")
            .upsert({
              symbol,
              watch_mode_active: true,
              watch_until: watchUntil,
              watch_started_at: runtime?.watch_started_at ?? nowUtc.toISOString(),
              watch_reason: setup.reason,
              watch_direction: setup.direction,
              watch_setup_score: setup.setupScore,
              last_baseline_15m_candle_time: target15mIso,
              last_provider: primaryProvider,
              updated_at: nowUtc.toISOString(),
            }, { onConflict: "symbol" });

          if (!watchActive) activeWatchCount += 1;
          watchActive = true;
          watchUntilIso = watchUntil;
          symbolResult.watch_mode = {
            active: true,
            until: watchUntil,
            reason: setup.reason,
            activated: !runtime?.watch_mode_active,
          };
        } else {
          if (watchActive && watchUntilMs <= nowUtc.getTime()) {
            await supabase
              .from("sync_symbol_runtime_state")
              .upsert({
                symbol,
                watch_mode_active: false,
                watch_until: null,
                watch_reason: "watch_ttl_expired",
                watch_setup_score: null,
                watch_direction: null,
                updated_at: nowUtc.toISOString(),
              }, { onConflict: "symbol" });
            watchActive = false;
            watchUntilIso = null;
            activeWatchCount = Math.max(0, activeWatchCount - 1);
          }

          symbolResult.watch_mode = {
            active: watchActive,
            reason: setup.reason,
            skipped_activation: !setup.candidate
              ? "setup_not_ready"
              : dayRemainingEstimate <= watchBudgetReserve
              ? "budget_reserve_guard"
              : "watch_capacity_reached",
          };
        }
      } else {
        symbolResult.baseline_15m = {
          skipped: true,
          reason: "outside_session_window",
        };
      }

      // 1m burst stage
      if (!(watchActive || forceWatch1m)) {
        symbolResult.minute_1m = {
          skipped: true,
          reason: "watch_mode_inactive",
        };
        results.push(symbolResult);
        continue;
      }

      if (!forceWatch1m && dayRemainingEstimate <= watchBudgetReserve) {
        symbolResult.minute_1m = {
          skipped: true,
          reason: "watch_budget_guard",
          day_remaining: dayRemainingEstimate,
        };
        results.push(symbolResult);
        continue;
      }

      const { data: existingMinute, error: existingMinuteError } = await supabase
        .from("price_candles_1m")
        .select("candle_time")
        .eq("symbol", symbol)
        .gte("candle_time", targetMinuteStart.toISOString())
        .lt("candle_time", targetMinuteEnd.toISOString())
        .maybeSingle();

      if (existingMinuteError) {
        throw new Error(`Failed checking existing minute: ${existingMinuteError.message}`);
      }

      if (existingMinute) {
        symbolResult.minute_1m = {
          skipped: true,
          reason: "latest_complete_minute_already_saved",
          candle_time_utc: existingMinute.candle_time,
        };
        results.push(symbolResult);
        continue;
      }

      const reserveMinute = await waitForProviderCallBudget({
        supabase,
        provider: primaryProvider,
        calls: 1,
        minuteLimit: primaryLimits.minuteLimit,
        dayLimit: primaryLimits.dayLimit,
        maxMinuteRetries: 10,
        maxWaitMs: 15 * 60_000,
      });
      dayRemainingEstimate = reserveMinute.day_remaining;

      const fetchedMinute = await withProviderFallback({
        primary: primaryProvider,
        fallback: fallbackProvider,
        symbol,
        interval: "1m",
        targetStart: targetMinuteStart,
        targetEnd: targetMinuteEnd,
        timeoutMs: fetchTimeoutMs,
        maxRetries: fetchMaxRetries,
        baseDelayMs: fetchBaseDelayMs,
        supabase,
        traceId,
      });
      apiCallsUsed += 1;
      watchCallsUsed += 1;

      if (!fetchedMinute.candle) {
        symbolResult.minute_1m = {
          fetched: 0,
          saved: 0,
          reason: "no_target_complete_minute_candle_returned",
          provider: fetchedMinute.providerUsed,
        };
        results.push(symbolResult);
        continue;
      }

      const savedMinute = await upsertMinuteCandles(
        supabase,
        symbol,
        [fetchedMinute.candle],
        200,
        fetchedMinute.providerUsed,
      );

      await supabase
        .from("sync_symbol_runtime_state")
        .upsert({
          symbol,
          watch_mode_active: watchActive,
          watch_until: watchActive ? (watchUntilIso ?? new Date(nowUtc.getTime() + watchBurstMinutes * MINUTE_MS).toISOString()) : null,
          last_1m_candle_time: targetMinuteIso,
          last_provider: fetchedMinute.providerUsed,
          updated_at: nowUtc.toISOString(),
        }, { onConflict: "symbol" });

      let opportunityCheck: Record<string, unknown> | null = null;
      if (runOpportunityCheck) {
        const checkResult = await runTradingOpportunityCheck({
          supabase,
          symbol,
          latestPrice: fetchedMinute.candle.close,
          latestCandleTimeUtc: fetchedMinute.candle.datetime,
          traceId: `${traceId}-${symbol.replace("/", "")}`,
        });

        let telegram: Record<string, unknown> | null = null;
        if (checkResult.should_notify && checkResult.signal_id !== null) {
          if (telegramEnabled && telegramBotToken && telegramChatId) {
            const text = buildTelegramTradingMessage(checkResult);
            const messageHash = await sha256Hex(text);

            const reservation = await reserveTelegramNotification({
              supabase,
              signalId: checkResult.signal_id,
              symbol,
              messageHash,
              traceId: checkResult.trace_id,
              maxMessagesPerHour: telegramMaxMessagesPerHour,
            });

            if (reservation.allowed) {
              const sent = await sendTelegramMessage({
                botToken: telegramBotToken,
                chatId: telegramChatId,
                text,
              }).catch((err) => ({
                ok: false,
                status: 500,
                messageId: null,
                error: err instanceof Error ? err.message : String(err),
              }));

              await finalizeTelegramNotification({
                supabase,
                symbol,
                messageHash,
                sent: sent.ok,
                errorText: sent.error,
              });

              if (sent.ok) {
                await markOpportunityTelegramNotified({
                  supabase,
                  checkId: checkResult.check_id,
                  messageId: sent.messageId,
                });
              }

              telegram = {
                reserved: true,
                sent: sent.ok,
                status: sent.status,
                message_id: sent.messageId,
                error: sent.error,
              };
            } else {
              telegram = {
                reserved: false,
                sent: false,
                reason: reservation.reason,
              };
            }
          } else {
            telegram = {
              sent: false,
              reason: "telegram_not_configured",
            };
          }
        } else {
          telegram = {
            sent: false,
            reason: "notify_not_required",
            signal_state: checkResult.signal_state,
          };
        }

        opportunityCheck = {
          invoked: true,
          ok: true,
          result: checkResult,
          telegram,
        };

        if (checkResult.signal_state === "triggered" || checkResult.signal_state === "executed") {
          await supabase
            .from("sync_symbol_runtime_state")
            .upsert({
              symbol,
              watch_mode_active: false,
              watch_until: null,
              watch_reason: "signal_triggered",
              updated_at: nowUtc.toISOString(),
            }, { onConflict: "symbol" });
        }
      }

      symbolResult.minute_1m = {
        fetched: 1,
        saved: savedMinute,
        latest_candle_time_utc: fetchedMinute.candle.datetime,
        latest_price: Number.parseFloat(fetchedMinute.candle.close),
        provider: fetchedMinute.providerUsed,
      };
      symbolResult.opportunity_check = opportunityCheck;
      results.push(symbolResult);
      } catch (error) {
        if (error instanceof ProviderRateLimitError && error.reason === "daily_limit") {
          runStatus = "partial";
          runPayload = {
            trace_id: traceId,
            symbols_requested: symbols,
            partial_results: results,
            reason: error.reason,
            provider: error.provider,
            minute_remaining: error.minuteRemaining,
            day_remaining: error.dayRemaining,
            api_calls_used: apiCallsUsed,
          };
          return jsonResponse(
            {
              error: error.message,
              reason: error.reason,
              provider: error.provider,
              wait_seconds: error.waitSeconds,
              minute_remaining: error.minuteRemaining,
              day_remaining: error.dayRemaining,
              partial_results: results,
              api_calls_used: apiCallsUsed,
              trace_id: traceId,
            },
            error.statusCode,
          );
        }

        symbolResult.error = error instanceof Error ? error.message : String(error);
        results.push(symbolResult);
      }
    }

    const responsePayload = {
      trace_id: traceId,
      symbols_requested: symbols,
      target_complete_minute_utc: targetMinuteIso,
      target_complete_15m_utc: target15mIso,
      symbols_processed: results.length,
      api_calls_used: apiCallsUsed,
      baseline_15m_calls_used: baselineCallsUsed,
      watch_1m_calls_used: watchCallsUsed,
      run_opportunity_check: runOpportunityCheck,
      check_function_name: "check-trading-opportunity (internal-shared-execution)",
      data_provider: primaryProvider,
      fallback_provider: fallbackProvider,
      scheduler: {
        session_active: sessionActive,
        session_start_hour_utc: sessionStartHourUtc % 24,
        session_end_hour_utc: sessionEndHourUtc % 24,
        watch_burst_minutes: watchBurstMinutes,
        watch_max_symbols: maxWatchSymbols,
        watch_budget_reserve_calls: watchBudgetReserve,
      },
      results,
    };

    runStatus = "success";
    runPayload = responsePayload;
    return jsonResponse(responsePayload);
  } catch (error) {
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
    };

    if (error instanceof ProviderRateLimitError) {
      return jsonResponse(
        {
          error: error.message,
          reason: error.reason,
          provider: error.provider,
          wait_seconds: error.waitSeconds,
          minute_remaining: error.minuteRemaining,
          day_remaining: error.dayRemaining,
          trace_id: traceId,
        },
        error.statusCode,
      );
    }

    if (error instanceof FinnhubApiError || error instanceof TwelveApiError) {
      return jsonResponse({ error: error.message, trace_id: traceId }, error.statusCode);
    }

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      },
      500,
    );
  } finally {
    if (supabase && lockName) {
      try {
        await supabase.rpc("release_pipeline_lock", {
          p_lock_name: lockName,
          p_owner_trace_id: traceId,
        });
      } catch {
        // Lock release is best-effort.
      }
    }
    if (supabase) {
      await finishOpsFunctionRun({
        supabase,
        runId,
        status: runStatus,
        startedAtMs,
        payload: runPayload,
      });
    }
  }
});
