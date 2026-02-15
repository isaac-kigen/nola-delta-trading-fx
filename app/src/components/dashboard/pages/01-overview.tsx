'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSystemData } from '@/context/SystemDataContext';

function badgeForState(state: string) {
  switch (state) {
    case 'triggered':
    case 'executed':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'active':
    case 'pending':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    case 'invalidated':
    case 'expired':
    case 'cancelled':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/50';
  }
}

export default function OverviewPage() {
  const { snapshot, isLive, loading, error, refreshing } = useSystemData();
  const latestSyncSnapshot = snapshot.latestSyncSnapshot;
  const latestValidationSummary = snapshot.latestValidationSummary;

  const updated = latestSyncSnapshot.rows.filter((row) => row.status === 'updated').length;
  const skipped = latestSyncSnapshot.rows.filter((row) => row.status === 'skipped').length;
  const checked = latestSyncSnapshot.rows.filter((row) => row.opportunity !== null).length;
  const spreadBlocked = latestSyncSnapshot.rows.filter(
    (row) => row.opportunity?.spreadPips !== null && (row.opportunity?.spreadPips ?? 0) > 2.2,
  ).length;

  const outOfSample = latestValidationSummary.metrics.outOfSample;
  const validationHealthy = outOfSample.profitFactor !== null && outOfSample.profitFactor >= 1;

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            System Overview
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'MOCK'}
            </Badge>
            {refreshing && (
              <Badge className="border bg-blue-500/20 text-blue-300 border-blue-500/50">
                refreshing
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Pipeline status aligned to sync/backfill/opportunity/validation edge functions
          </CardDescription>
          {error && <p className="text-xs text-yellow-300">{error}</p>}
          {loading && <p className="text-xs text-slate-400">Loading latest snapshot...</p>}
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Latest Sync Candle (UTC)</p>
            <p className="text-white text-lg font-bold mt-2">
              {latestSyncSnapshot.targetCompleteCandleUtc.replace('.000Z', 'Z')}
            </p>
            <p className="text-xs text-slate-400 mt-2">Trace: {latestSyncSnapshot.traceId.slice(0, 18)}...</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Sync Result</p>
            <p className="text-white text-lg font-bold mt-2">
              {updated} updated / {skipped} skipped
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {latestSyncSnapshot.symbolsProcessed} symbols processed
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Market Data API Usage</p>
            <p className="text-white text-lg font-bold mt-2">
              {latestSyncSnapshot.apiCallsUsed}/{latestSyncSnapshot.apiLimitPerMinute} per minute
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Daily cap: {latestSyncSnapshot.apiLimitPerDay}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Validation OOS PF</p>
            <p className={`text-lg font-bold mt-2 ${validationHealthy ? 'text-green-400' : 'text-red-400'}`}>
              {outOfSample.profitFactor ?? 0}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Expectancy: {outOfSample.expectancyR}R
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Per-Symbol Sync + Opportunity Snapshot</CardTitle>
          <CardDescription>
            Uses backend terms: signal_state, setup_score, spread filter, telegram eligibility
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-400">Symbol</th>
                  <th className="text-left py-2 px-2 text-slate-400">Sync</th>
                  <th className="text-right py-2 px-2 text-slate-400">Price</th>
                  <th className="text-left py-2 px-2 text-slate-400">Signal State</th>
                  <th className="text-right py-2 px-2 text-slate-400">Setup Score</th>
                  <th className="text-right py-2 px-2 text-slate-400">Spread (pips)</th>
                </tr>
              </thead>
              <tbody>
                {latestSyncSnapshot.rows.map((row) => (
                  <tr key={row.symbol} className="border-b border-slate-700 hover:bg-slate-700/40">
                    <td className="py-2 px-2 text-white font-semibold">{row.symbol}</td>
                    <td className="py-2 px-2">
                      <Badge
                        className={`border ${
                          row.status === 'updated'
                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                            : 'bg-slate-600/30 text-slate-300 border-slate-500/50'
                        }`}
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-2 px-2 text-right text-slate-200">
                      {row.latestPrice === null ? '-' : row.latestPrice}
                    </td>
                    <td className="py-2 px-2">
                      <Badge className={`border ${badgeForState(row.opportunity?.signalState ?? 'none')}`}>
                        {row.opportunity?.signalState ?? 'not_checked'}
                      </Badge>
                    </td>
                    <td className="py-2 px-2 text-right text-slate-200">
                      {row.opportunity?.setupScore ?? '-'}
                    </td>
                    <td className="py-2 px-2 text-right text-slate-200">
                      {row.opportunity?.spreadPips ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-xs text-slate-400 grid grid-cols-1 md:grid-cols-3 gap-2">
            <p>Opportunity checks executed: {checked}</p>
            <p>Spread filter blocked symbols: {spreadBlocked}</p>
            <p>
              Check mode: {latestSyncSnapshot.checkFunctionName}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Latest Validation Highlights ({latestValidationSummary.symbol})</CardTitle>
          <CardDescription>
            Walk-forward output from validate-strategy with paginated candle fetch
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="p-3 rounded bg-slate-700">
            <p className="text-slate-400">Candles Used</p>
            <p className="text-white text-xl font-bold mt-1">{latestValidationSummary.totalCandlesUsed}</p>
            <p className="text-slate-400 mt-1">
              Pages: {latestValidationSummary.assumptions.candlePagesFetched}
            </p>
          </div>
          <div className="p-3 rounded bg-slate-700">
            <p className="text-slate-400">Overall PF / Expectancy</p>
            <p className="text-white text-xl font-bold mt-1">
              {latestValidationSummary.metrics.overall.profitFactor} / {latestValidationSummary.metrics.overall.expectancyR}R
            </p>
            <p className="text-slate-400 mt-1">Trades: {latestValidationSummary.metrics.overall.trades}</p>
          </div>
          <div className="p-3 rounded bg-slate-700">
            <p className="text-slate-400">Out-of-Sample Win Rate</p>
            <p className="text-white text-xl font-bold mt-1">
              {(latestValidationSummary.metrics.outOfSample.winRate * 100).toFixed(2)}%
            </p>
            <p className="text-slate-400 mt-1">
              Max DD: {latestValidationSummary.metrics.outOfSample.maxDrawdownR}R
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
