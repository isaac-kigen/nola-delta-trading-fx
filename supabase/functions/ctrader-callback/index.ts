import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { enforceSecretAuth } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";

type IntentStatus =
  | "pending"
  | "sent"
  | "acknowledged"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "error";

type PositionStatus = "open" | "closed" | "cancelled";

interface BrokerIntentRow {
  id: number;
  signal_id: number | null;
  symbol: string;
  direction: "long" | "short";
  status: IntentStatus;
  broker_order_id: string | null;
  broker: string;
}

interface PositionSnapshot {
  broker_position_id: string;
  symbol: string;
  direction: "long" | "short";
  quantity: number | null;
  avg_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: PositionStatus;
  payload: Record<string, unknown>;
}

function parseBodyFromText(bodyText: string): Record<string, unknown> {
  if (!bodyText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw_text: bodyText };
  }
}

function normalizeProvider(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "ctrader";
  if (["pepperstone", "pepperstone_ctrader", "ctrader"].includes(value)) {
    return "ctrader";
  }
  return value;
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

function parseInteger(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseDirection(value: unknown): "long" | "short" | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (["long", "buy", "b", "1"].includes(v)) return "long";
  if (["short", "sell", "s", "-1"].includes(v)) return "short";
  return null;
}

function parseIntentStatus(value: unknown, fallback: IntentStatus = "acknowledged"): IntentStatus {
  const v = String(value ?? "").trim().toLowerCase();

  if (["pending", "queued", "waiting", "new"].includes(v)) return "pending";
  if (["sent", "submitted"].includes(v)) return "sent";
  if (["ack", "acknowledged", "accepted", "placed", "open"].includes(v)) return "acknowledged";
  if (["partially_filled", "partial_fill", "partial", "partfill"].includes(v)) return "partially_filled";
  if (["filled", "fill", "executed", "done"].includes(v)) return "filled";
  if (["cancelled", "canceled", "expired"].includes(v)) return "cancelled";
  if (["rejected", "reject", "denied"].includes(v)) return "rejected";
  if (["error", "failed", "failure"].includes(v)) return "error";

  return fallback;
}

function parsePositionStatus(value: unknown, fallback: PositionStatus = "open"): PositionStatus {
  const v = String(value ?? "").trim().toLowerCase();
  if (["open", "opened", "active"].includes(v)) return "open";
  if (["closed", "filled", "complete", "completed"].includes(v)) return "closed";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  return fallback;
}

function parseIntentIdCandidate(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  const match = text.match(/broker-intent-(\d+)/i) ?? text.match(/intent[-_: ](\d+)/i);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function extractEventId(payload: Record<string, unknown>, bodyText: string): Promise<string> {
  const directCandidates = [
    payload.event_id,
    payload.callback_id,
    payload.id,
    payload.execution_id,
    payload.message_id,
  ];

  for (const candidate of directCandidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return Promise.resolve(value);
    }
  }

  const orderObj = toObject(payload.order);
  const brokerOrderId = String(
    payload.broker_order_id ??
      payload.order_id ??
      orderObj.broker_order_id ??
      orderObj.order_id ??
      orderObj.id ??
      "",
  ).trim();

  const status = String(
    payload.status ??
      payload.order_status ??
      orderObj.status ??
      "",
  ).trim().toLowerCase();

  const eventTime = String(
    payload.event_time ??
      payload.timestamp ??
      payload.updated_at ??
      payload.time ??
      "",
  ).trim();

  if (brokerOrderId || status || eventTime) {
    return Promise.resolve(
      `derived:${brokerOrderId || "none"}:${status || "none"}:${eventTime || "none"}`,
    );
  }

  return sha256Hex(bodyText || JSON.stringify(payload));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function extractIntentId(payload: Record<string, unknown>): number | null {
  const orderObj = toObject(payload.order);
  const intentObj = toObject(payload.intent);

  const candidates: unknown[] = [
    payload.intent_id,
    intentObj.id,
    payload.client_order_id,
    payload.clientOrderId,
    payload.clientOrderLabel,
    orderObj.client_order_id,
    orderObj.clientOrderId,
    orderObj.client_order_label,
    orderObj.label,
  ];

  for (const candidate of candidates) {
    const id = parseIntentIdCandidate(candidate);
    if (id !== null) {
      return id;
    }
  }

  return null;
}

function extractSignalId(payload: Record<string, unknown>): number | null {
  const intentObj = toObject(payload.intent);
  const candidates: unknown[] = [
    payload.signal_id,
    intentObj.signal_id,
  ];

  for (const candidate of candidates) {
    const id = parseIntentIdCandidate(candidate);
    if (id !== null) {
      return id;
    }
  }

  return null;
}

function extractBrokerOrderId(payload: Record<string, unknown>): string | null {
  const orderObj = toObject(payload.order);
  const executionObj = toObject(payload.execution);

  const candidates: unknown[] = [
    payload.broker_order_id,
    payload.order_id,
    payload.orderId,
    orderObj.broker_order_id,
    orderObj.order_id,
    orderObj.id,
    executionObj.order_id,
    executionObj.id,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value.length > 0) {
      return value;
    }
  }

  return null;
}

function extractBrokerPositionId(payload: Record<string, unknown>): string | null {
  const positionObj = toObject(payload.position);
  const executionObj = toObject(payload.execution);
  const orderObj = toObject(payload.order);

  const candidates: unknown[] = [
    payload.broker_position_id,
    payload.position_id,
    payload.positionId,
    positionObj.broker_position_id,
    positionObj.position_id,
    positionObj.id,
    executionObj.position_id,
    executionObj.positionId,
    orderObj.position_id,
    orderObj.positionId,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value.length > 0) {
      return value;
    }
  }

  return null;
}

function extractStatus(payload: Record<string, unknown>, fallback: IntentStatus): IntentStatus {
  const orderObj = toObject(payload.order);
  const executionObj = toObject(payload.execution);

  return parseIntentStatus(
    payload.status ??
      payload.order_status ??
      payload.execution_status ??
      executionObj.status ??
      orderObj.status,
    fallback,
  );
}

function extractPositionSnapshot(params: {
  payload: Record<string, unknown>;
  brokerOrderId: string | null;
  fallbackSymbol: string | null;
  fallbackDirection: "long" | "short" | null;
  fallbackStatus: IntentStatus;
}): PositionSnapshot | null {
  const payload = params.payload;
  const positionObj = toObject(payload.position);
  const executionObj = toObject(payload.execution);
  const orderObj = toObject(payload.order);

  const brokerPositionId = String(
    positionObj.broker_position_id ??
      positionObj.position_id ??
      positionObj.id ??
      executionObj.position_id ??
      payload.position_id ??
      params.brokerOrderId ??
      "",
  ).trim();

  const symbol = String(
    positionObj.symbol ??
      payload.symbol ??
      orderObj.symbol ??
      params.fallbackSymbol ??
      "",
  ).trim().toUpperCase();

  const direction = parseDirection(
    positionObj.direction ??
      positionObj.side ??
      payload.direction ??
      payload.side ??
      orderObj.direction ??
      orderObj.side ??
      params.fallbackDirection,
  );

  if (!brokerPositionId || !symbol || !direction) {
    return null;
  }

  const fallbackPositionStatus: PositionStatus =
    params.fallbackStatus === "cancelled" || params.fallbackStatus === "rejected" ||
      params.fallbackStatus === "error"
      ? "cancelled"
      : "open";

  const status = parsePositionStatus(
    positionObj.status ?? payload.position_status,
    fallbackPositionStatus,
  );

  return {
    broker_position_id: brokerPositionId,
    symbol,
    direction,
    quantity: toFiniteNumber(
      positionObj.quantity ?? positionObj.size ?? positionObj.volume ?? payload.quantity,
    ),
    avg_price: toFiniteNumber(
      positionObj.avg_price ?? positionObj.entry_price ?? positionObj.price ?? payload.price,
    ),
    stop_loss: toFiniteNumber(positionObj.stop_loss ?? payload.stop_loss),
    take_profit: toFiniteNumber(positionObj.take_profit ?? payload.take_profit),
    status,
    payload: positionObj,
  };
}

async function loadIntent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  intentId: number | null;
  brokerOrderId: string | null;
  signalId: number | null;
}): Promise<BrokerIntentRow | null> {
  if (params.intentId !== null) {
    const { data, error } = await params.supabase
      .from("broker_order_intents")
      .select("id,signal_id,symbol,direction,status,broker_order_id,broker")
      .eq("id", params.intentId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed loading broker intent by id: ${error.message}`);
    }

    if (data) {
      return data as BrokerIntentRow;
    }
  }

  if (params.brokerOrderId) {
    const { data, error } = await params.supabase
      .from("broker_order_intents")
      .select("id,signal_id,symbol,direction,status,broker_order_id,broker")
      .eq("broker_order_id", params.brokerOrderId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed loading broker intent by broker_order_id: ${error.message}`);
    }

    if (data) {
      return data as BrokerIntentRow;
    }
  }

  if (params.signalId !== null) {
    const { data, error } = await params.supabase
      .from("broker_order_intents")
      .select("id,signal_id,symbol,direction,status,broker_order_id,broker")
      .eq("signal_id", params.signalId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed loading broker intent by signal_id: ${error.message}`);
    }

    if (data) {
      return data as BrokerIntentRow;
    }
  }

  return null;
}

async function insertSignalEvent(params: {
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

async function updateSignalStateFromBrokerStatus(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  signalId: number | null;
  status: IntentStatus;
}): Promise<void> {
  if (params.signalId === null) return;
  const nowIso = new Date().toISOString();

  if (params.status === "filled" || params.status === "partially_filled") {
    await params.supabase
      .from("trading_signals")
      .update({
        signal_state: "executed",
        updated_at: nowIso,
        last_evaluated_at: nowIso,
      })
      .eq("id", params.signalId)
      .in("signal_state", ["pending", "active", "triggered"]);
    return;
  }

  if (params.status === "rejected" || params.status === "cancelled" || params.status === "error") {
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

  if (req.method === "GET") {
    return jsonResponse({ ok: true, function: "ctrader-callback" });
  }

  const callbackHeaderName = (Deno.env.get("BROKER_CALLBACK_HEADER_NAME") ?? "")
    .trim()
    .toLowerCase();
  const authError = enforceSecretAuth({
    req,
    secretEnvNames: ["CTRADER_CALLBACK_SECRET", "BROKER_CALLBACK_SECRET"],
    includeServiceRoleKey: false,
    extraHeaderNames: callbackHeaderName ? [callbackHeaderName] : [],
    requireAuthEnvName: "REQUIRE_CALLBACK_AUTH",
    requireAuthByDefault: true,
    scope: "ctrader-callback",
  });
  if (authError) return authError;

  const traceId = `ctrader-callback-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();

  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;
  let callbackEventId: number | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    const bodyText = await req.text();
    const payload = parseBodyFromText(bodyText);
    const provider = normalizeProvider(payload.provider ?? payload.broker ?? "ctrader");
    const eventId = await extractEventId(payload, bodyText);

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "ctrader-callback",
      traceId,
      payload: {
        provider,
        event_id: eventId,
      },
    });

    const initialSignalId = extractSignalId(payload);
    const initialIntentId = extractIntentId(payload);
    const initialBrokerOrderId = extractBrokerOrderId(payload);
    const initialBrokerPositionId = extractBrokerPositionId(payload);

    const { data: insertedEvent, error: eventInsertError } = await supabase
      .from("broker_callback_events")
      .insert({
        provider,
        event_id: eventId,
        trace_id: traceId,
        intent_id: initialIntentId,
        signal_id: initialSignalId,
        broker_order_id: initialBrokerOrderId,
        broker_position_id: initialBrokerPositionId,
        processing_status: "received",
        payload,
      })
      .select("id")
      .maybeSingle();

    if (eventInsertError) {
      if (eventInsertError.code === "23505") {
        runStatus = "success";
        runPayload = {
          trace_id: traceId,
          provider,
          event_id: eventId,
          duplicate: true,
        };
        return jsonResponse(runPayload);
      }
      throw new Error(`Failed writing callback event: ${eventInsertError.message}`);
    }

    callbackEventId = insertedEvent?.id ? Number(insertedEvent.id) : null;

    const resolvedIntent = await loadIntent({
      supabase,
      intentId: initialIntentId,
      brokerOrderId: initialBrokerOrderId,
      signalId: initialSignalId,
    });

    const intentId = resolvedIntent?.id ?? initialIntentId;
    const signalId = resolvedIntent?.signal_id ?? initialSignalId;
    const brokerOrderId = initialBrokerOrderId ?? resolvedIntent?.broker_order_id ?? null;
    const status = extractStatus(payload, resolvedIntent?.status ?? "acknowledged");
    const callbackRetrySeconds = parseInteger(
      Deno.env.get("BROKER_CALLBACK_PENDING_RETRY_SECONDS"),
      90,
      30,
      3600,
    );
    const snapshot = extractPositionSnapshot({
      payload,
      brokerOrderId,
      fallbackSymbol: resolvedIntent?.symbol ?? null,
      fallbackDirection: resolvedIntent?.direction ?? null,
      fallbackStatus: status,
    });

    if (resolvedIntent) {
      const statusForFinalize = status;
      const nextRetrySeconds = statusForFinalize === "pending" ? callbackRetrySeconds : null;

      const { error: finalizeError } = await supabase.rpc("finalize_broker_order_intent", {
        p_intent_id: resolvedIntent.id,
        p_status: statusForFinalize,
        p_broker_order_id: brokerOrderId,
        p_response_payload: {
          callback_trace_id: traceId,
          callback_provider: provider,
          callback_event_id: eventId,
          callback_received_at: new Date().toISOString(),
          callback_payload: payload,
        },
        p_last_error: statusForFinalize === "error" || statusForFinalize === "rejected"
          ? String(payload.error ?? payload.message ?? "broker callback reported failure")
          : null,
        p_next_retry_seconds: nextRetrySeconds,
      });

      if (finalizeError) {
        throw new Error(`Failed finalizing callback intent ${resolvedIntent.id}: ${finalizeError.message}`);
      }
    }

    if (signalId !== null || brokerOrderId !== null || snapshot?.broker_position_id) {
      const nowIso = new Date().toISOString();
      const positionPatch: Record<string, unknown> = {
        broker: provider,
        updated_at: nowIso,
      };
      if (brokerOrderId) {
        positionPatch.broker_order_id = brokerOrderId;
      }
      if (snapshot?.broker_position_id) {
        positionPatch.broker_position_id = snapshot.broker_position_id;
      }

      if (["rejected", "error", "cancelled"].includes(status)) {
        positionPatch.status = "cancelled";
        positionPatch.closed_at = nowIso;
        positionPatch.close_reason = `broker_callback_${status}`;
        positionPatch.open_size_units = 0;
      }

      let positionUpdate = supabase
        .from("trading_positions")
        .update(positionPatch)
        .eq("status", "open");

      if (signalId !== null) {
        positionUpdate = positionUpdate.eq("signal_id", signalId);
      } else if (snapshot?.broker_position_id) {
        positionUpdate = positionUpdate.eq("broker_position_id", snapshot.broker_position_id);
      } else if (brokerOrderId) {
        positionUpdate = positionUpdate.eq("broker_order_id", brokerOrderId);
      }

      const { error: positionError } = await positionUpdate;
      if (positionError) {
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "ctrader_callback_position_update_failed",
          severity: "warning",
          message: "Failed applying trading_positions update from callback",
          payload: {
            signal_id: signalId,
            broker_order_id: brokerOrderId,
            broker_position_id: snapshot?.broker_position_id ?? null,
            status,
            error: positionError.message,
          },
        });
      }
    }

    if (snapshot) {
      const { error: snapshotError } = await supabase
        .from("broker_position_sync_snapshots")
        .insert({
          trace_id: traceId,
          broker: provider,
          broker_position_id: snapshot.broker_position_id,
          symbol: snapshot.symbol,
          direction: snapshot.direction,
          quantity: snapshot.quantity,
          avg_price: snapshot.avg_price,
          stop_loss: snapshot.stop_loss,
          take_profit: snapshot.take_profit,
          status: snapshot.status,
          payload: snapshot.payload,
        });

      if (snapshotError) {
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "ctrader_callback_snapshot_insert_failed",
          severity: "warning",
          message: "Failed inserting broker position snapshot from callback",
          payload: {
            broker_position_id: snapshot.broker_position_id,
            error: snapshotError.message,
          },
        });
      }

      if (snapshot.status !== "open") {
        const nowIso = new Date().toISOString();
        const closePatch: Record<string, unknown> = {
          status: snapshot.status === "cancelled" ? "cancelled" : "closed",
          closed_at: nowIso,
          close_reason: `broker_callback_position_${snapshot.status}`,
          open_size_units: 0,
          updated_at: nowIso,
        };

        if (brokerOrderId) {
          closePatch.broker_order_id = brokerOrderId;
        }
        closePatch.broker_position_id = snapshot.broker_position_id;

        let closeQuery = supabase
          .from("trading_positions")
          .update(closePatch)
          .eq("status", "open")
          .eq("broker", provider);

        if (signalId !== null) {
          closeQuery = closeQuery.eq("signal_id", signalId);
        } else if (snapshot.broker_position_id) {
          closeQuery = closeQuery.eq("broker_position_id", snapshot.broker_position_id);
        } else if (brokerOrderId) {
          closeQuery = closeQuery.eq("broker_order_id", brokerOrderId);
        }

        await closeQuery;
      }
    }

    await updateSignalStateFromBrokerStatus({
      supabase,
      signalId,
      status,
    });

    await insertSignalEvent({
      supabase,
      signalId,
      traceId,
      eventType: `broker_callback_${status}`,
      reason: `provider:${provider} event:${eventId}`,
      payload: {
        provider,
        event_id: eventId,
        intent_id: intentId,
        broker_order_id: brokerOrderId,
        broker_position_id: snapshot?.broker_position_id ?? null,
      },
    });

    if (callbackEventId !== null) {
      await supabase
        .from("broker_callback_events")
        .update({
          processing_status: resolvedIntent || snapshot ? "processed" : "ignored",
          intent_id: intentId,
          signal_id: signalId,
          broker_order_id: brokerOrderId,
          broker_position_id: snapshot?.broker_position_id ?? initialBrokerPositionId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", callbackEventId);
    }

    const responsePayload = {
      trace_id: traceId,
      provider,
      event_id: eventId,
      callback_event_row_id: callbackEventId,
      intent_id: intentId,
      signal_id: signalId,
      broker_order_id: brokerOrderId,
      broker_position_id: snapshot?.broker_position_id ?? null,
      status,
      matched_intent: Boolean(resolvedIntent),
      snapshot_saved: Boolean(snapshot),
    };

    runStatus = "success";
    runPayload = responsePayload;
    return jsonResponse(responsePayload);
  } catch (error) {
    runStatus = "failed";
    const errorMessage = error instanceof Error ? error.message : String(error);
    runPayload = {
      trace_id: traceId,
      error: errorMessage,
      callback_event_row_id: callbackEventId,
    };

    if (supabase && callbackEventId !== null) {
      try {
        await supabase
          .from("broker_callback_events")
          .update({
            processing_status: "error",
            error: errorMessage,
            processed_at: new Date().toISOString(),
          })
          .eq("id", callbackEventId);
      } catch {
        // Event error update is best-effort.
      }
    }

    if (supabase) {
      await insertOpsAlert({
        supabase,
        traceId,
        alertType: "ctrader_callback_failed",
        severity: "error",
        message: "cTrader callback processing failed",
        payload: {
          error: errorMessage,
          callback_event_row_id: callbackEventId,
        },
      });
    }

    return jsonResponse({ error: errorMessage, trace_id: traceId }, 500);
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
