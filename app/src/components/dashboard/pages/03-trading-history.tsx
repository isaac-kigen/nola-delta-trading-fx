'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function TradingHistoryPage() {
  const trades = [
    {
      id: 1,
      symbol: 'EUR/USD',
      direction: 'LONG',
      entryTime: '2026-02-12 14:30',
      exitTime: '2026-02-12 18:45',
      entryPrice: 1.0842,
      exitPrice: 1.0856,
      result: 'win',
      profitR: 2.5,
      pnl: '$625',
      reason: 'TP1 hit',
      riskAmount: '$250',
    },
    {
      id: 2,
      symbol: 'GBP/USD',
      direction: 'SHORT',
      entryTime: '2026-02-12 10:15',
      exitTime: '2026-02-12 14:20',
      entryPrice: 1.2768,
      exitPrice: 1.2745,
      result: 'win',
      profitR: 1.8,
      pnl: '$450',
      reason: 'TP1 hit',
      riskAmount: '$250',
    },
    {
      id: 3,
      symbol: 'XAU/USD',
      direction: 'LONG',
      entryTime: '2026-02-11 22:00',
      exitTime: '2026-02-12 09:30',
      entryPrice: 2150.50,
      exitPrice: 2142.30,
      result: 'loss',
      profitR: -1.2,
      pnl: '-$300',
      reason: 'Stop Loss',
      riskAmount: '$250',
    },
    {
      id: 4,
      symbol: 'SPX500',
      direction: 'LONG',
      entryTime: '2026-02-10 16:00',
      exitTime: '2026-02-12 13:00',
      entryPrice: 5420.30,
      exitPrice: 5485.00,
      result: 'win',
      profitR: 3.2,
      pnl: '$800',
      reason: 'TP2 hit',
      riskAmount: '$250',
    },
    {
      id: 5,
      symbol: 'EURUSD',
      direction: 'SHORT',
      entryTime: '2026-02-09 11:45',
      exitTime: '2026-02-10 15:30',
      entryPrice: 1.0920,
      exitPrice: 1.0885,
      result: 'win',
      profitR: 2.1,
      pnl: '$525',
      reason: 'TP1 hit',
      riskAmount: '$250',
    },
  ];

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.result === 'win').length;
  const losses = trades.filter((t) => t.result === 'loss').length;
  const winRate = ((wins / totalTrades) * 100).toFixed(1);
  const totalPnL = trades.reduce((sum, t) => sum + parseFloat(t.pnl.replace(/[$,]/g, '')), 0);

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Trading History</CardTitle>
          <CardDescription>Completed trades and performance metrics</CardDescription>
        </CardHeader>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Total Trades</p>
            <p className="text-3xl font-bold text-white mt-2">{totalTrades}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Win Rate</p>
            <p className="text-3xl font-bold text-green-400 mt-2">{winRate}%</p>
            <p className="text-xs text-slate-400 mt-1">{wins}W / {losses}L</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Total P&L</p>
            <p className={`text-3xl font-bold mt-2 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${totalPnL.toFixed(0)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Avg P&L per Trade</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">
              ${(totalPnL / totalTrades).toFixed(0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trades Table */}
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="pt-6">
          <div className="space-y-3">
            {trades.map((trade) => (
              <div key={trade.id} className="p-4 bg-slate-700 rounded-lg">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="text-white font-semibold">{trade.symbol}</h4>
                      <Badge
                        className={`${
                          trade.direction === 'LONG'
                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                            : 'bg-red-500/20 text-red-400 border-red-500/50'
                        } border`}
                      >
                        {trade.direction}
                      </Badge>
                      <Badge
                        className={`${
                          trade.result === 'win'
                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                            : 'bg-red-500/20 text-red-400 border-red-500/50'
                        } border`}
                      >
                        {trade.result === 'win' ? '✓ Win' : '✗ Loss'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">
                      Entry: {trade.entryPrice} @ {trade.entryTime} → Exit: {trade.exitPrice} @ {trade.exitTime}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Exit: {trade.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${trade.result === 'win' ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.pnl}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{trade.profitR > 0 ? '+' : ''}{trade.profitR.toFixed(1)}R</p>
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
