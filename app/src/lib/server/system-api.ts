import { buildEdgeFunctionLinks, buildEmptySystemSnapshot } from '@/lib/system-defaults';
import type {
  LatestValidationSummary,
  MarketSnapshotRow,
  OpsEvent,
  OpsRun,
  SignalDirection,
  SignalState,
  StrategyRuntimeConfig,
  StrategySymbolConfig,
  SyncSymbolRow,
  SystemActionName,
  SystemActionResult,
  SystemSnapshot,
  TradingPositionSnapshot,
  TradingSignalSnapshot,
  ValidationMetricsSummary,
  ValidationRunSummary,
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

interface StrategyRuntimeRow {
  key: string;
  value: unknown;
  updated_at: string;
}

interface StrategySymbolConfigRow {
  symbol: string;
  enabled: boolean | null;
  strategy_version: string | null;
  trigger_policy: string | null;
  session_start_hour_utc: number | string | null;
  session_end_hour_utc: number | string | null;
  risk_per_trade_pct: number | string | null;
  min_stop_pips: number | string | null;
  max_stop_pips: number | string | null;
  max_spread_pips: number | string | null;
  require_spread: boolean | null;
  min_atr_pips: number | string | null;
  max_atr_pips: number | string | null;
  min_trend_strength: number | string | null;
  signal_ttl_hours: number | string | null;
  reentry_cooldown_hours: number | string | null;
  slippage_pips_assumed: number | string | null;
  tp1_take_pct: number | string | null;
  tp2_take_pct: number | string | null;
  tp3_take_pct: number | string | null;
  move_sl_to_be_on_tp1: boolean | null;
  trail_after_tp2: boolean | null;
  trail_atr_multiple: number | string | null;
  updated_at: string | null;
}

interface TradingSignalRow {
  id: number;
  check_id: number | null;
  trace_id: string;
  symbol: string;
  strategy_version: string;
  strategy_name: string;
  setup_label: string;
  setup_score: number | string | null;
  direction: string;
  signal_state: string;
  trigger_policy: string;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  risk_amount_usd: number | string | null;
  position_size_units: number | string | null;
  spread_pips: number | string | null;
  regime_passed: boolean | null;
  valid_from: string;
  valid_until: string | null;
  triggered_at: string | null;
  invalidated_at: string | null;
  expired_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TradingPositionRow {
  id: number;
  signal_id: number | null;
  trace_id: string;
  symbol: string;
  direction: string;
  status: string;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  current_stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  risk_amount_usd: number | string | null;
  planned_size_units: number | string | null;
  open_size_units: number | string | null;
  closed_size_units: number | string | null;
  trailing_active: boolean | null;
  trailing_atr_multiple: number | string | null;
  broker: string | null;
  broker_order_id: string | null;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  realized_pnl: number | string | null;
  realized_r: number | string | null;
  created_at: string;
  updated_at: string;
}

interface StrategyValidationRunRow {
  id: number;
  trace_id: string;
  strategy_version: string;
  symbol: string;
  timeframe: string;
  from_time: string;
  to_time: string;
  walk_forward_split: string | null;
  metrics: unknown;
  created_at: string;
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

function parseNullableNumber(value: unknown): number | null {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown, fallback = 0): number {
  return Math.trunc(parseNumber(value, fallback));
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

function normalizePositionDirection(value: unknown): 'long' | 'short' {
  const normalized = parseString(value, 'long').toLowerCase();
  return normalized === 'short' ? 'short' : 'long';
}

function normalizePositionStatus(value: unknown): 'open' | 'closed' | 'cancelled' {
  const normalized = parseString(value, 'open').toLowerCase();
  if (normalized === 'closed' || normalized === 'cancelled') return normalized;
  return 'open';
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
      latestPrice: parseNullableNumber(row.latest_price),
      fetched: parseNumber(row.fetched, 0),
      saved: parseNumber(row.saved, 0),
      opportunity: hasOpportunityResult
        ? {
            signalState: normalizeSignalState(opportunityResult.signal_state),
            setupScore: parseNumber(opportunityResult.setup_score, 0),
            direction: normalizeDirection(opportunityResult.direction),
            triggerPolicy: normalizeTriggerPolicy(opportunityResult.trigger_policy),
            spreadPips: parseNullableNumber(opportunityResult.spread_pips),
            regimePassed: parseBoolean(opportunityResult.regime_passed, false),
            shouldNotify: parseBoolean(opportunityResult.should_notify, false),
            telegramSent: parseBoolean(opportunityTelegram.sent, parseBoolean(directTelegram.sent, false)),
            entry: parseNullableNumber(opportunityResult.entry_price),
            stopLoss: parseNullableNumber(opportunityResult.stop_loss),
            tp1: parseNullableNumber(opportunityResult.tp1),
            tp2: parseNullableNumber(opportunityResult.tp2),
            tp3: parseNullableNumber(opportunityResult.tp3),
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
  universe: string[],
): SyncSymbolRow[] {
  const map = new Map<string, TradingCheckRow>();
  for (const check of checks) {
    if (!map.has(check.symbol)) {
      map.set(check.symbol, check);
    }
  }

  return universe.map((symbol) => {
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
      latestPrice: parseNullableNumber(row.latest_price),
      fetched: 0,
      saved: 0,
      opportunity: {
        signalState: normalizeSignalState(row.signal_state),
        setupScore: parseNumber(row.setup_score, 0),
        direction: normalizeDirection(row.direction),
        triggerPolicy: normalizeTriggerPolicy(row.trigger_policy),
        spreadPips: parseNullableNumber(row.spread_pips),
        regimePassed: parseBoolean(row.regime_passed, false),
        shouldNotify: parseBoolean(row.should_notify, false),
        telegramSent: parseBoolean(row.telegram_notified, false),
        entry: parseNullableNumber(row.entry_price),
        stopLoss: parseNullableNumber(row.stop_loss),
        tp1: parseNullableNumber(row.tp1),
        tp2: parseNullableNumber(row.tp2),
        tp3: parseNullableNumber(row.tp3),
        topReasons: parseStringArray(row.top_reasons),
        invalidationConditions: parseStringArray(row.invalidation_conditions),
      },
    };
  });
}

function buildMarketSnapshotFromChecks(checks: TradingCheckRow[], universe: string[]): MarketSnapshotRow[] {
  const latestBySymbol = new Map<string, TradingCheckRow>();
  for (const check of checks) {
    if (!latestBySymbol.has(check.symbol)) {
      latestBySymbol.set(check.symbol, check);
    }
  }

  return universe.map((symbol) => {
    const row = latestBySymbol.get(symbol);
    const details = parseObject(row?.details);
    return {
      symbol,
      price: parseNumber(row?.latest_price, 0),
      spreadPips: parseNumber(row?.spread_pips, 0),
      atrPips: parseNumber(details.atr_pips, 0),
      htfBias: parseString(details.htf_bias, 'unknown'),
    };
  });
}

function buildMarketSnapshotFromSyncRows(rows: SyncSymbolRow[], universe: string[]): MarketSnapshotRow[] {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return universe.map((symbol) => {
    const row = bySymbol.get(symbol);
    return {
      symbol,
      price: row?.latestPrice ?? 0,
      spreadPips: row?.opportunity?.spreadPips ?? 0,
      atrPips: 0,
      htfBias: 'unknown',
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

function toValidationMetricsSummary(source: Record<string, unknown>): ValidationMetricsSummary {
  return {
    trades: parseNumber(source.trades, 0),
    winRate: parseNumber(source.win_rate ?? source.winRate, 0),
    expectancyR: parseNumber(source.expectancy_r ?? source.expectancyR, 0),
    profitFactor: parseNullableNumber(source.profit_factor ?? source.profitFactor),
    maxDrawdownR: parseNumber(source.max_drawdown_r ?? source.maxDrawdownR, 0),
  };
}

function parseValidationMetricsRoot(metricsRoot: Record<string, unknown>): {
  overall: ValidationMetricsSummary;
  inSample: ValidationMetricsSummary;
  outOfSample: ValidationMetricsSummary;
  totalCandlesUsed: number;
  signalsEvaluated: number;
  signalsQualified: number;
} {
  const overall = parseObject(metricsRoot.overall);
  const inSample = parseObject(metricsRoot.in_sample ?? metricsRoot.inSample);
  const outSample = parseObject(metricsRoot.out_of_sample ?? metricsRoot.outOfSample);

  return {
    overall: toValidationMetricsSummary(overall),
    inSample: toValidationMetricsSummary(inSample),
    outOfSample: toValidationMetricsSummary(outSample),
    totalCandlesUsed: parseNumber(metricsRoot.total_candles_used ?? metricsRoot.totalCandlesUsed, 0),
    signalsEvaluated: parseNumber(metricsRoot.signals_evaluated ?? metricsRoot.signalsEvaluated, 0),
    signalsQualified: parseNumber(metricsRoot.signals_qualified ?? metricsRoot.signalsQualified, 0),
  };
}

function buildValidationSummaryFromPayload(payload: Record<string, unknown>, run: OpsFunctionRunRow): LatestValidationSummary {
  const metrics = parseObject(payload.metrics);
  const parsedMetrics = parseValidationMetricsRoot(metrics);
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
    symbol: parseString(payload.symbol),
    fromUtc: parseString(payload.from_time_utc, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()),
    toUtc: parseString(payload.to_time_utc, new Date().toISOString()),
    totalCandlesUsed: parseNumber(payload.total_candles_used, parsedMetrics.totalCandlesUsed),
    signalsEvaluated: parseNumber(payload.signals_evaluated, parsedMetrics.signalsEvaluated),
    signalsQualified: parseNumber(payload.signals_qualified, parsedMetrics.signalsQualified),
    metrics: {
      overall: parsedMetrics.overall,
      inSample: parsedMetrics.inSample,
      outOfSample: parsedMetrics.outOfSample,
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

function toStrategyRuntimeConfig(row: StrategyRuntimeRow): StrategyRuntimeConfig {
  const value = parseObject(row.value);
  return {
    strategyVersion: parseString(value.strategy_version, ''),
    setupLabel: parseString(value.setup_label, ''),
    accountEquityUsd: parseNumber(value.account_equity_usd, 0),
    maxTotalRiskPct: parseNumber(value.max_total_risk_pct, 0),
    maxOpenTrades: parseInteger(value.max_open_trades, 0),
    maxTradesPerDay: parseInteger(value.max_trades_per_day, 0),
    maxSymbolTradesPerDay: parseInteger(value.max_symbol_trades_per_day, 0),
    maxTradesPerSession: parseInteger(value.max_trades_per_session, 0),
    correlationBaseCurrencyCap: parseInteger(value.correlation_base_currency_cap, 0),
    telegramMaxMessagesPerHour: parseInteger(value.telegram_max_messages_per_hour, 0),
    sessionFilterEnabled: parseBoolean(value.session_filter_enabled, false),
    newsFilterEnabled: parseBoolean(value.news_filter_enabled, false),
    volatilityFilterEnabled: parseBoolean(value.volatility_filter_enabled, false),
    trendFilterEnabled: parseBoolean(value.trend_filter_enabled, false),
    updatedAtUtc: row.updated_at,
  };
}

function toStrategySymbolConfig(row: StrategySymbolConfigRow): StrategySymbolConfig {
  return {
    symbol: parseString(row.symbol),
    enabled: parseBoolean(row.enabled, true),
    strategyVersion: parseString(row.strategy_version, ''),
    triggerPolicy: normalizeTriggerPolicy(row.trigger_policy),
    sessionStartHourUtc: parseInteger(row.session_start_hour_utc, 0),
    sessionEndHourUtc: parseInteger(row.session_end_hour_utc, 0),
    riskPerTradePct: parseNumber(row.risk_per_trade_pct, 0),
    minStopPips: parseNumber(row.min_stop_pips, 0),
    maxStopPips: parseNumber(row.max_stop_pips, 0),
    maxSpreadPips: parseNumber(row.max_spread_pips, 0),
    requireSpread: parseBoolean(row.require_spread, false),
    minAtrPips: parseNumber(row.min_atr_pips, 0),
    maxAtrPips: parseNumber(row.max_atr_pips, 0),
    minTrendStrength: parseNumber(row.min_trend_strength, 0),
    signalTtlHours: parseInteger(row.signal_ttl_hours, 0),
    reentryCooldownHours: parseInteger(row.reentry_cooldown_hours, 0),
    slippagePipsAssumed: parseNumber(row.slippage_pips_assumed, 0),
    tp1TakePct: parseNumber(row.tp1_take_pct, 0),
    tp2TakePct: parseNumber(row.tp2_take_pct, 0),
    tp3TakePct: parseNumber(row.tp3_take_pct, 0),
    moveSlToBeOnTp1: parseBoolean(row.move_sl_to_be_on_tp1, true),
    trailAfterTp2: parseBoolean(row.trail_after_tp2, true),
    trailAtrMultiple: parseNumber(row.trail_atr_multiple, 0),
    liquidityEpsPips: null,
    zoneBaseCandles: null,
    zoneBaseMaxPips: null,
    zoneImpulseCandles: null,
    zoneImpulsePips: null,
    zoneInvalidationPips: null,
    oneTradePerCycle: null,
    updatedAtUtc: row.updated_at,
  };
}

function toTradingSignalSnapshot(row: TradingSignalRow): TradingSignalSnapshot {
  return {
    id: row.id,
    checkId: row.check_id,
    traceId: parseString(row.trace_id),
    symbol: parseString(row.symbol),
    strategyVersion: parseString(row.strategy_version),
    strategyName: parseString(row.strategy_name),
    setupLabel: parseString(row.setup_label),
    setupScore: parseNumber(row.setup_score, 0),
    direction: normalizeDirection(row.direction),
    signalState: normalizeSignalState(row.signal_state),
    triggerPolicy: normalizeTriggerPolicy(row.trigger_policy),
    entryPrice: parseNullableNumber(row.entry_price),
    stopLoss: parseNullableNumber(row.stop_loss),
    tp1: parseNullableNumber(row.tp1),
    tp2: parseNullableNumber(row.tp2),
    tp3: parseNullableNumber(row.tp3),
    riskAmountUsd: parseNullableNumber(row.risk_amount_usd),
    positionSizeUnits: parseNullableNumber(row.position_size_units),
    spreadPips: parseNullableNumber(row.spread_pips),
    regimePassed: parseBoolean(row.regime_passed, false),
    validFromUtc: parseString(row.valid_from),
    validUntilUtc: parseNullableString(row.valid_until),
    triggeredAtUtc: parseNullableString(row.triggered_at),
    invalidatedAtUtc: parseNullableString(row.invalidated_at),
    expiredAtUtc: parseNullableString(row.expired_at),
    executedAtUtc: parseNullableString(row.executed_at),
    createdAtUtc: parseString(row.created_at),
    updatedAtUtc: parseString(row.updated_at),
  };
}

function toTradingPositionSnapshot(row: TradingPositionRow): TradingPositionSnapshot {
  return {
    id: row.id,
    signalId: row.signal_id,
    traceId: parseString(row.trace_id),
    symbol: parseString(row.symbol),
    direction: normalizePositionDirection(row.direction),
    status: normalizePositionStatus(row.status),
    entryPrice: parseNumber(row.entry_price, 0),
    stopLoss: parseNumber(row.stop_loss, 0),
    currentStopLoss: parseNumber(row.current_stop_loss, 0),
    tp1: parseNullableNumber(row.tp1),
    tp2: parseNullableNumber(row.tp2),
    tp3: parseNullableNumber(row.tp3),
    riskAmountUsd: parseNullableNumber(row.risk_amount_usd),
    plannedSizeUnits: parseNullableNumber(row.planned_size_units),
    openSizeUnits: parseNullableNumber(row.open_size_units),
    closedSizeUnits: parseNumber(row.closed_size_units, 0),
    trailingActive: parseBoolean(row.trailing_active, false),
    trailingAtrMultiple: parseNullableNumber(row.trailing_atr_multiple),
    broker: parseString(row.broker, 'paper'),
    brokerOrderId: parseNullableString(row.broker_order_id),
    brokerPositionId: null,
    openedAtUtc: parseString(row.opened_at),
    closedAtUtc: parseNullableString(row.closed_at),
    closeReason: parseNullableString(row.close_reason),
    realizedPnl: parseNullableNumber(row.realized_pnl),
    realizedR: parseNullableNumber(row.realized_r),
    createdAtUtc: parseString(row.created_at),
    updatedAtUtc: parseString(row.updated_at),
  };
}

function toValidationRunSummary(row: StrategyValidationRunRow): ValidationRunSummary {
  const metricsRoot = parseObject(row.metrics);
  const parsedMetrics = parseValidationMetricsRoot(metricsRoot);

  return {
    id: row.id,
    traceId: parseString(row.trace_id),
    strategyVersion: parseString(row.strategy_version),
    symbol: parseString(row.symbol),
    timeframe: parseString(row.timeframe, '1h'),
    fromUtc: parseString(row.from_time),
    toUtc: parseString(row.to_time),
    walkForwardSplitUtc: parseNullableString(row.walk_forward_split),
    totalCandlesUsed: parsedMetrics.totalCandlesUsed,
    signalsEvaluated: parsedMetrics.signalsEvaluated,
    signalsQualified: parsedMetrics.signalsQualified,
    metrics: {
      overall: parsedMetrics.overall,
      inSample: parsedMetrics.inSample,
      outOfSample: parsedMetrics.outOfSample,
    },
    createdAtUtc: parseString(row.created_at),
  };
}

function buildLatestValidationSummaryFromRun(
  run: ValidationRunSummary,
  fallback: LatestValidationSummary,
  symbolConfig: StrategySymbolConfig | null,
  runtimeConfig: StrategyRuntimeConfig | null,
): LatestValidationSummary {
  return {
    runId: run.id,
    traceId: run.traceId,
    symbol: run.symbol,
    fromUtc: run.fromUtc,
    toUtc: run.toUtc,
    totalCandlesUsed: run.totalCandlesUsed,
    signalsEvaluated: run.signalsEvaluated,
    signalsQualified: run.signalsQualified,
    metrics: run.metrics,
    assumptions: {
      triggerPolicy: symbolConfig?.triggerPolicy ?? fallback.assumptions.triggerPolicy,
      signalTtlHours: symbolConfig?.signalTtlHours ?? fallback.assumptions.signalTtlHours,
      slippagePipsAssumed: symbolConfig?.slippagePipsAssumed ?? fallback.assumptions.slippagePipsAssumed,
      tpDistributionPct: symbolConfig
        ? [symbolConfig.tp1TakePct, symbolConfig.tp2TakePct, symbolConfig.tp3TakePct]
        : fallback.assumptions.tpDistributionPct,
      moveSlToBeOnTp1: symbolConfig?.moveSlToBeOnTp1 ?? fallback.assumptions.moveSlToBeOnTp1,
      trailAfterTp2: symbolConfig?.trailAfterTp2 ?? fallback.assumptions.trailAfterTp2,
      maxTradesPerDay: runtimeConfig?.maxTradesPerDay ?? fallback.assumptions.maxTradesPerDay,
      maxSymbolTradesPerDay: runtimeConfig?.maxSymbolTradesPerDay ?? fallback.assumptions.maxSymbolTradesPerDay,
      maxTradesPerSession: runtimeConfig?.maxTradesPerSession ?? fallback.assumptions.maxTradesPerSession,
      validationPageSize: fallback.assumptions.validationPageSize,
      candlePagesFetched: fallback.assumptions.candlePagesFetched,
    },
  };
}

function settledRows<T>(result: PromiseSettledResult<T[]>, label: string, warnings: string[]): T[] {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  const reason = result.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  warnings.push(`${label}: ${message}`);
  return [];
}

function uniqueSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (symbol) {
      seen.add(symbol);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export async function buildSystemSnapshot(): Promise<{ snapshot: SystemSnapshot; live: boolean; warning?: string }> {
  const projectUrl = extractProjectUrl();
  const unavailableSnapshot = buildEmptySystemSnapshot(projectUrl);
  const config = getSupabaseServerConfig();

  if (!config) {
    return {
      snapshot: unavailableSnapshot,
      live: false,
      warning: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server.',
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
    const runtimeParams = new URLSearchParams({
      select: 'key,value,updated_at',
      key: 'eq.global',
      limit: '1',
    });
    const symbolConfigParams = new URLSearchParams({
      select:
        'symbol,enabled,strategy_version,trigger_policy,session_start_hour_utc,session_end_hour_utc,risk_per_trade_pct,min_stop_pips,max_stop_pips,max_spread_pips,require_spread,min_atr_pips,max_atr_pips,min_trend_strength,signal_ttl_hours,reentry_cooldown_hours,slippage_pips_assumed,tp1_take_pct,tp2_take_pct,tp3_take_pct,move_sl_to_be_on_tp1,trail_after_tp2,trail_atr_multiple,updated_at',
      order: 'symbol.asc',
      limit: '200',
    });
    const signalParams = new URLSearchParams({
      select:
        'id,check_id,trace_id,symbol,strategy_version,strategy_name,setup_label,setup_score,direction,signal_state,trigger_policy,entry_price,stop_loss,tp1,tp2,tp3,risk_amount_usd,position_size_units,spread_pips,regime_passed,valid_from,valid_until,triggered_at,invalidated_at,expired_at,executed_at,created_at,updated_at',
      order: 'created_at.desc',
      limit: '500',
    });
    const positionParams = new URLSearchParams({
      select:
        'id,signal_id,trace_id,symbol,direction,status,entry_price,stop_loss,current_stop_loss,tp1,tp2,tp3,risk_amount_usd,planned_size_units,open_size_units,closed_size_units,trailing_active,trailing_atr_multiple,broker,broker_order_id,opened_at,closed_at,close_reason,realized_pnl,realized_r,created_at,updated_at',
      order: 'opened_at.desc',
      limit: '500',
    });
    const validationRunsParams = new URLSearchParams({
      select:
        'id,trace_id,strategy_version,symbol,timeframe,from_time,to_time,walk_forward_split,metrics,created_at',
      order: 'created_at.desc',
      limit: '100',
    });

    const [
      syncRunsResult,
      validateRunsResult,
      recentRunsResult,
      checksResult,
      runtimeResult,
      symbolConfigsResult,
      signalsResult,
      positionsResult,
      validationRunsResult,
    ] = await Promise.allSettled([
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', syncParams),
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', validateParams),
      supabaseRestSelect<OpsFunctionRunRow>(config, 'ops_function_runs', runsParams),
      supabaseRestSelect<TradingCheckRow>(config, 'trading_opportunity_checks', checksParams),
      supabaseRestSelect<StrategyRuntimeRow>(config, 'strategy_runtime_config', runtimeParams),
      supabaseRestSelect<StrategySymbolConfigRow>(config, 'strategy_symbol_config', symbolConfigParams),
      supabaseRestSelect<TradingSignalRow>(config, 'trading_signals', signalParams),
      supabaseRestSelect<TradingPositionRow>(config, 'trading_positions', positionParams),
      supabaseRestSelect<StrategyValidationRunRow>(config, 'strategy_validation_runs', validationRunsParams),
    ]);

    const warnings: string[] = [];
    const syncRuns = settledRows(syncRunsResult, 'ops_function_runs(sync-latest-candle)', warnings);
    const validateRuns = settledRows(validateRunsResult, 'ops_function_runs(validate-strategy)', warnings);
    const recentRuns = settledRows(recentRunsResult, 'ops_function_runs(recent)', warnings);
    const checks = settledRows(checksResult, 'trading_opportunity_checks', warnings);
    const runtimeRows = settledRows(runtimeResult, 'strategy_runtime_config', warnings);
    const strategySymbolRows = settledRows(symbolConfigsResult, 'strategy_symbol_config', warnings);
    const signalRows = settledRows(signalsResult, 'trading_signals', warnings);
    const positionRows = settledRows(positionsResult, 'trading_positions', warnings);
    const validationRunRows = settledRows(validationRunsResult, 'strategy_validation_runs', warnings);

    const baseSnapshot = buildEmptySystemSnapshot(config.url);

    const strategyRuntime = runtimeRows.length > 0 ? toStrategyRuntimeConfig(runtimeRows[0]) : null;
    const strategySymbols = strategySymbolRows.map(toStrategySymbolConfig);

    const symbolUniverse = strategySymbols.length > 0
      ? strategySymbols.map((row) => row.symbol)
      : uniqueSymbols([
          ...checks.map((row) => row.symbol),
          ...signalRows.map((row) => row.symbol),
          ...positionRows.map((row) => row.symbol),
        ]);

    const syncRun = syncRuns[0];
    const validateRun = validateRuns[0];
    const fallbackTargetCandle = defaultTargetCandleUtc();

    let liveSync = baseSnapshot.latestSyncSnapshot;
    if (syncRun) {
      const payload = parseObject(syncRun.payload);
      const parsedRows = toSyncRowsFromPayload(payload, fallbackTargetCandle);
      const rows = parsedRows.length > 0 ? parsedRows : toSyncRowsFromChecks(checks, fallbackTargetCandle, symbolUniverse);
      const symbolsRequested = parseStringArray(payload.symbols_requested);

      liveSync = {
        traceId: parseString(payload.trace_id, syncRun.trace_id),
        targetCompleteCandleUtc: parseString(
          payload.target_complete_minute_utc,
          fallbackTargetCandle,
        ),
        symbolsRequested: symbolsRequested.length > 0 ? symbolsRequested : symbolUniverse,
        symbolsProcessed: parseNumber(payload.symbols_processed, rows.length),
        apiCallsUsed: parseNumber(payload.api_calls_used, 0),
        apiLimitPerMinute: parseNumber(payload.api_limit_per_minute, SYNC_LIMIT_PER_MINUTE),
        apiLimitPerDay: parseNumber(payload.api_limit_per_day, SYNC_LIMIT_PER_DAY),
        runOpportunityCheck: parseBoolean(payload.run_opportunity_check, true),
        checkFunctionName: parseString(payload.check_function_name, 'check-trading-opportunity'),
        rows,
      };
    } else {
      const rows = toSyncRowsFromChecks(checks, fallbackTargetCandle, symbolUniverse);
      liveSync = {
        ...baseSnapshot.latestSyncSnapshot,
        targetCompleteCandleUtc: fallbackTargetCandle,
        symbolsRequested: symbolUniverse,
        symbolsProcessed: rows.length,
        rows,
      };
    }

    const validationRuns = validationRunRows.map(toValidationRunSummary);
    const strategySymbolByName = new Map(strategySymbols.map((row) => [row.symbol, row]));

    let liveValidation = baseSnapshot.latestValidationSummary;
    if (validateRun) {
      liveValidation = buildValidationSummaryFromPayload(parseObject(validateRun.payload), validateRun);
    } else if (validationRuns.length > 0) {
      const latestRun = validationRuns[0];
      liveValidation = buildLatestValidationSummaryFromRun(
        latestRun,
        baseSnapshot.latestValidationSummary,
        strategySymbolByName.get(latestRun.symbol) ?? null,
        strategyRuntime,
      );
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

    const marketSnapshotFromChecks = buildMarketSnapshotFromChecks(checks, symbolUniverse);
    const marketSnapshot = marketSnapshotFromChecks.length > 0
      ? marketSnapshotFromChecks
      : buildMarketSnapshotFromSyncRows(liveSync.rows, symbolUniverse);

    const tradingSignals = signalRows.map(toTradingSignalSnapshot);
    const tradingPositions = positionRows.map(toTradingPositionSnapshot);

    const liveSnapshot: SystemSnapshot = {
      fetchedAtUtc: new Date().toISOString(),
      source: 'live',
      projectUrl: config.url,
      latestSyncSnapshot: liveSync,
      latestValidationSummary: liveValidation,
      validationRuns,
      marketSnapshot,
      opsEvents,
      opsRuns,
      edgeFunctionLinks: buildEdgeFunctionLinks(config.url),
      strategyRuntime,
      strategySymbols,
      tradingSignals,
      tradingPositions,
    };

    return {
      snapshot: liveSnapshot,
      live: true,
      warning: warnings.length > 0 ? warnings.join(' | ') : undefined,
    };
  } catch (error) {
    return {
      snapshot: buildEmptySystemSnapshot(config.url),
      live: false,
      warning: error instanceof Error ? error.message : 'Live snapshot failed',
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
