'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit2, Trash2, Plus } from 'lucide-react';

export default function SymbolManagementPage() {
  const symbols = [
    {
      id: 1,
      symbol: 'EUR/USD',
      enabled: true,
      strategy: 'Trend Following',
      sessionStart: 8,
      sessionEnd: 22,
      riskPct: 1.5,
      minStop: 15,
      maxStop: 50,
      lastSignal: '2026-02-12 14:30',
      trades7d: 12,
      winRate7d: 75.0,
    },
    {
      id: 2,
      symbol: 'GBP/USD',
      enabled: true,
      strategy: 'Trend Following',
      sessionStart: 8,
      sessionEnd: 20,
      riskPct: 1.5,
      minStop: 20,
      maxStop: 60,
      lastSignal: '2026-02-12 10:15',
      trades7d: 8,
      winRate7d: 62.5,
    },
    {
      id: 3,
      symbol: 'XAU/USD',
      enabled: true,
      strategy: 'Mean Reversion',
      sessionStart: 6,
      sessionEnd: 24,
      riskPct: 1.0,
      minStop: 5.0,
      maxStop: 15.0,
      lastSignal: '2026-02-12 22:00',
      trades7d: 15,
      winRate7d: 71.0,
    },
    {
      id: 4,
      symbol: 'SPX500',
      enabled: true,
      strategy: 'Trend Following',
      sessionStart: 13,
      sessionEnd: 20,
      riskPct: 2.0,
      minStop: 50,
      maxStop: 150,
      lastSignal: '2026-02-11 16:00',
      trades7d: 5,
      winRate7d: 80.0,
    },
    {
      id: 5,
      symbol: 'GBPJPY',
      enabled: false,
      strategy: 'Trend Following',
      sessionStart: 7,
      sessionEnd: 19,
      riskPct: 1.5,
      minStop: 30,
      maxStop: 80,
      lastSignal: '2026-02-08 12:00',
      trades7d: 2,
      winRate7d: 50.0,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Symbol Management</CardTitle>
          <CardDescription>Configure trading symbols and parameters</CardDescription>
        </CardHeader>
      </Card>

      {/* Add New Symbol Button */}
      <Button className="bg-blue-600 hover:bg-blue-700 text-white">
        <Plus className="w-4 h-4 mr-2" />
        Add New Symbol
      </Button>

      {/* Symbols List */}
      <div className="space-y-4">
        {symbols.map((sym) => (
          <Card key={sym.id} className="bg-slate-800 border-slate-700 overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-2xl font-bold text-white">{sym.symbol}</h3>
                    <Badge
                      className={`${
                        sym.enabled
                          ? 'bg-green-500/20 text-green-400 border-green-500/50'
                          : 'bg-red-500/20 text-red-400 border-red-500/50'
                      } border`}
                    >
                      {sym.enabled ? '✓ Enabled' : '✗ Disabled'}
                    </Badge>
                    <Badge variant="outline" className="border-slate-600 text-slate-300">
                      {sym.strategy}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">Last signal: {sym.lastSignal}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-600 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Configuration Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-slate-700 rounded-lg mb-4">
                <div>
                  <p className="text-slate-400 text-xs">Session (UTC)</p>
                  <p className="text-white font-semibold mt-1">
                    {sym.sessionStart}:00 - {sym.sessionEnd}:00
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Risk per Trade</p>
                  <p className="text-white font-semibold mt-1">{sym.riskPct}%</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Min/Max Stop</p>
                  <p className="text-white font-semibold mt-1">
                    {sym.minStop} / {sym.maxStop}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">7-Day Stats</p>
                  <p className="text-white font-semibold mt-1">
                    {sym.trades7d} trades @ {sym.winRate7d}%
                  </p>
                </div>
              </div>

              {/* Performance Bars */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-400 text-xs mb-2">7-Day Trades</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-600 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${(sym.trades7d / 20) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-slate-300 text-xs">{sym.trades7d}</span>
                  </div>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-2">Win Rate 7D</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-600 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          sym.winRate7d >= 70 ? 'bg-green-500' : 'bg-yellow-500'
                        }`}
                        style={{ width: `${sym.winRate7d}%` }}
                      ></div>
                    </div>
                    <span className="text-slate-300 text-xs">{sym.winRate7d}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Disabled Symbols */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Disabled Symbols</CardTitle>
          <CardDescription>Symbols with trading disabled</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-slate-300 text-sm">1 symbol disabled: GBPJPY</p>
          <p className="text-slate-400 text-xs mt-2">Reason: Below minimum performance threshold for 2 weeks</p>
        </CardContent>
      </Card>
    </div>
  );
}
