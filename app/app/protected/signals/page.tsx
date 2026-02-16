import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartCandlestick, History, Radar } from "lucide-react";
import { connection } from "next/server";

function relativeTime(value: string | null | undefined) {
  if (!value) return "n/a";
  const date = new Date(value);
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function SignalsPage() {
  await connection();

  const supabase = await createClient();

  const [checksRes, signalsRes, eventsRes] = await Promise.all([
    supabase
      .from("trading_opportunity_checks")
      .select("id, symbol, signal, signal_state, confidence, setup_score, strategy_version, checked_at")
      .order("checked_at", { ascending: false })
      .limit(12),
    supabase
      .from("trading_signals")
      .select("id, symbol, direction, signal_state, trigger_policy, cycle_id, setup_score, valid_until, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("trading_signal_events")
      .select("id, event_type, from_state, to_state, trace_id, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const checks = checksRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const events = eventsRes.data ?? [];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Recent Opportunity Checks</p>
            <p className="mt-1 text-lg font-semibold">{checks.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Recent Signal Rows</p>
            <p className="mt-1 text-lg font-semibold">{signals.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Lifecycle Events</p>
            <p className="mt-1 text-lg font-semibold">{events.length}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChartCandlestick className="size-4 text-primary" />
              Signal Lifecycle Board
            </CardTitle>
            <CardDescription>`trading_signals` state flow and cycle lock values</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell className="capitalize">{row.direction}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-full">
                        {row.signal_state}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.trigger_policy}</TableCell>
                    <TableCell className="text-muted-foreground">{row.cycle_id ?? "-"}</TableCell>
                    <TableCell className="text-right">{row.setup_score ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/protected/signals/${row.id}`} className="text-xs text-primary hover:underline">
                        Details
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-primary" />
              Latest Events
            </CardTitle>
            <CardDescription>`trading_signal_events` audit stream</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{event.event_type}</p>
                  <span className="text-xs text-muted-foreground">{relativeTime(event.created_at)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.from_state ?? "none"} -&gt; {event.to_state ?? "none"}
                </p>
                <Link href={`/protected/operations/traces/${encodeURIComponent(event.trace_id)}`} className="mt-1 block truncate text-xs text-primary hover:underline">
                  Trace: {event.trace_id}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="size-4 text-primary" />
              Opportunity Checks
            </CardTitle>
            <CardDescription>`trading_opportunity_checks` candidates and confidence</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell>{row.signal}</TableCell>
                    <TableCell>{row.signal_state}</TableCell>
                    <TableCell className="text-muted-foreground">{row.strategy_version}</TableCell>
                    <TableCell className="text-right">{row.confidence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
