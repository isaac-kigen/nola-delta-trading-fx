import {
  buildEdgeFunctionLinks,
  buildMockSystemSnapshot,
  fxUniverse,
  marketSnapshot as mockMarketSnapshot,
} from '@/lib/system-mock-data';
import type {
  LatestValidationSummary,
  MarketSnapshotRow,
  OpsEvent,
  OpsRun,
  SignalDirection,
  SignalState,
  SyncSymbolRow,
  SystemActionName,
  SystemActionResult,
  SystemSnapshot,
} from '@/lib/system-types';

interface SupabaseServerConfig {
  url: string;
  serviceRoleKey: string;
}

interface OpsFunctionRunRow {
  id: number;
  function_name: string;
  trace_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  payload: unknown;
}

interface TradingCheckRow {
  symbol: string;
  signal_state: string;
  setup_score: number | string | null;
  direction: string;
  trigger_policy: string | null;
  spread_pips: number | string | null;
  regime_passed: boolean | null;
  should_notify: boolean | null;
  telegram_notified: boolean | null;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  top_reasons: unknown;
  invalidation_conditions: unknown;
  latest_price: number | string | null;
  latest_candle_time: string | null;
  checked_at: string;
  details: unknown;
  trace_id: string | null;
}

const DEFAULT_API_LIMIT_PER_MINUTE = 60;
const DEFAULT_API_LIMIT_PER_DAY = 1_000;

function parseEnvInt(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SYNC_LIMIT_PER_MINUTE = parseEnvInt(
  'FINNHUB_API_CALLS_PER_MINUTE',
  parseEnvInt('SYNC_API_LIMIT_PER_MINUTE', DEFAULT_API_LIMIT_PER_MINUTE),
);
const SYNC_LIMIT_PER_DAY = parseEnvInt(
  'FINNHUB_API_CALLS_PER_DAY',
  parseEnvInt('SYNC_API_LIMIT_PER_DAY', DEFAULT_API_LIMIT_PER_DAY),
);

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function parseObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeSignalState(value: unknown): SignalState {
  const normalized = parseString(value, 'none') as SignalState;
  if (
    normalized === 'none' ||
    normalized === 'pending' ||
    normalized === 'active' ||
    normalized === 'triggered' ||
    normalized === 'executed' ||
    normalized === 'invalidated' ||
    normalized === 'expired' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'none';
}

function normalizeDirection(value: unknown): SignalDirection {
  const normalized = parseString(value, 'none').toLowerCase();
  if (normalized === 'long' || normalized === 'short' || normalized === 'none') {
    return normalized;
  }
  return 'none';
}

function normalizeTriggerPolicy(value: unknown): 'market' | 'limit' | 'confirmation' {
  const normalized = parseString(value, 'market').toLowerCase();
  if (normalized === 'market' || normalized === 'limit' || normalized === 'confirmation') {
    return normalized;
  }
  return 'market';
}

function extractProjectUrl(): string | null {
  const explicit = process.env.SUPABASE_URL?.trim();
  if (explicit) return explicit;
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (publicUrl) return publicUrl;
  return null;
}

function getSupabaseServerConfig(): SupabaseServerConfig | null {
  const url = extractProjectUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !serviceRoleKey) {
    return null;
  }
  return { url, serviceRoleKey };
}

async function supabaseRestSelect<T>(
  config: SupabaseServerConfig,
  table: string,
  params: URLSearchParams,
): Promise<T[]> {
  const url = new URL(`${config.url}/rest/v1/${table}`);
  params.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase REST ${table} failed: ${response.status} ${message}`);
  }

  return (await response.json()) as T[];
}

function toSyncRowsFromPayload(
  payload: Record<string, unknown>,
  fallbackTargetCandle: string,
): SyncSymbolRow[] {
  const rowsRaw = Array.isArray(payload.results) ? payload.results : [];
  const rows: SyncSymbolRow[] = [];

  for (const item of rowsRaw) {
    const row = parseObject(item);
    const symbol = parseString(row.symbol);
    if (!symbol) continue;

    const skipped = parseBoolean(row.skipped, false);
    const opportunityCheck = parseObject(row.opportunity_check);
    const opportunityResult = parseObject(opportunityCheck.result);
    const opportunityTelegram = parseObject(opportunityCheck.telegram);
    const directTelegram = parseObject(row.telegram);
    const hasOpportunityResult = Object.keys(opportunityResult).length > 0;

    rows.push({
      symbol,
      status: skipped ? 'skipped' : 'updated',
      reason: parseString(
        row.reason,
        skipped ? 'latest_complete_candle_already_saved' : 'saved_latest_complete_candle',
      ),
      targetCandleTimeUtc: parseString(
        row.target_candle_time_utc,
        parseString(payload.target_complete_minute_utc, fallbackTargetCandle),
      ),
      latestCandleTimeUtc: parseNullableString(row.latest_candle_time_utc) ?? parseNullableString(row.existing_candle_time_utc),
      latestPrice: Number.isFinite(parseNumber(row.latest_price, Number.NaN))
        ? parseNumber(row.latest_price, 0)
        : null,
      fetched: parseNumber(row.fetched, 0),
      saved: parseNumber(row.saved, 0),
      opportunity: hasOpportunityResult
        ? {
            signalState: normalizeSignalState(opportunityResult.signal_state),
            setupScore: parseNumber(opportunityResult.setup_score, 0),
            direction: normalizeDirection(opportunityResult.direction),
            triggerPolicy: normalizeTriggerPolicy(opportunityResult.trigger_policy),
            spreadPips: Number.isFinite(parseNumber(opportunityResult.spread_pips, Number.NaN))
              ? parseNumber(opportunityResult.spread_pips, 0)
              : null,
            regimePassed: parseBoolean(opportunityResult.regime_passed, false),
            shouldNotify: parseBoolean(opportunityResult.should_notify, false),
            telegramSent: parseBoolean(opportunityTelegram.sent, parseBoolean(directTelegram.sent, false)),
            entry: Number.isFinite(parseNumber(opportunityResult.entry_price, Number.NaN))
              ? parseNumber(opportunityResult.entry_price, 0)
              : null,
            stopLoss: Number.isFinite(parseNumber(opportunityResult.stop_loss, Number.NaN))
              ? parseNumber(opportunityResult.stop_loss, 0)
              : null,
            tp1: Number.isFinite(parseNumber(opportunityResult.tp1, Number.NaN))
              ? parseNumber(opportunityResult.tp1, 0)
              : null,
            tp2: Number.isFinite(parseNumber(opportunityResult.tp2, Number.NaN))
              ? parseNumber(opportunityResult.tp2, 0)
              : null,
            tp3: Number.isFinite(parseNumber(opportunityResult.tp3, Number.NaN))
              ? parseNumber(opportunityResult.tp3, 0)
              : null,
            topReasons: parseStringArray(opportunityResult.top_reasons),
            invalidationConditions: parseStringArray(opportunityResult.invalidation_conditions),
          }
        : null,
    });
  }

  return rows;
}

function toSyncRowsFromChecks(
  checks: TradingCheckRow[],
  targetCandle: string,
): SyncSymbolRow[] {
  const map = new Map<string, TradingCheckRow>();
  for (const check of checks) {
    if (!map.has(check.symbol)) {
      map.set(check.symbol, check);
    }
  }

  return fxUniverse.map((symbol) => {
    const row = map.get(symbol);
    if (!row) {
      return {
        symbol,
        status: 'skipped',
        reason: 'no_recent_check_found',
        targetCandleTimeUtc: targetCandle,
        latestCandleTimeUtc: null,
        latestPrice: null,
        fetched: 0,
        saved: 0,
        opportunity: null,
      };
    }

    return {
      symbol,
      status: 'updated',
      reason: 'derived_from_latest_check',
      targetCandleTimeUtc: targetCandle,
      latestCandleTimeUtc: row.latest_candle_time,
      latestPrice: Number.isFinite(parseNumber(row.latest_price, Number.NaN))
        ? parseNumber(row.latest_price, 0)
        : null,
      fetched: 0,
      saved: 0,
      opportunity: {
        signalState: normalizeSignalState(row.signal_state),
        setupScore: parseNumber(row.setup_score, 0),
        direction: normalizeDirection(row.direction),
        triggerPolicy: normalizeTriggerPolicy(row.trigger_policy),
        spreadPips: Number.isFinite(parseNumber(row.spread_pips, Number.NaN))
          ? parseNumber(row.spread_pips, 0)
          : null,
        regimePassed: parseBoolean(row.regime_passed, false),
        shouldNotify: parseBoolean(row.should_notify, false),
        telegramSent: parseBoolean(row.telegram_notified, false),
        entry: Number.isFinite(parseNumber(row.entry_price, Number.NaN))
          ? parseNumber(row.entry_price, 0)
          : null,
        stopLoss: Number.isFinite(parseNumber(row.stop_loss, Number.NaN))
          ? parseNumber(row.stop_loss, 0)
          : null,
        tp1: Number.isFinite(parseNumber(row.tp1, Number.NaN)) ? parseNumber(row.tp1, 0) : null,
        tp2: Number.isFinite(parseNumber(row.tp2, Number.NaN)) ? parseNumber(row.tp2, 0) : null,
        tp3: Number.isFinite(parseNumber(row.tp3, Number.NaN)) ? parseNumber(row.tp3, 0) : null,
        topReasons: parseStringArray(row.top_reasons),
        invalidationConditions: parseStringArray(row.invalidation_conditions),
      },
    };
  });
}

function summarizeRunDetail(run: OpsFunctionRunRow): string {
  const payload = parseObject(run.payload);
  if (run.function_name === 'sync-latest-candle') {
    const processed = parseNumber(payload.symbols_processed, 0);
    const apiCalls = parseNumber(payload.api_calls_used, 0);
    if (processed > 0) return `${processed} symbols processed, ${apiCalls} market data calls`;
    return 'Sync run completed';
  }
  if (run.function_name === 'backfill-candle-history') {
    const symbol = parseString(payload.symbol);
    const savedRows = parseNumber(payload.saved_rows, 0);
    if (symbol && savedRows > 0) return `${symbol} saved ${savedRows} candles`;
    return 'Backfill run completed';
  }
  if (run.function_name === 'validate-strategy') {
    const symbol = parseString(payload.symbol);
    const metrics = parseObject(payload.metrics);
    const overall = parseObject(metrics.overall);
    const pf = parseNumber(overall.profit_factor, Number.NaN);
    if (symbol && Number.isFinite(pf)) return `${symbol} profit factor ${pf.toFixed(4)}`;
    return 'Validation run completed';
  }
  return `${run.function_name} ${run.status}`;
}

function defaultTargetCandleUtc(now = new Date()): string {
  const minuteStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0,
    0,
  ));
  return new Date(minuteStart.getTime() - 60 * 1000).toISOString();
}

function buildValidationSummaryFromPayload(payload: Record<string, unknown>, run: OpsFunctionRunRow): LatestValidationSummary {
  const metrics = parseObject(payload.metrics);
  const overall = parseObject(metrics.overall);
  const inSample = parseObject(metrics.in_sample);
  const outSample = parseObject(metrics.out_of_sample);
  const assumptions = parseObject(payload.assumptions);
  const tpPctRaw = assumptions.tpDistributionPct ?? assumptions.tp_distribution_pct;
  const tpDistributionPct = Array.isArray(tpPctRaw)
    ? tpPctRaw.map((entry) => parseNumber(entry, 0))
    : [
        parseNumber(assumptions.tp1_take_pct, 50),
        parseNumber(assumptions.tp2_take_pct, 30),
        parseNumber(assumptions.tp3_take_pct, 20),
      ];

  return {
    runId: run.id,
    traceId: run.trace_id,
    symbol: parseString(payload.symbol, 'EUR/USD'),
    fromUtc: parseString(payload.from_time_utc, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()),
    toUtc: parseString(payload.to_time_utc, new Date().toISOString()),
    totalCandlesUsed: parseNumber(payload.total_candles_used, 0),
    signalsEvaluated: parseNumber(payload.signals_evaluated, 0),
    signalsQualified: parseNumber(payload.signals_qualified, 0),
    metrics: {
      overall: {
        trades: parseNumber(overall.trades, 0),
        winRate: parseNumber(overall.win_rate, 0),
        expectancyR: parseNumber(overall.expectancy_r, 0),
        profitFactor: Number.isFinite(parseNumber(overall.profit_factor, Number.NaN))
          ? parseNumber(overall.profit_factor, 0)
          : null,
        maxDrawdownR: parseNumber(overall.max_drawdown_r, 0),
      },
      inSample: {
        trades: parseNumber(inSample.trades, 0),
        winRate: parseNumber(inSample.win_rate, 0),
        expectancyR: parseNumber(inSample.expectancy_r, 0),
        profitFactor: Number.isFinite(parseNumber(inSample.profit_factor, Number.NaN))
          ? parseNumber(inSample.profit_factor, 0)
          : null,
        maxDrawdownR: parseNumber(inSample.max_drawdown_r, 0),
      },
      outOfSample: {
        trades: parseNumber(outSample.trades, 0),
        winRate: parseNumber(outSample.win_rate, 0),
        expectancyR: parseNumber(outSample.expectancy_r, 0),
        profitFactor: Number.isFinite(parseNumber(outSample.profit_factor, Number.NaN))
          ? parseNumber(outSample.profit_factor, 0)
          : null,
        maxDrawdownR: parseNumber(outSample.max_drawdown_r, 0),
      },
    },
    assumptions: {
      triggerPolicy: parseString(assumptions.trigger_policy, 'market'),
      signalTtlHours: parseNumber(assumptions.signal_ttl_hours, 6),
      slippagePipsAssumed: parseNumber(assumptions.slippage_pips_assumed, 0.4),
      tpDistributionPct,
      moveSlToBeOnTp1: parseBoolean(assumptions.move_sl_to_be_on_tp1, true),
      trailAfterTp2: parseBoolean(assumptions.trail_after_tp2, true),
      maxTradesPerDay: parseNumber(assumptions.max_trades_per_day, 10),
      maxSymbolTradesPerDay: parseNumber(assumptions.max_symbol_trades_per_day, 2),
      maxTradesPerSession: parseNumber(assumptions.max_trades_per_session, 4),
      validationPageSize: parseNumber(assumptions.validation_page_size, 1000),
      candlePagesFetched: parseNumber(assumptions.candle_pages_fetched, 1),
    },
  };
}

function buildMarketSnapshotFromChecks(checks: TradingCheckRow[]): MarketSnapshotRow[] {
  const fallbackMap = new Map(mockMarketSnapshot.map((row) => [row.symbol, row]));
  const latestBySymbol = new Map<string, TradingCheckRow>();
  for (const check of checks) {
    if (!latestBySymbol.has(check.symbol)) {
      latestBySymbol.set(check.symbol, check);
    }
  }

  return fxUniverse.map((symbol) => {
    const fallback = fallbackMap.get(symbol);
    const row = latestBySymbol.get(symbol);
    if (!row) {
      return fallback ?? { symbol, price: 0, spreadPips: 0, atrPips: 0, htfBias: 'unknown' };
    }
    const details = parseObject(row.details);
    return {
      symbol,
      price: Number.isFinite(parseNumber(row.latest_price, Number.NaN))
        ? parseNumber(row.latest_price, 0)
        : (fallback?.price ?? 0),
      spreadPips: Number.isFinite(parseNumber(row.spread_pips, Number.NaN))
        ? parseNumber(row.spread_pips, 0)
        : (fallback?.spreadPips ?? 0),
      atrPips: Number.isFinite(parseNumber(details.atr_pips, Number.NaN))
        ? parseNumber(details.atr_pips, 0)
        : (fallback?.atrPips ?? 0),
      htfBias: parseString(details.htf_bias, fallback?.htfBias ?? 'unknown'),
    };
  });
}

export async function buildSystemSnapshot(): Promise<{ snapshot: SystemSnapshot; live: boolean; warning?: string }> {
  const fallback = buildMockSystemSnapshot();
  const config = getSupabaseServerConfig();
  if (!config) {
    return {
      snapshot: fallback,
      live: false,
      warning: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; using mock data.',
    };
  }

  try {
    const syncParams = new URLSearchParams({
      select: 'id,function_name,trace_id,status,started_at,finished_at,duration_ms,payload',
      function_name: 'eq.sync-latest-candle',
      order: 'started_at.desc',
      limit: '1',
    });
    const validateParams = new URLSearchParams({
      select: 'id,function_name,trace_id,status,started_at,finished_at,duration_ms,payload',
      function_name: 'eq.validate-strategy',
      order: 'started_at.desc',
      limit: '1',
    });
    const runsParams = new URLSearchParams({
      select: 'id,function_name,trace_id,status,started_at,finished_at,duration_ms,payload',
      order: 'started_at.desc',
      limit: '20',
    });
    const checksParams = new URLSearchParams({
      select:
        'symbol,signal_state,setup_score,direction,trigger_policy,spread_pips,regime_passed,should_notify,telegram_notified,entry_price,stop_loss,tp1,tp2,tp3,top_reasons,invalidation_conditions,latest_price,latest_candle_time,checked_at,details,trace_id',
      order: 'checked_at.desc',
      limit: '400',
    });

    const [syncRuns, validateRuns, recentRuns, checks] = await Promise.all([
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', syncParams),
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', validateParams),
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', runsParams),
      supabaseRestSelect<TradingCheckRow>(config, 'trading_opportunity_checks', checksParams),
    ]);

    const syncRun = syncRuns[0];
    const validateRun = validateRuns[0];
    const fallbackTargetCandle = defaultTargetCandleUtc();

    let liveSync = fallback.latestSyncSnapshot;
    if (syncRun) {
      const payload = parseObject(syncRun.payload);
      const parsedRows = toSyncRowsFromPayload(payload, fallbackTargetCandle);
      const rows = parsedRows.length > 0 ? parsedRows : toSyncRowsFromChecks(checks, fallbackTargetCandle);
      liveSync = {
        traceId: parseString(payload.trace_id, syncRun.trace_id),
        targetCompleteCandleUtc: parseString(
          payload.target_complete_minute_utc,
          fallbackTargetCandle,
        ),
        symbolsRequested: parseStringArray(payload.symbols_requested).length > 0
          ? parseStringArray(payload.symbols_requested)
          : fxUniverse,
        symbolsProcessed: parseNumber(payload.symbols_processed, rows.length),
        apiCallsUsed: parseNumber(payload.api_calls_used, 0),
        apiLimitPerMinute: parseNumber(payload.api_limit_per_minute, SYNC_LIMIT_PER_MINUTE),
        apiLimitPerDay: parseNumber(payload.api_limit_per_day, SYNC_LIMIT_PER_DAY),
        runOpportunityCheck: parseBoolean(payload.run_opportunity_check, true),
        checkFunctionName: parseString(payload.check_function_name, 'check-trading-opportunity'),
        rows,
      };
    } else {
      liveSync = {
        ...fallback.latestSyncSnapshot,
        rows: toSyncRowsFromChecks(checks, fallbackTargetCandle),
      };
    }

    let liveValidation = fallback.latestValidationSummary;
    if (validateRun) {
      liveValidation = buildValidationSummaryFromPayload(parseObject(validateRun.payload), validateRun);
    }

    const opsEvents: OpsEvent[] = recentRuns.slice(0, 10).map((run) => ({
      timestampUtc: run.finished_at ?? run.started_at,
      event: run.function_name,
      status: run.status,
      detail: summarizeRunDetail(run),
    }));

    const opsRuns: OpsRun[] = recentRuns.slice(0, 20).map((run) => ({
      id: run.id,
      functionName: run.function_name,
      traceId: run.trace_id,
      status: run.status,
      startedAtUtc: run.started_at,
      finishedAtUtc: run.finished_at,
      durationMs: run.duration_ms,
      payload: parseObject(run.payload),
    }));

    const liveSnapshot: SystemSnapshot = {
      fetchedAtUtc: new Date().toISOString(),
      source: 'live',
      projectUrl: config.url,
      latestSyncSnapshot: liveSync,
      latestValidationSummary: liveValidation,
      marketSnapshot: buildMarketSnapshotFromChecks(checks),
      opsEvents,
      opsRuns,
      edgeFunctionLinks: buildEdgeFunctionLinks(config.url),
    };

    return { snapshot: liveSnapshot, live: true };
  } catch (error) {
    return {
      snapshot: fallback,
      live: false,
      warning: error instanceof Error ? error.message : 'Live snapshot failed; using mock data.',
    };
  }
}

function actionToFunctionConfig(action: SystemActionName): { functionName: string; secretName: string } {
  switch (action) {
    case 'sync':
      return { functionName: 'sync-latest-candle', secretName: 'SYNC_CRON_SECRET' };
    case 'check':
      return { functionName: 'check-trading-opportunity', secretName: 'CHECK_CRON_SECRET' };
    case 'backfill':
      return { functionName: 'backfill-candle-history', secretName: 'BACKFILL_CRON_SECRET' };
    case 'validate':
      return { functionName: 'validate-strategy', secretName: 'VALIDATE_CRON_SECRET' };
    default:
      return { functionName: 'sync-latest-candle', secretName: 'SYNC_CRON_SECRET' };
  }
}

function parseResponseData(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function invokeSystemAction(action: SystemActionName, payload: unknown): Promise<SystemActionResult> {
  const config = getSupabaseServerConfig();
  if (!config) {
    return {
      ok: false,
      status: 500,
      action,
      data: { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server.' },
    };
  }

  const fn = actionToFunctionConfig(action);
  const edgeUrl = `${config.url}/functions/v1/${fn.functionName}`;
  const functionSecret = process.env[fn.secretName]?.trim();
  const fallbackSecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const authSecret = functionSecret || fallbackSecret || '';

  if (!authSecret) {
    return {
      ok: false,
      status: 500,
      action,
      data: { error: `Missing ${fn.secretName} (or SUPABASE_SERVICE_ROLE_KEY fallback).` },
    };
  }

  const response = await fetch(edgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': authSecret,
    },
    body: JSON.stringify(payload ?? {}),
    cache: 'no-store',
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    action,
    data: parseResponseData(text),
  };
}
