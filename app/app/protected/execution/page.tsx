import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, CheckCheck, Link2, WalletCards } from "lucide-react";
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

export default async function ExecutionPage() {
  await connection();

  const supabase = await createClient();

  const [healthRes, intentsRes, callbacksRes, positionsRes] = await Promise.all([
    supabase.from("broker_execution_health_30m").select("broker, total_intents, success_count, error_count, in_flight_count, error_rate_pct, latest_update_at").order("broker", { ascending: true }),
    supabase
      .from("broker_order_intents")
      .select("id, symbol, direction, order_type, status, broker, attempt_count, broker_order_id, updated_at")
      .order("updated_at", { ascending: false })
      .limit(14),
    supabase
      .from("broker_callback_events")
      .select("id, provider, processing_status, intent_id, broker_order_id, broker_position_id, received_at")
      .order("received_at", { ascending: false })
      .limit(10),
    supabase
      .from("trading_positions")
      .select("id, symbol, direction, status, broker, broker_position_id, realized_pnl, opened_at")
      .order("opened_at", { ascending: false })
      .limit(10),
  ]);

  const health = healthRes.data ?? [];
  const intents = intentsRes.data ?? [];
  const callbacks = callbacksRes.data ?? [];
  const positions = positionsRes.data ?? [];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Brokers in Health View</p>
            <p className="mt-1 text-lg font-semibold">{health.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Queue Rows Loaded</p>
            <p className="mt-1 text-lg font-semibold">{intents.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Callbacks Loaded</p>
            <p className="mt-1 text-lg font-semibold">{callbacks.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Positions Loaded</p>
            <p className="mt-1 text-lg font-semibold">{positions.length}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-primary" />
              Broker Execution Health (30m)
            </CardTitle>
            <CardDescription>From `broker_execution_health_30m`</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broker</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>In Flight</TableHead>
                  <TableHead className="text-right">Err %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.map((row) => (
                  <TableRow key={row.broker}>
                    <TableCell className="font-medium">{row.broker}</TableCell>
                    <TableCell>{row.total_intents}</TableCell>
                    <TableCell>{row.success_count}</TableCell>
                    <TableCell>{row.error_count}</TableCell>
                    <TableCell>{row.in_flight_count}</TableCell>
                    <TableCell className="text-right">{row.error_rate_pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCheck className="size-4 text-primary" />
              Callback Stream
            </CardTitle>
            <CardDescription>From `broker_callback_events`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {callbacks.map((row) => (
              <div key={row.id} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{row.provider}</p>
                  <Badge variant="secondary" className="rounded-full">{row.processing_status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  intent #{row.intent_id ?? "-"} • order {row.broker_order_id ?? "-"}
                </p>
                {row.intent_id && (
                  <Link href={`/protected/execution/intents/${row.intent_id}`} className="mt-1 block text-xs text-primary hover:underline">
                    Open intent detail
                  </Link>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{relativeTime(row.received_at)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="size-4 text-primary" />
              Broker Order Intents
            </CardTitle>
            <CardDescription>Claim/finalize queue records</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Broker</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell><Badge variant="secondary" className="rounded-full">{row.status}</Badge></TableCell>
                    <TableCell>{row.order_type}</TableCell>
                    <TableCell>{row.broker}</TableCell>
                    <TableCell className="text-right">{row.attempt_count ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/protected/execution/intents/${row.id}`} className="text-xs text-primary hover:underline">
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
              <WalletCards className="size-4 text-primary" />
              Trading Positions
            </CardTitle>
            <CardDescription>Reconciled positions and broker IDs</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Broker Pos ID</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell className="capitalize">{row.direction}</TableCell>
                    <TableCell><Badge variant={row.status === "open" ? "default" : "secondary"} className="rounded-full">{row.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{row.broker_position_id ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{relativeTime(row.opened_at)}</TableCell>
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
