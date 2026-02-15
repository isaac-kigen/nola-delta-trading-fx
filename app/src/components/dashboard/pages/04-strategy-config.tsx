'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSystemData } from '@/context/SystemDataContext';

export default function StrategyConfigPage() {
  const { snapshot, isLive } = useSystemData();
  const runtime = snapshot.strategyRuntime;
  const symbolConfigs = snapshot.strategySymbols;

  const globalEntries = runtime
    ? [
        { key: 'Strategy Version', value: runtime.strategyVersion || '-' },
        { key: 'Setup Label', value: runtime.setupLabel || '-' },
        { key: 'Account Equity', value: `$${runtime.accountEquityUsd.toLocaleString()}` },
        { key: 'Max Total Risk', value: `${runtime.maxTotalRiskPct}%` },
        { key: 'Max Open Trades', value: runtime.maxOpenTrades },
        { key: 'Max Trades / Day', value: runtime.maxTradesPerDay },
        { key: 'Max Symbol Trades / Day', value: runtime.maxSymbolTradesPerDay },
        { key: 'Max Trades / Session', value: runtime.maxTradesPerSession },
        { key: 'Correlation Cap', value: runtime.correlationBaseCurrencyCap },
        { key: 'Telegram Msg / Hour', value: runtime.telegramMaxMessagesPerHour },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Strategy Configuration
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Runtime and symbol settings loaded from strategy config tables</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="global" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-slate-700 border border-slate-600">
          <TabsTrigger
            value="global"
            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300"
          >
            Global Settings
          </TabsTrigger>
          <TabsTrigger
            value="symbols"
            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300"
          >
            Symbol Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-4 mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              {runtime ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  {globalEntries.map((entry) => (
                    <div key={entry.key}>
                      <p className="text-slate-400 text-sm">{entry.key}</p>
                      <p className="text-white font-semibold mt-1">{entry.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-300 text-sm">No runtime config row found for `strategy_runtime_config.key = global`.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg text-white">Filter Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'News Filter', enabled: runtime?.newsFilterEnabled ?? false },
                { label: 'Volatility Filter', enabled: runtime?.volatilityFilterEnabled ?? false },
                { label: 'Trend Filter', enabled: runtime?.trendFilterEnabled ?? false },
                { label: 'Session Filter', enabled: runtime?.sessionFilterEnabled ?? false },
              ].map((filter) => (
                <div key={filter.label} className="flex justify-between items-center p-2 bg-slate-700 rounded">
                  <span className="text-slate-300">{filter.label}</span>
                  <span className={filter.enabled ? 'text-green-400 font-semibold' : 'text-slate-400 font-semibold'}>
                    {filter.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="symbols" className="space-y-4 mt-6">
          {symbolConfigs.length === 0 && (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-6">
                <p className="text-slate-300 text-sm">No symbol configs available in `strategy_symbol_config`.</p>
              </CardContent>
            </Card>
          )}

          {symbolConfigs.map((config) => (
            <Card key={config.symbol} className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-white">{config.symbol}</CardTitle>
                  <span className={`px-3 py-1 rounded text-sm font-semibold ${config.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {config.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-slate-400 text-sm">Trigger Policy</p>
                    <p className="text-white font-semibold mt-1 capitalize">{config.triggerPolicy}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Session (UTC)</p>
                    <p className="text-white font-semibold mt-1">
                      {config.sessionStartHourUtc}:00 - {config.sessionEndHourUtc}:00
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Risk per Trade</p>
                    <p className="text-white font-semibold mt-1">{config.riskPerTradePct}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Min Stop</p>
                    <p className="text-white font-semibold mt-1">{config.minStopPips} pips</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Max Stop</p>
                    <p className="text-white font-semibold mt-1">{config.maxStopPips} pips</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Trail After TP2</p>
                    <p className={`font-semibold mt-1 ${config.trailAfterTp2 ? 'text-green-400' : 'text-slate-400'}`}>
                      {config.trailAfterTp2 ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-700 rounded">
                  <p className="text-slate-400 text-sm mb-2">Take Profit Distribution</p>
                  <div className="flex gap-2">
                    {[config.tp1TakePct, config.tp2TakePct, config.tp3TakePct].map((pct, idx) => (
                      <div key={idx} className="flex-1 text-center">
                        <p className="text-green-400 font-semibold">TP{idx + 1}</p>
                        <p className="text-white">{pct}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
