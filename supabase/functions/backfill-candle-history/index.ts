import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { upsertMinuteCandles } from "../_shared/candleStore.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { readSymbol, requiredEnv } from "../_shared/config.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  fetchFinnhubCandlesWithRetry,
  FinnhubApiError,
} from "../_shared/finnhub.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import {
  FinnhubRateLimitError,
  waitForFinnhubCallBudget,
} from "../_shared/rateLimit.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";

interface BackfillRequest {
  symbol?: string;
  chunk_days?: number;
  start_date_utc?: string;
  end_date_utc?: string;
  dry_run?: boolean | string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_SAFE_CHUNK_DAYS = 30;

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

function clampChunkDays(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return 7;
  return Math.min(MAX_SAFE_CHUNK_DAYS, Math.max(1, Math.trunc(value)));
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
    api_calls_used: 0,
    empty_chunks_skipped: 0,
  };

  try {
    const body = await parseBody(req);
    const url = new URL(req.url);
    const symbol = readSymbol(
      body.symbol ?? url.searchParams.get("symbol") ??
        Deno.env.get("FINNHUB_DEFAULT_SYMBOL") ?? Deno.env.get("TWELVE_DEFAULT_SYMBOL"),
    );
    const requestedChunkDays = parseInteger(body.chunk_days ?? url.searchParams.get("chunk_days"), 7);
    const chunkDays = clampChunkDays(requestedChunkDays);
    const chunkDaysCapped = chunkDays !== requestedChunkDays;
    const dryRun = parseBoolean(body.dry_run ?? url.searchParams.get("dry_run"), false);
    const skipEmptyChunks = parseBoolean(Deno.env.get("BACKFILL_SKIP_EMPTY_CHUNKS"), true);

    if (!symbol) {
      return jsonResponse(
        { error: "symbol is required (body.symbol, query param, or FINNHUB_DEFAULT_SYMBOL)" },
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
        chunk_days_requested: requestedChunkDays,
        chunk_days_effective: chunkDays,
        chunk_days_capped_for_outputsize: chunkDaysCapped,
        dry_run: dryRun,
        start_date_utc: startDateInput,
        end_date_utc: endDateInput,
      },
    });

    const lockEnabled = parseBoolean(Deno.env.get("LOCK_ENABLED"), true);
    const lockFailOpen = parseBoolean(Deno.env.get("LOCK_FAIL_OPEN"), true);
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
        const canFailOpen = lockFailOpen || isMissingLockRpcError(lockError.message);
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
              lock_fail_open: lockFailOpen,
            },
          });
        } else {
          throw new Error(`Failed acquiring backfill lock: ${lockError.message}`);
        }
      }

      const lockAcquired = lockError ? true : Boolean(lockRow?.acquired);
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

    const apiKey = requiredEnv("FINNHUB_API_KEY");
    const fetchMaxRetries = parseInteger(Deno.env.get("FINNHUB_FETCH_MAX_RETRIES"), 3);
    const fetchBaseDelayMs = parseInteger(Deno.env.get("FINNHUB_FETCH_BASE_DELAY_MS"), 400);
    const fetchTimeoutMs = parseInteger(Deno.env.get("FINNHUB_FETCH_TIMEOUT_MS"), 15_000);
    const maxChunksPerRun = parseInteger(Deno.env.get("BACKFILL_MAX_CHUNKS_PER_RUN"), 120);

    const latestCompleteMinute = latestCompleteMinuteUtc();
    let requestedStart: Date;
    let requestedEnd: Date;
    let rangeMode: "explicit_dates" | "default_anchor" = "default_anchor";
    let latestSavedAnchorUtc: string | null = null;
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

      const anchor = latestSaved?.candle_time ? new Date(String(latestSaved.candle_time)) : latestCompleteMinute;
      latestSavedAnchorUtc = anchor.toISOString();
      requestedEnd = floorToMinuteUtc(anchor);
      requestedStart = floorToMinuteUtc(new Date(requestedEnd.getTime() - 365 * DAY_MS));
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

    const totalMinutesRequested = Math.floor((requestedEnd.getTime() - requestedStart.getTime()) / MINUTE_MS) + 1;
    const estimatedChunks = Math.ceil(totalMinutesRequested / (chunkDays * 24 * 60));

    if (estimatedChunks > maxChunksPerRun) {
      runStatus = "partial";
      runPayload = {
        trace_id: traceId,
        reason: "max_chunks_per_run_exceeded",
        estimated_chunks: estimatedChunks,
        max_chunks_per_run: maxChunksPerRun,
      };
      return jsonResponse(
        {
          error: "Requested range exceeds max chunks per run. Decrease range or increase chunk_days.",
          trace_id: traceId,
          estimated_chunks: estimatedChunks,
          max_chunks_per_run: maxChunksPerRun,
        },
        422,
      );
    }

    const chunkMs = chunkDays * DAY_MS;
    let cursor = requestedStart.getTime();
    const hardEndMs = requestedEnd.getTime();
    while (cursor <= hardEndMs) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(Math.min(hardEndMs, cursor + chunkMs - MINUTE_MS));

      await waitForFinnhubCallBudget(supabase, 1, {
        maxMinuteRetries: 10,
        maxWaitMs: 15 * 60_000,
      });
      progress.api_calls_used += 1;

      const candles = await fetchFinnhubCandlesWithRetry({
        apiKey,
        symbol,
        resolution: "1",
        from: chunkStart,
        to: chunkEnd,
        timeoutMs: fetchTimeoutMs,
        maxRetries: fetchMaxRetries,
        baseDelayMs: fetchBaseDelayMs,
      });

      progress.fetched_rows += candles.length;
      if (candles.length === 0 && skipEmptyChunks) {
        progress.empty_chunks_skipped += 1;
        cursor = chunkEnd.getTime() + MINUTE_MS;
        progress.chunks_completed += 1;
        continue;
      }

      if (!dryRun && candles.length > 0) {
        const changed = await upsertMinuteCandles(supabase, symbol, candles, 2_000, "finnhub");
        progress.saved_rows += changed;
      } else if (dryRun) {
        progress.saved_rows += candles.length;
      }

      progress.chunks_completed += 1;
      cursor = chunkEnd.getTime() + MINUTE_MS;
    }

    const responsePayload = {
      trace_id: traceId,
      symbol,
      chunk_days_requested: requestedChunkDays,
      chunk_days: chunkDays,
      chunk_days_capped_for_outputsize: chunkDaysCapped,
      dry_run: dryRun,
      skip_empty_chunks: skipEmptyChunks,
      data_provider: "finnhub",
      range_mode: rangeMode,
      latest_saved_anchor_utc: latestSavedAnchorUtc,
      requested_start_date_utc: startDateInput,
      requested_end_date_utc: endDateInput,
      clamped_end_to_latest_complete_minute: clampedEnd,
      fetched_from_utc: requestedStart.toISOString(),
      fetched_to_utc: requestedEnd.toISOString(),
      total_minutes_requested: totalMinutesRequested,
      estimated_chunks: estimatedChunks,
      max_chunks_per_run: maxChunksPerRun,
      chunks_completed: progress.chunks_completed,
      fetched_rows: progress.fetched_rows,
      saved_rows: progress.saved_rows,
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

    if (error instanceof FinnhubRateLimitError) {
      return jsonResponse(
        {
          error: error.message,
          reason: error.reason,
          wait_seconds: error.waitSeconds,
          minute_remaining: error.minuteRemaining,
          day_remaining: error.dayRemaining,
          partial_progress: progress,
          trace_id: traceId,
        },
        error.statusCode,
      );
    }

    if (error instanceof FinnhubApiError) {
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
