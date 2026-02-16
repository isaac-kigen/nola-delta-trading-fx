import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActivitySquare, AlertOctagon, Cpu, Timer } from "lucide-react";
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

export default async function OperationsPage() {
  await connection();

  const supabase = await createClient();
  const [runsRes, alertsRes, providerUsageRes, locksRes] = await Promise.all([
    supabase
      .from("ops_function_runs")
      .select("id, trace_id, function_name, status, duration_ms, started_at")
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("ops_alerts")
      .select("id, severity, alert_type, message, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("provider_api_usage")
      .select("provider, minute_calls, day_calls, minute_window_start, day_window_start, updated_at")
      .order("provider", { ascending: true }),
    supabase
      .from("pipeline_locks")
      .select("lock_name, lock_owner, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const runs = runsRes.data ?? [];
  const alerts = alertsRes.data ?? [];
  const providerUsage = providerUsageRes.data ?? [];
  const locks = locksRes.data ?? [];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Function Runs</p><p className="mt-1 text-lg font-semibold">{runs.length}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ops Alerts</p><p className="mt-1 text-lg font-semibold">{alerts.length}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Providers</p><p className="mt-1 text-lg font-semibold">{providerUsage.length}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pipeline Locks</p><p className="mt-1 text-lg font-semibold">{locks.length}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4 text-primary" /> Function Runtime</CardTitle>
            <CardDescription>Recent runs from `ops_function_runs`</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Function</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                  <TableHead className="text-right">Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.function_name}</TableCell>
                    <TableCell><Badge variant={row.status === "failed" ? "destructive" : "secondary"} className="rounded-full">{row.status}</Badge></TableCell>
                    <TableCell className="text-right">{row.duration_ms ?? "-"}ms</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{relativeTime(row.started_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/protected/operations/traces/${encodeURIComponent(row.trace_id)}`} className="text-xs text-primary hover:underline">
                        Open
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
            <CardTitle className="flex items-center gap-2 text-base"><AlertOctagon className="size-4 text-primary" /> Alert Feed</CardTitle>
            <CardDescription>`ops_alerts` severity and message stream</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {alerts.map((row) => (
              <div key={row.id} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <Badge variant={row.severity === "critical" || row.severity === "error" ? "destructive" : "secondary"} className="rounded-full">{row.severity}</Badge>
                  <span className="text-xs text-muted-foreground">{relativeTime(row.created_at)}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{row.alert_type}</p>
                <p className="text-xs text-muted-foreground">{row.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><ActivitySquare className="size-4 text-primary" /> Provider Quotas</CardTitle>
            <CardDescription>`provider_api_usage` call windows</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Minute</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providerUsage.map((row) => (
                  <TableRow key={row.provider}>
                    <TableCell className="font-medium">{row.provider}</TableCell>
                    <TableCell>{row.minute_calls}</TableCell>
                    <TableCell>{row.day_calls}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{relativeTime(row.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Timer className="size-4 text-primary" /> Pipeline Locks</CardTitle>
            <CardDescription>Current rows from `pipeline_locks`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {locks.length === 0 && <p className="text-muted-foreground">No active lock rows found.</p>}
            {locks.map((row) => (
              <div key={`${row.lock_name}-${row.created_at}`} className="rounded-xl border border-border/70 px-3 py-2">
                <p className="font-medium">{row.lock_name}</p>
                <p className="text-xs text-muted-foreground">owner: {row.lock_owner ?? "-"}</p>
                <p className="text-xs text-muted-foreground">expires: {relativeTime(row.expires_at)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
