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

export interface EdgeFunctionLink {
  name: string;
  method: 'POST';
  url: string;
  authHeader: string;
  purpose: string;
}

export interface SystemSnapshot {
  fetchedAtUtc: string;
  source: 'live' | 'mock';
  projectUrl: string | null;
  latestSyncSnapshot: LatestSyncSnapshot;
  latestValidationSummary: LatestValidationSummary;
  marketSnapshot: MarketSnapshotRow[];
  opsEvents: OpsEvent[];
  opsRuns: OpsRun[];
  edgeFunctionLinks: EdgeFunctionLink[];
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
