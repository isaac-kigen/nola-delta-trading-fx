import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

type CheckRow = {
  id: number;
  checked_at: string;
  latest_candle_time: string | null;
  signal_state: string | null;
  signal: string | null;
  direction: string | null;
  setup_score: number | string | null;
  cycle_id: string | null;
  trigger_policy: string | null;
  regime_passed: boolean | null;
  spread_pips: number | string | null;
  top_reasons: unknown;
  invalidation_conditions: unknown;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  risk_r: number | string | null;
  details: Record<string, unknown> | null;
};

type SignalRow = {
  id: number;
  created_at: string;
  signal_state: string | null;
  direction: string | null;
  setup_score: number | string | null;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  tp3: number | string | null;
};

const PHOTON_FLOW = [
  "WAIT_HTF",
  "WAIT_PULLBACK_END",
  "WAIT_ZONE",
  "WAIT_SWEEP",
  "WAIT_MITIGATION",
  "WAIT_CHOCH",
  "READY",
] as const;

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

function asText(input: unknown, fallback = "n/a") {
  if (typeof input === "string" && input.trim().length > 0) return input.trim();
  return fallback;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asTextList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => asText(item, "")).filter((value) => value.length > 0);
  }
  return [];
}

function formatPrice(input: unknown, digits = 6) {
  const value = asNumber(input, Number.NaN);
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function formatDateTime(input: unknown) {
  const value = asText(input, "");
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function stateLabel(state: string) {
  switch (state) {
    case "WAIT_HTF":
      return "Waiting HTF";
    case "WAIT_PULLBACK_END":
      return "Waiting Pullback End";
    case "WAIT_ZONE":
      return "Waiting Zone";
    case "WAIT_SWEEP":
      return "Waiting Sweep";
    case "WAIT_MITIGATION":
      return "Waiting Mitigation";
    case "WAIT_CHOCH":
      return "Waiting CHOCH";
    case "READY":
      return "Ready";
    default:
      return state;
  }
}

function reasonExplanation(reason: string) {
  switch (reason) {
    case "htf_trend_neutral":
      return "No confirmed 4H BOS yet. Waiting for clear HTF bullish/bearish structure.";
    case "eq_4h_unavailable":
      return "4H dealing range is not formed yet. Need valid range high/low and EQ_4H.";
    case "eq_15m_unavailable":
      return "15M dealing range is incomplete. Need an HTF-aligned 15M iBOS.";
    case "pullback_cycle_not_completed":
      return "Pullback cycle is not complete yet. Waiting for pullback against HTF and continuation back with HTF.";
    case "zone_gate_not_satisfied":
      return "Price is not inside a valid aligned 15M zone yet.";
    case "insufficient_real_1m_ltf_history":
      return "Not enough real 1M watch candles in the active burst to evaluate LTF gates.";
    case "liquidity_sweep_not_found":
      return "No valid 1M liquidity sweep has occurred inside the active 15M zone.";
    case "zone_midpoint_not_mitigated_after_sweep":
      return "Sweep happened, but price has not yet mitigated the 15M zone midpoint.";
    case "choch_trigger_not_ready":
      return "Mitigation confirmed. Waiting for 1M CHOCH trigger in trade direction.";
    case "entry_candle_not_available":
      return "CHOCH exists, waiting for the next 1M open candle for entry.";
    case "stop_pivot_not_found":
      return "Entry exists, but no valid opposite 1M fractal pivot for stop placement.";
    case "weak_target_not_found":
      return "No valid 4H weak target available in trade direction.";
    case "rr_below_threshold":
      return "Setup exists but RR is below the required minimum threshold.";
    case "ok":
      return "All structure gates passed. Entry plan is valid.";
    default:
      return reason;
  }
}

function phaseIndex(state: string) {
  const index = PHOTON_FLOW.indexOf(state as (typeof PHOTON_FLOW)[number]);
  return index >= 0 ? index : 0;
}

function stepTone(status: "done" | "current" | "pending"): "default" | "secondary" | "outline" {
  if (status === "done") return "default";
  if (status === "current") return "secondary";
  return "outline";
}

function describeBias(htfTrend: string, mtfBias: string, side: string) {
  const htfText = htfTrend === "bull" ? "bullish" : htfTrend === "bear" ? "bearish" : "neutral";
  const mtfText = mtfBias === "with_htf"
    ? "with HTF"
    : mtfBias === "against_htf"
    ? "against HTF"
    : "neutral";
  const sideText = side === "long" || side === "short" ? side : "none";
  return `${htfText} HTF, MTF bias ${mtfText}, current side ${sideText}`;
}

function formatBos(input: unknown) {
  const row = asRecord(input);
  const type = asText(row.type, "n/a");
  const ts = formatDateTime(row.ts);
  const level = formatPrice(row.break_level, 6);
  return `${type} @ ${ts} (level ${level})`;
}

function formatRange(input: unknown) {
  const row = asRecord(input);
  const high = formatPrice(row.range_high, 6);
  const low = formatPrice(row.range_low, 6);
  const eq = formatPrice(row.eq, 6);
  return `high ${high} / low ${low} / eq ${eq}`;
}

function formatLtfEvent(input: unknown) {
  const row = asRecord(input);
  const type = asText(row.type, asText(row.kind, "n/a"));
  const ts = formatDateTime(row.ts);
  const level = row.break_level !== undefined ? ` / level ${formatPrice(row.break_level, 6)}` : "";
  const price = row.price !== undefined ? ` / price ${formatPrice(row.price, 6)}` : "";
  return `${type} @ ${ts}${level}${price}`;
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

  const [cfgRes, watchRes, checksRes, signalsRes, count1mRes, count15mRes, gapRes] = await Promise.all([
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
      .select(
        "id, checked_at, latest_candle_time, signal_state, signal, direction, setup_score, cycle_id, trigger_policy, regime_passed, spread_pips, top_reasons, invalidation_conditions, entry_price, stop_loss, tp1, tp2, tp3, risk_r, details",
      )
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
    supabase
      .from("v_analysis_15m_gap_status")
      .select("baseline_up_to_date, missing_15m_bars, last_15m_candle_time, latest_complete_15m_utc")
      .eq("symbol", symbol)
      .maybeSingle(),
  ]);

  if (!cfgRes.data) notFound();

  const cfg = cfgRes.data;
  const watch = watchRes.data;
  const checks = (checksRes.data ?? []) as CheckRow[];
  const signals = (signalsRes.data ?? []) as SignalRow[];
  const latestCheck = checks[0] ?? null;
  const latestSignal = signals[0] ?? null;
  const candles1m = count1mRes.count ?? 0;
  const candles15m = count15mRes.count ?? 0;

  const details = asRecord(latestCheck?.details);
  const photon = asRecord(details.photon);
  const photonDetails = asRecord(photon.details);
  const photonState = asText(photon.state, "WAIT_HTF");
  const photonReason = asText(photon.reason, "no_check_data");
  const htfTrend = asText(photon.htf_trend, "neutral");
  const mtfBias = asText(photon.mtf_bias, "neutral");
  const engineSide = asText(photon.side, asText(latestCheck?.direction, "none"));
  const nextConditionText = reasonExplanation(photonReason);
  const flowIndex = phaseIndex(photonState);
  const flowDone = photonState === "READY";

  const topReasons = asTextList(latestCheck?.top_reasons ?? photon.top_reasons);
  const invalidationConditions = asTextList(
    latestCheck?.invalidation_conditions ?? photon.invalidation_conditions,
  );

  const zone = asRecord(photonDetails.zone);
  const sweep = asRecord(photonDetails.sweep);
  const trigger = asRecord(photonDetails.trigger);
  const ltfStates = asRecord(photon.ltf_states);

  const flowSteps = [
    "HTF trend established (4H BOS)",
    "15M pullback cycle completed",
    "Price inside aligned 15M zone",
    "1M liquidity sweep confirmed",
    "Zone midpoint mitigated",
    "1M CHOCH trigger confirmed",
    "RR gate passed and entry plan ready",
  ];

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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Engine Phase</p>
            <p className="mt-1 text-lg font-semibold">{stateLabel(photonState)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{photonReason}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">HTF Trend</p>
            <p className="mt-1 text-lg font-semibold">{htfTrend}</p>
            <p className="mt-1 text-xs text-muted-foreground">4H narrative anchor</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">MTF Bias</p>
            <p className="mt-1 text-lg font-semibold">{mtfBias}</p>
            <p className="mt-1 text-xs text-muted-foreground">15M relative to HTF</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Current Side</p>
            <p className="mt-1 text-lg font-semibold">{engineSide}</p>
            <p className="mt-1 text-xs text-muted-foreground">Directional candidate</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Watch Mode</p>
            <Badge className="mt-2 rounded-full" variant={watch?.watch_mode_active ? "default" : "secondary"}>
              {watch?.watch_mode_active ? "active" : "inactive"}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">{watch?.watch_reason ?? "n/a"}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Latest Check</p>
            <p className="mt-1 text-lg font-semibold">{relativeTime(latestCheck?.checked_at)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              score {asNumber(latestCheck?.setup_score, 0).toFixed(1)}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Market Narrative</CardTitle>
            <CardDescription>Current structure context and what the engine is waiting for next</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Bias Snapshot</p>
              <p className="font-semibold">{describeBias(htfTrend, mtfBias, engineSide)}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Current Wait Condition</p>
              <p className="font-semibold">{stateLabel(photonState)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{nextConditionText}</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Cycle / Trigger / Regime</p>
              <p className="font-semibold">
                cycle {asText(latestCheck?.cycle_id, "n/a")} • trigger {asText(latestCheck?.trigger_policy, "n/a")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                signal {asText(latestCheck?.signal_state, "none")} • regime{" "}
                {latestCheck?.regime_passed === null || latestCheck?.regime_passed === undefined
                  ? "n/a"
                  : latestCheck.regime_passed
                  ? "passed"
                  : "blocked"}
                {" "}• spread {formatPrice(latestCheck?.spread_pips, 3)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pipeline Gates</CardTitle>
            <CardDescription>Photon flow from HTF context to executable setup</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {flowSteps.map((step, index) => {
              const status: "done" | "current" | "pending" = flowDone
                ? "done"
                : index < flowIndex
                ? "done"
                : index === flowIndex
                ? "current"
                : "pending";
              return (
                <div key={step} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2">
                  <p className="text-sm">{step}</p>
                  <Badge variant={stepTone(status)} className="rounded-full">
                    {status}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">HTF / MTF Structure</CardTitle>
            <CardDescription>4H and 15M structural anchors from latest check</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow><TableHead className="w-[220px]">4H Trend</TableHead><TableCell>{htfTrend}</TableCell></TableRow>
                <TableRow><TableHead>4H Last BOS</TableHead><TableCell>{formatBos(photon.htf_last_bos)}</TableCell></TableRow>
                <TableRow><TableHead>4H Dealing Range</TableHead><TableCell>{formatRange(photon.range_4h)}</TableCell></TableRow>
                <TableRow><TableHead>EQ_4H</TableHead><TableCell>{formatPrice(photon.eq_4h, 6)}</TableCell></TableRow>
                <TableRow><TableHead>15M Bias</TableHead><TableCell>{mtfBias}</TableCell></TableRow>
                <TableRow><TableHead>15M Last iBOS</TableHead><TableCell>{formatBos(photon.mtf_last_ibos)}</TableCell></TableRow>
                <TableRow><TableHead>15M Dealing Range</TableHead><TableCell>{formatRange(photon.range_15m)}</TableCell></TableRow>
                <TableRow><TableHead>EQ_15M</TableHead><TableCell>{formatPrice(photon.eq_15m, 6)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">LTF Execution Context</CardTitle>
            <CardDescription>1M sweep/mitigation/CHOCH state and entry plan snapshot</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow><TableHead className="w-[220px]">Last Micro BOS</TableHead><TableCell>{formatLtfEvent(ltfStates.last_micro_bos)}</TableCell></TableRow>
                <TableRow><TableHead>Last CHOCH</TableHead><TableCell>{formatLtfEvent(ltfStates.last_choch)}</TableCell></TableRow>
                <TableRow><TableHead>Last Pivot High</TableHead><TableCell>{formatLtfEvent(ltfStates.last_pivot_high)}</TableCell></TableRow>
                <TableRow><TableHead>Last Pivot Low</TableHead><TableCell>{formatLtfEvent(ltfStates.last_pivot_low)}</TableCell></TableRow>
                <TableRow><TableHead>Active Zone</TableHead><TableCell>{asText(zone.kind, "n/a")} / low {formatPrice(zone.low, 6)} / high {formatPrice(zone.high, 6)} / mid {formatPrice(zone.mid, 6)}</TableCell></TableRow>
                <TableRow><TableHead>Sweep</TableHead><TableCell>{asText(sweep.type, "n/a")} @ {formatDateTime(sweep.ts)} / pool {formatPrice(sweep.pool_price, 6)}</TableCell></TableRow>
                <TableRow><TableHead>Mitigation Touch</TableHead><TableCell>{formatDateTime(photonDetails.mitigation_touch_ts)}</TableCell></TableRow>
                <TableRow><TableHead>Trigger</TableHead><TableCell>{asText(trigger.choch_type, "n/a")} @ {formatDateTime(trigger.choch_ts)}</TableCell></TableRow>
                <TableRow><TableHead>Entry / SL / TP3</TableHead><TableCell>{formatPrice(latestCheck?.entry_price, 6)} / {formatPrice(latestCheck?.stop_loss, 6)} / {formatPrice(latestCheck?.tp3, 6)}</TableCell></TableRow>
                <TableRow><TableHead>TP1 / TP2 / RR</TableHead><TableCell>{formatPrice(latestCheck?.tp1, 6)} / {formatPrice(latestCheck?.tp2, 6)} / {formatPrice(latestCheck?.risk_r, 3)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Reasons and Invalidations</CardTitle>
            <CardDescription>Why this setup is in current state and what cancels it</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Top Reasons</p>
              <div className="mt-2 space-y-1 text-sm">
                {topReasons.length > 0 ? topReasons.map((reason) => (
                  <p key={reason}>- {reason}</p>
                )) : <p className="text-muted-foreground">No reasons recorded.</p>}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Invalidation Conditions</p>
              <div className="mt-2 space-y-1 text-sm">
                {invalidationConditions.length > 0 ? invalidationConditions.map((condition) => (
                  <p key={condition}>- {condition}</p>
                )) : <p className="text-muted-foreground">No invalidations recorded.</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Config and Data Freshness</CardTitle>
            <CardDescription>Symbol config + runtime capture status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Symbol Policy</p>
              <p className="font-semibold">
                {cfg.strategy_version} • {cfg.trigger_policy} • risk {cfg.risk_per_trade_pct}% • cycle lock{" "}
                {cfg.one_trade_per_cycle ? "on" : "off"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">liquidity eps {cfg.liquidity_eps_pips} pips</p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Capture Status</p>
              <p className="font-semibold">
                15m {candles15m.toLocaleString()} • 1m {candles1m.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                gap {asNumber(gapRes.data?.missing_15m_bars, 0)} • baseline{" "}
                {gapRes.data?.baseline_up_to_date ? "up-to-date" : "behind"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                latest 15m {relativeTime(gapRes.data?.last_15m_candle_time)} • target{" "}
                {formatDateTime(gapRes.data?.latest_complete_15m_utc)}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 p-3">
              <p className="text-xs text-muted-foreground">Watch Runtime</p>
              <p className="font-semibold">
                {watch?.watch_mode_active ? "active" : "inactive"} • until{" "}
                {watch?.watch_until ? formatDateTime(watch.watch_until) : "n/a"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                last 15m {relativeTime(watch?.last_baseline_15m_candle_time)} • last 1m{" "}
                {relativeTime(watch?.last_1m_candle_time)}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Opportunity Checks</CardTitle>
            <CardDescription>Last 20 checks with structure phase and reason</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 md:hidden">
              {checks.map((row) => {
                const rowPhoton = asRecord(asRecord(row.details).photon);
                const rowState = asText(rowPhoton.state, "WAIT_HTF");
                const rowReason = asText(rowPhoton.reason, "n/a");
                return (
                  <div key={row.id} className="rounded-xl border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{new Date(row.checked_at).toLocaleString()}</p>
                      <p className="text-sm font-medium">{asNumber(row.setup_score, 0).toFixed(1)}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span>{row.signal_state ?? "none"}</span>
                      <span className="text-muted-foreground">{row.direction ?? "none"}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{stateLabel(rowState)} • {rowReason}</p>
                  </div>
                );
              })}
              {checks.length === 0 && (
                <div className="rounded-xl border border-border/70 p-3 text-center text-sm text-muted-foreground">
                  No checks yet.
                </div>
              )}
            </div>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((row) => {
                    const rowPhoton = asRecord(asRecord(row.details).photon);
                    const rowState = asText(rowPhoton.state, "WAIT_HTF");
                    const rowReason = asText(rowPhoton.reason, "n/a");
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.checked_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {asText(row.signal_state, "none")} / {asText(row.direction, "none")}
                        </TableCell>
                        <TableCell>{stateLabel(rowState)}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">{rowReason}</TableCell>
                        <TableCell className="text-right">{asNumber(row.setup_score, 0).toFixed(1)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {checks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No checks yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Signals</CardTitle>
            <CardDescription>Latest 20 rows from `trading_signals`</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 md:hidden">
              {signals.map((row) => (
                <Link
                  key={row.id}
                  href={`/protected/signals/${row.id}`}
                  className="block rounded-xl border border-border/70 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-primary">#{row.id}</p>
                    <p className="text-sm">{asNumber(row.setup_score, 0).toFixed(1)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</p>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span>{row.signal_state}</span>
                    <span className="text-muted-foreground">{row.direction}</span>
                  </div>
                </Link>
              ))}
              {signals.length === 0 && (
                <div className="rounded-xl border border-border/70 p-3 text-center text-sm text-muted-foreground">
                  No signals yet.
                </div>
              )}
            </div>

            <div className="hidden md:block">
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
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
