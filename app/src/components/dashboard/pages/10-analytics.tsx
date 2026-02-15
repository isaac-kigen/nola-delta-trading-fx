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
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { useSystemData } from '@/context/SystemDataContext';

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function sessionForHour(hour: number): 'Asian' | 'London' | 'US' | 'Overlap' {
  if (hour >= 12 && hour < 16) return 'Overlap';
  if (hour >= 7 && hour < 12) return 'London';
  if (hour >= 16 && hour < 21) return 'US';
  return 'Asian';
}

export default function AnalyticsPage() {
  const { snapshot, isLive } = useSystemData();
  const accountEquity = snapshot.strategyRuntime?.accountEquityUsd ?? 0;

  const closedPositions = useMemo(
    () =>
      snapshot.tradingPositions
        .filter((position) => position.status === 'closed')
        .sort(
          (a, b) =>
            new Date(a.closedAtUtc ?? a.openedAtUtc).getTime() -
            new Date(b.closedAtUtc ?? b.openedAtUtc).getTime(),
        ),
    [snapshot.tradingPositions],
  );

  const performanceData = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const data: Array<{ week: string; trades: number; wins: number; pnl: number }> = [];

    for (let i = 5; i >= 0; i -= 1) {
      const start = now - ((i + 1) * weekMs);
      const end = now - (i * weekMs);
      const weekTrades = closedPositions.filter((position) => {
        const timestamp = new Date(position.closedAtUtc ?? position.openedAtUtc).getTime();
        return timestamp >= start && timestamp < end;
      });

      data.push({
        week: `W${6 - i}`,
        trades: weekTrades.length,
        wins: weekTrades.filter((position) => (position.realizedPnl ?? 0) > 0).length,
        pnl: weekTrades.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0),
      });
    }

    return data;
  }, [closedPositions]);

  const dailyPerformance = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date();
    const startTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const rows: Array<{ day: string; pnl: number; return: number }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const start = startTodayUtc - (i * dayMs);
      const end = start + dayMs;
      const dayDate = new Date(start);
      const pnl = closedPositions
        .filter((position) => {
          const timestamp = new Date(position.closedAtUtc ?? position.openedAtUtc).getTime();
          return timestamp >= start && timestamp < end;
        })
        .reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);

      rows.push({
        day: dayDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        pnl,
        return: accountEquity > 0 ? (pnl / accountEquity) * 100 : 0,
      });
    }

    return rows;
  }, [accountEquity, closedPositions]);

  const totals = useMemo(() => {
    const totalPnL = closedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
    const wins = closedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length;
    const losses = closedPositions.filter((position) => (position.realizedPnl ?? 0) < 0).length;
    const breakeven = closedPositions.length - wins - losses;

    const grossWins = closedPositions.reduce(
      (sum, position) => sum + Math.max(position.realizedPnl ?? 0, 0),
      0,
    );
    const grossLoss = closedPositions.reduce(
      (sum, position) => sum + Math.abs(Math.min(position.realizedPnl ?? 0, 0)),
      0,
    );

    let consecutiveWins = 0;
    let longestWinStreak = 0;
    for (const position of closedPositions) {
      if ((position.realizedPnl ?? 0) > 0) {
        consecutiveWins += 1;
        longestWinStreak = Math.max(longestWinStreak, consecutiveWins);
      } else {
        consecutiveWins = 0;
      }
    }

    return {
      totalPnL,
      wins,
      losses,
      breakeven,
      totalTrades: closedPositions.length,
      winRate: closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWins / grossLoss : null,
      longestWinStreak,
      avgTradePnl: closedPositions.length > 0 ? totalPnL / closedPositions.length : 0,
    };
  }, [closedPositions]);

  const timeDistribution = useMemo(() => {
    const sessions = new Map<string, { trades: number; wins: number }>([
      ['Asian', { trades: 0, wins: 0 }],
      ['London', { trades: 0, wins: 0 }],
      ['US', { trades: 0, wins: 0 }],
      ['Overlap', { trades: 0, wins: 0 }],
    ]);

    for (const position of closedPositions) {
      const opened = new Date(position.openedAtUtc);
      const session = sessionForHour(opened.getUTCHours());
      const row = sessions.get(session);
      if (!row) continue;
      row.trades += 1;
      if ((position.realizedPnl ?? 0) > 0) row.wins += 1;
    }

    return [...sessions.entries()].map(([period, row]) => ({
      period,
      trades: row.trades,
      winRate: row.trades > 0 ? (row.wins / row.trades) * 100 : 0,
    }));
  }, [closedPositions]);

  const symbolMetrics = useMemo(() => {
    const grouped = new Map<string, { trades: number; wins: number; pnl: number; totalR: number; countedR: number }>();

    for (const position of closedPositions) {
      const current = grouped.get(position.symbol) ?? { trades: 0, wins: 0, pnl: 0, totalR: 0, countedR: 0 };
      current.trades += 1;
      current.pnl += position.realizedPnl ?? 0;
      if ((position.realizedPnl ?? 0) > 0) current.wins += 1;
      if (position.realizedR !== null) {
        current.totalR += position.realizedR;
        current.countedR += 1;
      }
      grouped.set(position.symbol, current);
    }

    return [...grouped.entries()]
      .map(([symbol, row]) => ({
        symbol,
        trades: row.trades,
        pnl: row.pnl,
        winRate: row.trades > 0 ? (row.wins / row.trades) * 100 : 0,
        avgR: row.countedR > 0 ? row.totalR / row.countedR : 0,
      }))
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 8);
  }, [closedPositions]);

  const riskMetrics = useMemo(() => {
    const dailyPnLValues = dailyPerformance.map((row) => row.pnl);
    const bestDay = dailyPnLValues.length > 0 ? Math.max(...dailyPnLValues) : 0;
    const worstDay = dailyPnLValues.length > 0 ? Math.min(...dailyPnLValues) : 0;
    const avgDay = dailyPnLValues.length > 0
      ? dailyPnLValues.reduce((sum, value) => sum + value, 0) / dailyPnLValues.length
      : 0;

    const largestWin = closedPositions.reduce((max, position) => Math.max(max, position.realizedPnl ?? 0), 0);
    const largestLoss = closedPositions.reduce((min, position) => Math.min(min, position.realizedPnl ?? 0), 0);

    return [
      {
        metric: 'Best Day P&L',
        value: formatCurrency(bestDay),
        percentage: accountEquity > 0 ? (bestDay / accountEquity) * 100 : 0,
      },
      {
        metric: 'Worst Day P&L',
        value: formatCurrency(worstDay),
        percentage: accountEquity > 0 ? (worstDay / accountEquity) * 100 : 0,
      },
      {
        metric: 'Avg Daily P&L',
        value: formatCurrency(avgDay),
        percentage: accountEquity > 0 ? (avgDay / accountEquity) * 100 : 0,
      },
      {
        metric: 'Largest Win',
        value: formatCurrency(largestWin),
        percentage: accountEquity > 0 ? (largestWin / accountEquity) * 100 : 0,
      },
      {
        metric: 'Largest Loss',
        value: formatCurrency(largestLoss),
        percentage: accountEquity > 0 ? (largestLoss / accountEquity) * 100 : 0,
      },
    ];
  }, [accountEquity, closedPositions, dailyPerformance]);

  const keyMetrics = [
    {
      label: 'Total P&L',
      value: formatCurrency(totals.totalPnL),
      change: `${totals.totalPnL >= 0 ? '+' : ''}${formatPercent(accountEquity > 0 ? (totals.totalPnL / accountEquity) * 100 : 0)}`,
      icon: TrendingUp,
      color: totals.totalPnL >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Total Trades',
      value: String(totals.totalTrades),
      change: `${performanceData.at(-1)?.trades ?? 0} in latest week`,
      icon: TrendingUp,
      color: 'text-blue-400',
    },
    {
      label: 'Win Rate',
      value: formatPercent(totals.winRate),
      change: `${totals.wins} wins / ${totals.losses} losses`,
      icon: TrendingUp,
      color: 'text-emerald-400',
    },
    {
      label: 'Profit Factor',
      value: totals.profitFactor === null ? '-' : totals.profitFactor.toFixed(4),
      change: 'Gross wins to gross losses ratio',
      icon: TrendingUp,
      color: 'text-indigo-400',
    },
    {
      label: 'Max Consecutive Wins',
      value: String(totals.longestWinStreak),
      change: 'Longest closed-trade streak',
      icon: TrendingUp,
      color: 'text-yellow-400',
    },
    {
      label: 'Avg Trade P&L',
      value: formatCurrency(totals.avgTradePnl),
      change: 'Average closed-position result',
      icon: TrendingUp,
      color: 'text-cyan-400',
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Trading Analytics
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Performance metrics computed from live trading positions and signals</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {keyMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label} className="bg-slate-800 border-slate-700 hover:bg-slate-750 transition">
              <CardContent className="pt-6">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-slate-400 text-sm">{metric.label}</p>
                    <h3 className={`text-2xl font-bold mt-2 ${metric.color}`}>{metric.value}</h3>
                    <p className="text-xs text-slate-300 mt-2">{metric.change}</p>
                  </div>
                  <Icon className="w-6 h-6 text-slate-600" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">6-Week Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="week" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Bar dataKey="trades" fill="#3b82f6" />
              <Bar dataKey="wins" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Daily Returns This Week</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dailyPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="day" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Line
                type="monotone"
                dataKey="return"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ fill: '#f59e0b' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Performance by Trading Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {timeDistribution.map((period) => (
              <div key={period.period} className="p-4 bg-slate-700 rounded-lg">
                <p className="text-white font-semibold mb-2">{period.period}</p>
                <p className="text-slate-400 text-xs">Trades</p>
                <p className="text-2xl font-bold text-blue-400">{period.trades}</p>
                <p className="text-slate-400 text-xs mt-2">Win Rate</p>
                <p className="text-lg font-bold text-green-400">{period.winRate.toFixed(2)}%</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Symbol Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {symbolMetrics.length === 0 ? (
            <p className="text-slate-400 text-sm">No closed-position symbol analytics yet.</p>
          ) : (
            <div className="space-y-3">
              {symbolMetrics.map((symbol) => (
                <div key={symbol.symbol} className="p-4 bg-slate-700 rounded-lg">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-white font-semibold">{symbol.symbol}</h4>
                    <p className={`text-sm font-bold ${symbol.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {symbol.pnl >= 0 ? '+' : ''}{formatCurrency(symbol.pnl)}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-slate-400 text-xs">Trades</p>
                      <p className="text-white font-semibold mt-1">{symbol.trades}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Win Rate</p>
                      <p className="text-green-400 font-semibold mt-1">{symbol.winRate.toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Avg R</p>
                      <p className="text-blue-400 font-semibold mt-1">{symbol.avgR.toFixed(2)}R</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Risk Metrics Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {riskMetrics.map((metric) => (
              <div key={metric.metric} className="p-3 bg-slate-700 rounded-lg text-center">
                <p className="text-slate-400 text-xs mb-2">{metric.metric}</p>
                <p className={`text-lg font-bold ${metric.percentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {metric.value}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {metric.percentage >= 0 ? '+' : ''}{metric.percentage.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Trade Performance Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gradient-to-br from-green-500/20 to-green-500/5 rounded-lg border border-green-500/50">
            <p className="text-green-400 text-sm font-semibold">Winning Trades</p>
            <p className="text-3xl font-bold text-green-400 mt-2">{totals.wins}</p>
            <p className="text-xs text-green-400/70 mt-1">
              {totals.totalTrades > 0 ? ((totals.wins / totals.totalTrades) * 100).toFixed(2) : '0.00'}% win rate
            </p>
          </div>
          <div className="p-4 bg-gradient-to-br from-red-500/20 to-red-500/5 rounded-lg border border-red-500/50">
            <p className="text-red-400 text-sm font-semibold">Losing Trades</p>
            <p className="text-3xl font-bold text-red-400 mt-2">{totals.losses}</p>
            <p className="text-xs text-red-400/70 mt-1">
              {totals.totalTrades > 0 ? ((totals.losses / totals.totalTrades) * 100).toFixed(2) : '0.00'}% loss rate
            </p>
          </div>
          <div className="p-4 bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 rounded-lg border border-yellow-500/50">
            <p className="text-yellow-400 text-sm font-semibold">Breakeven</p>
            <p className="text-3xl font-bold text-yellow-400 mt-2">{totals.breakeven}</p>
            <p className="text-xs text-yellow-400/70 mt-1">
              {totals.totalTrades > 0 ? ((totals.breakeven / totals.totalTrades) * 100).toFixed(2) : '0.00'}% breakeven
            </p>
          </div>
          <div className="p-4 bg-gradient-to-br from-blue-500/20 to-blue-500/5 rounded-lg border border-blue-500/50">
            <p className="text-blue-400 text-sm font-semibold">Total Trades</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">{totals.totalTrades}</p>
            <p className="text-xs text-blue-400/70 mt-1">Closed positions only</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
