'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit2, Trash2, Plus } from 'lucide-react';
import { useSystemData } from '@/context/SystemDataContext';

function formatUtc(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('.000Z', 'Z');
}

export default function SymbolManagementPage() {
  const { snapshot, isLive } = useSystemData();
  const symbolConfigs = snapshot.strategySymbols;
  const snapshotTimestamp = new Date(snapshot.fetchedAtUtc).getTime();
  const referenceNow = Number.isFinite(snapshotTimestamp) ? snapshotTimestamp : 0;

  const statsBySymbol = useMemo(() => {
    const sevenDaysAgo = referenceNow - 7 * 24 * 60 * 60 * 1000;
    const stats = new Map<string, { trades7d: number; wins7d: number; losses7d: number; lastSignal: string | null }>();

    for (const signal of snapshot.tradingSignals) {
      const existing = stats.get(signal.symbol) ?? { trades7d: 0, wins7d: 0, losses7d: 0, lastSignal: null };
      if (!existing.lastSignal) {
        existing.lastSignal = signal.createdAtUtc;
      }
      stats.set(signal.symbol, existing);
    }

    for (const position of snapshot.tradingPositions) {
      const timestamp = position.closedAtUtc ?? position.openedAtUtc;
      if (new Date(timestamp).getTime() < sevenDaysAgo) continue;

      const existing = stats.get(position.symbol) ?? { trades7d: 0, wins7d: 0, losses7d: 0, lastSignal: null };
      existing.trades7d += 1;

      const pnl = position.realizedPnl ?? 0;
      if (pnl > 0) existing.wins7d += 1;
      if (pnl < 0) existing.losses7d += 1;

      stats.set(position.symbol, existing);
    }

    return stats;
  }, [referenceNow, snapshot.tradingSignals, snapshot.tradingPositions]);

  const disabledSymbols = symbolConfigs.filter((config) => !config.enabled);

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Symbol Management
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Strategy symbol config and 7-day symbol performance from live tables</CardDescription>
        </CardHeader>
      </Card>

      <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled>
        <Plus className="w-4 h-4 mr-2" />
        Add New Symbol
      </Button>

      <div className="space-y-4">
        {symbolConfigs.length === 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <p className="text-slate-300 text-sm">No symbol configurations found in `strategy_symbol_config`.</p>
            </CardContent>
          </Card>
        )}

        {symbolConfigs.map((config) => {
          const stats = statsBySymbol.get(config.symbol) ?? {
            trades7d: 0,
            wins7d: 0,
            losses7d: 0,
            lastSignal: null,
          };

          const winRate7d = stats.trades7d > 0 ? (stats.wins7d / stats.trades7d) * 100 : 0;

          return (
            <Card key={config.symbol} className="bg-slate-800 border-slate-700 overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-2xl font-bold text-white">{config.symbol}</h3>
                      <Badge
                        className={`${
                          config.enabled
                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                            : 'bg-red-500/20 text-red-400 border-red-500/50'
                        } border`}
                      >
                        {config.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <Badge variant="outline" className="border-slate-600 text-slate-300">
                        {config.strategyVersion || 'strategy'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">Last signal: {formatUtc(stats.lastSignal)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-600 text-slate-300 hover:bg-slate-700"
                      disabled
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-600 text-red-400 hover:bg-red-500/10"
                      disabled
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-slate-700 rounded-lg mb-4">
                  <div>
                    <p className="text-slate-400 text-xs">Session (UTC)</p>
                    <p className="text-white font-semibold mt-1">
                      {config.sessionStartHourUtc}:00 - {config.sessionEndHourUtc}:00
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Risk per Trade</p>
                    <p className="text-white font-semibold mt-1">{config.riskPerTradePct}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Min/Max Stop</p>
                    <p className="text-white font-semibold mt-1">
                      {config.minStopPips} / {config.maxStopPips}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">7-Day Stats</p>
                    <p className="text-white font-semibold mt-1">
                      {stats.trades7d} trades @ {winRate7d.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-400 text-xs mb-2">7-Day Trades</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-600 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${Math.min(100, (stats.trades7d / 20) * 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-slate-300 text-xs">{stats.trades7d}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-2">Win Rate 7D</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-600 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            winRate7d >= 70 ? 'bg-green-500' : winRate7d >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, winRate7d))}%` }}
                        ></div>
                      </div>
                      <span className="text-slate-300 text-xs">{winRate7d.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Disabled Symbols</CardTitle>
          <CardDescription>Symbols with trading disabled in live config</CardDescription>
        </CardHeader>
        <CardContent>
          {disabledSymbols.length === 0 ? (
            <p className="text-slate-300 text-sm">No disabled symbols.</p>
          ) : (
            <>
              <p className="text-slate-300 text-sm">{disabledSymbols.length} disabled symbols</p>
              <p className="text-slate-400 text-xs mt-2">
                {disabledSymbols.map((symbol) => symbol.symbol).join(', ')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
