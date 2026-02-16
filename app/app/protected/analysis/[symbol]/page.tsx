import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

function relativeTime(value: string | null | undefined) {
  if (!value) return "n/a";
  const date = new Date(value);
  const diffSeconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function asNumber(input: unknown, fallback = 0) {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export default async function AssetAnalysisDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  await connection();

  const route = await params;
  const symbol = decodeURIComponent(route.symbol ?? "").trim().toUpperCase();
  if (!symbol || !symbol.includes("/")) notFound();

  const supabase = await createClient();

  const [cfgRes, watchRes, checksRes, signalsRes, count1mRes, count15mRes] = await Promise.all([
    supabase
      .from("strategy_symbol_config")
      .select("symbol, enabled, strategy_version, trigger_policy, risk_per_trade_pct, one_trade_per_cycle, liquidity_eps_pips, updated_at")
      .eq("symbol", symbol)
      .maybeSingle(),
    supabase
      .from("sync_symbol_runtime_state")
      .select("watch_mode_active, watch_until, watch_reason, watch_direction, watch_setup_score, last_baseline_15m_candle_time, last_1m_candle_time, updated_at")
      .eq("symbol", symbol)
      .maybeSingle(),
    supabase
      .from("trading_opportunity_checks")
      .select("id, checked_at, latest_candle_time, signal_state, direction, setup_score, details")
      .eq("symbol", symbol)
      .order("checked_at", { ascending: false })
      .limit(20),
    supabase
      .from("trading_signals")
      .select("id, created_at, signal_state, direction, setup_score, entry_price, stop_loss, tp3")
      .eq("symbol", symbol)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("price_candles_1m")
      .select("*", { count: "exact", head: true })
      .eq("symbol", symbol),
    supabase
      .from("price_candles_15m")
      .select("*", { count: "exact", head: true })
      .eq("symbol", symbol),
  ]);

  if (!cfgRes.data) notFound();

  const cfg = cfgRes.data;
  const watch = watchRes.data;
  const checks = checksRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const latestCheck = checks[0];
  const latestSignal = signals[0];
  const candles1m = count1mRes.count ?? 0;
  const candles15m = count15mRes.count ?? 0;

  const details = (latestCheck?.details ?? {}) as Record<string, unknown>;
  const photon = (details.photon ?? {}) as Record<string, unknown>;
  const photonState = String(photon.state ?? "n/a");
  const photonReason = String(photon.reason ?? "n/a");

  return (
    <>
      <section className="text-xs text-muted-foreground">
        <Link href="/protected" className="hover:text-foreground">Dashboard</Link>
        {" / "}
        <Link href="/protected/analysis" className="hover:text-foreground">Analysis</Link>
        {" / "}
        <span className="text-foreground">{symbol}</span>
      </section>

      <section className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Asset Analysis Detail</p>
          <h1 className="text-2xl font-semibold">{symbol}</h1>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <Link href="/protected/analysis">Back to Overview</Link>
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Analysis State</p><p className="mt-1 text-lg font-semibold">{photonState}</p><p className="mt-1 text-xs text-muted-foreground">{photonReason}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Watch Mode</p><Badge className="mt-2 rounded-full" variant={watch?.watch_mode_active ? "default" : "secondary"}>{watch?.watch_mode_active ? "active" : "inactive"}</Badge><p className="mt-1 text-xs text-muted-foreground">{watch?.watch_reason ?? "n/a"}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">15m Candles</p><p className="mt-1 text-lg font-semibold">{candles15m.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">1m: {candles1m.toLocaleString()}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Latest Check</p><p className="mt-1 text-lg font-semibold">{relativeTime(latestCheck?.checked_at)}</p><p className="mt-1 text-xs text-muted-foreground">{latestCheck?.signal_state ?? "none"}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Latest Signal</p><p className="mt-1 text-lg font-semibold">{latestSignal?.signal_state ?? "none"}</p><p className="mt-1 text-xs text-muted-foreground">score {asNumber(latestSignal?.setup_score, 0).toFixed(1)}</p></CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Configuration</CardTitle>
            <CardDescription>`strategy_symbol_config` + runtime watch state</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Enabled</p>
              <p className="font-semibold">{cfg.enabled ? "yes" : "no"}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Strategy / Policy</p>
              <p className="font-semibold">{cfg.strategy_version} • {cfg.trigger_policy}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Risk / Cycle Lock / Liquidity Eps</p>
              <p className="font-semibold">
                {cfg.risk_per_trade_pct}% • {cfg.one_trade_per_cycle ? "cycle lock on" : "cycle lock off"} • {cfg.liquidity_eps_pips} pips
              </p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Watch Window</p>
              <p className="font-semibold">until {watch?.watch_until ? new Date(watch.watch_until).toLocaleString() : "n/a"}</p>
              <p className="text-xs text-muted-foreground">
                last 15m: {relativeTime(watch?.last_baseline_15m_candle_time)} • last 1m: {relativeTime(watch?.last_1m_candle_time)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Opportunity Checks</CardTitle>
            <CardDescription>Latest 20 rows from `trading_opportunity_checks`</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(row.checked_at).toLocaleString()}</TableCell>
                    <TableCell>{row.signal_state}</TableCell>
                    <TableCell>{row.direction ?? "none"}</TableCell>
                    <TableCell className="text-right">{asNumber(row.setup_score, 0).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
                {checks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No checks yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Signals</CardTitle>
            <CardDescription>Latest 20 rows from `trading_signals`</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link href={`/protected/signals/${row.id}`} className="text-primary hover:underline">
                        #{row.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TableCell>
                    <TableCell>{row.signal_state}</TableCell>
                    <TableCell>{row.direction}</TableCell>
                    <TableCell className="text-right">{asNumber(row.setup_score, 0).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
                {signals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No signals yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

