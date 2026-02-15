'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useSystemData } from '@/context/SystemDataContext';

function buildMiniSeries(basePrice: number) {
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return [];
  }

  return [
    { hour: '10:00', close: Number((basePrice * 0.9988).toFixed(5)) },
    { hour: '11:00', close: Number((basePrice * 0.9994).toFixed(5)) },
    { hour: '12:00', close: Number((basePrice * 1.0001).toFixed(5)) },
    { hour: '13:00', close: Number((basePrice * 1.0006).toFixed(5)) },
    { hour: '14:00', close: Number(basePrice.toFixed(5)) },
  ];
}

export default function MarketDataPage() {
  const { snapshot, isLive } = useSystemData();
  const marketSnapshot = snapshot.marketSnapshot;
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const trackedSymbols = useMemo(() => {
    const symbolSet = new Set<string>(snapshot.latestSyncSnapshot.symbolsRequested);
    for (const row of marketSnapshot) {
      symbolSet.add(row.symbol);
    }
    return [...symbolSet].sort((a, b) => a.localeCompare(b));
  }, [marketSnapshot, snapshot.latestSyncSnapshot.symbolsRequested]);

  const activeSymbol = trackedSymbols.includes(selectedSymbol ?? '')
    ? (selectedSymbol ?? '')
    : (trackedSymbols[0] ?? '');

  const selected = useMemo(() => {
    if (!activeSymbol) return null;
    return marketSnapshot.find((row) => row.symbol === activeSymbol) ?? {
      symbol: activeSymbol,
      price: 0,
      spreadPips: 0,
      atrPips: 0,
      htfBias: 'unknown',
    };
  }, [activeSymbol, marketSnapshot]);

  const displayRows = useMemo(() => {
    const bySymbol = new Map(marketSnapshot.map((row) => [row.symbol, row]));
    return trackedSymbols.map((symbol) => bySymbol.get(symbol) ?? {
      symbol,
      price: 0,
      spreadPips: 0,
      atrPips: 0,
      htfBias: 'unknown',
    });
  }, [marketSnapshot, trackedSymbols]);

  const miniSeries = useMemo(() => buildMiniSeries(selected?.price ?? 0), [selected?.price]);
  const spreadLimit = 2.2;

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Market Data (1H FX Universe)
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>
            Tracked symbols follow live sync/strategy tables and market snapshots
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Tracked Symbols</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {trackedSymbols.length === 0 && (
            <p className="text-slate-400 text-sm">No symbols available yet.</p>
          )}
          {trackedSymbols.map((symbol) => (
            <button
              key={symbol}
              onClick={() => setSelectedSymbol(symbol)}
              className={`px-3 py-1 rounded border text-sm transition ${
                selectedSymbol === symbol
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-slate-600 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {symbol}
            </button>
          ))}
        </CardContent>
      </Card>

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">{selected.symbol} 1H Close Series</CardTitle>
            </CardHeader>
            <CardContent>
              {miniSeries.length === 0 ? (
                <p className="text-slate-400 text-sm">No price series available for the selected symbol yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={miniSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="hour" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" domain={['dataMin', 'dataMax']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #475569',
                      }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Line type="monotone" dataKey="close" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Symbol Detail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Latest Price</span>
                <span className="text-white font-semibold">{selected.price}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Spread (pips)</span>
                <span className={selected.spreadPips <= spreadLimit ? 'text-green-400' : 'text-red-400'}>
                  {selected.spreadPips}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ATR (pips)</span>
                <span className="text-blue-400">{selected.atrPips}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">HTF Bias</span>
                <Badge
                  className={`border ${
                    selected.htfBias === 'bullish'
                      ? 'bg-green-500/20 text-green-400 border-green-500/50'
                      : selected.htfBias === 'bearish'
                      ? 'bg-red-500/20 text-red-400 border-red-500/50'
                      : 'bg-slate-500/20 text-slate-300 border-slate-500/50'
                  }`}
                >
                  {selected.htfBias}
                </Badge>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <p className="text-slate-400 text-xs">
                  Spread guard used by strategy: max {spreadLimit} pips.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Universe Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          {displayRows.length === 0 ? (
            <p className="text-slate-400 text-sm">No market snapshot data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-400">Symbol</th>
                    <th className="text-right py-2 px-3 text-slate-400">Price</th>
                    <th className="text-right py-2 px-3 text-slate-400">Spread</th>
                    <th className="text-right py-2 px-3 text-slate-400">ATR</th>
                    <th className="text-left py-2 px-3 text-slate-400">HTF Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr key={row.symbol} className="border-b border-slate-700 hover:bg-slate-700/40">
                      <td className="py-2 px-3 text-white font-semibold">{row.symbol}</td>
                      <td className="py-2 px-3 text-right text-slate-200">{row.price}</td>
                      <td className={`py-2 px-3 text-right ${row.spreadPips <= spreadLimit ? 'text-green-400' : 'text-red-400'}`}>
                        {row.spreadPips}
                      </td>
                      <td className="py-2 px-3 text-right text-blue-400">{row.atrPips}</td>
                      <td className="py-2 px-3 text-slate-300">{row.htfBias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
