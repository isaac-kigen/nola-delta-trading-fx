'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useSystemData } from '@/context/SystemDataContext';

export default function BacktestResultsPage() {
  const { snapshot, isLive } = useSystemData();
  const latest = snapshot.latestValidationSummary;
  const validationRuns = snapshot.validationRuns;

  const runTrendData = useMemo(
    () =>
      [...validationRuns]
        .slice(0, 10)
        .reverse()
        .map((run, index) => ({
          run: `${index + 1}`,
          profitFactor: run.metrics.overall.profitFactor ?? 0,
          outSampleWinRate: Number((run.metrics.outOfSample.winRate * 100).toFixed(2)),
          trades: run.metrics.overall.trades,
        })),
    [validationRuns],
  );

  const symbolPerformance = useMemo(() => {
    const grouped = new Map<string, { trades: number; winRateTotal: number; pfTotal: number; count: number }>();

    for (const run of validationRuns) {
      const current = grouped.get(run.symbol) ?? { trades: 0, winRateTotal: 0, pfTotal: 0, count: 0 };
      current.trades += run.metrics.overall.trades;
      current.winRateTotal += run.metrics.overall.winRate;
      current.pfTotal += run.metrics.overall.profitFactor ?? 0;
      current.count += 1;
      grouped.set(run.symbol, current);
    }

    return [...grouped.entries()]
      .map(([symbol, metrics]) => ({
        symbol,
        trades: metrics.trades,
        winRate: metrics.count > 0 ? Number(((metrics.winRateTotal / metrics.count) * 100).toFixed(2)) : 0,
        profitFactor: metrics.count > 0 ? Number((metrics.pfTotal / metrics.count).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 8);
  }, [validationRuns]);

  const hasValidation = latest.runId > 0 || validationRuns.length > 0;

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Strategy Backtest Results
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Validation metrics sourced from live run payloads and strategy_validation_runs</CardDescription>
        </CardHeader>
      </Card>

      {!hasValidation && (
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-200 font-semibold">No validation runs found.</p>
            <p className="text-slate-400 text-sm mt-1">
              Run `validate-strategy` to populate backtest and validation analytics.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[
          { label: 'Latest Trades', value: latest.metrics.overall.trades, color: 'text-white' },
          { label: 'Latest Win Rate', value: `${(latest.metrics.overall.winRate * 100).toFixed(2)}%`, color: 'text-green-400' },
          { label: 'Latest Profit Factor', value: latest.metrics.overall.profitFactor ?? '-', color: 'text-blue-400' },
          { label: 'Latest Expectancy', value: `${latest.metrics.overall.expectancyR.toFixed(4)}R`, color: 'text-indigo-400' },
          { label: 'Out-of-Sample PF', value: latest.metrics.outOfSample.profitFactor ?? '-', color: 'text-purple-400' },
          { label: 'Out-of-Sample WR', value: `${(latest.metrics.outOfSample.winRate * 100).toFixed(2)}%`, color: 'text-emerald-400' },
          { label: 'Candles Used', value: latest.totalCandlesUsed, color: 'text-yellow-400' },
          { label: 'Validation Runs', value: validationRuns.length, color: 'text-cyan-400' },
        ].map((metric, idx) => (
          <Card key={idx} className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <p className="text-slate-400 text-sm">{metric.label}</p>
              <p className={`text-2xl font-bold mt-2 ${metric.color}`}>{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Profit Factor Trend (Recent Runs)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={runTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="run" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="profitFactor" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Out-of-Sample Win Rate Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={runTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="run" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="outSampleWinRate" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Symbol Validation Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {symbolPerformance.length === 0 ? (
            <p className="text-slate-400 text-sm">No symbol-level validation metrics available yet.</p>
          ) : (
            <div className="space-y-3">
              {symbolPerformance.map((symbol) => (
                <div key={symbol.symbol} className="p-3 bg-slate-700 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-white font-semibold">{symbol.symbol}</h4>
                    <span className="text-slate-400 text-xs">{symbol.trades} trades</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-slate-400 text-xs">Avg Win Rate</p>
                      <p className="text-green-400 font-semibold">{symbol.winRate}%</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Avg Profit Factor</p>
                      <p className="text-blue-400 font-semibold">{symbol.profitFactor}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
