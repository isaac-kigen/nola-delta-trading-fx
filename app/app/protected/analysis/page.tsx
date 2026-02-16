import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { connection } from "next/server";

type LatestCheck = {
  signal_state: string | null;
  latest_candle_time: string | null;
  details: Record<string, unknown> | null;
};

type WatchState = {
  watch_mode_active: boolean | null;
  watch_until: string | null;
  last_baseline_15m_candle_time: string | null;
  last_1m_candle_time: string | null;
};

type LatestSignal = {
  signal_state: string | null;
  setup_score: number | string | null;
};

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

function buildAnalysisStatus(check: LatestCheck | null): { label: string; reason: string } {
  if (!check) return { label: "No checks", reason: "No analysis run recorded yet" };

  const details = (check.details ?? {}) as Record<string, unknown>;
  const photon = (details.photon ?? {}) as Record<string, unknown>;
  const photonState = String(photon.state ?? "").trim();
  const photonReason = String(photon.reason ?? "").trim();
  const signalState = String(check.signal_state ?? "none").trim();

  if (signalState === "triggered" || signalState === "active") {
    return { label: "Signal ready", reason: signalState };
  }
  if (photonState.length > 0) {
    return { label: photonState, reason: photonReason || "waiting" };
  }
  return { label: "Idle", reason: signalState || "none" };
}

export default async function AnalysisOverviewPage() {
  await connection();

  const supabase = await createClient();
  const symbolsRes = await supabase
    .from("strategy_symbol_config")
    .select("symbol, enabled")
    .order("symbol", { ascending: true })
    .limit(50);

  const symbols = (symbolsRes.data ?? []).map((row) => row.symbol).filter(Boolean);

  const [watchRes, checksRes, signalsRes] = symbols.length > 0
    ? await Promise.all([
      supabase
        .from("sync_symbol_runtime_state")
        .select("symbol, watch_mode_active, watch_until, last_baseline_15m_candle_time, last_1m_candle_time")
        .in("symbol", symbols),
      supabase
        .from("trading_opportunity_checks")
        .select("symbol, signal_state, latest_candle_time, checked_at, details")
        .in("symbol", symbols)
        .order("checked_at", { ascending: false })
        .limit(1000),
      supabase
        .from("trading_signals")
        .select("symbol, signal_state, setup_score, created_at")
        .in("symbol", symbols)
        .order("created_at", { ascending: false })
        .limit(1000),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const watchMap = new Map<string, WatchState>();
  for (const row of watchRes.data ?? []) {
    watchMap.set(row.symbol, {
      watch_mode_active: row.watch_mode_active,
      watch_until: row.watch_until,
      last_baseline_15m_candle_time: row.last_baseline_15m_candle_time,
      last_1m_candle_time: row.last_1m_candle_time,
    });
  }

  const latestCheckMap = new Map<string, LatestCheck>();
  for (const row of checksRes.data ?? []) {
    if (!latestCheckMap.has(row.symbol)) {
      latestCheckMap.set(row.symbol, {
        signal_state: row.signal_state,
        latest_candle_time: row.latest_candle_time,
        details: (row.details ?? {}) as Record<string, unknown>,
      });
    }
  }

  const latestSignalMap = new Map<string, LatestSignal>();
  for (const row of signalsRes.data ?? []) {
    if (!latestSignalMap.has(row.symbol)) {
      latestSignalMap.set(row.symbol, {
        signal_state: row.signal_state,
        setup_score: row.setup_score,
      });
    }
  }

  const rows = (symbolsRes.data ?? []).map((cfg) => {
    const symbol = cfg.symbol;
    const watch = watchMap.get(symbol) ?? null;
    const check = latestCheckMap.get(symbol) ?? null;
    const signal = latestSignalMap.get(symbol) ?? null;
    const analysis = buildAnalysisStatus(check);
    const freshnessRef = check?.latest_candle_time ??
      watch?.last_baseline_15m_candle_time ??
      watch?.last_1m_candle_time ??
      null;

    return {
      symbol,
      enabled: cfg.enabled,
      analysisLabel: analysis.label,
      analysisReason: analysis.reason,
      watchActive: Boolean(watch?.watch_mode_active),
      watchUntil: watch?.watch_until ?? null,
      lastSignalState: signal?.signal_state ?? "none",
      lastSetupScore: asNumber(signal?.setup_score, 0),
      freshnessRef,
    };
  });

  return (
    <>
      <section className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Analysis Status</p>
          <h1 className="text-2xl font-semibold">Asset Overview</h1>
        </div>
      </section>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Analysis Overview</CardTitle>
          <CardDescription>Click an asset to open detailed analysis state</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Analysis</TableHead>
                <TableHead>Freshness</TableHead>
                <TableHead>Watch Mode</TableHead>
                <TableHead className="text-right">Last Signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.symbol}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/protected/analysis/${encodeURIComponent(row.symbol)}`}
                        className="text-primary hover:underline"
                      >
                        {row.symbol}
                      </Link>
                      {!row.enabled && <Badge variant="secondary" className="rounded-full">disabled</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{row.analysisLabel}</p>
                      <p className="text-xs text-muted-foreground">{row.analysisReason}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{relativeTime(row.freshnessRef)}</TableCell>
                  <TableCell>
                    <Badge variant={row.watchActive ? "default" : "secondary"} className="rounded-full">
                      {row.watchActive ? "active" : "inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{row.lastSignalState}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({row.lastSetupScore.toFixed(1)})
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No assets configured in `strategy_symbol_config`.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

