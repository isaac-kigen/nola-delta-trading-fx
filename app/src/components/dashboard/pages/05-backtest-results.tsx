'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function BacktestResultsPage() {
  const backtestMetrics = {
    trades: 152,
    wins: 103,
    losses: 42,
    breakeven: 7,
    winRate: 67.8,
    expectancy: 2.15,
    profitFactor: 3.42,
    maxDrawdown: -12.5,
    longestWinStreak: 8,
    longestLossStreak: 3,
    directionalAccuracy: 82.3,
  };

  const equityCurveData = [
    { day: '1', equity: 50000 },
    { day: '2', equity: 51250 },
    { day: '3', equity: 50800 },
    { day: '4', equity: 52100 },
    { day: '5', equity: 51900 },
    { day: '6', equity: 53450 },
    { day: '7', equity: 54200 },
    { day: '8', equity: 53100 },
    { day: '9', equity: 55800 },
    { day: '10', equity: 57200 },
  ];

  const monthlyReturnData = [
    { month: 'Jan', return: 5.2 },
    { month: 'Feb', return: 7.8 },
    { month: 'Mar', return: 3.5 },
    { month: 'Apr', return: 9.2 },
    { month: 'May', return: 6.1 },
    { month: 'Jun', return: 8.3 },
  ];

  const symbolPerformance = [
    { symbol: 'EUR/USD', trades: 45, winRate: 68.9, profitFactor: 3.2 },
    { symbol: 'GBP/USD', trades: 38, winRate: 65.8, profitFactor: 2.9 },
    { symbol: 'XAU/USD', trades: 42, winRate: 71.4, profitFactor: 3.8 },
    { symbol: 'SPX500', trades: 27, winRate: 66.7, profitFactor: 3.1 },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Strategy Backtest Results</CardTitle>
          <CardDescription>Historical performance and validation metrics</CardDescription>
        </CardHeader>
      </Card>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Trades', value: backtestMetrics.trades, color: 'text-white' },
          { label: 'Win Rate', value: `${backtestMetrics.winRate}%`, color: 'text-green-400' },
          { label: 'Profit Factor', value: backtestMetrics.profitFactor, color: 'text-blue-400' },
          { label: 'Expectancy', value: `${backtestMetrics.expectancy}R`, color: 'text-purple-400' },
          { label: 'Max Drawdown', value: `${backtestMetrics.maxDrawdown}%`, color: 'text-red-400' },
          { label: 'Wins', value: backtestMetrics.wins, color: 'text-green-400' },
          { label: 'Losses', value: backtestMetrics.losses, color: 'text-red-400' },
          { label: 'Directional Acc.', value: `${backtestMetrics.directionalAccuracy}%`, color: 'text-yellow-400' },
        ].map((metric, idx) => (
          <Card key={idx} className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <p className="text-slate-400 text-sm">{metric.label}</p>
              <p className={`text-2xl font-bold mt-2 ${metric.color}`}>{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Equity Curve */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Equity Curve (Last 10 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={equityCurveData}>
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
                dataKey="equity"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly Returns */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Monthly Returns</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyReturnData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="return" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Symbol Performance */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Symbol Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {symbolPerformance.map((symbol) => (
              <div key={symbol.symbol} className="p-3 bg-slate-700 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-white font-semibold">{symbol.symbol}</h4>
                  <span className="text-slate-400 text-xs">{symbol.trades} trades</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-400 text-xs">Win Rate</p>
                    <p className="text-green-400 font-semibold">{symbol.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Profit Factor</p>
                    <p className="text-blue-400 font-semibold">{symbol.profitFactor}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
