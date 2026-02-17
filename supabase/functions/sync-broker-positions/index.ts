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

interface SyncPositionsRequest {
  provider?: string;
  limit?: number | string;
  only_open?: boolean | string;
}

type PositionStatus = "open" | "closed" | "cancelled";

interface BrokerPositionSnapshotInput {
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

function parseBody(req: Request): Promise<SyncPositionsRequest> {
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeProvider(raw: string | null | undefined, fallback: string): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["pepperstone", "pepperstone_ctrader", "ctrader"].includes(normalized)) {
    return "ctrader";
  }
  return normalized;
}

function normalizeDirection(raw: unknown): "long" | "short" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["long", "buy", "b", "1"].includes(value)) return "long";
  if (["short", "sell", "s", "-1"].includes(value)) return "short";
  return null;
}

function normalizePositionStatus(raw: unknown): PositionStatus {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["open", "opened", "active"].includes(value)) return "open";
  if (["closed", "filled", "complete", "completed"].includes(value)) return "closed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  return "open";
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isMissingLockRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("acquire_pipeline_lock") &&
    (m.includes("could not find the function") || m.includes("does not exist"));
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

function parseBridgePositions(payload: unknown): BrokerPositionSnapshotInput[] {
  const obj = toObject(payload);
  const rows = Array.isArray(obj.positions)
    ? obj.positions
    : Array.isArray(payload)
    ? payload
    : [];

  const snapshots: BrokerPositionSnapshotInput[] = [];
  for (const row of rows) {
    const item = toObject(row);
    const brokerPositionIdRaw = item.broker_position_id ?? item.position_id ?? item.id;
    const brokerPositionId = String(brokerPositionIdRaw ?? "").trim();
    const symbol = String(item.symbol ?? "").trim().toUpperCase();
    const direction = normalizeDirection(item.direction ?? item.side);

    if (!brokerPositionId || !symbol || !direction) {
      continue;
    }

    snapshots.push({
      broker_position_id: brokerPositionId,
      symbol,
      direction,
      quantity: toFiniteNumber(item.quantity ?? item.size ?? item.volume),
      avg_price: toFiniteNumber(item.avg_price ?? item.entry_price ?? item.price),
      stop_loss: toFiniteNumber(item.stop_loss),
      take_profit: toFiniteNumber(item.take_profit),
      status: normalizePositionStatus(item.status),
      payload: item,
    });
  }

  return snapshots;
}

async function loadPaperSnapshots(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  limit: number;
  onlyOpen: boolean;
}): Promise<BrokerPositionSnapshotInput[]> {
  let query = params.supabase
    .from("trading_positions")
    .select(
      "signal_id,symbol,direction,status,open_size_units,entry_price,current_stop_loss,tp3,broker,broker_order_id,broker_position_id,execution_payload,updated_at,opened_at,closed_at",
    )
    .order("updated_at", { ascending: false })
    .limit(params.limit);

  if (params.onlyOpen) {
    query = query.eq("status", "open");
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed loading paper positions: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const positionId = row.broker_position_id
      ? String(row.broker_position_id)
      : row.broker_order_id
      ? String(row.broker_order_id)
      : `signal-${row.signal_id}`;

    return {
      broker_position_id: positionId,
      symbol: String(row.symbol ?? "").toUpperCase(),
      direction: String(row.direction) === "short" ? "short" : "long",
      quantity: toFiniteNumber(row.open_size_units),
      avg_price: toFiniteNumber(row.entry_price),
      stop_loss: toFiniteNumber(row.current_stop_loss),
      take_profit: toFiniteNumber(row.tp3),
      status: normalizePositionStatus(row.status),
      payload: {
        source: "paper_local_state",
        signal_id: row.signal_id,
        updated_at: row.updated_at,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        execution_payload: row.execution_payload,
      },
    } as BrokerPositionSnapshotInput;
  });
}

async function loadBridgeSnapshots(params: {
  provider: string;
  bridgeUrl: string;
  bridgeToken: string;
  timeoutMs: number;
  traceId: string;
  onlyOpen: boolean;
  limit: number;
}): Promise<BrokerPositionSnapshotInput[]> {
  if (!params.bridgeUrl) {
    throw new Error(
      `BROKER_POSITIONS_SYNC_URL (or BROKER_BRIDGE_URL) is required for provider '${params.provider}'.`,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-trace-id": params.traceId,
  };
  if (params.bridgeToken.trim().length > 0) {
    headers.Authorization = `Bearer ${params.bridgeToken.trim()}`;
  }

  const response = await fetchJsonWithTimeout({
    url: params.bridgeUrl,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "list_positions",
        provider: params.provider,
        only_open: params.onlyOpen,
        limit: params.limit,
      }),
    },
    timeoutMs: params.timeoutMs,
  });

  if (!response.ok) {
    const bodyText = response.text.length > 280 ? `${response.text.slice(0, 280)}...` : response.text;
    throw new Error(`Bridge position sync failed (${response.status}): ${bodyText}`);
  }

  return parseBridgePositions(response.json);
}

async function reconcileSignalStates(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  signalIds: number[];
  nextState: "executed" | "cancelled";
  snapshotTime: string;
}): Promise<void> {
  if (params.signalIds.length === 0) return;
  try {
    await params.supabase
      .from("trading_signals")
      .update({
        signal_state: params.nextState,
        updated_at: params.snapshotTime,
        last_evaluated_at: params.snapshotTime,
      })
      .in("id", params.signalIds)
      .neq("signal_state", params.nextState);
  } catch {
    // Signal reconciliation is best-effort.
  }
}

async function reconcilePositionsByRefs(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  provider: string;
  refs: string[];
  snapshotTime: string;
  finalStatus: "closed" | "cancelled";
  closeReason: string;
}): Promise<number> {
  const uniqueRefs = [...new Set(params.refs.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0))];
  if (uniqueRefs.length === 0) return 0;

  const patch = {
    status: params.finalStatus,
    closed_at: params.snapshotTime,
    close_reason: params.closeReason,
    open_size_units: 0,
    updated_at: params.snapshotTime,
  };

  let total = 0;
  const signalIds = new Set<number>();

  const updateByField = async (field: "broker_position_id" | "broker_order_id"): Promise<void> => {
    const { data, error } = await params.supabase
      .from("trading_positions")
      .update(patch)
      .eq("status", "open")
      .eq("broker", params.provider)
      .in(field, uniqueRefs)
      .select("id,signal_id");

    if (error) {
      throw new Error(`Failed reconciling positions by ${field}: ${error.message}`);
    }

    total += data?.length ?? 0;
    for (const row of data ?? []) {
      if (row.signal_id !== null && row.signal_id !== undefined) {
        signalIds.add(Number(row.signal_id));
      }
    }
  };

  await updateByField("broker_position_id");
  await updateByField("broker_order_id");

  await reconcileSignalStates({
    supabase: params.supabase,
    signalIds: [...signalIds],
    nextState: params.finalStatus === "closed" ? "executed" : "cancelled",
    snapshotTime: params.snapshotTime,
  });

  return total;
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
    secretEnvNames: ["BROKER_SYNC_CRON_SECRET", "EXECUTE_CRON_SECRET"],
    scope: "sync-broker-positions",
  });
  if (authError) return authError;

  const traceId = `broker-sync-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  const defaultProvider = normalizeProvider(Deno.env.get("BROKER_EXECUTION_PROVIDER"), "paper");
  const defaultBatchSize = parseInteger(
    Deno.env.get("BROKER_POSITIONS_SYNC_BATCH_SIZE"),
    150,
    1,
    1000,
  );
  const syncTimeoutMs = parseInteger(
    Deno.env.get("BROKER_POSITIONS_SYNC_TIMEOUT_MS"),
    15_000,
    1_000,
    120_000,
  );
  const lockEnabled = parseBoolean(Deno.env.get("LOCK_ENABLED"), true);
  const lockFailOpen = parseBoolean(Deno.env.get("LOCK_FAIL_OPEN"), false);
  const lockTtlSeconds = parseInteger(
    Deno.env.get("BROKER_SYNC_LOCK_TTL_SECONDS"),
    90,
    30,
    3600,
  );

  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let ctraderRuntime: CTraderOpenApiRuntime | null = null;
  let runId: number | null = null;
  let lockName: string | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    const body = await parseBody(req);
    const url = new URL(req.url);

    const provider = normalizeProvider(
      String(body.provider ?? url.searchParams.get("provider") ?? ""),
      defaultProvider,
    );
    const onlyOpen = parseBoolean(
      body.only_open ?? url.searchParams.get("only_open"),
      true,
    );
    const limit = parseInteger(
      body.limit ?? url.searchParams.get("limit"),
      defaultBatchSize,
      1,
      1000,
    );

    const bridgeUrl = Deno.env.get("BROKER_POSITIONS_SYNC_URL")?.trim() ||
      Deno.env.get("BROKER_BRIDGE_URL")?.trim() || "";
    const bridgeToken = Deno.env.get("BROKER_POSITIONS_SYNC_TOKEN")?.trim() ||
      Deno.env.get("BROKER_BRIDGE_TOKEN")?.trim() || "";

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "sync-broker-positions",
      traceId,
      payload: {
        provider,
        only_open: onlyOpen,
        limit,
      },
    });

    if (lockEnabled) {
      lockName = `sync-broker-positions:${provider}`;
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
            alertType: "broker_sync_lock_error_fail_open",
            severity: "warning",
            message: "acquire_pipeline_lock failed for sync-broker-positions; continuing",
            payload: {
              rpc_error: lockError.message,
              lock_fail_open: lockFailOpen,
            },
          });
        } else {
          throw new Error(`Failed acquiring broker sync lock: ${lockError.message}`);
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
            error: "Broker position sync lock is currently held",
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

    let snapshots: BrokerPositionSnapshotInput[] = [];
    if (provider === "paper") {
      snapshots = await loadPaperSnapshots({
        supabase,
        limit,
        onlyOpen,
      });
    } else if (provider === "ctrader") {
      ctraderRuntime = await CTraderOpenApiRuntime.create({
        supabase,
        traceId,
      });
      snapshots = await ctraderRuntime.listPositions({
        onlyOpen,
        limit,
      });
    } else {
      snapshots = await loadBridgeSnapshots({
        provider,
        bridgeUrl,
        bridgeToken,
        timeoutMs: syncTimeoutMs,
        traceId,
        onlyOpen,
        limit,
      });
    }

    if (snapshots.length === 0) {
      runStatus = "success";
      runPayload = {
        trace_id: traceId,
        provider,
        inserted_snapshots: 0,
      };
      return jsonResponse({
        trace_id: traceId,
        provider,
        inserted_snapshots: 0,
        reconciled_closed: 0,
        reconciled_cancelled: 0,
      });
    }

    const snapshotTime = new Date().toISOString();
    const insertRows = snapshots.map((row) => ({
      trace_id: traceId,
      broker: provider,
      broker_position_id: row.broker_position_id,
      symbol: row.symbol,
      direction: row.direction,
      quantity: row.quantity,
      avg_price: row.avg_price,
      stop_loss: row.stop_loss,
      take_profit: row.take_profit,
      status: row.status,
      snapshot_time: snapshotTime,
      payload: row.payload,
    }));

    const { error: insertError } = await supabase
      .from("broker_position_sync_snapshots")
      .insert(insertRows);

    if (insertError) {
      throw new Error(`Failed inserting position snapshots: ${insertError.message}`);
    }

    const closedIds = snapshots
      .filter((row) => row.status === "closed")
      .map((row) => row.broker_position_id);
    const cancelledIds = snapshots
      .filter((row) => row.status === "cancelled")
      .map((row) => row.broker_position_id);

    let reconciledClosed = 0;
    let reconciledCancelled = 0;

    if (provider !== "paper" && closedIds.length > 0) {
      try {
        reconciledClosed = await reconcilePositionsByRefs({
          supabase,
          provider,
          refs: closedIds,
          snapshotTime,
          finalStatus: "closed",
          closeReason: "broker_sync_closed",
        });
      } catch (error) {
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_sync_reconcile_failed",
          severity: "warning",
          message: `Failed reconciling closed positions for provider ${provider}`,
          payload: {
            error: error instanceof Error ? error.message : String(error),
            closed_ids_count: closedIds.length,
          },
        });
      }
    }

    if (provider !== "paper" && cancelledIds.length > 0) {
      try {
        reconciledCancelled = await reconcilePositionsByRefs({
          supabase,
          provider,
          refs: cancelledIds,
          snapshotTime,
          finalStatus: "cancelled",
          closeReason: "broker_sync_cancelled",
        });
      } catch (error) {
        await insertOpsAlert({
          supabase,
          traceId,
          alertType: "broker_sync_reconcile_failed",
          severity: "warning",
          message: `Failed reconciling cancelled positions for provider ${provider}`,
          payload: {
            error: error instanceof Error ? error.message : String(error),
            cancelled_ids_count: cancelledIds.length,
          },
        });
      }
    }

    const responsePayload = {
      trace_id: traceId,
      provider,
      only_open: onlyOpen,
      requested_limit: limit,
      snapshots_loaded: snapshots.length,
      inserted_snapshots: insertRows.length,
      reconciled_closed: reconciledClosed,
      reconciled_cancelled: reconciledCancelled,
      sample: snapshots.slice(0, 5),
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

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      },
      500,
    );
  } finally {
    if (ctraderRuntime) {
      ctraderRuntime.close();
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
