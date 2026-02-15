import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type OpsRunStatus = "started" | "success" | "failed" | "partial";
type OpsAlertSeverity = "info" | "warning" | "error" | "critical";

export async function startOpsFunctionRun(params: {
  supabase: SupabaseClient;
  functionName: string;
  traceId: string;
  payload?: Record<string, unknown>;
}): Promise<number | null> {
  const { data, error } = await params.supabase
    .from("ops_function_runs")
    .insert({
      function_name: params.functionName,
      trace_id: params.traceId,
      status: "started",
      started_at: new Date().toISOString(),
      payload: params.payload ?? {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return null;
  }

  return Number(data.id);
}

export async function finishOpsFunctionRun(params: {
  supabase: SupabaseClient;
  runId: number | null;
  status: OpsRunStatus;
  startedAtMs: number;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!params.runId) {
    return;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - params.startedAtMs);

  try {
    await params.supabase
      .from("ops_function_runs")
      .update({
        status: params.status,
        finished_at: finishedAt,
        duration_ms: durationMs,
        payload: params.payload ?? {},
      })
      .eq("id", params.runId);
  } catch {
    // Run-finalization telemetry is best-effort.
  }
}

export async function insertOpsAlert(params: {
  supabase: SupabaseClient;
  traceId?: string | null;
  alertType: string;
  severity: OpsAlertSeverity;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await params.supabase
      .from("ops_alerts")
      .insert({
        trace_id: params.traceId ?? null,
        alert_type: params.alertType,
        severity: params.severity,
        message: params.message,
        payload: params.payload ?? {},
      });
  } catch {
    // Alert insertion is best-effort.
  }
}
