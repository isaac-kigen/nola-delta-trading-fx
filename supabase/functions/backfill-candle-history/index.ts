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

interface BackfillRequest {
  symbol?: string;
  chunk_days?: number;
  max_chunks_this_run?: number | string;
  start_date_utc?: string;
  end_date_utc?: string;
  dry_run?: boolean | string;
  smart_mode?: boolean | string;
  smart_lookback_days?: number | string;
}

interface ProviderCandleRow {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_SAFE_CHUNK_DAYS_FINNHUB = 30;
const MAX_SAFE_CHUNK_DAYS_TWELVE = 3;

function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseCandleUtcMs(datetime: string): number | null {
  const raw = String(datetime ?? "").trim();
  if (!raw) return null;
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(raw);
  const hasZulu = /z$/i.test(raw);
  const normalized = raw.includes("T")
    ? (hasZulu || hasOffset ? raw : `${raw}Z`)
    : `${raw.replace(" ", "T")}Z`;
  const tsMs = new Date(normalized).getTime();
  return Number.isFinite(tsMs) ? tsMs : null;
}

interface ParsedMinuteCandle {
  tsMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface FifteenMinuteBucketState {
  bucketStartMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  minuteCount: number;
}

function parseMinuteCandles(candles: ProviderCandleRow[]): ParsedMinuteCandle[] {
  const deduped = new Map<number, ParsedMinuteCandle>();
  for (const row of candles) {
    const tsMs = parseCandleUtcMs(row.datetime);
    if (!Number.isFinite(tsMs)) continue;

    const open = Number.parseFloat(row.open);
    const high = Number.parseFloat(row.high);
    const low = Number.parseFloat(row.low);
    const close = Number.parseFloat(row.close);
    const volume = row.volume === undefined || row.volume === null || row.volume === ""
      ? null
      : Number.parseFloat(String(row.volume));

    if (![open, high, low, close].every(Number.isFinite)) continue;

    deduped.set(tsMs as number, {
      tsMs: tsMs as number,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : null,
    });
  }

  return [...deduped.values()].sort((a, b) => a.tsMs - b.tsMs);
}

function build15mCandleFromBucket(bucket: FifteenMinuteBucketState): ProviderCandleRow {
  return {
    datetime: formatUtcDateTime(new Date(bucket.bucketStartMs)),
    open: bucket.open.toString(),
    high: bucket.high.toString(),
    low: bucket.low.toString(),
    close: bucket.close.toString(),
    volume: bucket.volume === null ? null : bucket.volume.toString(),
  };
}

function aggregateMinuteCandlesTo15m(params: {
  candles: ProviderCandleRow[];
  carry: FifteenMinuteBucketState | null;
}): { candles15m: ProviderCandleRow[]; carry: FifteenMinuteBucketState | null } {
  const rows = parseMinuteCandles(params.candles);
  if (rows.length === 0) {
    return { candles15m: [], carry: params.carry };
  }

  const output: ProviderCandleRow[] = [];
  let carry = params.carry;

  for (const row of rows) {
    const bucketStartMs = Math.floor(row.tsMs / (15 * MINUTE_MS)) * (15 * MINUTE_MS);
    if (!carry) {
      carry = {
        bucketStartMs,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        minuteCount: 1,
      };
      continue;
    }

    if (carry.bucketStartMs === bucketStartMs) {
      carry.high = Math.max(carry.high, row.high);
      carry.low = Math.min(carry.low, row.low);
      carry.close = row.close;
      carry.minuteCount += 1;
      if (row.volume !== null) {
        carry.volume = carry.volume === null ? row.volume : carry.volume + row.volume;
      }
      continue;
    }

    // Only persist complete 15m buckets; avoid writing partial OHLC at chunk boundaries.
    if (carry.minuteCount >= 15) {
      output.push(build15mCandleFromBucket(carry));
    }

    carry = {
      bucketStartMs,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      minuteCount: 1,
    };
  }

  return { candles15m: output, carry };
}

function flush15mCarry(carry: FifteenMinuteBucketState | null): ProviderCandleRow[] {
  if (!carry || carry.minuteCount < 15) return [];
  return [build15mCandleFromBucket(carry)];
}

type MarketProvider = "finnhub" | "twelve_data";

function parseBody(req: Request): Promise<BackfillRequest> {
  if (req.method !== "POST") {
    return Promise.resolve({});
  }
  return req.json().catch(() => ({}));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseInteger(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const asInt = Math.trunc(parsed);
  return asInt > 0 ? asInt : null;
}

function clampChunkDays(value: number | undefined, provider: MarketProvider): number {
  const maxChunkDays = provider === "twelve_data"
    ? MAX_SAFE_CHUNK_DAYS_TWELVE
    : MAX_SAFE_CHUNK_DAYS_FINNHUB;
  if (!value || Number.isNaN(value)) return Math.min(7, maxChunkDays);
  return Math.min(maxChunkDays, Math.max(1, Math.trunc(value)));
}

function normalizeProvider(input: string | null | undefined): MarketProvider | null {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "finnhub") return "finnhub";
  if (v === "twelve" || v === "twelve_data" || v === "twelvedata") return "twelve_data";
  return null;
}

function resolveProvider(): MarketProvider {
  const explicit = normalizeProvider(Deno.env.get("BACKFILL_DATA_PROVIDER") ?? Deno.env.get("MARKET_DATA_PROVIDER") ?? Deno.env.get("DATA_PROVIDER"));
  if (explicit) return explicit;
  if ((Deno.env.get("TWELVE_DATA_API_KEY") ?? "").trim()) return "twelve_data";
  return "finnhub";
}

function requiredProviderKey(provider: MarketProvider): string {
  if (provider === "twelve_data") return requiredEnv("TWELVE_DATA_API_KEY");
  return requiredEnv("FINNHUB_API_KEY");
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

function floorToMinuteUtc(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      0,
      0,
    ),
  );
}

function parseUtcDateInput(
  input: string | null | undefined,
  mode: "start" | "end",
): Date | null {
  if (!input || input.trim() === "") return null;
  const raw = input.trim();

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (
      !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
      month < 1 || month > 12 || day < 1 || day > 31
    ) {
      return null;
    }

    const hour = mode === "start" ? 0 : 23;
    const minute = mode === "start" ? 0 : 59;
    const second = mode === "start" ? 0 : 59;
    const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
    if (
      normalized.getUTCFullYear() !== year ||
      normalized.getUTCMonth() !== month - 1 ||
      normalized.getUTCDate() !== day
    ) {
      return null;
    }
    return normalized;
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function readDateInput(
  body: BackfillRequest,
  url: URL,
  key: "start_date_utc" | "end_date_utc",
): string | null {
  const fromBody = body[key];
  if (typeof fromBody === "string" && fromBody.trim() !== "") return fromBody;
  const fromQuery = url.searchParams.get(key);
  if (fromQuery && fromQuery.trim() !== "") return fromQuery;
  return null;
}

function isMissingLockRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("acquire_pipeline_lock") &&
    (m.includes("could not find the function") || m.includes("does not exist"));
}

function isProviderNoDataError(error: unknown): boolean {
  if (!(error instanceof TwelveApiError) && !(error instanceof FinnhubApiError)) {
    return false;
  }
  const msg = String(error.message ?? "").toLowerCase();
  return msg.includes("no data") || msg.includes("no_data");
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
    secretEnvNames: ["BACKFILL_CRON_SECRET"],
    scope: "backfill-candle-history",
  });
  if (authError) return authError;

  const traceId = `backfill-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;
  let lockName: string | null = null;

  const progress = {
    chunks_completed: 0,
    fetched_rows: 0,
    saved_rows: 0,
    fetched_rows_15m: 0,
    saved_rows_15m: 0,
    api_calls_used: 0,
    empty_chunks_skipped: 0,
  };

  try {
    const body = await parseBody(req);
    const url = new URL(req.url);
    const dataProvider = resolveProvider();
    const symbol = readSymbol(
      body.symbol ?? url.searchParams.get("symbol") ??
        Deno.env.get("FINNHUB_DEFAULT_SYMBOL") ?? Deno.env.get("TWELVE_DEFAULT_SYMBOL"),
    );
    const requestedChunkDays = parseInteger(body.chunk_days ?? url.searchParams.get("chunk_days"), 7);
    const chunkDays = clampChunkDays(requestedChunkDays, dataProvider);
    const chunkDaysCapped = chunkDays !== requestedChunkDays;
    const requestedMaxChunksThisRun = parseOptionalPositiveInteger(
      body.max_chunks_this_run ?? url.searchParams.get("max_chunks_this_run"),
    );
    const dryRun = parseBoolean(body.dry_run ?? url.searchParams.get("dry_run"), false);
    const smartModeDefault = parseBoolean(Deno.env.get("BACKFILL_SMART_MODE"), false);
    const smartMode = parseBoolean(body.smart_mode ?? url.searchParams.get("smart_mode"), smartModeDefault);
    const smartLookbackDefault = parseInteger(Deno.env.get("BACKFILL_SMART_LOOKBACK_DAYS"), 365);
    const smartLookbackDays = parseInteger(
      body.smart_lookback_days ?? url.searchParams.get("smart_lookback_days"),
      smartLookbackDefault,
    );
    const skipEmptyChunks = parseBoolean(Deno.env.get("BACKFILL_SKIP_EMPTY_CHUNKS"), true);

    if (!symbol) {
      return jsonResponse(
        { error: "symbol is required (body.symbol, query param, or FINNHUB_DEFAULT_SYMBOL/TWELVE_DEFAULT_SYMBOL)" },
        400,
      );
    }

    const startDateInput = readDateInput(body, url, "start_date_utc");
    const endDateInput = readDateInput(body, url, "end_date_utc");
    if ((startDateInput && !endDateInput) || (!startDateInput && endDateInput)) {
      return jsonResponse(
        { error: "Provide both start_date_utc and end_date_utc, or neither (default anchor mode)." },
        400,
      );
    }

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "backfill-candle-history",
      traceId,
      payload: {
        symbol,
        data_provider: dataProvider,
        chunk_days_requested: requestedChunkDays,
        chunk_days_effective: chunkDays,
        chunk_days_capped_for_outputsize: chunkDaysCapped,
        max_chunks_this_run_requested: requestedMaxChunksThisRun,
        dry_run: dryRun,
        smart_mode: smartMode,
        smart_lookback_days: smartLookbackDays,
        start_date_utc: startDateInput,
        end_date_utc: endDateInput,
      },
    });

    const lockEnabled = parseBoolean(Deno.env.get("LOCK_ENABLED"), true);
    if (lockEnabled) {
      lockName = `backfill-candle-history:${symbol}`;
      const lockTtlSeconds = parseInteger(Deno.env.get("BACKFILL_LOCK_TTL_SECONDS"), 7200);
      const { data: lockData, error: lockError } = await supabase
        .rpc("acquire_pipeline_lock", {
          p_lock_name: lockName,
          p_owner_trace_id: traceId,
          p_ttl_seconds: lockTtlSeconds,
        })
        .single();
      const lockRow = lockData as Record<string, unknown> | null;

      if (lockError) {
        const canFailOpen = isMissingLockRpcError(lockError.message);
        if (canFailOpen) {
          lockName = null;
          await insertOpsAlert({
            supabase,
            traceId,
            alertType: "backfill_lock_error_fail_open",
            severity: "warning",
            message: "acquire_pipeline_lock failed; continuing without distributed backfill lock",
            payload: {
              rpc_error: lockError.message,
              symbol,
              lock_fail_open: false,
            },
          });
        } else {
          throw new Error(`Failed acquiring backfill lock: ${lockError.message}`);
        }
      }

      const lockOwnerTraceId = lockRow?.owner_trace_id === null || lockRow?.owner_trace_id === undefined
        ? null
        : String(lockRow.owner_trace_id);
      const lockAcquired = lockError
        ? true
        : Boolean(lockRow?.acquired) || lockOwnerTraceId === traceId;
      if (!lockAcquired) {
        runStatus = "partial";
        runPayload = {
          trace_id: traceId,
          lock_name: lockName,
          lock_owner_trace_id: lockRow?.owner_trace_id ?? null,
          lock_expires_at: lockRow?.expires_at ?? null,
          reason: "lock_not_acquired",
        };

        return jsonResponse(
          {
            error: "Backfill already running for this symbol",
            reason: "lock_not_acquired",
            trace_id: traceId,
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

    const apiKey = requiredProviderKey(dataProvider);
    const fetchMaxRetries = parseInteger(
      Deno.env.get(dataProvider === "twelve_data" ? "TWELVE_FETCH_MAX_RETRIES" : "FINNHUB_FETCH_MAX_RETRIES"),
      3,
    );
    const fetchBaseDelayMs = parseInteger(
      Deno.env.get(dataProvider === "twelve_data" ? "TWELVE_FETCH_BASE_DELAY_MS" : "FINNHUB_FETCH_BASE_DELAY_MS"),
      400,
    );
    const fetchTimeoutMs = parseInteger(
      Deno.env.get(dataProvider === "twelve_data" ? "TWELVE_FETCH_TIMEOUT_MS" : "FINNHUB_FETCH_TIMEOUT_MS"),
      15_000,
    );
    const maxChunksPerRunConfigured = parseInteger(Deno.env.get("BACKFILL_MAX_CHUNKS_PER_RUN"), 120);
    const maxChunksPerRun = requestedMaxChunksThisRun !== null
      ? Math.min(maxChunksPerRunConfigured, requestedMaxChunksThisRun)
      : maxChunksPerRunConfigured;
    const limits = providerLimits(dataProvider);

    const latestCompleteMinute = latestCompleteMinuteUtc();
    let requestedStart: Date;
    let requestedEnd: Date;
    let rangeMode: "explicit_dates" | "default_anchor" | "smart_oldest_extend" = "default_anchor";
    let latestSavedAnchorUtc: string | null = null;
    let oldestSavedAnchorUtc: string | null = null;
    let smartModeFallbackReason: string | null = null;
    let clampedEnd = false;

    if (startDateInput && endDateInput) {
      rangeMode = "explicit_dates";
      const parsedStart = parseUtcDateInput(startDateInput, "start");
      const parsedEnd = parseUtcDateInput(endDateInput, "end");
      if (!parsedStart || !parsedEnd) {
        return jsonResponse({ error: "Invalid start_date_utc or end_date_utc. Use YYYY-MM-DD or full UTC datetime." }, 400);
      }
      requestedStart = floorToMinuteUtc(parsedStart);
      requestedEnd = floorToMinuteUtc(parsedEnd);
    } else {
      const { data: latestSaved, error: latestSavedError } = await supabase
        .from("price_candles_1m")
        .select("candle_time")
        .eq("symbol", symbol)
        .order("candle_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestSavedError) {
        throw new Error(`Failed reading latest saved candle for anchor: ${latestSavedError.message}`);
      }

      const latestAnchor = latestSaved?.candle_time ? new Date(String(latestSaved.candle_time)) : latestCompleteMinute;
      latestSavedAnchorUtc = latestAnchor.toISOString();

      if (smartMode) {
        const { data: oldestSaved, error: oldestSavedError } = await supabase
          .from("price_candles_1m")
          .select("candle_time")
          .eq("symbol", symbol)
          .order("candle_time", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (oldestSavedError) {
          throw new Error(`Failed reading oldest saved candle for smart anchor: ${oldestSavedError.message}`);
        }

        if (oldestSaved?.candle_time) {
          rangeMode = "smart_oldest_extend";
          const oldestAnchor = floorToMinuteUtc(new Date(String(oldestSaved.candle_time)));
          oldestSavedAnchorUtc = oldestAnchor.toISOString();
          requestedEnd = new Date(oldestAnchor.getTime() - MINUTE_MS);
          requestedStart = floorToMinuteUtc(new Date(requestedEnd.getTime() - smartLookbackDays * DAY_MS));
        } else {
          smartModeFallbackReason = "no_existing_data_for_symbol";
          requestedEnd = floorToMinuteUtc(latestAnchor);
          requestedStart = floorToMinuteUtc(new Date(requestedEnd.getTime() - 365 * DAY_MS));
        }
      } else {
        requestedEnd = floorToMinuteUtc(latestAnchor);
        requestedStart = floorToMinuteUtc(new Date(requestedEnd.getTime() - 365 * DAY_MS));
      }
    }

    if (requestedEnd > latestCompleteMinute) {
      requestedEnd = latestCompleteMinute;
      clampedEnd = true;
    }

    if (requestedStart > requestedEnd) {
      return jsonResponse(
        {
          error: "Invalid range: start is after end.",
          requested_start_utc: requestedStart.toISOString(),
          requested_end_utc: requestedEnd.toISOString(),
          latest_complete_minute_utc: latestCompleteMinute.toISOString(),
        },
        400,
      );
    }

    let totalMinutesRequested = Math.floor((requestedEnd.getTime() - requestedStart.getTime()) / MINUTE_MS) + 1;
    let estimatedChunks = Math.ceil(totalMinutesRequested / (chunkDays * 24 * 60));

    if (
      estimatedChunks > maxChunksPerRun &&
      smartMode &&
      !startDateInput &&
      !endDateInput
    ) {
      const maxMinutesPerRun = maxChunksPerRun * chunkDays * 24 * 60;
      requestedStart = new Date(requestedEnd.getTime() - (maxMinutesPerRun - 1) * MINUTE_MS);
      requestedStart = floorToMinuteUtc(requestedStart);
      totalMinutesRequested = Math.floor((requestedEnd.getTime() - requestedStart.getTime()) / MINUTE_MS) + 1;
      estimatedChunks = Math.ceil(totalMinutesRequested / (chunkDays * 24 * 60));
      if (!smartModeFallbackReason) {
        smartModeFallbackReason = "smart_range_clamped_to_max_chunks_per_run";
      }
    }

    if (estimatedChunks > maxChunksPerRun) {
      runStatus = "partial";
      runPayload = {
        trace_id: traceId,
        reason: "max_chunks_per_run_exceeded",
        estimated_chunks: estimatedChunks,
        max_chunks_per_run: maxChunksPerRun,
        max_chunks_per_run_configured: maxChunksPerRunConfigured,
        max_chunks_this_run_requested: requestedMaxChunksThisRun,
      };
      return jsonResponse(
        {
          error: "Requested range exceeds max chunks per run. Decrease range or increase chunk_days.",
          trace_id: traceId,
          estimated_chunks: estimatedChunks,
          max_chunks_per_run: maxChunksPerRun,
          max_chunks_per_run_configured: maxChunksPerRunConfigured,
          max_chunks_this_run_requested: requestedMaxChunksThisRun,
        },
        422,
      );
    }

    const chunkMs = chunkDays * DAY_MS;
    let cursor = requestedStart.getTime();
    const hardEndMs = requestedEnd.getTime();
    let carry15m: FifteenMinuteBucketState | null = null;
    while (cursor <= hardEndMs) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(Math.min(hardEndMs, cursor + chunkMs - MINUTE_MS));

      await waitForProviderCallBudget({
        supabase,
        provider: dataProvider,
        calls: 1,
        minuteLimit: limits.minuteLimit,
        dayLimit: limits.dayLimit,
        maxMinuteRetries: 10,
        maxWaitMs: 15 * 60_000,
      });
      progress.api_calls_used += 1;

      let candles: ProviderCandleRow[] = [];
      try {
        candles = dataProvider === "twelve_data"
          ? await fetchTwelveCandlesWithRetry({
            apiKey,
            symbol,
            interval: "1min",
            startAt: chunkStart,
            endAt: chunkEnd,
            outputsize: 5_000,
            timeoutMs: fetchTimeoutMs,
            maxRetries: fetchMaxRetries,
            baseDelayMs: fetchBaseDelayMs,
          })
          : await fetchFinnhubCandlesWithRetry({
            apiKey,
            symbol,
            resolution: "1",
            from: chunkStart,
            to: chunkEnd,
            timeoutMs: fetchTimeoutMs,
            maxRetries: fetchMaxRetries,
            baseDelayMs: fetchBaseDelayMs,
          });
      } catch (error) {
        if (skipEmptyChunks && isProviderNoDataError(error)) {
          candles = [];
        } else {
          throw error;
        }
      }

      progress.fetched_rows += candles.length;
      if (candles.length === 0 && skipEmptyChunks) {
        progress.empty_chunks_skipped += 1;
        cursor = chunkEnd.getTime() + MINUTE_MS;
        progress.chunks_completed += 1;
        continue;
      }

      const aggregated15m = aggregateMinuteCandlesTo15m({
        candles,
        carry: carry15m,
      });
      const candles15m = aggregated15m.candles15m;
      carry15m = aggregated15m.carry;
      progress.fetched_rows_15m += candles15m.length;

      if (!dryRun && candles.length > 0) {
        const changed = await upsertMinuteCandles(supabase, symbol, candles, 2_000, dataProvider);
        progress.saved_rows += changed;
        if (candles15m.length > 0) {
          const changed15m = await upsertFifteenMinuteCandles(supabase, symbol, candles15m, 500, dataProvider);
          progress.saved_rows_15m += changed15m;
        }
      } else if (dryRun) {
        progress.saved_rows += candles.length;
        progress.saved_rows_15m += candles15m.length;
      }

      progress.chunks_completed += 1;
      cursor = chunkEnd.getTime() + MINUTE_MS;
    }

    const trailing15m = flush15mCarry(carry15m);
    progress.fetched_rows_15m += trailing15m.length;
    if (!dryRun && trailing15m.length > 0) {
      const changed15m = await upsertFifteenMinuteCandles(supabase, symbol, trailing15m, 500, dataProvider);
      progress.saved_rows_15m += changed15m;
    } else if (dryRun) {
      progress.saved_rows_15m += trailing15m.length;
    }

    const responsePayload = {
      trace_id: traceId,
      symbol,
      chunk_days_requested: requestedChunkDays,
      chunk_days: chunkDays,
      chunk_days_capped_for_outputsize: chunkDaysCapped,
      dry_run: dryRun,
      skip_empty_chunks: skipEmptyChunks,
      data_provider: dataProvider,
      range_mode: rangeMode,
      latest_saved_anchor_utc: latestSavedAnchorUtc,
      oldest_saved_anchor_utc: oldestSavedAnchorUtc,
      smart_mode: smartMode,
      smart_lookback_days: smartLookbackDays,
      smart_mode_fallback_reason: smartModeFallbackReason,
      requested_start_date_utc: startDateInput,
      requested_end_date_utc: endDateInput,
      clamped_end_to_latest_complete_minute: clampedEnd,
      fetched_from_utc: requestedStart.toISOString(),
      fetched_to_utc: requestedEnd.toISOString(),
      total_minutes_requested: totalMinutesRequested,
      estimated_chunks: estimatedChunks,
      max_chunks_per_run: maxChunksPerRun,
      max_chunks_per_run_configured: maxChunksPerRunConfigured,
      max_chunks_this_run_requested: requestedMaxChunksThisRun,
      chunks_completed: progress.chunks_completed,
      fetched_rows: progress.fetched_rows,
      saved_rows: progress.saved_rows,
      fetched_rows_15m: progress.fetched_rows_15m,
      saved_rows_15m: progress.saved_rows_15m,
      api_calls_used: progress.api_calls_used,
      empty_chunks_skipped: progress.empty_chunks_skipped,
    };

    runStatus = "success";
    runPayload = responsePayload;
    return jsonResponse(responsePayload);
  } catch (error) {
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
      partial_progress: progress,
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
          partial_progress: progress,
          trace_id: traceId,
        },
        error.statusCode,
      );
    }

    if (error instanceof FinnhubApiError || error instanceof TwelveApiError) {
      return jsonResponse(
        {
          error: error.message,
          partial_progress: progress,
          trace_id: traceId,
        },
        error.statusCode,
      );
    }

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        partial_progress: progress,
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
