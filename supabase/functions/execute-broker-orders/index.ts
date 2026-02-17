import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";
import { CTraderOpenApiRuntime } from "../_shared/ctraderOpenApi.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";

interface ExecuteRequest {
  limit?: number | string;
  provider?: string;
  probe?: boolean | string;
  probe_deep?: boolean | string;
  force?: boolean | string;
  skip_circuit_breaker?: boolean | string;
  chaos_mode?: boolean | string;
  chaos_failure_rate_pct?: number | string;
}

type IntentStatus =
  | "pending"
  | "sent"
  | "acknowledged"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "error";

interface ClaimedIntentRow {
  id: number;
  signal_id: number | null;
  trace_id: string;
  symbol: string;
  direction: "long" | "short";
  order_type: "market" | "limit" | "stop";
  requested_entry_price: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  planned_size_units: number | string | null;
  broker: string;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  attempt_count: number;
}

interface ExecutionOutcome {
  finalStatus: IntentStatus;
  provider: string;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  retryable: boolean;
  httpStatus: number | null;
  message: string;
  payload: Record<string, unknown>;
}

const ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "sent",
  "acknowledged",
  "filled",
  "partially_filled",
  "cancelled",
  "rejected",
  "error",
]);

function parseBody(req: Request): Promise<ExecuteRequest> {
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

function parseInteger(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseNumber(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isMissingLockRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("acquire_pipeline_lock") &&
    (m.includes("could not find the function") || m.includes("does not exist"));
}

function normalizeProvider(raw: string | null | undefined, fallback: string): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["pepperstone", "pepperstone_ctrader", "ctrader"].includes(normalized)) {
    return "ctrader";
  }
  return normalized;
}

function normalizeStatus(raw: string | null | undefined, fallback: IntentStatus): IntentStatus {
  const candidate = (raw ?? "").trim().toLowerCase();
  if (ALLOWED_STATUSES.has(candidate)) {
    return candidate as IntentStatus;
  }
  return fallback;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: unknown, digits = 5): string {
  const num = toFiniteNumber(value);
  if (num === null) return "-";
  if (digits <= 0) return String(Math.round(num));
  return num.toFixed(digits);
}

function compactText(text: string, maxLength = 220): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function deterministicRatio(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0) / 4294967295;
}

function shouldInjectChaos(params: {
  enabled: boolean;
  failureRatePct: number;
  seed: string;
}): boolean {
  if (!params.enabled) return false;
  if (!(params.failureRatePct > 0)) return false;
  return deterministicRatio(params.seed) < params.failureRatePct / 100;
}

function cTraderBridgeFallbackEnabled(): boolean {
  return parseBoolean(Deno.env.get("CTRADER_RUNTIME_BRIDGE_FALLBACK"), true);
}

function cTraderRuntimeConfigured(): boolean {
  const clientId = (Deno.env.get("CTRADER_CLIENT_ID") ?? "").trim();
  const clientSecret = (Deno.env.get("CTRADER_CLIENT_SECRET") ?? "").trim();
  return clientId.length > 0 && clientSecret.length > 0;
}

function looksLikeCTraderRuntimeProtocolError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("non-json ctrader websocket frames") ||
    normalized.includes("websocket") ||
    normalized.includes("payloadtype") ||
    normalized.includes("timed out waiting ctrader event") ||
    normalized.includes("timed out connecting to ctrader websocket");
}

function parseBrokerPositionId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text;
}

function selectTp3First(intent: ClaimedIntentRow): number | null {
  return toFiniteNumber(intent.tp3);
}

function buildExecutionTelegramMessage(params: {
  intent: ClaimedIntentRow;
  provider: string;
  status: IntentStatus;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  message: string;
  traceId: string;
  retryInSeconds?: number | null;
}): string {
  const side = params.intent.direction === "long" ? "BUY" : "SELL";
  const tp3 = selectTp3First(params.intent);
  const entry = toFiniteNumber(params.intent.requested_entry_price);
  const sl = toFiniteNumber(params.intent.stop_loss);
  const sizeUnits = toFiniteNumber(params.intent.planned_size_units);

  return [
    `Broker ${params.status.toUpperCase()} | ${side} ${params.intent.symbol}`,
    `Provider: ${params.provider}`,
    `Intent: ${params.intent.id} | Signal: ${params.intent.signal_id ?? "-"}`,
    `Entry: ${formatNumber(entry)} | SL: ${formatNumber(sl)} | TP(3): ${formatNumber(tp3)}`,
    `Size(units): ${sizeUnits === null ? "-" : formatNumber(sizeUnits, 2)}`,
    `Broker Order ID: ${params.brokerOrderId ?? "-"}`,
    `Broker Position ID: ${params.brokerPositionId ?? "-"}`,
    `Attempt: ${params.intent.attempt_count}`,
    params.retryInSeconds && params.retryInSeconds > 0
      ? `Retry In: ${params.retryInSeconds}s`
      : "Retry In: -",
    `Message: ${compactText(params.message)}`,
    `Trace: ${params.traceId}`,
  ].join("\n");
}

async function sendExecutionTelegram(params: {
  enabled: boolean;
  botToken: string;
  chatId: string;
  text: string;
  timeoutMs: number;
}): Promise<void> {
  if (!params.enabled || !params.botToken || !params.chatId) {
    return;
  }

  try {
    await sendTelegramMessage({
      botToken: params.botToken,
      chatId: params.chatId,
      text: params.text,
      timeoutMs: params.timeoutMs,
    });
  } catch {
    // Telegram notifications are best-effort and must not block execution.
  }
}

async function dispatchBrokerPositionSyncNow(params: {
  provider: string;
  traceId: string;
  timeoutMs: number;
  onlyOpen: boolean;
}): Promise<void> {
  const dispatchEnabled = parseBoolean(Deno.env.get("BROKER_SYNC_DISPATCH_AFTER_EXECUTION"), true);
  if (!dispatchEnabled) return;

  const explicitUrl = (Deno.env.get("BROKER_SYNC_DISPATCH_URL") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  const syncUrl = explicitUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1/sync-broker-positions` : "");
  if (!syncUrl) return;

  const cronSecret = (Deno.env.get("BROKER_SYNC_CRON_SECRET") ?? "").trim() ||
    (Deno.env.get("EXECUTE_CRON_SECRET") ?? "").trim();
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-trigger-source": "execute-broker-orders",
  };
  if (cronSecret) {
    headers["x-cron-secret"] = cronSecret;
  } else if (serviceRoleKey) {
    headers.apikey = serviceRoleKey;
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }

  const response = await fetchJsonWithTimeout({
    url: syncUrl,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: params.provider,
        only_open: params.onlyOpen,
        limit: 200,
        trigger_trace_id: params.traceId,
      }),
    },
    timeoutMs: params.timeoutMs,
  });

  if (!response.ok) {
    const clipped = response.text.length > 300 ? `${response.text.slice(0, 300)}...` : response.text;
    throw new Error(`sync-broker-positions dispatch failed (${response.status}): ${clipped}`);
  }
}

interface CircuitBreakerDecision {
  open: boolean;
  reason: string;
  window_minutes: number;
  total_considered: number;
  error_count: number;
  success_count: number;
  error_rate_pct: number;
}

async function evaluateBrokerCircuitBreaker(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  provider: string;
  windowMinutes: number;
  minSample: number;
  maxErrors: number;
  maxErrorRatePct: number;
}): Promise<CircuitBreakerDecision> {
  const sinceIso = new Date(Date.now() - params.windowMinutes * 60_000).toISOString();

  const queryCount = async (statuses: string[]): Promise<number> => {
    let query = params.supabase
      .from("broker_order_intents")
      .select("id", { head: true, count: "exact" })
      .gte("updated_at", sinceIso)
      .in("status", statuses);

    if (params.provider && params.provider !== "all") {
      query = query.eq("broker", params.provider);
    }

    const { count, error } = await query;
    if (error) {
      throw new Error(`Circuit-breaker query failed: ${error.message}`);
    }
    return count ?? 0;
  };

  const errorCount = await queryCount(["error", "rejected"]);
  const successCount = await queryCount(["filled", "partially_filled"]);
  const totalConsidered = await queryCount([
    "sent",
    "acknowledged",
    "filled",
    "partially_filled",
    "cancelled",
    "rejected",
    "error",
  ]);

  const errorRate = totalConsidered > 0 ? (errorCount / totalConsidered) * 100 : 0;
  const dominatedByErrors = errorCount > 0 && errorCount >= successCount * 2;
  const enoughSample = totalConsidered >= params.minSample;
  const open = enoughSample &&
    dominatedByErrors &&
    (errorCount >= params.maxErrors || errorRate >= params.maxErrorRatePct);

  return {
    open,
    reason: open ? "broker_circuit_breaker_open" : "healthy",
    window_minutes: params.windowMinutes,
    total_considered: totalConsidered,
    error_count: errorCount,
    success_count: successCount,
    error_rate_pct: Math.round(errorRate * 100) / 100,
  };
}

async function countBrokerIntents(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  provider: string;
  statuses: string[];
  updatedSinceIso?: string;
}): Promise<number> {
  let query = params.supabase
    .from("broker_order_intents")
    .select("id", { head: true, count: "exact" })
    .in("status", params.statuses);

  if (params.provider && params.provider !== "all") {
    query = query.eq("broker", params.provider);
  }
  if (params.updatedSinceIso) {
    query = query.gte("updated_at", params.updatedSinceIso);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed counting broker intents: ${error.message}`);
  }
  return count ?? 0;
}

async function fetchJsonWithTimeout(params: {
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<{ status: number; ok: boolean; json: unknown; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(params.url, {
      ...params.init,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw_text: text };
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      json,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function executePaperIntent(intent: ClaimedIntentRow): Promise<ExecutionOutcome> {
  return {
    finalStatus: "filled",
    provider: "paper",
    brokerOrderId: `paper-${intent.id}-${Date.now()}`,
    brokerPositionId: null,
    retryable: false,
    httpStatus: null,
    message: "Filled in paper execution mode",
    payload: {
      execution_mode: "paper",
      filled_at: new Date().toISOString(),
      intent_id: intent.id,
      requested_entry_price: intent.requested_entry_price,
    },
  };
}

async function executeViaBridge(params: {
  intent: ClaimedIntentRow;
  provider: string;
  bridgeUrl: string;
  bridgeToken: string;
  callbackUrl: string;
  callbackSecret: string;
  callbackHeaderName: string;
  timeoutMs: number;
  traceId: string;
}): Promise<ExecutionOutcome> {
  const idempotencyKey = `broker-intent-${params.intent.id}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-idempotency-key": idempotencyKey,
    "x-trace-id": params.traceId,
  };

  if (params.bridgeToken.trim().length > 0) {
    headers.Authorization = `Bearer ${params.bridgeToken.trim()}`;
  }

  const callbackConfig = params.callbackUrl
    ? {
      url: params.callbackUrl,
      headers: params.callbackSecret
        ? {
          [params.callbackHeaderName || "x-callback-secret"]: params.callbackSecret,
        }
        : {},
    }
    : null;

  const payload = {
    type: "place_order",
    provider: params.provider,
    trace_id: params.traceId,
    idempotency_key: idempotencyKey,
    callback: callbackConfig,
    intent: params.intent,
  };

  const response = await fetchJsonWithTimeout({
    url: params.bridgeUrl,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    timeoutMs: params.timeoutMs,
  });

  const responseObj = toObject(response.json);
  const message = String(
    responseObj.message ??
      responseObj.error ??
      (response.ok ? "Bridge execution succeeded" : `Bridge execution failed (${response.status})`),
  );
  const brokerOrderIdRaw = responseObj.broker_order_id ?? responseObj.order_id;
  const brokerOrderId = typeof brokerOrderIdRaw === "string" && brokerOrderIdRaw.trim().length > 0
    ? brokerOrderIdRaw
    : null;

  const retryable = parseBoolean(
    responseObj.retryable ?? (response.status === 429 || response.status >= 500),
    response.status === 429 || response.status >= 500,
  );

  if (response.ok) {
    const brokerPositionId = parseBrokerPositionId(
      responseObj.broker_position_id ?? responseObj.position_id ?? responseObj.positionId,
    );
    return {
      finalStatus: normalizeStatus(String(responseObj.status ?? responseObj.final_status ?? ""), "acknowledged"),
      provider: params.provider,
      brokerOrderId,
      brokerPositionId,
      retryable,
      httpStatus: response.status,
      message,
      payload: {
        response: responseObj,
      },
    };
  }

  return {
    finalStatus: retryable ? "pending" : "rejected",
    provider: params.provider,
    brokerOrderId,
    brokerPositionId: null,
    retryable,
    httpStatus: response.status,
    message,
    payload: {
      response: responseObj,
      body_text: response.text,
    },
  };
}

async function executeIntent(params: {
  intent: ClaimedIntentRow;
  provider: string;
  ctraderRuntime: CTraderOpenApiRuntime | null;
  bridgeUrl: string;
  bridgeToken: string;
  callbackUrl: string;
  callbackSecret: string;
  callbackHeaderName: string;
  timeoutMs: number;
  traceId: string;
}): Promise<ExecutionOutcome> {
  if (params.provider === "paper") {
    return executePaperIntent(params.intent);
  }

  if (params.provider === "ctrader") {
    const allowBridgeFallback = cTraderBridgeFallbackEnabled() && params.bridgeUrl.trim().length > 0;

    if (!params.ctraderRuntime) {
      if (allowBridgeFallback) {
        const bridged = await executeViaBridge({
          ...params,
          provider: "ctrader",
        });
        return {
          ...bridged,
          message: `cTrader runtime unavailable, bridged: ${bridged.message}`,
          payload: {
            ...bridged.payload,
            execution_mode: "bridge_fallback",
            fallback_reason: "ctrader_runtime_unavailable",
          },
        };
      }

      throw new Error(
        "cTrader runtime is not available. Ensure CTRADER_CLIENT_ID/CTRADER_CLIENT_SECRET and OAuth token are configured.",
      );
    }

    try {
      const ctraderOutcome = await params.ctraderRuntime.placeOrder({
        id: params.intent.id,
        symbol: params.intent.symbol,
        direction: params.intent.direction,
        planned_size_units: params.intent.planned_size_units,
        stop_loss: params.intent.stop_loss,
        tp1: params.intent.tp1,
        tp2: params.intent.tp2,
        tp3: params.intent.tp3,
      });

      return {
        finalStatus: ctraderOutcome.finalStatus,
        provider: "ctrader",
        brokerOrderId: ctraderOutcome.brokerOrderId,
        brokerPositionId: ctraderOutcome.brokerPositionId,
        retryable: ctraderOutcome.retryable,
        httpStatus: null,
        message: ctraderOutcome.message,
        payload: ctraderOutcome.payload,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (allowBridgeFallback && looksLikeCTraderRuntimeProtocolError(errorMessage)) {
        const bridged = await executeViaBridge({
          ...params,
          provider: "ctrader",
        });
        return {
          ...bridged,
          message: `cTrader runtime failed, bridged: ${bridged.message}`,
          payload: {
            ...bridged.payload,
            execution_mode: "bridge_fallback",
            fallback_reason: errorMessage.slice(0, 320),
          },
        };
      }
      throw error;
    }
  }

  if (!params.bridgeUrl) {
    throw new Error(
      `BROKER_BRIDGE_URL is required for provider '${params.provider}'. Set provider to 'paper' for paper mode.`,
    );
  }

  return executeViaBridge(params);
}

async function finalizeIntent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  intentId: number;
  status: IntentStatus;
  brokerOrderId: string | null;
  responsePayload: Record<string, unknown>;
  lastError: string | null;
  nextRetrySeconds: number | null;
}): Promise<void> {
  const { error } = await params.supabase.rpc("finalize_broker_order_intent", {
    p_intent_id: params.intentId,
    p_status: params.status,
    p_broker_order_id: params.brokerOrderId,
    p_response_payload: params.responsePayload,
    p_last_error: params.lastError,
    p_next_retry_seconds: params.nextRetrySeconds,
  });

  if (error) {
    throw new Error(`Failed finalizing broker intent ${params.intentId}: ${error.message}`);
  }
}

async function writeSignalEvent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  signalId: number | null;
  traceId: string;
  eventType: string;
  reason: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (params.signalId === null) return;

  try {
    await params.supabase
      .from("trading_signal_events")
      .insert({
        signal_id: params.signalId,
        trace_id: params.traceId,
        event_type: params.eventType,
        event_reason: params.reason,
        event_payload: params.payload,
      });
  } catch {
    // Event logging is best-effort.
  }
}

async function syncPositionBrokerRefs(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  signalId: number | null;
  provider: string;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
}): Promise<void> {
  if (params.signalId === null) return;

  const patch: Record<string, unknown> = {
    broker: params.provider,
    updated_at: new Date().toISOString(),
  };
  if (params.brokerOrderId) {
    patch.broker_order_id = params.brokerOrderId;
  }
  if (params.brokerPositionId) {
    patch.broker_position_id = params.brokerPositionId;
  }

  try {
    await params.supabase
      .from("trading_positions")
      .update(patch)
      .eq("signal_id", params.signalId)
      .eq("status", "open");
  } catch {
    // Position sync is best-effort.
  }
}

async function syncSignalLifecycleFromExecution(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  signalId: number | null;
  finalStatus: IntentStatus;
}): Promise<void> {
  if (params.signalId === null) return;

  const nowIso = new Date().toISOString();
  if (params.finalStatus === "filled" || params.finalStatus === "partially_filled") {
    await params.supabase
      .from("trading_signals")
      .update({
        signal_state: "executed",
        updated_at: nowIso,
        last_evaluated_at: nowIso,
      })
      .eq("id", params.signalId)
      .in("signal_state", ["triggered", "active", "pending"]);
    return;
  }

  if (params.finalStatus === "cancelled" || params.finalStatus === "rejected" || params.finalStatus === "error") {
    await params.supabase
      .from("trading_signals")
      .update({
        signal_state: "cancelled",
        updated_at: nowIso,
        last_evaluated_at: nowIso,
      })
      .eq("id", params.signalId)
      .neq("signal_state", "cancelled");
  }
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
    secretEnvNames: ["EXECUTE_CRON_SECRET"],
    scope: "execute-broker-orders",
  });
  if (authError) return authError;

  const traceId = `exec-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  const defaultProvider = normalizeProvider(
    Deno.env.get("BROKER_EXECUTION_PROVIDER"),
    "paper",
  );
  const batchSizeDefault = parseInteger(
    Deno.env.get("BROKER_EXECUTION_BATCH_SIZE"),
    5,
    1,
    50,
  );
  const reclaimSentAfterSeconds = parseInteger(
    Deno.env.get("BROKER_RECLAIM_SENT_AFTER_SECONDS"),
    300,
    60,
    3600,
  );
  const retrySecondsBase = parseInteger(
    Deno.env.get("BROKER_EXECUTION_RETRY_SECONDS"),
    120,
    30,
    3600,
  );
  const maxAttempts = parseInteger(
    Deno.env.get("BROKER_EXECUTION_MAX_ATTEMPTS"),
    5,
    1,
    100,
  );
  const bridgeUrl = Deno.env.get("BROKER_BRIDGE_URL")?.trim() ?? "";
  const bridgeToken = Deno.env.get("BROKER_BRIDGE_TOKEN")?.trim() ?? "";
  const callbackUrl = Deno.env.get("BROKER_CALLBACK_URL")?.trim() ?? "";
  const callbackSecret = (Deno.env.get("BROKER_CALLBACK_SECRET") ?? "").trim() ||
    (Deno.env.get("CTRADER_CALLBACK_SECRET") ?? "").trim();
  const callbackHeaderName = Deno.env.get("BROKER_CALLBACK_HEADER_NAME")?.trim() || "x-callback-secret";
  const bridgeTimeoutMs = parseInteger(
    Deno.env.get("BROKER_BRIDGE_TIMEOUT_MS"),
    15_000,
    1_000,
    120_000,
  );
  const lockEnabled = parseBoolean(Deno.env.get("LOCK_ENABLED"), true);
  const lockFailOpen = parseBoolean(Deno.env.get("LOCK_FAIL_OPEN"), false);
  const lockTtlSeconds = parseInteger(
    Deno.env.get("BROKER_EXECUTION_LOCK_TTL_SECONDS"),
    55,
    30,
    3600,
  );
  const brokerExecTelegramEnabled = parseBoolean(
    Deno.env.get("BROKER_EXEC_TELEGRAM_ENABLED"),
    true,
  );
  const brokerExecTelegramBotToken = (
    Deno.env.get("BROKER_EXEC_TELEGRAM_BOT_TOKEN") ?? ""
  ).trim() || (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const brokerExecTelegramChatId = (
    Deno.env.get("BROKER_EXEC_TELEGRAM_CHAT_ID") ?? ""
  ).trim() || (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim();
  const brokerExecTelegramTimeoutMs = parseInteger(
    Deno.env.get("BROKER_EXEC_TELEGRAM_TIMEOUT_MS"),
    10_000,
    1_000,
    60_000,
  );
  const circuitBreakerEnabled = parseBoolean(
    Deno.env.get("BROKER_CIRCUIT_BREAKER_ENABLED"),
    true,
  );
  const circuitBreakerWindowMinutes = parseInteger(
    Deno.env.get("BROKER_CIRCUIT_BREAKER_WINDOW_MINUTES"),
    30,
    5,
    24 * 60,
  );
  const circuitBreakerMinSample = parseInteger(
    Deno.env.get("BROKER_CIRCUIT_BREAKER_MIN_SAMPLE"),
    8,
    1,
    10_000,
  );
  const circuitBreakerMaxErrors = parseInteger(
    Deno.env.get("BROKER_CIRCUIT_BREAKER_MAX_ERRORS"),
    6,
    1,
    10_000,
  );
  const circuitBreakerMaxErrorRatePct = parseNumber(
    Deno.env.get("BROKER_CIRCUIT_BREAKER_MAX_ERROR_RATE_PCT"),
    70,
    1,
    100,
  );
  const envChaosMode = parseBoolean(Deno.env.get("BROKER_CHAOS_MODE"), false);
  const envChaosFailureRatePct = parseNumber(
    Deno.env.get("BROKER_CHAOS_FAILURE_RATE_PCT"),
    0,
    0,
    100,
  );

  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let ctraderRuntime: CTraderOpenApiRuntime | null = null;
  let ctraderWsActive = false;
  let runId: number | null = null;
  let lockName: string | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    const body = await parseBody(req);
    const url = new URL(req.url);

    const requestedProvider = normalizeProvider(
      String(body.provider ?? url.searchParams.get("provider") ?? ""),
      defaultProvider,
    );
    const forceExecution = parseBoolean(
      body.force ?? url.searchParams.get("force"),
      false,
    );
    const skipCircuitBreaker = parseBoolean(
      body.skip_circuit_breaker ?? url.searchParams.get("skip_circuit_breaker"),
      false,
    );
    const bypassCircuitBreaker = forceExecution || skipCircuitBreaker;
    const probeMode = parseBoolean(
      body.probe ?? url.searchParams.get("probe"),
      req.method === "GET",
    );
    const probeDeep = parseBoolean(
      body.probe_deep ?? url.searchParams.get("probe_deep"),
      false,
    );
    const chaosMode = parseBoolean(
      body.chaos_mode ?? url.searchParams.get("chaos_mode"),
      envChaosMode,
    );
    const chaosFailureRatePct = parseNumber(
      body.chaos_failure_rate_pct ?? url.searchParams.get("chaos_failure_rate_pct"),
      envChaosFailureRatePct,
      0,
      100,
    );
    const batchSize = parseInteger(
      body.limit ?? url.searchParams.get("limit"),
      batchSizeDefault,
      1,
      50,
    );

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "execute-broker-orders",
      traceId,
      payload: {
        requested_provider: requestedProvider,
        batch_size: batchSize,
        force_execution: forceExecution,
        skip_circuit_breaker: skipCircuitBreaker,
        probe_mode: probeMode,
        probe_deep: probeDeep,
        chaos_mode: chaosMode,
        chaos_failure_rate_pct: chaosFailureRatePct,
      },
    });

    const breakerProvider = requestedProvider === "paper" ? "all" : requestedProvider;

    if (probeMode) {
      const pendingCount = await countBrokerIntents({
        supabase,
        provider: breakerProvider,
        statuses: ["pending"],
      });
      const inflightCount = await countBrokerIntents({
        supabase,
        provider: breakerProvider,
        statuses: ["sent", "acknowledged"],
      });
      const recentFailuresCount = await countBrokerIntents({
        supabase,
        provider: breakerProvider,
        statuses: ["error", "rejected"],
        updatedSinceIso: new Date(Date.now() - 30 * 60_000).toISOString(),
      });

      const breaker = circuitBreakerEnabled
        ? await evaluateBrokerCircuitBreaker({
          supabase,
          provider: breakerProvider,
          windowMinutes: circuitBreakerWindowMinutes,
          minSample: circuitBreakerMinSample,
          maxErrors: circuitBreakerMaxErrors,
          maxErrorRatePct: circuitBreakerMaxErrorRatePct,
        })
        : null;

      let runtimeProbe: Record<string, unknown> | null = null;
      if (probeDeep && requestedProvider === "ctrader") {
        if (cTraderRuntimeConfigured()) {
          try {
            const runtime = await CTraderOpenApiRuntime.create({ supabase, traceId });
            runtimeProbe = { connected: true };
            runtime.close();
          } catch (runtimeError) {
            runtimeProbe = {
              connected: false,
              error: runtimeError instanceof Error ? runtimeError.message : String(runtimeError),
            };
          }
        } else {
          runtimeProbe = {
            connected: false,
            error: "cTrader runtime credentials are not configured",
          };
        }
      }

      const warnings: string[] = [];
      const runtimeConfigured = cTraderRuntimeConfigured();
      const bridgeConfigured = bridgeUrl.length > 0;
      const callbackConfigured = callbackUrl.length > 0 && callbackSecret.length > 0;
      const runtimeBridgeFallbackEnabled = cTraderBridgeFallbackEnabled();

      if (requestedProvider === "ctrader" && !runtimeConfigured && !bridgeConfigured) {
        warnings.push("Neither cTrader runtime credentials nor BROKER_BRIDGE_URL are configured.");
      }
      if (requestedProvider === "ctrader" && runtimeBridgeFallbackEnabled && !bridgeConfigured) {
        warnings.push(
          "CTRADER_RUNTIME_BRIDGE_FALLBACK is enabled but BROKER_BRIDGE_URL is empty, so fallback cannot run.",
        );
      }
      if (requestedProvider === "ctrader" && !callbackConfigured) {
        warnings.push("BROKER_CALLBACK_URL and callback secret are recommended for async broker updates.");
      }
      if (breaker?.open && bypassCircuitBreaker) {
        warnings.push("Circuit-breaker is open but bypass is requested.");
      }

      const probePayload = {
        trace_id: traceId,
        mode: "probe",
        provider: requestedProvider,
        provider_scope: breakerProvider,
        queue: {
          pending: pendingCount,
          inflight: inflightCount,
          recent_failures_30m: recentFailuresCount,
        },
        circuit_breaker_enabled: circuitBreakerEnabled,
        circuit_breaker: breaker,
        bypass_circuit_breaker: bypassCircuitBreaker,
        bridge_configured: bridgeConfigured,
        callback_configured: callbackConfigured,
        ctrader_runtime_configured: runtimeConfigured,
        ctrader_runtime_bridge_fallback: runtimeBridgeFallbackEnabled,
        deep_probe: runtimeProbe,
        warnings,
      };

      runStatus = warnings.length > 0 ? "partial" : "success";
      runPayload = probePayload;
      return jsonResponse(probePayload);
    }

    if (circuitBreakerEnabled) {
      const breaker = await evaluateBrokerCircuitBreaker({
        supabase,
        provider: breakerProvider,
        windowMinutes: circuitBreakerWindowMinutes,
        minSample: circuitBreakerMinSample,
        maxErrors: circuitBreakerMaxErrors,
        maxErrorRatePct: circuitBreakerMaxErrorRatePct,
      });

      if (breaker.open && !bypassCircuitBreaker) {
        runStatus = "partial";
        runPayload = {
          trace_id: traceId,
          provider: requestedProvider,
          breaker_provider: breakerProvider,
          reason: breaker.reason,
          breaker,
        };

        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_circuit_breaker_open",
          severity: "critical",
          message:
            `Execution halted by circuit-breaker for provider scope '${breakerProvider}'`,
          payload: runPayload,
        });

        await sendExecutionTelegram({
          enabled: brokerExecTelegramEnabled,
          botToken: brokerExecTelegramBotToken,
          chatId: brokerExecTelegramChatId,
          timeoutMs: brokerExecTelegramTimeoutMs,
          text: [
            "Broker CIRCUIT BREAKER OPEN",
            `Trace: ${traceId}`,
            `Provider scope: ${breakerProvider}`,
            `Window(min): ${breaker.window_minutes}`,
            `Errors: ${breaker.error_count} | Success: ${breaker.success_count}`,
            `Error rate: ${breaker.error_rate_pct}% | Sample: ${breaker.total_considered}`,
            "Execution paused. Use force=true only after manual verification.",
          ].join("\n"),
        });

        return jsonResponse(
          {
            error: "Execution paused by broker circuit-breaker",
            reason: breaker.reason,
            provider: requestedProvider,
            breaker_provider: breakerProvider,
            breaker,
            trace_id: traceId,
          },
          429,
        );
      }

      if (breaker.open && bypassCircuitBreaker) {
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_circuit_breaker_bypassed",
          severity: "warning",
          message: "Execution bypassed an open broker circuit-breaker",
          payload: {
            provider: requestedProvider,
            breaker_provider: breakerProvider,
            breaker,
            bypass_circuit_breaker: bypassCircuitBreaker,
            force_execution: forceExecution,
            skip_circuit_breaker: skipCircuitBreaker,
          },
        });

        await sendExecutionTelegram({
          enabled: brokerExecTelegramEnabled,
          botToken: brokerExecTelegramBotToken,
          chatId: brokerExecTelegramChatId,
          timeoutMs: brokerExecTelegramTimeoutMs,
          text: [
            "Broker CIRCUIT BREAKER BYPASSED",
            `Trace: ${traceId}`,
            `Provider scope: ${breakerProvider}`,
            `Force: ${forceExecution} | Skip: ${skipCircuitBreaker}`,
            `Errors: ${breaker.error_count} | Success: ${breaker.success_count}`,
            `Error rate: ${breaker.error_rate_pct}% | Sample: ${breaker.total_considered}`,
          ].join("\n"),
        });
      }
    }

    if (lockEnabled) {
      lockName = "execute-broker-orders";
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
            alertType: "broker_exec_lock_error_fail_open",
            severity: "warning",
            message: "acquire_pipeline_lock failed for execute-broker-orders; continuing",
            payload: {
              rpc_error: lockError.message,
              lock_fail_open: lockFailOpen,
            },
          });
        } else {
          throw new Error(`Failed acquiring execution lock: ${lockError.message}`);
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
          reason: "lock_not_acquired",
          lock_name: lockRow?.lock_name ?? lockName,
          lock_owner_trace_id: lockRow?.owner_trace_id ?? null,
          lock_expires_at: lockRow?.expires_at ?? null,
        };
        return jsonResponse(
          {
            error: "Broker execution lock is currently held",
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

    const { data: claimedRaw, error: claimError } = await supabase.rpc(
      "claim_broker_order_intents",
      {
        p_worker_trace_id: traceId,
        p_limit: batchSize,
        p_reclaim_sent_after_seconds: reclaimSentAfterSeconds,
      },
    );

    if (claimError) {
      throw new Error(`Failed claiming broker order intents: ${claimError.message}`);
    }

    const claimed = (claimedRaw ?? []) as ClaimedIntentRow[];
    if (claimed.length === 0) {
      runStatus = "success";
      runPayload = {
        trace_id: traceId,
        claimed: 0,
        processed: 0,
      };
      return jsonResponse({
        trace_id: traceId,
        claimed: 0,
        processed: 0,
        results: [],
      });
    }

    const results: Array<Record<string, unknown>> = [];
    let filled = 0;
    let acknowledged = 0;
    let pendingRetry = 0;
    let rejected = 0;
    let errored = 0;
    const providersToOpenSync = new Set<string>();
    const providersToFullSync = new Set<string>();

    for (const intent of claimed) {
      const resolvedProvider = normalizeProvider(intent.broker, requestedProvider);
      const effectiveProvider = resolvedProvider || requestedProvider;

      try {
        if (shouldInjectChaos({
          enabled: chaosMode,
          failureRatePct: chaosFailureRatePct,
          seed: `${traceId}:${intent.id}:pre_send`,
        })) {
          throw new Error(
            `Chaos failure injected before broker send (intent_id=${intent.id}, provider=${effectiveProvider})`,
          );
        }

        if (effectiveProvider === "ctrader" && !ctraderRuntime) {
          try {
            ctraderRuntime = await CTraderOpenApiRuntime.create({
              supabase,
              traceId,
            });
            ctraderWsActive = true;
            await sendExecutionTelegram({
              enabled: brokerExecTelegramEnabled,
              botToken: brokerExecTelegramBotToken,
              chatId: brokerExecTelegramChatId,
              timeoutMs: brokerExecTelegramTimeoutMs,
              text: [
                "Broker WS CONNECTED | cTrader",
                `Trace: ${traceId}`,
                `Provider: ctrader`,
              ].join("\n"),
            });
          } catch (runtimeError) {
            const runtimeErrorMessage = runtimeError instanceof Error
              ? runtimeError.message
              : String(runtimeError);
            await sendExecutionTelegram({
              enabled: brokerExecTelegramEnabled,
              botToken: brokerExecTelegramBotToken,
              chatId: brokerExecTelegramChatId,
              timeoutMs: brokerExecTelegramTimeoutMs,
              text: [
                "Broker WS ERROR | cTrader",
                `Trace: ${traceId}`,
                `Provider: ctrader`,
                `Error: ${compactText(runtimeErrorMessage)}`,
              ].join("\n"),
            });
            throw runtimeError;
          }
        }

        const outcome = await executeIntent({
          intent,
          provider: effectiveProvider,
          ctraderRuntime,
          bridgeUrl,
          bridgeToken,
          callbackUrl,
          callbackSecret,
          callbackHeaderName,
          timeoutMs: bridgeTimeoutMs,
          traceId,
        });

        let finalStatus = outcome.finalStatus;
        let nextRetrySeconds: number | null = null;

        if (finalStatus === "pending") {
          if (intent.attempt_count >= maxAttempts) {
            finalStatus = "error";
          } else {
            nextRetrySeconds = Math.min(
              retrySecondsBase * Math.max(1, intent.attempt_count),
              retrySecondsBase * 10,
            );
          }
        }

        await finalizeIntent({
          supabase,
          intentId: intent.id,
          status: finalStatus,
          brokerOrderId: outcome.brokerOrderId,
          responsePayload: {
            execution_trace_id: traceId,
            provider: outcome.provider,
            outcome: outcome.payload,
            message: outcome.message,
            http_status: outcome.httpStatus,
          },
          lastError: finalStatus === "pending" || finalStatus === "error" || finalStatus === "rejected"
            ? outcome.message
            : null,
          nextRetrySeconds,
        });

        await syncPositionBrokerRefs({
          supabase,
          signalId: intent.signal_id,
          provider: outcome.provider,
          brokerOrderId: outcome.brokerOrderId,
          brokerPositionId: outcome.brokerPositionId,
        });

        try {
          await syncSignalLifecycleFromExecution({
            supabase,
            signalId: intent.signal_id,
            finalStatus,
          });
        } catch {
          // Signal lifecycle sync is best-effort.
        }

        await writeSignalEvent({
          supabase,
          signalId: intent.signal_id,
          traceId,
          eventType: `broker_order_${finalStatus}`,
          reason: outcome.message.slice(0, 180),
          payload: {
            intent_id: intent.id,
            provider: outcome.provider,
            broker_order_id: outcome.brokerOrderId,
            broker_position_id: outcome.brokerPositionId,
            http_status: outcome.httpStatus,
          },
        });

        if (finalStatus === "filled" || finalStatus === "partially_filled") {
          filled += 1;
        } else if (finalStatus === "acknowledged") {
          acknowledged += 1;
        } else if (finalStatus === "pending") {
          pendingRetry += 1;
        } else if (finalStatus === "rejected") {
          rejected += 1;
        } else if (finalStatus === "error") {
          errored += 1;
        }

        await sendExecutionTelegram({
          enabled: brokerExecTelegramEnabled,
          botToken: brokerExecTelegramBotToken,
          chatId: brokerExecTelegramChatId,
          timeoutMs: brokerExecTelegramTimeoutMs,
          text: buildExecutionTelegramMessage({
            intent,
            provider: outcome.provider,
            status: finalStatus,
            brokerOrderId: outcome.brokerOrderId,
            brokerPositionId: outcome.brokerPositionId,
            message: outcome.message,
            traceId,
            retryInSeconds: nextRetrySeconds,
          }),
        });

        if (
          outcome.provider !== "paper" &&
          ["filled", "partially_filled", "cancelled", "rejected", "error"].includes(finalStatus)
        ) {
          providersToFullSync.add(outcome.provider);
        } else if (
          outcome.provider !== "paper" &&
          ["acknowledged", "pending"].includes(finalStatus)
        ) {
          providersToOpenSync.add(outcome.provider);
        }

        results.push({
          intent_id: intent.id,
          signal_id: intent.signal_id,
          symbol: intent.symbol,
          provider: outcome.provider,
          attempt_count: intent.attempt_count,
          final_status: finalStatus,
          broker_order_id: outcome.brokerOrderId,
          broker_position_id: outcome.brokerPositionId,
          retryable: outcome.retryable,
          retry_in_seconds: nextRetrySeconds,
          message: outcome.message,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const maxReached = intent.attempt_count >= maxAttempts;
        const fallbackStatus: IntentStatus = maxReached ? "error" : "pending";
        const retryInSeconds = maxReached
          ? null
          : Math.min(retrySecondsBase * Math.max(1, intent.attempt_count), retrySecondsBase * 10);

        try {
          await finalizeIntent({
            supabase,
            intentId: intent.id,
            status: fallbackStatus,
            brokerOrderId: null,
            responsePayload: {
              execution_trace_id: traceId,
              provider: effectiveProvider,
              fallback_error: errorMessage,
            },
            lastError: errorMessage,
            nextRetrySeconds: retryInSeconds,
          });
        } catch (finalizeError) {
          const finalizeMessage = finalizeError instanceof Error
            ? finalizeError.message
            : String(finalizeError);
          await insertOpsAlert({
            supabase,
            traceId,
            alertType: "broker_execution_finalize_failed",
            severity: "error",
            message: `Failed finalizing broker intent ${intent.id}`,
            payload: {
              intent_id: intent.id,
              execution_error: errorMessage,
              finalize_error: finalizeMessage,
            },
          });
        }

        if (fallbackStatus === "pending") {
          pendingRetry += 1;
        } else {
          errored += 1;
        }

        if (effectiveProvider !== "paper" && fallbackStatus === "error") {
          providersToFullSync.add(effectiveProvider);
        } else if (effectiveProvider !== "paper" && fallbackStatus === "pending") {
          providersToOpenSync.add(effectiveProvider);
        }

        await sendExecutionTelegram({
          enabled: brokerExecTelegramEnabled,
          botToken: brokerExecTelegramBotToken,
          chatId: brokerExecTelegramChatId,
          timeoutMs: brokerExecTelegramTimeoutMs,
          text: buildExecutionTelegramMessage({
            intent,
            provider: effectiveProvider,
            status: fallbackStatus,
            brokerOrderId: null,
            brokerPositionId: null,
            message: errorMessage,
            traceId,
            retryInSeconds: retryInSeconds,
          }),
        });

        results.push({
          intent_id: intent.id,
          signal_id: intent.signal_id,
          symbol: intent.symbol,
          provider: effectiveProvider,
          attempt_count: intent.attempt_count,
          final_status: fallbackStatus,
          retry_in_seconds: retryInSeconds,
          error: errorMessage,
        });
      }
    }

    for (const provider of providersToFullSync) {
      try {
        await dispatchBrokerPositionSyncNow({
          provider,
          traceId,
          timeoutMs: bridgeTimeoutMs,
          onlyOpen: false,
        });
      } catch (syncError) {
        const syncMessage = syncError instanceof Error ? syncError.message : String(syncError);
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_post_execution_sync_failed",
          severity: "warning",
          message: `Post-execution broker position sync failed for provider '${provider}'`,
          payload: {
            provider,
            only_open: false,
            error: syncMessage,
          },
        });
      }
    }

    for (const provider of providersToOpenSync) {
      if (providersToFullSync.has(provider)) continue;
      try {
        await dispatchBrokerPositionSyncNow({
          provider,
          traceId,
          timeoutMs: bridgeTimeoutMs,
          onlyOpen: true,
        });
      } catch (syncError) {
        const syncMessage = syncError instanceof Error ? syncError.message : String(syncError);
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_post_execution_sync_failed",
          severity: "warning",
          message: `Post-execution broker open-position sync failed for provider '${provider}'`,
          payload: {
            provider,
            only_open: true,
            error: syncMessage,
          },
        });
      }
    }

    const responsePayload = {
      trace_id: traceId,
      claimed: claimed.length,
      processed: results.length,
      provider: requestedProvider,
      chaos_mode: chaosMode,
      chaos_failure_rate_pct: chaosFailureRatePct,
      providers_post_sync: {
        full: [...providersToFullSync],
        only_open: [...providersToOpenSync].filter((provider) => !providersToFullSync.has(provider)),
      },
      counts: {
        filled,
        acknowledged,
        pending_retry: pendingRetry,
        rejected,
        errored,
      },
      results,
    };

    runStatus = rejected > 0 || errored > 0 ? "partial" : "success";
    runPayload = responsePayload;
    return jsonResponse(responsePayload);
  } catch (error) {
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
    };

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      },
      500,
    );
  } finally {
    if (runStatus === "failed") {
      const runPayloadError = runPayload["error"];
      const message = runPayloadError
        ? String(runPayloadError)
        : "execute-broker-orders failed";
      await sendExecutionTelegram({
        enabled: brokerExecTelegramEnabled,
        botToken: brokerExecTelegramBotToken,
        chatId: brokerExecTelegramChatId,
        timeoutMs: brokerExecTelegramTimeoutMs,
        text: [
          "Broker Worker FAILED",
          `Trace: ${traceId}`,
          `Error: ${compactText(message)}`,
        ].join("\n"),
      });
    }

    if (ctraderRuntime) {
      ctraderRuntime.close();
      if (ctraderWsActive) {
        await sendExecutionTelegram({
          enabled: brokerExecTelegramEnabled,
          botToken: brokerExecTelegramBotToken,
          chatId: brokerExecTelegramChatId,
          timeoutMs: brokerExecTelegramTimeoutMs,
          text: [
            "Broker WS CLOSED | cTrader",
            `Trace: ${traceId}`,
            "Provider: ctrader",
          ].join("\n"),
        });
      }
    }

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
