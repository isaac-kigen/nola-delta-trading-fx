import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connection } from "next/server";
import { Suspense } from "react";

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function IntentDetailContent({ id }: { id: string }) {
  const intentId = parseId(id);
  if (!intentId) notFound();

  const supabase = await createClient();
  const [intentRes, callbackRes, signalRes, prevRes, nextRes] = await Promise.all([
    supabase.from("broker_order_intents").select("*").eq("id", intentId).maybeSingle(),
    supabase.from("broker_callback_events").select("id, processing_status, provider, event_id, received_at").eq("intent_id", intentId).order("received_at", { ascending: false }).limit(20),
    supabase.from("broker_order_intents").select("signal_id").eq("id", intentId).maybeSingle(),
    supabase.from("broker_order_intents").select("id").lt("id", intentId).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("broker_order_intents").select("id").gt("id", intentId).order("id", { ascending: true }).limit(1).maybeSingle(),
  ]);

  const intent = intentRes.data;
  if (!intent) notFound();

  const callbacks = callbackRes.data ?? [];
  const previousId = prevRes.data?.id ?? null;
  const nextId = nextRes.data?.id ?? null;

  return (
    <>
      <section className="text-xs text-muted-foreground">
        <Link href="/protected" className="hover:text-foreground">Dashboard</Link>
        {" / "}
        <Link href="/protected/execution" className="hover:text-foreground">Execution</Link>
        {" / "}
        <span className="text-foreground">Intent #{intent.id}</span>
      </section>
      <section className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Intent #{intent.id}</p>
          <h1 className="text-2xl font-semibold">{intent.symbol} {intent.direction}</h1>
        </div>
        <div className="flex items-center gap-2">
          {previousId && (
            <Button asChild variant="outline" className="rounded-xl">
              <Link href={`/protected/execution/intents/${previousId}`}>Previous</Link>
            </Button>
          )}
          {nextId && (
            <Button asChild variant="outline" className="rounded-xl">
              <Link href={`/protected/execution/intents/${nextId}`}>Next</Link>
            </Button>
          )}
          <Button asChild variant="outline" className="rounded-xl"><Link href="/protected/execution">Back to Execution</Link></Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><Badge className="mt-2 rounded-full" variant="secondary">{intent.status}</Badge></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Broker</p><p className="mt-1 font-semibold">{intent.broker}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Order Type</p><p className="mt-1 font-semibold">{intent.order_type}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Attempt Count</p><p className="mt-1 font-semibold">{intent.attempt_count ?? 0}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Intent Payload</CardTitle><CardDescription>Request/response and error metadata</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Broker Order ID</p>
              <p className="font-medium">{intent.broker_order_id ?? "-"}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Last Error</p>
              <p className="font-medium">{intent.last_error ?? "none"}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Trace ID</p>
              <Link href={`/protected/operations/traces/${encodeURIComponent(intent.trace_id)}`} className="font-medium text-primary hover:underline">{intent.trace_id}</Link>
            </div>
            {signalRes.data?.signal_id && (
              <Button asChild variant="outline" className="rounded-xl"><Link href={`/protected/signals/${signalRes.data.signal_id}`}>Open Related Signal</Link></Button>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Callback Events</CardTitle><CardDescription>`broker_callback_events` linked to this intent</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {callbacks.length === 0 && <p className="text-muted-foreground">No callbacks recorded for this intent.</p>}
            {callbacks.map((callback) => (
              <div key={callback.id} className="rounded-xl border border-border/70 p-3">
                <div className="flex items-center justify-between"><p className="font-medium">{callback.provider}</p><Badge variant="secondary" className="rounded-full">{callback.processing_status}</Badge></div>
                <p className="text-xs text-muted-foreground">event: {callback.event_id}</p>
                <p className="text-xs text-muted-foreground">{new Date(callback.received_at).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

export default async function IntentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;

  return (
    <Suspense fallback={<div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">Loading intent detail...</div>}>
      <IntentDetailContent id={id} />
    </Suspense>
  );
}
