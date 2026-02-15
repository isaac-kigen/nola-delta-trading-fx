import type {
  EdgeFunctionLink,
  LatestValidationSummary,
  SystemSnapshot,
  ValidationMetricsSummary,
} from '@/lib/system-types';

const DEFAULT_API_LIMIT_PER_MINUTE = 60;
const DEFAULT_API_LIMIT_PER_DAY = 1_000;

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

function emptyValidationMetrics(): ValidationMetricsSummary {
  return {
    trades: 0,
    winRate: 0,
    expectancyR: 0,
    profitFactor: null,
    maxDrawdownR: 0,
  };
}

function emptyLatestValidationSummary(now = new Date()): LatestValidationSummary {
  const nowIso = now.toISOString();
  return {
    runId: 0,
    traceId: '',
    symbol: '',
    fromUtc: nowIso,
    toUtc: nowIso,
    totalCandlesUsed: 0,
    signalsEvaluated: 0,
    signalsQualified: 0,
    metrics: {
      overall: emptyValidationMetrics(),
      inSample: emptyValidationMetrics(),
      outOfSample: emptyValidationMetrics(),
    },
    assumptions: {
      triggerPolicy: 'market',
      signalTtlHours: 0,
      slippagePipsAssumed: 0,
      tpDistributionPct: [0, 0, 0],
      moveSlToBeOnTp1: false,
      trailAfterTp2: false,
      maxTradesPerDay: 0,
      maxSymbolTradesPerDay: 0,
      maxTradesPerSession: 0,
      validationPageSize: 0,
      candlePagesFetched: 0,
    },
  };
}

export function buildEdgeFunctionLinks(baseUrl: string | null): EdgeFunctionLink[] {
  const normalizedBaseUrl = baseUrl?.trim() ?? '';
  const buildUrl = (name: string) => (normalizedBaseUrl ? `${normalizedBaseUrl}/functions/v1/${name}` : '');

  return [
    {
      name: 'sync-latest-candle',
      method: 'POST',
      url: buildUrl('sync-latest-candle'),
      authHeader: 'x-cron-secret: SYNC_CRON_SECRET',
      purpose: 'Fetch latest complete candle and run opportunity checks.',
    },
    {
      name: 'check-trading-opportunity',
      method: 'POST',
      url: buildUrl('check-trading-opportunity'),
      authHeader: 'x-cron-secret: CHECK_CRON_SECRET',
      purpose: 'Evaluate lifecycle state and produce setup/plan/notification decision.',
    },
    {
      name: 'backfill-candle-history',
      method: 'POST',
      url: buildUrl('backfill-candle-history'),
      authHeader: 'x-cron-secret: BACKFILL_CRON_SECRET',
      purpose: 'Fetch historical 1H candles using explicit start/end date windows.',
    },
    {
      name: 'validate-strategy',
      method: 'POST',
      url: buildUrl('validate-strategy'),
      authHeader: 'x-cron-secret: VALIDATE_CRON_SECRET',
      purpose: 'Run walk-forward validation with full candle history pagination.',
    },
  ];
}

export function buildEmptySystemSnapshot(projectUrl: string | null): SystemSnapshot {
  const now = new Date();
  return {
    fetchedAtUtc: now.toISOString(),
    source: 'unavailable',
    projectUrl,
    latestSyncSnapshot: {
      traceId: '',
      targetCompleteCandleUtc: defaultTargetCandleUtc(now),
      symbolsRequested: [],
      symbolsProcessed: 0,
      apiCallsUsed: 0,
      apiLimitPerMinute: DEFAULT_API_LIMIT_PER_MINUTE,
      apiLimitPerDay: DEFAULT_API_LIMIT_PER_DAY,
      runOpportunityCheck: true,
      checkFunctionName: 'check-trading-opportunity',
      rows: [],
    },
    latestValidationSummary: emptyLatestValidationSummary(now),
    validationRuns: [],
    marketSnapshot: [],
    opsEvents: [],
    opsRuns: [],
    edgeFunctionLinks: buildEdgeFunctionLinks(projectUrl),
    strategyRuntime: null,
    strategySymbols: [],
    tradingSignals: [],
    tradingPositions: [],
  };
}
