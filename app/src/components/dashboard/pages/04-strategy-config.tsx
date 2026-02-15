'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StrategyConfigPage() {
  const globalConfig = {
    strategyVersion: 'v2.5.0-stable',
    setupLabel: 'Multi-Symbol Trend Following',
    accountEquity: '$50,000',
    maxTotalRiskPct: 2.0,
    maxOpenTrades: 5,
    maxTradesPerDay: 8,
    maxSymbolTradesPerDay: 2,
    maxTradesPerSession: 3,
    sessionFilterEnabled: true,
    newsFilterEnabled: true,
    volatilityFilterEnabled: true,
    trendFilterEnabled: true,
  };

  const symbolConfigs = [
    {
      symbol: 'EUR/USD',
      enabled: true,
      triggerPolicy: 'market',
      sessionStart: 8,
      sessionEnd: 22,
      riskPerTrade: 1.5,
      minStop: 15,
      maxStop: 50,
      tpTakePct: [30, 40, 30],
      trailAfterTp2: true,
    },
    {
      symbol: 'GBP/USD',
      enabled: true,
      triggerPolicy: 'confirmation',
      sessionStart: 8,
      sessionEnd: 20,
      riskPerTrade: 1.5,
      minStop: 20,
      maxStop: 60,
      tpTakePct: [30, 40, 30],
      trailAfterTp2: true,
    },
    {
      symbol: 'XAU/USD',
      enabled: true,
      triggerPolicy: 'market',
      sessionStart: 6,
      sessionEnd: 24,
      riskPerTrade: 1.0,
      minStop: 5.0,
      maxStop: 15.0,
      tpTakePct: [25, 50, 25],
      trailAfterTp2: false,
    },
    {
      symbol: 'SPX500',
      enabled: true,
      triggerPolicy: 'limit',
      sessionStart: 13,
      sessionEnd: 20,
      riskPerTrade: 2.0,
      minStop: 50,
      maxStop: 150,
      tpTakePct: [40, 30, 30],
      trailAfterTp2: true,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Strategy Configuration</CardTitle>
          <CardDescription>Global and symbol-specific strategy settings</CardDescription>
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

        {/* Global Settings Tab */}
        <TabsContent value="global" className="space-y-4 mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {Object.entries(globalConfig).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-slate-400 text-sm capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                    <p className="text-white font-semibold mt-1">
                      {typeof value === 'boolean' ? (value ? '✓ Enabled' : '✗ Disabled') : value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg text-white">Filter Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between items-center p-2 bg-slate-700 rounded">
                <span className="text-slate-300">News Filter</span>
                <span className="text-green-400 font-semibold">Active</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-slate-700 rounded">
                <span className="text-slate-300">Volatility Filter</span>
                <span className="text-green-400 font-semibold">Active</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-slate-700 rounded">
                <span className="text-slate-300">Trend Filter</span>
                <span className="text-green-400 font-semibold">Active</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-slate-700 rounded">
                <span className="text-slate-300">Session Filter</span>
                <span className="text-green-400 font-semibold">Active</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Symbol Settings Tab */}
        <TabsContent value="symbols" className="space-y-4 mt-6">
          {symbolConfigs.map((config) => (
            <Card key={config.symbol} className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-white">{config.symbol}</CardTitle>
                  <span className={`px-3 py-1 rounded text-sm font-semibold ${config.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {config.enabled ? '✓ Enabled' : '✗ Disabled'}
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
                      {config.sessionStart}:00 - {config.sessionEnd}:00
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Risk per Trade</p>
                    <p className="text-white font-semibold mt-1">{config.riskPerTrade}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Min Stop</p>
                    <p className="text-white font-semibold mt-1">{config.minStop} pips</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Max Stop</p>
                    <p className="text-white font-semibold mt-1">{config.maxStop} pips</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Trail After TP2</p>
                    <p className={`font-semibold mt-1 ${config.trailAfterTp2 ? 'text-green-400' : 'text-slate-400'}`}>
                      {config.trailAfterTp2 ? '✓ Yes' : '✗ No'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-700 rounded">
                  <p className="text-slate-400 text-sm mb-2">Take Profit Distribution</p>
                  <div className="flex gap-2">
                    {config.tpTakePct.map((pct, idx) => (
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
