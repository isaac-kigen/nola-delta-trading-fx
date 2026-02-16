import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connection } from "next/server";

export default async function TraceDetailPage({ params }: { params: Promise<{ traceId: string }> }) {
  await connection();

  const { traceId } = await params;
  if (!traceId) notFound();

  const decodedTraceId = decodeURIComponent(traceId);
  const supabase = await createClient();
  const [runsRes, signalsRes, intentsRes, callbacksRes, alertsRes] = await Promise.all([
    supabase.from("ops_function_runs").select("id, function_name, status, started_at, duration_ms").eq("trace_id", decodedTraceId).order("started_at", { ascending: false }),
    supabase.from("trading_signals").select("id, symbol, signal_state, created_at").eq("trace_id", decodedTraceId).order("created_at", { ascending: false }).limit(20),
    supabase.from("broker_order_intents").select("id, symbol, status, updated_at").eq("trace_id", decodedTraceId).order("updated_at", { ascending: false }).limit(20),
    supabase.from("broker_callback_events").select("id, provider, processing_status, received_at").eq("trace_id", decodedTraceId).order("received_at", { ascending: false }).limit(20),
    supabase.from("ops_alerts").select("id, alert_type, severity, message, created_at").eq("trace_id", decodedTraceId).order("created_at", { ascending: false }).limit(20),
  ]);

  const runs = runsRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const intents = intentsRes.data ?? [];
  const callbacks = callbacksRes.data ?? [];
  const alerts = alertsRes.data ?? [];

  if (!runs.length && !signals.length && !intents.length && !callbacks.length && !alerts.length) {
    notFound();
  }

  return (
    <>
      <section className="text-xs text-muted-foreground">
        <Link href="/protected" className="hover:text-foreground">Dashboard</Link>
        {" / "}
        <Link href="/protected/operations" className="hover:text-foreground">Operations</Link>
        {" / "}
        <span className="text-foreground">Trace</span>
      </section>
      <section className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Trace</p>
          <h1 className="text-xl font-semibold break-all">{decodedTraceId}</h1>
        </div>
        <Button asChild variant="outline" className="rounded-xl"><Link href="/protected/operations">Back to Operations</Link></Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Function Runs</p><p className="mt-1 text-lg font-semibold">{runs.length}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Signals</p><p className="mt-1 text-lg font-semibold">{signals.length}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Intents</p><p className="mt-1 text-lg font-semibold">{intents.length}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Callbacks</p><p className="mt-1 text-lg font-semibold">{callbacks.length}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Alerts</p><p className="mt-1 text-lg font-semibold">{alerts.length}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-base">Function Runs</CardTitle><CardDescription>`ops_function_runs`</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">{runs.map((run) => <div key={run.id} className="rounded-xl border border-border/70 px-3 py-2"><div className="flex items-center justify-between"><p className="font-medium">{run.function_name}</p><Badge variant={run.status === "failed" ? "destructive" : "secondary"} className="rounded-full">{run.status}</Badge></div><p className="text-xs text-muted-foreground">{new Date(run.started_at).toLocaleString()} • {run.duration_ms ?? "-"}ms</p></div>)}</CardContent></Card>
        <Card className="rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-base">Linked Signals & Intents</CardTitle><CardDescription>`trading_signals` + `broker_order_intents`</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">{signals.map((signal) => <div key={`s-${signal.id}`} className="rounded-xl border border-border/70 px-3 py-2"><div className="flex items-center justify-between"><Link href={`/protected/signals/${signal.id}`} className="font-medium text-primary hover:underline">Signal #{signal.id} • {signal.symbol}</Link><Badge className="rounded-full" variant="secondary">{signal.signal_state}</Badge></div></div>)}{intents.map((intent) => <div key={`i-${intent.id}`} className="rounded-xl border border-border/70 px-3 py-2"><div className="flex items-center justify-between"><Link href={`/protected/execution/intents/${intent.id}`} className="font-medium text-primary hover:underline">Intent #{intent.id} • {intent.symbol}</Link><Badge className="rounded-full" variant="secondary">{intent.status}</Badge></div></div>)}</CardContent></Card>
      </section>
    </>
  );
}
