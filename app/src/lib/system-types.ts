export type SignalDirection = 'long' | 'short' | 'none';
export type SignalState =
  | 'none'
  | 'pending'
  | 'active'
  | 'triggered'
  | 'executed'
  | 'invalidated'
  | 'expired'
  | 'cancelled';

export interface OpportunitySnapshot {
  signalState: SignalState;
  setupScore: number;
  direction: SignalDirection;
  triggerPolicy: 'market' | 'limit' | 'confirmation';
  spreadPips: number | null;
  regimePassed: boolean;
  shouldNotify: boolean;
  telegramSent: boolean;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  topReasons: string[];
  invalidationConditions: string[];
}

export interface SyncSymbolRow {
  symbol: string;
  status: 'updated' | 'skipped';
  reason: string;
  targetCandleTimeUtc: string;
  latestCandleTimeUtc: string | null;
  latestPrice: number | null;
  fetched: number;
  saved: number;
  opportunity: OpportunitySnapshot | null;
}

export interface LatestSyncSnapshot {
  traceId: string;
  targetCompleteCandleUtc: string;
  symbolsRequested: string[];
  symbolsProcessed: number;
  apiCallsUsed: number;
  apiLimitPerMinute: number;
  apiLimitPerDay: number;
  runOpportunityCheck: boolean;
  checkFunctionName: string;
  rows: SyncSymbolRow[];
}

export interface ValidationMetricsSummary {
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
}

export interface LatestValidationSummary {
  runId: number;
  traceId: string;
  symbol: string;
  fromUtc: string;
  toUtc: string;
  totalCandlesUsed: number;
  signalsEvaluated: number;
  signalsQualified: number;
  metrics: {
    overall: ValidationMetricsSummary;
    inSample: ValidationMetricsSummary;
    outOfSample: ValidationMetricsSummary;
  };
  assumptions: {
    triggerPolicy: string;
    signalTtlHours: number;
    slippagePipsAssumed: number;
    tpDistributionPct: number[];
    moveSlToBeOnTp1: boolean;
    trailAfterTp2: boolean;
    maxTradesPerDay: number;
    maxSymbolTradesPerDay: number;
    maxTradesPerSession: number;
    validationPageSize: number;
    candlePagesFetched: number;
  };
}

export interface ValidationRunSummary {
  id: number;
  traceId: string;
  strategyVersion: string;
  symbol: string;
  timeframe: string;
  fromUtc: string;
  toUtc: string;
  walkForwardSplitUtc: string | null;
  totalCandlesUsed: number;
  signalsEvaluated: number;
  signalsQualified: number;
  metrics: {
    overall: ValidationMetricsSummary;
    inSample: ValidationMetricsSummary;
    outOfSample: ValidationMetricsSummary;
  };
  createdAtUtc: string;
}

export interface MarketSnapshotRow {
  symbol: string;
  price: number;
  spreadPips: number;
  atrPips: number;
  htfBias: string;
}

export interface OpsEvent {
  timestampUtc: string;
  event: string;
  status: string;
  detail: string;
}

export interface OpsRun {
  id: number;
  functionName: string;
  traceId: string;
  status: string;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  durationMs: number | null;
  payload: Record<string, unknown>;
}

export interface StrategyRuntimeConfig {
  strategyVersion: string;
  setupLabel: string;
  accountEquityUsd: number;
  maxTotalRiskPct: number;
  maxOpenTrades: number;
  maxTradesPerDay: number;
  maxSymbolTradesPerDay: number;
  maxTradesPerSession: number;
  correlationBaseCurrencyCap: number;
  telegramMaxMessagesPerHour: number;
  sessionFilterEnabled: boolean;
  newsFilterEnabled: boolean;
  volatilityFilterEnabled: boolean;
  trendFilterEnabled: boolean;
  updatedAtUtc: string | null;
}

export interface StrategySymbolConfig {
  symbol: string;
  enabled: boolean;
  strategyVersion: string;
  triggerPolicy: 'market' | 'limit' | 'confirmation';
  sessionStartHourUtc: number;
  sessionEndHourUtc: number;
  riskPerTradePct: number;
  minStopPips: number;
  maxStopPips: number;
  maxSpreadPips: number;
  requireSpread: boolean;
  minAtrPips: number;
  maxAtrPips: number;
  minTrendStrength: number;
  signalTtlHours: number;
  reentryCooldownHours: number;
  slippagePipsAssumed: number;
  tp1TakePct: number;
  tp2TakePct: number;
  tp3TakePct: number;
  moveSlToBeOnTp1: boolean;
  trailAfterTp2: boolean;
  trailAtrMultiple: number;
  liquidityEpsPips: number | null;
  zoneBaseCandles: number | null;
  zoneBaseMaxPips: number | null;
  zoneImpulseCandles: number | null;
  zoneImpulsePips: number | null;
  zoneInvalidationPips: number | null;
  oneTradePerCycle: boolean | null;
  updatedAtUtc: string | null;
}

export interface TradingSignalSnapshot {
  id: number;
  checkId: number | null;
  traceId: string;
  symbol: string;
  strategyVersion: string;
  strategyName: string;
  setupLabel: string;
  setupScore: number;
  direction: SignalDirection;
  signalState: SignalState;
  triggerPolicy: 'market' | 'limit' | 'confirmation';
  entryPrice: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskAmountUsd: number | null;
  positionSizeUnits: number | null;
  spreadPips: number | null;
  regimePassed: boolean;
  validFromUtc: string;
  validUntilUtc: string | null;
  triggeredAtUtc: string | null;
  invalidatedAtUtc: string | null;
  expiredAtUtc: string | null;
  executedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface TradingPositionSnapshot {
  id: number;
  signalId: number | null;
  traceId: string;
  symbol: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed' | 'cancelled';
  entryPrice: number;
  stopLoss: number;
  currentStopLoss: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskAmountUsd: number | null;
  plannedSizeUnits: number | null;
  openSizeUnits: number | null;
  closedSizeUnits: number;
  trailingActive: boolean;
  trailingAtrMultiple: number | null;
  broker: string;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  openedAtUtc: string;
  closedAtUtc: string | null;
  closeReason: string | null;
  realizedPnl: number | null;
  realizedR: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface EdgeFunctionLink {
  name: string;
  method: 'POST';
  url: string;
  authHeader: string;
  purpose: string;
}

export interface SystemSnapshot {
  fetchedAtUtc: string;
  source: 'live' | 'unavailable';
  projectUrl: string | null;
  latestSyncSnapshot: LatestSyncSnapshot;
  latestValidationSummary: LatestValidationSummary;
  validationRuns: ValidationRunSummary[];
  marketSnapshot: MarketSnapshotRow[];
  opsEvents: OpsEvent[];
  opsRuns: OpsRun[];
  edgeFunctionLinks: EdgeFunctionLink[];
  strategyRuntime: StrategyRuntimeConfig | null;
  strategySymbols: StrategySymbolConfig[];
  tradingSignals: TradingSignalSnapshot[];
  tradingPositions: TradingPositionSnapshot[];
}

export interface SystemSnapshotResponse {
  live: boolean;
  snapshot: SystemSnapshot;
  warning?: string;
}

export type SystemActionName = 'sync' | 'check' | 'backfill' | 'validate';

export interface SystemActionResult {
  ok: boolean;
  status: number;
  action: SystemActionName;
  data: unknown;
}
