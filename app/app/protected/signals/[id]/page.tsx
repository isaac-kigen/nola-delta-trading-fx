import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { connection } from "next/server";

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();

  const { id } = await params;
  const signalId = parseId(id);
  if (!signalId) notFound();

  const supabase = await createClient();
  const [signalRes, eventsRes, intentRes, positionRes, prevRes, nextRes] = await Promise.all([
    supabase.from("trading_signals").select("*").eq("id", signalId).maybeSingle(),
    supabase.from("trading_signal_events").select("id, event_type, from_state, to_state, event_reason, created_at").eq("signal_id", signalId).order("created_at", { ascending: false }).limit(20),
    supabase.from("broker_order_intents").select("id, status, broker, updated_at").eq("signal_id", signalId).order("updated_at", { ascending: false }).limit(5),
    supabase.from("trading_positions").select("id, status, broker, broker_position_id, opened_at").eq("signal_id", signalId).order("opened_at", { ascending: false }).limit(5),
    supabase.from("trading_signals").select("id").lt("id", signalId).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("trading_signals").select("id").gt("id", signalId).order("id", { ascending: true }).limit(1).maybeSingle(),
  ]);

  if (!signalRes.data) notFound();

  const signal = signalRes.data;
  const events = eventsRes.data ?? [];
  const intents = intentRes.data ?? [];
  const positions = positionRes.data ?? [];
  const previousId = prevRes.data?.id ?? null;
  const nextId = nextRes.data?.id ?? null;

  return (
    <>
      <section className="text-xs text-muted-foreground">
        <Link href="/protected" className="hover:text-foreground">Dashboard</Link>
        {" / "}
        <Link href="/protected/signals" className="hover:text-foreground">Signals</Link>
        {" / "}
        <span className="text-foreground">#{signal.id}</span>
      </section>
      <section className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Signal #{signal.id}</p>
          <h1 className="text-2xl font-semibold">{signal.symbol} {signal.direction}</h1>
        </div>
        <div className="flex items-center gap-2">
          {previousId && (
            <Button asChild variant="outline" className="rounded-xl">
              <Link href={`/protected/signals/${previousId}`}>Previous</Link>
            </Button>
          )}
          {nextId && (
            <Button asChild variant="outline" className="rounded-xl">
              <Link href={`/protected/signals/${nextId}`}>Next</Link>
            </Button>
          )}
          <Button asChild variant="outline" className="rounded-xl"><Link href="/protected/signals">Back to Signals</Link></Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">State</p><Badge className="mt-2 rounded-full" variant="secondary">{signal.signal_state}</Badge></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Trigger Policy</p><p className="mt-1 font-semibold">{signal.trigger_policy}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Setup Score</p><p className="mt-1 font-semibold">{signal.setup_score ?? "-"}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cycle ID</p><p className="mt-1 font-semibold">{signal.cycle_id ?? "-"}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Signal Events</CardTitle><CardDescription>`trading_signal_events` for this signal</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Transition</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">When</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.event_type}</TableCell>
                    <TableCell>{event.from_state ?? "none"} -&gt; {event.to_state ?? "none"}</TableCell>
                    <TableCell className="text-muted-foreground">{event.event_reason ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Execution Linkage</CardTitle><CardDescription>Intent and position rows derived from this signal</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Broker Intents</p>
              {intents.map((intent) => (
                <div key={intent.id} className="mb-2 rounded-xl border border-border/70 px-3 py-2">
                  <div className="flex items-center justify-between"><span>Intent #{intent.id}</span><Badge variant="secondary" className="rounded-full">{intent.status}</Badge></div>
                  <Link href={`/protected/execution/intents/${intent.id}`} className="text-xs text-primary hover:underline">Open intent detail</Link>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Positions</p>
              {positions.map((position) => (
                <div key={position.id} className="mb-2 rounded-xl border border-border/70 px-3 py-2">
                  <div className="flex items-center justify-between"><span>Position #{position.id}</span><Badge variant="secondary" className="rounded-full">{position.status}</Badge></div>
                  <p className="text-xs text-muted-foreground">{position.broker} • {position.broker_position_id ?? "no broker position id"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
