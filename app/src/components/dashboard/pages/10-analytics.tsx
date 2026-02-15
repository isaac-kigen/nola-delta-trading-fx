'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function AnalyticsPage() {
  const performanceData = [
    { week: 'W1', trades: 12, wins: 8, pnl: 2100 },
    { week: 'W2', trades: 15, wins: 10, pnl: 2850 },
    { week: 'W3', trades: 10, wins: 7, pnl: 1680 },
    { week: 'W4', trades: 18, wins: 12, pnl: 3240 },
    { week: 'W5', trades: 14, wins: 9, pnl: 2100 },
    { week: 'W6', trades: 16, wins: 11, pnl: 2960 },
  ];

  const dailyReturnsData = [
    { day: 'Mon', return: 1.2 },
    { day: 'Tue', return: 0.8 },
    { day: 'Wed', return: 1.5 },
    { day: 'Thu', return: -0.3 },
    { day: 'Fri', return: 2.1 },
    { day: 'Sat', return: 0.2 },
    { day: 'Sun', return: 0.0 },
  ];

  const keyMetrics = [
    { label: 'Total P&L', value: '$14,830', change: '+12.3%', icon: TrendingUp, color: 'text-green-400' },
    { label: 'Total Trades', value: '85', change: '+18 this week', icon: TrendingUp, color: 'text-blue-400' },
    { label: 'Win Rate', value: '68.2%', change: '+3.5% vs last month', icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Profit Factor', value: '3.24', change: '+0.15 vs baseline', icon: TrendingUp, color: 'text-purple-400' },
    { label: 'Max Consecutive Wins', value: '8', change: 'Best streak', icon: TrendingUp, color: 'text-yellow-400' },
    { label: 'Avg Trade P&L', value: '$174.47', change: '+8.2% improvement', icon: TrendingUp, color: 'text-pink-400' },
  ];

  const timeDistribution = [
    { period: 'Asian', trades: 8, winRate: 62.5 },
    { period: 'London', trades: 32, winRate: 71.9 },
    { period: 'US', trades: 28, winRate: 67.9 },
    { period: 'Overlap', trades: 17, winRate: 70.6 },
  ];

  const symbolMetrics = [
    { symbol: 'EUR/USD', trades: 32, pnl: 5280, winRate: 71.9, avgR: 2.15 },
    { symbol: 'GBP/USD', trades: 24, pnl: 3840, winRate: 66.7, avgR: 1.95 },
    { symbol: 'XAU/USD', trades: 18, pnl: 3420, winRate: 72.2, avgR: 2.35 },
    { symbol: 'SPX500', trades: 11, pnl: 2290, winRate: 63.6, avgR: 1.58 },
  ];

  const riskMetrics = [
    { metric: 'Best Day P&L', value: '+$850', percentage: 1.7 },
    { metric: 'Worst Day P&L', value: '-$320', percentage: -0.64 },
    { metric: 'Avg Daily P&L', value: '+$186', percentage: 0.37 },
    { metric: 'Largest Win', value: '+$1,200', percentage: 2.4 },
    { metric: 'Largest Loss', value: '-$450', percentage: -0.9 },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Trading Analytics</CardTitle>
          <CardDescription>Performance metrics and statistical analysis</CardDescription>
        </CardHeader>
      </Card>

      {/* Key Performance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {keyMetrics.map((metric, idx) => {
          const Icon = metric.icon;
          return (
            <Card key={idx} className="bg-slate-800 border-slate-700 hover:bg-slate-750 transition">
              <CardContent className="pt-6">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-slate-400 text-sm">{metric.label}</p>
                    <h3 className={`text-2xl font-bold mt-2 ${metric.color}`}>{metric.value}</h3>
                    <p className="text-xs text-green-400 mt-2">{metric.change}</p>
                  </div>
                  <Icon className="w-6 h-6 text-slate-600" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Performance Trend */}
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

      {/* Daily Returns */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Daily Returns This Week</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dailyReturnsData}>
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

      {/* Trading by Time Period */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Performance by Trading Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {timeDistribution.map((period, idx) => (
              <div key={idx} className="p-4 bg-slate-700 rounded-lg">
                <p className="text-white font-semibold mb-2">{period.period}</p>
                <p className="text-slate-400 text-xs">Trades</p>
                <p className="text-2xl font-bold text-blue-400">{period.trades}</p>
                <p className="text-slate-400 text-xs mt-2">Win Rate</p>
                <p className="text-lg font-bold text-green-400">{period.winRate}%</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Symbol Analytics */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Symbol Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {symbolMetrics.map((sym) => (
              <div key={sym.symbol} className="p-4 bg-slate-700 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-white font-semibold">{sym.symbol}</h4>
                  <p className={`text-sm font-bold ${sym.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {sym.pnl >= 0 ? '+' : ''}${sym.pnl}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Trades</p>
                    <p className="text-white font-semibold mt-1">{sym.trades}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Win Rate</p>
                    <p className="text-green-400 font-semibold mt-1">{sym.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Avg R</p>
                    <p className="text-blue-400 font-semibold mt-1">{sym.avgR}R</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Risk Metrics */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Risk Metrics Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {riskMetrics.map((metric, idx) => (
              <div key={idx} className="p-3 bg-slate-700 rounded-lg text-center">
                <p className="text-slate-400 text-xs mb-2">{metric.metric}</p>
                <p className={`text-lg font-bold ${metric.percentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {metric.value}
                </p>
                <p className="text-xs text-slate-400 mt-1">{metric.percentage > 0 ? '+' : ''}{metric.percentage}%</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Correlation Heatmap */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Trade Performance Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gradient-to-br from-green-500/20 to-green-500/5 rounded-lg border border-green-500/50">
            <p className="text-green-400 text-sm font-semibold">Winning Trades</p>
            <p className="text-3xl font-bold text-green-400 mt-2">58</p>
            <p className="text-xs text-green-400/70 mt-1">68.2% win rate</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-red-500/20 to-red-500/5 rounded-lg border border-red-500/50">
            <p className="text-red-400 text-sm font-semibold">Losing Trades</p>
            <p className="text-3xl font-bold text-red-400 mt-2">23</p>
            <p className="text-xs text-red-400/70 mt-1">27.1% loss rate</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 rounded-lg border border-yellow-500/50">
            <p className="text-yellow-400 text-sm font-semibold">Breakeven</p>
            <p className="text-3xl font-bold text-yellow-400 mt-2">4</p>
            <p className="text-xs text-yellow-400/70 mt-1">4.7% breakeven</p>
          </div>
          <div className="p-4 bg-gradient-to-br from-blue-500/20 to-blue-500/5 rounded-lg border border-blue-500/50">
            <p className="text-blue-400 text-sm font-semibold">Total Trades</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">85</p>
            <p className="text-xs text-blue-400/70 mt-1">Since Feb 1st</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
