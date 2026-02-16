import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Bot, CandlestickChart, Clock3, Layers3 } from "lucide-react";
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

export default async function ProtectedPage() {
  await connection();

  const supabase = await createClient();
  const [runtimeRes, signalsRes, intentsRes, positionsRes, alertsRes] = await Promise.all([
    supabase.from("strategy_runtime_config").select("value, updated_at").eq("key", "global").maybeSingle(),
    supabase.from("trading_signals").select("id, symbol, direction, signal_state, setup_score, cycle_id, created_at").order("created_at", { ascending: false }).limit(8),
    supabase.from("broker_order_intents").select("id, symbol, status, broker, attempt_count, updated_at").order("updated_at", { ascending: false }).limit(8),
    supabase.from("trading_positions").select("id, symbol, direction, status, broker, realized_pnl, opened_at").order("opened_at", { ascending: false }).limit(6),
    supabase.from("ops_alerts").select("id, severity, alert_type, message, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const runtime = runtimeRes.data?.value as Record<string, string | number | boolean> | undefined;
  const signals = signalsRes.data ?? [];
  const intents = intentsRes.data ?? [];
  const positions = positionsRes.data ?? [];
  const alerts = alertsRes.data ?? [];
  const openPositions = positions.filter((item) => item.status === "open").length;
  const activeSignals = signals.filter((item) => item.signal_state === "active" || item.signal_state === "triggered").length;
  const inFlightIntents = intents.filter((item) => item.status === "pending" || item.status === "sent" || item.status === "acknowledged").length;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Strategy Version</p>
            <p className="mt-1 text-lg font-semibold">{String(runtime?.strategy_version ?? "unavailable")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Updated {relativeTime(runtimeRes.data?.updated_at)}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active/Triggered Signals</p>
            <p className="mt-1 text-lg font-semibold">{activeSignals}</p>
            <p className="mt-1 text-xs text-muted-foreground">From latest {signals.length} entries</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">In-flight Intents</p>
            <p className="mt-1 text-lg font-semibold">{inFlightIntents}</p>
            <p className="mt-1 text-xs text-muted-foreground">Queued to broker worker</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open Positions</p>
            <p className="mt-1 text-lg font-semibold">{openPositions}</p>
            <p className="mt-1 text-xs text-muted-foreground">Across connected brokers</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CandlestickChart className="size-4 text-primary" />
              Latest Signal Lifecycle
            </CardTitle>
            <CardDescription>Derived from `trading_signals` with cycle lock context</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((signal) => (
                  <TableRow key={signal.id}>
                    <TableCell className="font-medium">{signal.symbol}</TableCell>
                    <TableCell className="capitalize">{signal.direction}</TableCell>
                    <TableCell><Badge variant="secondary" className="rounded-full">{signal.signal_state}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{signal.cycle_id ?? "-"}</TableCell>
                    <TableCell className="text-right">{signal.setup_score ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-primary" />
              Recent Ops Alerts
            </CardTitle>
            <CardDescription>From `ops_alerts` severity stream</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.length === 0 && (
              <div className="rounded-xl border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground">
                No alerts recorded yet.
              </div>
            )}
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={alert.severity === "critical" || alert.severity === "error" ? "destructive" : "secondary"} className="rounded-full">
                    {alert.severity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{relativeTime(alert.created_at)}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{alert.alert_type}</p>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-primary" />
              Broker Intents
            </CardTitle>
            <CardDescription>Queue health from `broker_order_intents`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {intents.map((intent) => (
              <div key={intent.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
                <div>
                  <p className="font-medium">{intent.symbol}</p>
                  <p className="text-xs text-muted-foreground">{intent.broker} • attempt {intent.attempt_count ?? 0}</p>
                </div>
                <Badge variant="secondary" className="rounded-full">{intent.status}</Badge>
                <span className="text-xs text-muted-foreground">{relativeTime(intent.updated_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers3 className="size-4 text-primary" />
              Position Snapshot
            </CardTitle>
            <CardDescription>Execution outcomes from `trading_positions`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {positions.map((position) => (
              <div key={position.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
                <div>
                  <p className="font-medium">{position.symbol}</p>
                  <p className="text-xs text-muted-foreground capitalize">{position.direction} • {position.broker}</p>
                </div>
                <Badge variant={position.status === "open" ? "default" : "secondary"} className="rounded-full">{position.status}</Badge>
                <span className="text-xs text-muted-foreground">{relativeTime(position.opened_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
      <section className="rounded-2xl border border-border/70 bg-card p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Clock3 className="size-4" />
          This dashboard reflects your Supabase pipeline tables directly: runtime config, signal lifecycle, broker intents, positions, and operations alerts.
        </p>
      </section>
    </>
  );
}
