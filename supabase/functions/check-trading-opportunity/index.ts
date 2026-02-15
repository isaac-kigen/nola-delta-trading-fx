import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { readSymbol } from "../_shared/config.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  finishOpsFunctionRun,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import {
  buildTelegramTradingMessage,
  finalizeTelegramNotification,
  markOpportunityTelegramNotified,
  reserveTelegramNotification,
  runTradingOpportunityCheck,
} from "../_shared/tradingOpportunity.ts";

interface CheckRequest {
  symbol?: string;
  latest_price?: number | string;
  latest_candle_time_utc?: string;
  spread_pips?: number | string;
  send_telegram?: boolean | string;
}

function parseBody(req: Request): Promise<CheckRequest> {
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
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
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
    secretEnvNames: ["CHECK_CRON_SECRET"],
    scope: "check-trading-opportunity",
  });
  if (authError) return authError;

  const traceId = `check-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    supabase = createSupabaseAdminClient();

    const body = await parseBody(req);
    const url = new URL(req.url);
    const symbol = readSymbol(
      body.symbol ?? url.searchParams.get("symbol") ??
        Deno.env.get("FINNHUB_DEFAULT_SYMBOL") ?? Deno.env.get("TWELVE_DEFAULT_SYMBOL"),
    );
    const sendTelegram = parseBoolean(
      body.send_telegram ?? url.searchParams.get("send_telegram"),
      true,
    );

    if (!symbol) {
      return jsonResponse(
        { error: "symbol is required (body.symbol, ?symbol=, or FINNHUB_DEFAULT_SYMBOL)" },
        400,
      );
    }

    runId = await startOpsFunctionRun({
      supabase,
      functionName: "check-trading-opportunity",
      traceId,
      payload: {
        symbol,
        send_telegram: sendTelegram,
      },
    });

    const result = await runTradingOpportunityCheck({
      supabase,
      symbol,
      latestPrice: body.latest_price ?? url.searchParams.get("latest_price"),
      latestCandleTimeUtc: body.latest_candle_time_utc ??
        url.searchParams.get("latest_candle_time_utc"),
      spreadPips: body.spread_pips ?? url.searchParams.get("spread_pips"),
      traceId,
    });

    let telegram: Record<string, unknown> | null = null;
    if (sendTelegram && result.should_notify && result.signal_id !== null) {
      const enabled = parseBoolean(Deno.env.get("TELEGRAM_ALERTS_ENABLED"), true);
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
      const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
      const maxMessagesPerHour = parseInteger(
        Deno.env.get("TELEGRAM_MAX_MESSAGES_PER_HOUR"),
        8,
      );

      if (enabled && botToken && chatId) {
        const text = buildTelegramTradingMessage(result);
        const messageHash = await sha256Hex(text);

        const reservation = await reserveTelegramNotification({
          supabase,
          signalId: result.signal_id,
          symbol,
          messageHash,
          traceId: result.trace_id,
          maxMessagesPerHour,
        });

        if (reservation.allowed) {
          const sent = await sendTelegramMessage({
            botToken,
            chatId,
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
              checkId: result.check_id,
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
        reason: sendTelegram ? "notify_not_required" : "send_telegram_disabled",
      };
    }

    const payload = {
      trace_id: traceId,
      result,
      telegram,
    };
    runStatus = "success";
    runPayload = payload;

    return jsonResponse(payload);
  } catch (error) {
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
    };
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error), trace_id: traceId },
      500,
    );
  } finally {
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
