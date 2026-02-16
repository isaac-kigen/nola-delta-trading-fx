import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlaskConical, SlidersHorizontal, Sparkles, Target } from "lucide-react";
import { connection } from "next/server";

function valueNumber(input: unknown, fallback = 0) {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const n = Number(input);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export default async function StrategyPage() {
  await connection();

  const supabase = await createClient();

  const [runtimeRes, symbolConfigRes, validationRes] = await Promise.all([
    supabase.from("strategy_runtime_config").select("value, updated_at").eq("key", "global").maybeSingle(),
    supabase
      .from("strategy_symbol_config")
      .select("symbol, enabled, strategy_version, trigger_policy, risk_per_trade_pct, one_trade_per_cycle, liquidity_eps_pips, updated_at")
      .order("symbol", { ascending: true })
      .limit(20),
    supabase
      .from("strategy_validation_runs")
      .select("id, symbol, strategy_version, timeframe, from_time, to_time, metrics, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const runtime = runtimeRes.data?.value as Record<string, unknown> | undefined;
  const symbolConfig = symbolConfigRes.data ?? [];
  const validationRuns = validationRes.data ?? [];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Strategy Version</p><p className="mt-1 text-lg font-semibold">{String(runtime?.strategy_version ?? "n/a")}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Max Total Risk %</p><p className="mt-1 text-lg font-semibold">{valueNumber(runtime?.max_total_risk_pct).toFixed(2)}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Max Open Trades</p><p className="mt-1 text-lg font-semibold">{valueNumber(runtime?.max_open_trades)}</p></CardContent></Card>
        <Card className="glass-panel rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Configured Symbols</p><p className="mt-1 text-lg font-semibold">{symbolConfig.length}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="size-4 text-primary" /> Global Runtime Knobs</CardTitle>
            <CardDescription>`strategy_runtime_config` key `global`</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Account Equity USD</p><p className="text-lg font-semibold">${valueNumber(runtime?.account_equity_usd).toLocaleString()}</p></div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Max Trades/Day</p><p className="text-lg font-semibold">{valueNumber(runtime?.max_trades_per_day)}</p></div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Session Filter</p><p className="text-lg font-semibold">{runtime?.session_filter_enabled ? "On" : "Off"}</p></div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Volatility Filter</p><p className="text-lg font-semibold">{runtime?.volatility_filter_enabled ? "On" : "Off"}</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" /> Photon Controls</CardTitle>
            <CardDescription>v3.1 zone and cycle constraints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Setup Label</p>
              <p className="font-semibold">{String(runtime?.setup_label ?? "setup_score")}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">One Trade Per Cycle</p>
              <p className="font-semibold">Enforced by unique triggered index on `(symbol, cycle_id)`</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Default Trigger Policy</p>
              <p className="font-semibold">Market / Limit / Confirmation (per symbol)</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-primary" /> Symbol Configuration</CardTitle>
            <CardDescription>`strategy_symbol_config`</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Risk %</TableHead>
                  <TableHead className="text-right">Cycle Lock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbolConfig.map((row) => (
                  <TableRow key={row.symbol}>
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell><Badge variant={row.enabled ? "default" : "secondary"} className="rounded-full">{row.enabled ? "on" : "off"}</Badge></TableCell>
                    <TableCell>{row.trigger_policy}</TableCell>
                    <TableCell>{row.risk_per_trade_pct}</TableCell>
                    <TableCell className="text-right">{row.one_trade_per_cycle ? "yes" : "no"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="size-4 text-primary" /> Validation Runs</CardTitle>
            <CardDescription>Recent `strategy_validation_runs`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {validationRuns.map((run) => (
              <div key={run.id} className="rounded-xl border border-border/70 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{run.symbol} • {run.timeframe}</p>
                  <Badge variant="secondary" className="rounded-full">{run.strategy_version}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(run.from_time).toLocaleDateString()} - {new Date(run.to_time).toLocaleDateString()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
