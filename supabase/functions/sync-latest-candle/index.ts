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
import { sendTelegramMessage } from "../_shared/telegram.ts";
import {
  buildTelegramTradingMessage,
  finalizeTelegramNotification,
  markOpportunityTelegramNotified,
  reserveTelegramNotification,
  runTradingOpportunityCheck,
} from "../_shared/tradingOpportunity.ts";

interface SyncLatestRequest {
  symbol?: string;
  symbols?: string[];
  run_opportunity_check?: boolean;
}

const MINUTE_MS = 60 * 1000;

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

function parseInteger(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
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

function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function isMissingLockRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("acquire_pipeline_lock") &&
    (m.includes("could not find the function") || m.includes("does not exist"));
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

    if (symbols.length === 0) {
      return jsonResponse(
        {
          error: "At least one symbol is required (body.symbol/body.symbols, query params, or FINNHUB_DEFAULT_SYMBOL(S)).",
        },
        400,
      );
    }

    const apiKey = requiredEnv("FINNHUB_API_KEY");
    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "sync-latest-candle",
      traceId,
      payload: {
        symbols_requested: symbols,
        run_opportunity_check: runOpportunityCheck,
      },
    });

    const telegramEnabled = parseBoolean(Deno.env.get("TELEGRAM_ALERTS_ENABLED"), true);
    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
    const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
    const telegramMaxMessagesPerHour = parseInteger(Deno.env.get("TELEGRAM_MAX_MESSAGES_PER_HOUR"), 8);
    const fetchMaxRetries = parseInteger(Deno.env.get("FINNHUB_FETCH_MAX_RETRIES"), 3);
    const fetchBaseDelayMs = parseInteger(Deno.env.get("FINNHUB_FETCH_BASE_DELAY_MS"), 400);
    const fetchTimeoutMs = parseInteger(Deno.env.get("FINNHUB_FETCH_TIMEOUT_MS"), 15_000);

    const targetMinuteStart = latestCompleteMinuteUtc();
    const targetMinuteEnd = new Date(targetMinuteStart.getTime() + MINUTE_MS);
    const targetMinuteIso = targetMinuteStart.toISOString();
    const targetMinuteText = formatUtcDateTime(targetMinuteStart);
    const targetMinuteEndExclusiveMinus1s = new Date(targetMinuteEnd.getTime() - 1000);

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

    const results: Array<Record<string, unknown>> = [];
    let apiCallsUsed = 0;

    for (const symbol of symbols) {
      try {
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
          results.push({
            symbol,
            skipped: true,
            reason: "latest_complete_minute_already_saved",
            target_candle_time_utc: targetMinuteIso,
            existing_candle_time_utc: existingMinute.candle_time,
          });
          continue;
        }

        await waitForFinnhubCallBudget(supabase, 1, {
          maxMinuteRetries: 10,
          maxWaitMs: 15 * 60_000,
        });
        apiCallsUsed += 1;

        const candles = await fetchFinnhubCandlesWithRetry({
          apiKey,
          symbol,
          resolution: "1",
          from: targetMinuteStart,
          to: targetMinuteEndExclusiveMinus1s,
          timeoutMs: fetchTimeoutMs,
          maxRetries: fetchMaxRetries,
          baseDelayMs: fetchBaseDelayMs,
        });

        const latestCandle = candles.find((row) => row.datetime === targetMinuteText) ?? null;
        if (!latestCandle) {
          results.push({
            symbol,
            skipped: true,
            reason: "no_target_complete_minute_candle_returned",
            target_candle_time_utc: targetMinuteIso,
            fetched: candles.length,
          });
          await insertOpsAlert({
            supabase,
            traceId,
            alertType: "missing_minute_candle",
            severity: "warning",
            message: `${symbol} missing latest complete minute candle`,
            payload: {
              target_candle_time_utc: targetMinuteIso,
              fetched_rows: candles.length,
            },
          });
          continue;
        }

        const saved = await upsertMinuteCandles(supabase, symbol, [latestCandle], 200, "finnhub");
        let opportunityCheck: Record<string, unknown> | null = null;

        if (runOpportunityCheck) {
          const checkResult = await runTradingOpportunityCheck({
            supabase,
            symbol,
            latestPrice: latestCandle.close,
            latestCandleTimeUtc: latestCandle.datetime,
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
        }

        results.push({
          symbol,
          fetched: candles.length,
          saved,
          latest_candle_time_utc: latestCandle.datetime,
          latest_price: Number.parseFloat(latestCandle.close),
          opportunity_check: opportunityCheck,
        });
      } catch (error) {
        if (error instanceof FinnhubRateLimitError && error.reason === "daily_limit") {
          runStatus = "partial";
          runPayload = {
            symbols_requested: symbols,
            partial_results: results,
            reason: error.reason,
            minute_remaining: error.minuteRemaining,
            day_remaining: error.dayRemaining,
            api_calls_used: apiCallsUsed,
          };
          return jsonResponse(
            {
              error: error.message,
              reason: error.reason,
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

        if (error instanceof FinnhubRateLimitError || error instanceof FinnhubApiError) {
          results.push({
            symbol,
            error: error.message,
          });
          continue;
        }

        results.push({
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const responsePayload = {
      trace_id: traceId,
      symbols_requested: symbols,
      target_complete_minute_utc: targetMinuteIso,
      symbols_processed: results.length,
      api_calls_used: apiCallsUsed,
      run_opportunity_check: runOpportunityCheck,
      check_function_name: "check-trading-opportunity (internal-shared-execution)",
      data_provider: "finnhub",
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

    if (error instanceof FinnhubRateLimitError) {
      return jsonResponse(
        {
          error: error.message,
          reason: error.reason,
          wait_seconds: error.waitSeconds,
          minute_remaining: error.minuteRemaining,
          day_remaining: error.dayRemaining,
          trace_id: traceId,
        },
        error.statusCode,
      );
    }

    if (error instanceof FinnhubApiError) {
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
