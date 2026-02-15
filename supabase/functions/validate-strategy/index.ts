import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { readSymbol } from "../_shared/config.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";
import { runStrategyValidation } from "../_shared/strategyValidation.ts";

interface ValidateRequest {
  symbol?: string;
  from_time_utc?: string;
  to_time_utc?: string;
  walk_forward_split_utc?: string;
  walk_forward_ratio?: number | string;
  max_candles?: number | string;
  directional_lookahead_bars?: number | string;
}

function parseBody(req: Request): Promise<ValidateRequest> {
  if (req.method !== "POST") {
    return Promise.resolve({});
  }
  return req.json().catch(() => ({}));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
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
    secretEnvNames: ["VALIDATE_CRON_SECRET"],
    scope: "validate-strategy",
  });
  if (authError) return authError;

  const traceId = `validate-${crypto.randomUUID()}`;
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
    if (!symbol) {
      return jsonResponse(
        { error: "symbol is required (body.symbol, ?symbol=, or FINNHUB_DEFAULT_SYMBOL)" },
        400,
      );
    }

    runId = await startOpsFunctionRun({
      supabase,
      functionName: "validate-strategy",
      traceId,
      payload: { symbol },
    });

    const result = await runStrategyValidation({
      supabase,
      symbol,
      fromTimeUtc: body.from_time_utc ?? url.searchParams.get("from_time_utc"),
      toTimeUtc: body.to_time_utc ?? url.searchParams.get("to_time_utc"),
      walkForwardSplitUtc: body.walk_forward_split_utc ??
        url.searchParams.get("walk_forward_split_utc"),
      walkForwardRatio: parseNumber(body.walk_forward_ratio ?? url.searchParams.get("walk_forward_ratio")),
      maxCandles: parseNumber(body.max_candles ?? url.searchParams.get("max_candles")),
      directionalLookaheadBars: parseNumber(
        body.directional_lookahead_bars ?? url.searchParams.get("directional_lookahead_bars"),
      ),
      traceId,
    });

    runStatus = "success";
    runPayload = result.summary as unknown as Record<string, unknown>;
    return jsonResponse(result);
  } catch (error) {
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
    };
    if (supabase) {
      await insertOpsAlert({
        supabase,
        traceId,
        alertType: "strategy_validation_error",
        severity: "error",
        message: "Strategy validation failed",
        payload: runPayload,
      });
    }
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      },
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
