'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSystemData } from '@/context/SystemDataContext';

function formatUtc(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('.000Z', 'Z');
}

function formatPrice(value: number | null): string {
  if (value === null) return '-';
  return value.toFixed(5);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function TradingHistoryPage() {
  const { snapshot, isLive } = useSystemData();

  const closedTrades = useMemo(
    () =>
      snapshot.tradingPositions
        .filter((position) => position.status === 'closed')
        .sort((a, b) => {
          const aTime = new Date(a.closedAtUtc ?? a.openedAtUtc).getTime();
          const bTime = new Date(b.closedAtUtc ?? b.openedAtUtc).getTime();
          return bTime - aTime;
        }),
    [snapshot.tradingPositions],
  );

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length;
  const losses = closedTrades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalPnL = closedTrades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Trading History
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Closed positions from live trading position logs</CardDescription>
        </CardHeader>
      </Card>

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
            <p className="text-xs text-slate-400 mt-1">
              {wins}W / {losses}L
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Total P&amp;L</p>
            <p className={`text-3xl font-bold mt-2 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Avg P&amp;L per Trade</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">
              {totalTrades > 0 ? formatCurrency(totalPnL / totalTrades) : '$0.00'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="pt-6">
          {closedTrades.length === 0 ? (
            <div className="rounded-lg border border-slate-700 p-4">
              <p className="text-slate-200 font-semibold">No closed trades found.</p>
              <p className="text-slate-400 text-sm mt-1">
                Trades will appear here after positions are closed in `trading_positions`.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {closedTrades.map((trade) => {
                const pnl = trade.realizedPnl ?? 0;
                const result = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
                return (
                  <div key={trade.id} className="p-4 bg-slate-700 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-white font-semibold">{trade.symbol}</h4>
                          <Badge
                            className={`${
                              trade.direction === 'long'
                                ? 'bg-green-500/20 text-green-400 border-green-500/50'
                                : 'bg-red-500/20 text-red-400 border-red-500/50'
                            } border`}
                          >
                            {trade.direction.toUpperCase()}
                          </Badge>
                          <Badge
                            className={`${
                              result === 'win'
                                ? 'bg-green-500/20 text-green-400 border-green-500/50'
                                : result === 'loss'
                                ? 'bg-red-500/20 text-red-400 border-red-500/50'
                                : 'bg-slate-500/20 text-slate-300 border-slate-500/50'
                            } border`}
                          >
                            {result}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-400">
                          Entry: {formatPrice(trade.entryPrice)} @ {formatUtc(trade.openedAtUtc)}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Exit: {formatUtc(trade.closedAtUtc)} | Reason: {trade.closeReason ?? '-'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          {trade.realizedR === null ? '-' : `${trade.realizedR >= 0 ? '+' : ''}${trade.realizedR.toFixed(2)}R`}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Risk: {trade.riskAmountUsd === null ? '-' : formatCurrency(trade.riskAmountUsd)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
