export type PhotonDirection = "long" | "short" | "none";
export type PhotonTrend = "bull" | "bear" | "neutral";
export type PhotonMtfBias = "with_htf" | "against_htf" | "neutral";
export type PhotonState =
  | "WAIT_HTF"
  | "WAIT_PULLBACK_END"
  | "WAIT_ZONE"
  | "WAIT_SWEEP"
  | "WAIT_MITIGATION"
  | "WAIT_CHOCH"
  | "READY";

export interface PhotonInputCandle {
  candle_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandleRow {
  ts: string;
  tsMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PivotRow {
  kind: "high" | "low";
  ts: string;
  tsMs: number;
  index: number;
  price: number;
}

interface BosEventRow {
  type: "BOS_UP" | "BOS_DOWN";
  ts: string;
  tsMs: number;
  index: number;
  break_level: number;
  level_ts: string;
  level_ts_ms: number;
}

interface ChochEventRow {
  type: "CHOCH_UP" | "CHOCH_DOWN";
  ts: string;
  tsMs: number;
  index: number;
  break_level: number;
  level_ts: string;
  level_ts_ms: number;
}

interface DealingRange {
  range_high: number;
  range_low: number;
  eq: number;
}

interface PullbackCycle {
  id: string;
  start: BosEventRow;
  end: BosEventRow;
  depth_reached: boolean;
}

interface ZoneRow {
  id: string;
  kind: "demand" | "supply";
  created_ts: string;
  created_ts_ms: number;
  base_start_ts: string;
  base_end_ts: string;
  zone_low: number;
  zone_high: number;
  zone_mid: number;
  invalidated: boolean;
  invalidated_ts: string | null;
  mitigated: boolean;
  mitigated_ts: string | null;
}

interface LiquidityPool {
  id: string;
  kind: "EQH" | "EQL";
  price: number;
  first_ts: string;
  last_ts: string;
  first_ts_ms: number;
  last_ts_ms: number;
  members: number;
  formed_ts_ms: number;
  swept: boolean;
  swept_ts: string | null;
}

interface SweepEvent {
  pool_id: string;
  pool_kind: "EQH" | "EQL";
  type: "SWEEP_UP" | "SWEEP_DOWN";
  ts: string;
  tsMs: number;
  pool_price: number;
}

export interface PhotonEvaluationResult {
  valid: boolean;
  reason: string;
  state: PhotonState;
  side: PhotonDirection;
  cycle_id: string | null;
  entry_ts: string | null;
  entry_price: number | null;
  sl: number | null;
  tp: number | null;
  rr: number | null;
  htf_trend: PhotonTrend;
  htf_last_bos: Record<string, unknown> | null;
  eq_4h: number | null;
  range_4h: Record<string, unknown> | null;
  mtf_last_ibos: Record<string, unknown> | null;
  mtf_bias: PhotonMtfBias;
  eq_15m: number | null;
  range_15m: Record<string, unknown> | null;
  ltf_states: {
    last_micro_bos: Record<string, unknown> | null;
    last_choch: Record<string, unknown> | null;
    last_pivot_high: Record<string, unknown> | null;
    last_pivot_low: Record<string, unknown> | null;
  };
  top_reasons: string[];
  invalidation_conditions: string[];
  details: Record<string, unknown>;
}

const MINUTE_MS = 60_000;
const FIFTEEN_MIN_MS = 15 * MINUTE_MS;
const FOUR_HOUR_MS = 4 * 60 * MINUTE_MS;
const EPS = 1e-10;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

function symbolPipSize(symbol: string | null | undefined): number {
  const normalized = (symbol ?? "").trim().toUpperCase();
  return normalized.includes("JPY") ? 0.01 : 0.0001;
}

function defaultLiquidityEpsPips(symbol: string | null | undefined): number {
  const normalized = (symbol ?? "").trim().toUpperCase();
  return normalized.includes("JPY") ? 0.2 : 2;
}

function normalizeCandles(candles: PhotonInputCandle[]): CandleRow[] {
  const dedupe = new Map<number, CandleRow>();
  for (const row of candles) {
    const ts = new Date(String(row.candle_time));
    const tsMs = ts.getTime();
    if (!Number.isFinite(tsMs)) continue;
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;

    dedupe.set(tsMs, {
      ts: new Date(tsMs).toISOString(),
      tsMs,
      open,
      high,
      low,
      close,
    });
  }
  return [...dedupe.values()].sort((a, b) => a.tsMs - b.tsMs);
}

function aggregateCandles(rows: CandleRow[], bucketMs: number): CandleRow[] {
  const buckets = new Map<number, CandleRow[]>();
  for (const row of rows) {
    const bucketTsMs = Math.floor(row.tsMs / bucketMs) * bucketMs;
    const arr = buckets.get(bucketTsMs) ?? [];
    arr.push(row);
    buckets.set(bucketTsMs, arr);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out: CandleRow[] = [];
  for (const key of keys) {
    const bucketRows = buckets.get(key) ?? [];
    if (bucketRows.length === 0) continue;
    const first = bucketRows[0];
    const last = bucketRows[bucketRows.length - 1];
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    for (const row of bucketRows) {
      if (row.high > high) high = row.high;
      if (row.low < low) low = row.low;
    }

    out.push({
      ts: new Date(key).toISOString(),
      tsMs: key,
      open: first.open,
      high,
      low,
      close: last.close,
    });
  }
  return out;
}

function detectConfirmedPivots(params: {
  rows: CandleRow[];
  left: number;
  right: number;
  asofMs: number;
  tfMs: number;
}): { highs: PivotRow[]; lows: PivotRow[] } {
  const highs: PivotRow[] = [];
  const lows: PivotRow[] = [];
  const n = params.rows.length;
  if (n < params.left + params.right + 1) return { highs, lows };

  const cutoffMs = params.asofMs - params.right * params.tfMs;
  for (let i = params.left; i < n - params.right; i += 1) {
    const row = params.rows[i];
    if (row.tsMs > cutoffMs) break;

    let maxHigh = Number.NEGATIVE_INFINITY;
    let minLow = Number.POSITIVE_INFINITY;
    for (let j = i - params.left; j <= i + params.right; j += 1) {
      const r = params.rows[j];
      if (r.high > maxHigh) maxHigh = r.high;
      if (r.low < minLow) minLow = r.low;
    }

    const isHighCandidate = row.high > maxHigh || almostEqual(row.high, maxHigh);
    const isLowCandidate = row.low < minLow || almostEqual(row.low, minLow);

    let isLatestHighTie = true;
    if (isHighCandidate) {
      for (let j = i + 1; j <= i + params.right; j += 1) {
        if (almostEqual(params.rows[j].high, maxHigh)) {
          isLatestHighTie = false;
          break;
        }
      }
    } else {
      isLatestHighTie = false;
    }

    let isLatestLowTie = true;
    if (isLowCandidate) {
      for (let j = i + 1; j <= i + params.right; j += 1) {
        if (almostEqual(params.rows[j].low, minLow)) {
          isLatestLowTie = false;
          break;
        }
      }
    } else {
      isLatestLowTie = false;
    }

    if (isLatestHighTie) {
      highs.push({
        kind: "high",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        price: row.high,
      });
    }
    if (isLatestLowTie) {
      lows.push({
        kind: "low",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        price: row.low,
      });
    }
  }

  return { highs, lows };
}

function detectStructureEvents(params: {
  rows: CandleRow[];
  pivotHighs: PivotRow[];
  pivotLows: PivotRow[];
}): { bosEvents: BosEventRow[]; chochEvents: ChochEventRow[] } {
  const bosEvents: BosEventRow[] = [];
  const chochEvents: ChochEventRow[] = [];

  let highPtr = 0;
  let lowPtr = 0;
  let lastHighPivot: PivotRow | null = null;
  let lastLowPivot: PivotRow | null = null;

  const bosBrokenHigh = new Set<number>();
  const bosBrokenLow = new Set<number>();
  const chochBrokenHigh = new Set<number>();
  const chochBrokenLow = new Set<number>();

  for (let i = 0; i < params.rows.length; i += 1) {
    const row = params.rows[i];

    while (highPtr < params.pivotHighs.length && params.pivotHighs[highPtr].index <= i) {
      lastHighPivot = params.pivotHighs[highPtr];
      highPtr += 1;
    }
    while (lowPtr < params.pivotLows.length && params.pivotLows[lowPtr].index <= i) {
      lastLowPivot = params.pivotLows[lowPtr];
      lowPtr += 1;
    }

    if (lastHighPivot && row.close > lastHighPivot.price && !bosBrokenHigh.has(lastHighPivot.index)) {
      bosBrokenHigh.add(lastHighPivot.index);
      bosEvents.push({
        type: "BOS_UP",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        break_level: lastHighPivot.price,
        level_ts: lastHighPivot.ts,
        level_ts_ms: lastHighPivot.tsMs,
      });
    }

    if (lastLowPivot && row.close < lastLowPivot.price && !bosBrokenLow.has(lastLowPivot.index)) {
      bosBrokenLow.add(lastLowPivot.index);
      bosEvents.push({
        type: "BOS_DOWN",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        break_level: lastLowPivot.price,
        level_ts: lastLowPivot.ts,
        level_ts_ms: lastLowPivot.tsMs,
      });
    }

    if (lastHighPivot && row.high > lastHighPivot.price && !chochBrokenHigh.has(lastHighPivot.index)) {
      chochBrokenHigh.add(lastHighPivot.index);
      chochEvents.push({
        type: "CHOCH_UP",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        break_level: lastHighPivot.price,
        level_ts: lastHighPivot.ts,
        level_ts_ms: lastHighPivot.tsMs,
      });
    }

    if (lastLowPivot && row.low < lastLowPivot.price && !chochBrokenLow.has(lastLowPivot.index)) {
      chochBrokenLow.add(lastLowPivot.index);
      chochEvents.push({
        type: "CHOCH_DOWN",
        ts: row.ts,
        tsMs: row.tsMs,
        index: i,
        break_level: lastLowPivot.price,
        level_ts: lastLowPivot.ts,
        level_ts_ms: lastLowPivot.tsMs,
      });
    }
  }

  return { bosEvents, chochEvents };
}

function latestEvent<T extends { tsMs: number }>(events: T[]): T | null {
  return events.length > 0 ? events[events.length - 1] : null;
}

function latestPivotBefore(pivots: PivotRow[], tsMs: number): PivotRow | null {
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    if (pivots[i].tsMs < tsMs) return pivots[i];
  }
  return null;
}

function buildRangeFromLastBos(params: {
  lastBos: BosEventRow | null;
  pivotsHigh: PivotRow[];
  pivotsLow: PivotRow[];
}): DealingRange | null {
  if (!params.lastBos) return null;

  if (params.lastBos.type === "BOS_UP") {
    const lowBefore = latestPivotBefore(params.pivotsLow, params.lastBos.tsMs);
    if (!lowBefore) return null;
    const rangeHigh = params.lastBos.break_level;
    const rangeLow = lowBefore.price;
    return {
      range_high: rangeHigh,
      range_low: rangeLow,
      eq: (rangeHigh + rangeLow) / 2,
    };
  }

  const highBefore = latestPivotBefore(params.pivotsHigh, params.lastBos.tsMs);
  if (!highBefore) return null;
  const rangeLow = params.lastBos.break_level;
  const rangeHigh = highBefore.price;
  return {
    range_high: rangeHigh,
    range_low: rangeLow,
    eq: (rangeHigh + rangeLow) / 2,
  };
}

function formatBosEvent(event: BosEventRow | null): Record<string, unknown> | null {
  if (!event) return null;
  return {
    type: event.type,
    ts: event.ts,
    break_level: round(event.break_level, 6),
    level_ts: event.level_ts,
  };
}

function formatPivot(pivot: PivotRow | null): Record<string, unknown> | null {
  if (!pivot) return null;
  return {
    kind: pivot.kind,
    ts: pivot.ts,
    price: round(pivot.price, 6),
  };
}

function formatChochEvent(event: ChochEventRow | null): Record<string, unknown> | null {
  if (!event) return null;
  return {
    type: event.type,
    ts: event.ts,
    break_level: round(event.break_level, 6),
    level_ts: event.level_ts,
  };
}

function formatRange(range: DealingRange | null): Record<string, unknown> | null {
  if (!range) return null;
  return {
    range_high: round(range.range_high, 6),
    range_low: round(range.range_low, 6),
    eq: round(range.eq, 6),
  };
}

function nearestWeakTarget(params: {
  trend: PhotonTrend;
  entryPrice: number;
  pivots4hHigh: PivotRow[];
  pivots4hLow: PivotRow[];
}): number | null {
  if (params.trend === "bull") {
    const candidates = params.pivots4hHigh
      .map((row) => row.price)
      .filter((price) => price > params.entryPrice);
    if (candidates.length === 0) return null;
    return Math.min(...candidates);
  }

  if (params.trend === "bear") {
    const candidates = params.pivots4hLow
      .map((row) => row.price)
      .filter((price) => price < params.entryPrice);
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
  }

  return null;
}

function findLatestPullbackCycle(params: {
  htfTrend: PhotonTrend;
  last4hBos: BosEventRow | null;
  eq4h: number;
  rows15m: CandleRow[];
  events15m: BosEventRow[];
}): {
  cycle: PullbackCycle | null;
  waitingForPullbackEnd: boolean;
  latestStartTs: string | null;
  latestEndTs: string | null;
  structural_seen: boolean;
  depth_seen: boolean;
} {
  if (!params.last4hBos || params.htfTrend === "neutral") {
    return {
      cycle: null,
      waitingForPullbackEnd: true,
      latestStartTs: null,
      latestEndTs: null,
      structural_seen: false,
      depth_seen: false,
    };
  }

  const startType = params.htfTrend === "bull" ? "BOS_DOWN" : "BOS_UP";
  const endType = params.htfTrend === "bull" ? "BOS_UP" : "BOS_DOWN";

  const scopedEvents = params.events15m.filter((event) => event.tsMs > params.last4hBos!.tsMs);
  const startEvents = scopedEvents.filter((event) => event.type === startType);
  const endEvents = scopedEvents.filter((event) => event.type === endType);

  const latestStart = startEvents.length > 0 ? startEvents[startEvents.length - 1] : null;
  const latestEnd = endEvents.length > 0 ? endEvents[endEvents.length - 1] : null;

  const structuralSeen = startEvents.length > 0;
  const depthSeen = params.htfTrend === "bull"
    ? params.rows15m.some((row) => row.tsMs > params.last4hBos!.tsMs && row.close <= params.eq4h)
    : params.rows15m.some((row) => row.tsMs > params.last4hBos!.tsMs && row.close >= params.eq4h);

  let chosen: PullbackCycle | null = null;
  for (const endEvent of endEvents) {
    let startEvent: BosEventRow | null = null;
    for (let i = startEvents.length - 1; i >= 0; i -= 1) {
      if (startEvents[i].tsMs < endEvent.tsMs) {
        startEvent = startEvents[i];
        break;
      }
    }
    if (!startEvent) continue;

    const depthReached = params.htfTrend === "bull"
      ? params.rows15m.some((row) => row.tsMs >= startEvent.tsMs && row.tsMs <= endEvent.tsMs && row.close <= params.eq4h)
      : params.rows15m.some((row) => row.tsMs >= startEvent.tsMs && row.tsMs <= endEvent.tsMs && row.close >= params.eq4h);

    if (!depthReached) continue;

    chosen = {
      id: `${params.htfTrend}:${startEvent.ts}:${endEvent.ts}`,
      start: startEvent,
      end: endEvent,
      depth_reached: true,
    };
  }

  const waitingForPullbackEnd = latestStart !== null && (latestEnd === null || latestStart.tsMs > latestEnd.tsMs);

  return {
    cycle: chosen,
    waitingForPullbackEnd,
    latestStartTs: latestStart?.ts ?? null,
    latestEndTs: latestEnd?.ts ?? null,
    structural_seen: structuralSeen,
    depth_seen: depthSeen,
  };
}

function build15mZones(params: {
  rows15m: CandleRow[];
  bosEvents15m: BosEventRow[];
  asofMs: number;
  pipSize: number;
  zoneBaseCandles: number;
  zoneImpulseCandles: number;
  zoneBaseMaxPips: number;
  zoneImpulsePips: number;
  zoneInvalidationPips: number;
}): ZoneRow[] {
  const zones: ZoneRow[] = [];
  const n = params.rows15m.length;
  const k = params.zoneBaseCandles;
  const m = params.zoneImpulseCandles;
  const baseMax = params.zoneBaseMaxPips * params.pipSize;
  const impulseMin = params.zoneImpulsePips * params.pipSize;
  const inv = params.zoneInvalidationPips * params.pipSize;

  if (n < k + m) return zones;

  const bosByIndex = new Map<number, BosEventRow[]>();
  for (const event of params.bosEvents15m) {
    const arr = bosByIndex.get(event.index) ?? [];
    arr.push(event);
    bosByIndex.set(event.index, arr);
  }

  for (let start = 0; start + k + m - 1 < n; start += 1) {
    const baseRows = params.rows15m.slice(start, start + k);
    const impulseStart = start + k;
    const impulseEnd = impulseStart + m - 1;
    if (impulseEnd >= n) break;

    const impulseRows = params.rows15m.slice(impulseStart, impulseEnd + 1);
    if (impulseRows[impulseRows.length - 1].tsMs > params.asofMs) break;

    const baseHigh = Math.max(...baseRows.map((row) => row.high));
    const baseLow = Math.min(...baseRows.map((row) => row.low));
    const baseMid = (baseHigh + baseLow) / 2;
    const baseRange = baseHigh - baseLow;
    if (baseRange > baseMax) continue;

    const maxOc = Math.max(...baseRows.map((row) => Math.max(row.open, row.close)));
    const minOc = Math.min(...baseRows.map((row) => Math.min(row.open, row.close)));

    const impulseMaxHigh = Math.max(...impulseRows.map((row) => row.high));
    const impulseMinLow = Math.min(...impulseRows.map((row) => row.low));
    const impulseMinLowDuringUp = Math.min(...impulseRows.map((row) => row.low));
    const impulseMaxHighDuringDown = Math.max(...impulseRows.map((row) => row.high));

    const upImpulse = impulseMaxHigh - baseHigh >= impulseMin && impulseMinLowDuringUp >= baseMid;
    const downImpulse = baseLow - impulseMinLow >= impulseMin && impulseMaxHighDuringDown <= baseMid;

    let demandBosIndex: number | null = null;
    let supplyBosIndex: number | null = null;
    for (let idx = impulseStart; idx <= impulseEnd; idx += 1) {
      const eventsAt = bosByIndex.get(idx) ?? [];
      if (demandBosIndex === null && eventsAt.some((event) => event.type === "BOS_UP")) {
        demandBosIndex = idx;
      }
      if (supplyBosIndex === null && eventsAt.some((event) => event.type === "BOS_DOWN")) {
        supplyBosIndex = idx;
      }
    }

    if (upImpulse && demandBosIndex !== null) {
      const zoneLow = baseLow;
      const zoneHigh = maxOc;
      const zoneMid = (zoneLow + zoneHigh) / 2;
      const createdAt = params.rows15m[demandBosIndex];

      let invalidatedTs: string | null = null;
      let mitigatedTs: string | null = null;
      for (let j = demandBosIndex + 1; j < n; j += 1) {
        const row = params.rows15m[j];
        if (row.tsMs > params.asofMs) break;
        if (mitigatedTs === null && row.low <= zoneMid && row.high >= zoneMid) {
          mitigatedTs = row.ts;
        }
        if (row.close < zoneLow - inv) {
          invalidatedTs = row.ts;
          break;
        }
      }

      zones.push({
        id: `demand:${params.rows15m[start].ts}:${createdAt.ts}`,
        kind: "demand",
        created_ts: createdAt.ts,
        created_ts_ms: createdAt.tsMs,
        base_start_ts: params.rows15m[start].ts,
        base_end_ts: params.rows15m[start + k - 1].ts,
        zone_low: zoneLow,
        zone_high: zoneHigh,
        zone_mid: zoneMid,
        mitigated: mitigatedTs !== null,
        mitigated_ts: mitigatedTs,
        invalidated: invalidatedTs !== null,
        invalidated_ts: invalidatedTs,
      });
    }

    if (downImpulse && supplyBosIndex !== null) {
      const zoneHigh = baseHigh;
      const zoneLow = minOc;
      const zoneMid = (zoneLow + zoneHigh) / 2;
      const createdAt = params.rows15m[supplyBosIndex];

      let invalidatedTs: string | null = null;
      let mitigatedTs: string | null = null;
      for (let j = supplyBosIndex + 1; j < n; j += 1) {
        const row = params.rows15m[j];
        if (row.tsMs > params.asofMs) break;
        if (mitigatedTs === null && row.low <= zoneMid && row.high >= zoneMid) {
          mitigatedTs = row.ts;
        }
        if (row.close > zoneHigh + inv) {
          invalidatedTs = row.ts;
          break;
        }
      }

      zones.push({
        id: `supply:${params.rows15m[start].ts}:${createdAt.ts}`,
        kind: "supply",
        created_ts: createdAt.ts,
        created_ts_ms: createdAt.tsMs,
        base_start_ts: params.rows15m[start].ts,
        base_end_ts: params.rows15m[start + k - 1].ts,
        zone_low: zoneLow,
        zone_high: zoneHigh,
        zone_mid: zoneMid,
        mitigated: mitigatedTs !== null,
        mitigated_ts: mitigatedTs,
        invalidated: invalidatedTs !== null,
        invalidated_ts: invalidatedTs,
      });
    }
  }

  const dedupe = new Map<string, ZoneRow>();
  for (const zone of zones) {
    const key = `${zone.kind}|${round(zone.zone_low, 6)}|${round(zone.zone_high, 6)}|${zone.created_ts}`;
    dedupe.set(key, zone);
  }

  return [...dedupe.values()].sort((a, b) => a.created_ts_ms - b.created_ts_ms);
}

function findActiveZone(params: {
  zones: ZoneRow[];
  side: PhotonDirection;
  currentPrice: number;
  asofMs: number;
  minCreatedTsMs: number;
}): ZoneRow | null {
  const desiredKind = params.side === "long" ? "demand" : "supply";
  const candidates = params.zones
    .filter((zone) =>
      zone.kind === desiredKind &&
      !zone.invalidated &&
      zone.created_ts_ms <= params.asofMs &&
      zone.created_ts_ms >= params.minCreatedTsMs &&
      params.currentPrice >= zone.zone_low &&
      params.currentPrice <= zone.zone_high
    )
    .sort((a, b) => b.created_ts_ms - a.created_ts_ms);

  return candidates[0] ?? null;
}

function buildLiquidityPools(params: {
  pivots: PivotRow[];
  kind: "EQH" | "EQL";
  epsPrice: number;
  minTsMs: number;
}): LiquidityPool[] {
  const pools: LiquidityPool[] = [];

  for (const pivot of params.pivots) {
    if (pivot.tsMs < params.minTsMs) continue;

    let targetIndex = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pools.length; i += 1) {
      const pool = pools[i];
      const diff = Math.abs(pool.price - pivot.price);
      if (diff <= params.epsPrice && diff < bestDiff) {
        bestDiff = diff;
        targetIndex = i;
      }
    }

    if (targetIndex === -1) {
      pools.push({
        id: `${params.kind}:${pivot.ts}:${round(pivot.price, 6)}`,
        kind: params.kind,
        price: pivot.price,
        first_ts: pivot.ts,
        last_ts: pivot.ts,
        first_ts_ms: pivot.tsMs,
        last_ts_ms: pivot.tsMs,
        members: 1,
        formed_ts_ms: Number.POSITIVE_INFINITY,
        swept: false,
        swept_ts: null,
      });
      continue;
    }

    const pool = pools[targetIndex];
    const nextMembers = pool.members + 1;
    const nextPrice = (pool.price * pool.members + pivot.price) / nextMembers;
    pool.price = nextPrice;
    pool.members = nextMembers;
    pool.last_ts = pivot.ts;
    pool.last_ts_ms = pivot.tsMs;
    if (pool.members >= 2 && !Number.isFinite(pool.formed_ts_ms)) {
      pool.formed_ts_ms = pivot.tsMs;
    }
  }

  return pools.filter((pool) => pool.members >= 2).sort((a, b) => a.formed_ts_ms - b.formed_ts_ms);
}

function detectSweeps(params: {
  rows1m: CandleRow[];
  pools: LiquidityPool[];
  epsPrice: number;
  minTsMs: number;
}): SweepEvent[] {
  const sweeps: SweepEvent[] = [];

  for (const row of params.rows1m) {
    if (row.tsMs < params.minTsMs) continue;

    for (const pool of params.pools) {
      if (pool.swept) continue;
      if (row.tsMs < pool.formed_ts_ms) continue;

      if (pool.kind === "EQH") {
        const wickAbove = row.high >= pool.price + params.epsPrice;
        const closeBackBelow = row.close < pool.price;
        if (wickAbove && closeBackBelow) {
          pool.swept = true;
          pool.swept_ts = row.ts;
          sweeps.push({
            pool_id: pool.id,
            pool_kind: pool.kind,
            type: "SWEEP_UP",
            ts: row.ts,
            tsMs: row.tsMs,
            pool_price: pool.price,
          });
        }
      } else {
        const wickBelow = row.low <= pool.price - params.epsPrice;
        const closeBackAbove = row.close > pool.price;
        if (wickBelow && closeBackAbove) {
          pool.swept = true;
          pool.swept_ts = row.ts;
          sweeps.push({
            pool_id: pool.id,
            pool_kind: pool.kind,
            type: "SWEEP_DOWN",
            ts: row.ts,
            tsMs: row.tsMs,
            pool_price: pool.price,
          });
        }
      }
    }
  }

  return sweeps.sort((a, b) => a.tsMs - b.tsMs);
}

function latestChochAfter(params: {
  chochEvents: ChochEventRow[];
  minTsMs: number;
  type: "CHOCH_UP" | "CHOCH_DOWN";
}): ChochEventRow | null {
  const filtered = params.chochEvents.filter((event) => event.tsMs > params.minTsMs && event.type === params.type);
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

export function evaluatePhotonStructure(params: {
  candles1m: PhotonInputCandle[];
  symbol?: string | null;
  asofUtc?: string | Date | null;
  minRr?: number;
  maxLtfCandles?: number;
  zoneBaseCandles?: number;
  zoneImpulseCandles?: number;
  zoneBaseMaxPips?: number;
  zoneImpulsePips?: number;
  zoneInvalidationPips?: number;
  liquidityEpsPips?: number;
}): PhotonEvaluationResult {
  const rawRows = normalizeCandles(params.candles1m);
  const maxLtfCandles = params.maxLtfCandles && params.maxLtfCandles > 500
    ? Math.trunc(params.maxLtfCandles)
    : 120_000;

  const initialAsOfMs = (() => {
    if (params.asofUtc instanceof Date) return params.asofUtc.getTime();
    if (typeof params.asofUtc === "string" && params.asofUtc.trim()) {
      const parsed = new Date(params.asofUtc);
      if (Number.isFinite(parsed.getTime())) return parsed.getTime();
    }
    if (rawRows.length > 0) return rawRows[rawRows.length - 1].tsMs;
    return Date.now();
  })();

  const rowsUpToAsof = rawRows.filter((row) => row.tsMs <= initialAsOfMs);
  const rows1m = rowsUpToAsof.length > maxLtfCandles
    ? rowsUpToAsof.slice(rowsUpToAsof.length - maxLtfCandles)
    : rowsUpToAsof;

  const asofMs = rows1m.length > 0 ? rows1m[rows1m.length - 1].tsMs : initialAsOfMs;
  const symbol = (params.symbol ?? "").trim().toUpperCase();
  const pip = symbolPipSize(symbol);

  const zoneBaseCandles = Math.max(3, Math.min(5, Math.trunc(params.zoneBaseCandles ?? 3)));
  const zoneImpulseCandles = Math.max(1, Math.min(6, Math.trunc(params.zoneImpulseCandles ?? 3)));
  const zoneBaseMaxPips = Math.max(1, Number(params.zoneBaseMaxPips ?? 12));
  const zoneImpulsePips = Math.max(1, Number(params.zoneImpulsePips ?? 20));
  const zoneInvalidationPips = Math.max(0.1, Number(params.zoneInvalidationPips ?? 1));
  const liquidityEpsPips = Math.max(0.01, Number(params.liquidityEpsPips ?? defaultLiquidityEpsPips(symbol)));
  const epsPrice = liquidityEpsPips * pip;
  const rrGate = Number.isFinite(params.minRr) ? Math.max(0, Number(params.minRr)) : 2;

  const baseResult = (reason: string, state: PhotonState, overrides: Partial<PhotonEvaluationResult> = {}): PhotonEvaluationResult => ({
    valid: false,
    reason,
    state,
    side: "none",
    cycle_id: null,
    entry_ts: null,
    entry_price: null,
    sl: null,
    tp: null,
    rr: null,
    htf_trend: "neutral",
    htf_last_bos: null,
    eq_4h: null,
    range_4h: null,
    mtf_last_ibos: null,
    mtf_bias: "neutral",
    eq_15m: null,
    range_15m: null,
    ltf_states: {
      last_micro_bos: null,
      last_choch: null,
      last_pivot_high: null,
      last_pivot_low: null,
    },
    top_reasons: [],
    invalidation_conditions: [],
    details: {},
    ...overrides,
  });

  if (rows1m.length < 2_500) {
    return baseResult("insufficient_1m_history", "WAIT_HTF", {
      details: {
        required_1m_candles: 2500,
        available_1m_candles: rows1m.length,
      },
    });
  }

  const rows15m = aggregateCandles(rows1m, FIFTEEN_MIN_MS);
  const rows4h = aggregateCandles(rows1m, FOUR_HOUR_MS);
  if (rows15m.length < 80 || rows4h.length < 40) {
    return baseResult("insufficient_aggregated_history", "WAIT_HTF", {
      details: {
        available_15m_candles: rows15m.length,
        available_4h_candles: rows4h.length,
      },
    });
  }

  const pivots4h = detectConfirmedPivots({ rows: rows4h, left: 5, right: 5, asofMs, tfMs: FOUR_HOUR_MS });
  const pivots15m = detectConfirmedPivots({ rows: rows15m, left: 3, right: 3, asofMs, tfMs: FIFTEEN_MIN_MS });
  const pivots1m = detectConfirmedPivots({ rows: rows1m, left: 1, right: 1, asofMs, tfMs: MINUTE_MS });

  const events4h = detectStructureEvents({ rows: rows4h, pivotHighs: pivots4h.highs, pivotLows: pivots4h.lows });
  const events15m = detectStructureEvents({ rows: rows15m, pivotHighs: pivots15m.highs, pivotLows: pivots15m.lows });
  const events1m = detectStructureEvents({ rows: rows1m, pivotHighs: pivots1m.highs, pivotLows: pivots1m.lows });

  const last4hBos = latestEvent(events4h.bosEvents);
  const last15mBos = latestEvent(events15m.bosEvents);
  const last1mBos = latestEvent(events1m.bosEvents);
  const last1mChoch = latestEvent(events1m.chochEvents);

  const htfTrend: PhotonTrend = last4hBos
    ? (last4hBos.type === "BOS_UP" ? "bull" : "bear")
    : "neutral";

  const range4h = buildRangeFromLastBos({ lastBos: last4hBos, pivotsHigh: pivots4h.highs, pivotsLow: pivots4h.lows });
  const last15mBosWithHtf = htfTrend === "neutral"
    ? null
    : [...events15m.bosEvents]
      .reverse()
      .find((event) => htfTrend === "bull" ? event.type === "BOS_UP" : event.type === "BOS_DOWN") ?? null;

  const range15m = buildRangeFromLastBos({
    lastBos: last15mBosWithHtf,
    pivotsHigh: pivots15m.highs,
    pivotsLow: pivots15m.lows,
  });

  let mtfBias: PhotonMtfBias = "neutral";
  if (htfTrend !== "neutral" && last15mBos) {
    if (htfTrend === "bull") {
      mtfBias = last15mBos.type === "BOS_UP" ? "with_htf" : "against_htf";
    } else {
      mtfBias = last15mBos.type === "BOS_DOWN" ? "with_htf" : "against_htf";
    }
  }

  const lastPivotHigh1m = pivots1m.highs.length > 0 ? pivots1m.highs[pivots1m.highs.length - 1] : null;
  const lastPivotLow1m = pivots1m.lows.length > 0 ? pivots1m.lows[pivots1m.lows.length - 1] : null;

  const commonState = {
    htf_trend: htfTrend,
    htf_last_bos: formatBosEvent(last4hBos),
    eq_4h: range4h ? round(range4h.eq, 6) : null,
    range_4h: formatRange(range4h),
    mtf_last_ibos: formatBosEvent(last15mBosWithHtf ?? last15mBos),
    mtf_bias: mtfBias,
    eq_15m: range15m ? round(range15m.eq, 6) : null,
    range_15m: formatRange(range15m),
    ltf_states: {
      last_micro_bos: formatBosEvent(last1mBos),
      last_choch: formatChochEvent(last1mChoch),
      last_pivot_high: formatPivot(lastPivotHigh1m),
      last_pivot_low: formatPivot(lastPivotLow1m),
    },
  };

  if (htfTrend === "neutral") {
    return baseResult("htf_trend_neutral", "WAIT_HTF", {
      ...commonState,
      details: {
        reason_detail: "No confirmed 4H BOS event available.",
      },
    });
  }

  if (!range4h) {
    return baseResult("eq_4h_unavailable", "WAIT_HTF", {
      ...commonState,
      details: {
        reason_detail: "Could not build 4H dealing range from last BOS.",
      },
    });
  }

  if (!last15mBosWithHtf || !range15m) {
    return baseResult("eq_15m_unavailable", "WAIT_PULLBACK_END", {
      ...commonState,
      side: htfTrend === "bull" ? "long" : "short",
      details: {
        reason_detail: "Could not build 15M dealing range from last iBOS aligned with HTF.",
      },
    });
  }

  const cycleInfo = findLatestPullbackCycle({
    htfTrend,
    last4hBos,
    eq4h: range4h.eq,
    rows15m,
    events15m: events15m.bosEvents,
  });

  const cycle = cycleInfo.cycle;
  if (!cycle || cycleInfo.waitingForPullbackEnd) {
    return baseResult("pullback_cycle_not_completed", "WAIT_PULLBACK_END", {
      ...commonState,
      side: htfTrend === "bull" ? "long" : "short",
      details: {
        pullback_structural_seen: cycleInfo.structural_seen,
        pullback_depth_eq4h_seen: cycleInfo.depth_seen,
        latest_pullback_start_ts: cycleInfo.latestStartTs,
        latest_pullback_end_ts: cycleInfo.latestEndTs,
      },
    });
  }

  const desiredSide: PhotonDirection = htfTrend === "bull" ? "long" : "short";
  const current1m = rows1m[rows1m.length - 1];

  const zones15m = build15mZones({
    rows15m,
    bosEvents15m: events15m.bosEvents,
    asofMs,
    pipSize: pip,
    zoneBaseCandles,
    zoneImpulseCandles,
    zoneBaseMaxPips,
    zoneImpulsePips,
    zoneInvalidationPips,
  });

  const activeZone = findActiveZone({
    zones: zones15m,
    side: desiredSide,
    currentPrice: current1m.close,
    asofMs,
    minCreatedTsMs: cycle.start.tsMs,
  });

  if (!activeZone) {
    return baseResult("zone_gate_not_satisfied", "WAIT_ZONE", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        cycle_start_ts: cycle.start.ts,
        cycle_end_ts: cycle.end.ts,
        current_price: round(current1m.close, 6),
        zones_built: zones15m.length,
        aligned_zone_inside_count: zones15m.filter((zone) =>
          zone.kind === (desiredSide === "long" ? "demand" : "supply") &&
          !zone.invalidated &&
          current1m.close >= zone.zone_low &&
          current1m.close <= zone.zone_high
        ).length,
      },
    });
  }

  const pools1mHigh = buildLiquidityPools({
    pivots: pivots1m.highs,
    kind: "EQH",
    epsPrice,
    minTsMs: cycle.start.tsMs,
  });
  const pools1mLow = buildLiquidityPools({
    pivots: pivots1m.lows,
    kind: "EQL",
    epsPrice,
    minTsMs: cycle.start.tsMs,
  });

  const sweeps = detectSweeps({
    rows1m,
    pools: [...pools1mHigh, ...pools1mLow],
    epsPrice,
    minTsMs: cycle.end.tsMs,
  });

  const desiredSweepType = desiredSide === "long" ? "SWEEP_DOWN" : "SWEEP_UP";
  const sweep = sweeps
    .filter((event) =>
      event.type === desiredSweepType &&
      event.tsMs > cycle.end.tsMs
    )
    .filter((event) => {
      const row = rows1m.find((candle) => candle.tsMs === event.tsMs);
      if (!row) return false;
      return row.high >= activeZone.zone_low && row.low <= activeZone.zone_high;
    })
    .slice(-1)[0] ?? null;

  if (!sweep) {
    return baseResult("liquidity_sweep_not_found", "WAIT_SWEEP", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        active_zone_id: activeZone.id,
        active_zone_kind: activeZone.kind,
        active_zone_low: round(activeZone.zone_low, 6),
        active_zone_high: round(activeZone.zone_high, 6),
        active_zone_mid: round(activeZone.zone_mid, 6),
        liquidity_eps_pips: liquidityEpsPips,
        pools_1m_eqh: pools1mHigh.length,
        pools_1m_eql: pools1mLow.length,
        sweep_candidates: sweeps.filter((event) => event.type === desiredSweepType).length,
      },
    });
  }

  const mitigationTouch = rows1m.find((row) => row.tsMs > sweep.tsMs && row.low <= activeZone.zone_mid && row.high >= activeZone.zone_mid) ?? null;
  if (!mitigationTouch) {
    return baseResult("zone_midpoint_not_mitigated_after_sweep", "WAIT_MITIGATION", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        sweep_ts: sweep.ts,
        active_zone_id: activeZone.id,
        zone_mid: round(activeZone.zone_mid, 6),
      },
    });
  }

  const requiredChochType = desiredSide === "long" ? "CHOCH_UP" : "CHOCH_DOWN";
  const choch = latestChochAfter({
    chochEvents: events1m.chochEvents,
    minTsMs: mitigationTouch.tsMs,
    type: requiredChochType,
  });

  if (!choch) {
    return baseResult("choch_trigger_not_ready", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        sweep_ts: sweep.ts,
        mitigation_ts: mitigationTouch.ts,
        required_choch: requiredChochType,
      },
    });
  }

  const entryCandle = rows1m[choch.index + 1] ?? null;
  if (!entryCandle) {
    return baseResult("entry_candle_not_available", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        choch_ts: choch.ts,
      },
    });
  }

  const entryPrice = entryCandle.open;
  const slPivot = desiredSide === "long"
    ? latestPivotBefore(pivots1m.lows, entryCandle.tsMs)
    : latestPivotBefore(pivots1m.highs, entryCandle.tsMs);

  if (!slPivot) {
    return baseResult("stop_pivot_not_found", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        entry_ts: entryCandle.ts,
      },
    });
  }

  const sl = slPivot.price;
  if ((desiredSide === "long" && !(sl < entryPrice)) || (desiredSide === "short" && !(sl > entryPrice))) {
    return baseResult("invalid_stop_side", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        entry_price: round(entryPrice, 6),
        stop_loss: round(sl, 6),
      },
    });
  }

  const tp = nearestWeakTarget({
    trend: htfTrend,
    entryPrice,
    pivots4hHigh: pivots4h.highs,
    pivots4hLow: pivots4h.lows,
  });

  if (tp === null) {
    return baseResult("weak_target_not_found", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        entry_price: round(entryPrice, 6),
      },
    });
  }

  if ((desiredSide === "long" && !(tp > entryPrice)) || (desiredSide === "short" && !(tp < entryPrice))) {
    return baseResult("invalid_target_side", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        entry_price: round(entryPrice, 6),
        target_price: round(tp, 6),
      },
    });
  }

  const riskDistance = Math.abs(entryPrice - sl);
  if (!(riskDistance > 0)) {
    return baseResult("invalid_risk_distance", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
    });
  }

  const rr = Math.abs(tp - entryPrice) / riskDistance;
  if (rr < rrGate) {
    return baseResult("rr_below_threshold", "WAIT_CHOCH", {
      ...commonState,
      side: desiredSide,
      cycle_id: cycle.id,
      details: {
        cycle_id: cycle.id,
        rr: round(rr, 4),
        rr_threshold: rrGate,
      },
    });
  }

  const topReasons = [
    desiredSide === "long"
      ? "4H trend bull, 15M pullback cycle completed with EQ_4H depth"
      : "4H trend bear, 15M pullback cycle completed with EQ_4H depth",
    desiredSide === "long"
      ? "Price inside valid 15M demand zone + 1M sweep down confirmed"
      : "Price inside valid 15M supply zone + 1M sweep up confirmed",
    desiredSide === "long"
      ? "Zone midpoint mitigated, then 1M CHOCH_UP triggered"
      : "Zone midpoint mitigated, then 1M CHOCH_DOWN triggered",
  ];

  const invalidationConditions = desiredSide === "long"
    ? [
      `Invalidate if 1M close < ${round(activeZone.zone_low - zoneInvalidationPips * pip, 6)}`,
      `Invalidate if stop (${round(sl, 6)}) is breached before TP`,
    ]
    : [
      `Invalidate if 1M close > ${round(activeZone.zone_high + zoneInvalidationPips * pip, 6)}`,
      `Invalidate if stop (${round(sl, 6)}) is breached before TP`,
    ];

  return {
    valid: true,
    reason: "ok",
    state: "READY",
    side: desiredSide,
    cycle_id: cycle.id,
    entry_ts: entryCandle.ts,
    entry_price: round(entryPrice, 6),
    sl: round(sl, 6),
    tp: round(tp, 6),
    rr: round(rr, 4),
    ...commonState,
    top_reasons: topReasons,
    invalidation_conditions: invalidationConditions,
    details: {
      cycle_id: cycle.id,
      cycle_start_ts: cycle.start.ts,
      cycle_end_ts: cycle.end.ts,
      cycle_depth_reached: cycle.depth_reached,
      pullback_start_type: cycle.start.type,
      pullback_end_type: cycle.end.type,
      zone: {
        id: activeZone.id,
        kind: activeZone.kind,
        low: round(activeZone.zone_low, 6),
        high: round(activeZone.zone_high, 6),
        mid: round(activeZone.zone_mid, 6),
        mitigated: activeZone.mitigated,
        mitigated_ts: activeZone.mitigated_ts,
      },
      sweep: {
        type: sweep.type,
        ts: sweep.ts,
        pool_kind: sweep.pool_kind,
        pool_price: round(sweep.pool_price, 6),
      },
      mitigation_touch_ts: mitigationTouch.ts,
      trigger: {
        choch_type: choch.type,
        choch_ts: choch.ts,
      },
      pip_size: pip,
      liquidity_eps_pips: liquidityEpsPips,
      rr_threshold: rrGate,
      pivot_counts: {
        h4_highs: pivots4h.highs.length,
        h4_lows: pivots4h.lows.length,
        m15_highs: pivots15m.highs.length,
        m15_lows: pivots15m.lows.length,
        m1_highs: pivots1m.highs.length,
        m1_lows: pivots1m.lows.length,
      },
      zones_built: zones15m.length,
      pools_1m_eqh: pools1mHigh.length,
      pools_1m_eql: pools1mLow.length,
      sweeps_detected: sweeps.length,
      asof_utc: new Date(asofMs).toISOString(),
    },
  };
}
