'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle } from 'lucide-react';

export default function RiskManagementPage() {
  const riskMetrics = {
    accountEquity: 50000,
    totalRiskUsd: 750,
    maxTotalRiskUsd: 1000,
    riskPercentage: 1.5,
    maxRiskPercentage: 2.0,
    openRiskUsd: 750,
    exposurePercentage: 45,
  };

  const openPositions = [
    {
      symbol: 'EUR/USD',
      direction: 'LONG',
      entry: 1.0842,
      current: 1.0856,
      positionSize: 100000,
      riskAmount: 250,
      profitLoss: 325,
      riskReward: 1.3,
    },
    {
      symbol: 'GBP/USD',
      direction: 'LONG',
      entry: 1.2745,
      current: 1.2768,
      positionSize: 80000,
      riskAmount: 250,
      profitLoss: 575,
      riskReward: 2.3,
    },
    {
      symbol: 'XAU/USD',
      direction: 'SHORT',
      entry: 2165.30,
      current: 2152.10,
      positionSize: 50,
      riskAmount: 250,
      profitLoss: 660,
      riskReward: 2.64,
    },
  ];

  const correlation = [
    { pair: 'EUR/USD vs GBP/USD', correlation: 0.78, risk: 'Moderate' },
    { pair: 'EUR/USD vs XAU/USD', correlation: -0.45, risk: 'Low' },
    { pair: 'GBP/USD vs XAU/USD', correlation: -0.52, risk: 'Low' },
  ];

  const limits = [
    {
      name: 'Daily Risk Usage',
      used: riskMetrics.riskPercentage,
      max: riskMetrics.maxRiskPercentage,
      status: 'normal',
    },
    {
      name: 'Max Open Trades',
      used: 3,
      max: 5,
      status: 'normal',
    },
    {
      name: 'Daily Trades',
      used: 5,
      max: 8,
      status: 'normal',
    },
    {
      name: 'Current Drawdown',
      used: -3.2,
      max: -15.0,
      status: 'good',
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Risk Management Dashboard</CardTitle>
          <CardDescription>Position sizing, exposure, and drawdown tracking</CardDescription>
        </CardHeader>
      </Card>

      {/* Risk Metrics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Account Equity</p>
            <p className="text-2xl font-bold text-white mt-2">${riskMetrics.accountEquity.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Open Risk USD</p>
            <p className="text-2xl font-bold text-orange-400 mt-2">${riskMetrics.openRiskUsd}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Max Total Risk</p>
            <p className="text-2xl font-bold text-red-400 mt-2">${riskMetrics.maxTotalRiskUsd}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Current Exposure</p>
            <p className="text-2xl font-bold text-blue-400 mt-2">{riskMetrics.exposurePercentage}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Risk Limits Progress */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Risk Limits & Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {limits.map((limit, idx) => (
            <div key={idx}>
              <div className="flex justify-between items-center mb-2">
                <label className="text-slate-300">{limit.name}</label>
                <span className="text-white font-semibold">
                  {limit.used}
                  {typeof limit.max === 'number' ? `/${limit.max}` : ''}
                  {typeof limit.max === 'number' && limit.max > 1 && !limit.name.includes('Drawdown') ? '%' : ''}
                </span>
              </div>
              <Progress
                value={Math.min(
                  100,
                  (Math.abs(limit.used) / Math.abs(limit.max)) * 100
                )}
                className="h-2"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Open Positions Risk Analysis */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Open Positions Risk Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {openPositions.map((pos, idx) => (
              <div key={idx} className="p-4 bg-slate-700 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="text-white font-semibold">{pos.symbol}</h4>
                    <p className={`text-xs mt-1 ${pos.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.direction} @ {pos.entry}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${pos.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${pos.profitLoss}
                    </p>
                    <p className="text-xs text-slate-400">{pos.current}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <p className="text-slate-400">Size</p>
                    <p className="text-white font-semibold">{pos.positionSize.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Risk USD</p>
                    <p className="text-orange-400 font-semibold">${pos.riskAmount}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Risk %</p>
                    <p className="text-blue-400 font-semibold">
                      {((pos.riskAmount / riskMetrics.accountEquity) * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Risk:Reward</p>
                    <p className="text-green-400 font-semibold">1:{pos.riskReward}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Correlation Analysis */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Position Correlation</CardTitle>
          <CardDescription>Correlation between open positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {correlation.map((corr, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-slate-700 rounded">
                <div>
                  <p className="text-white font-semibold text-sm">{corr.pair}</p>
                  <p className="text-slate-400 text-xs mt-1">Risk: {corr.risk}</p>
                </div>
                <div className="text-right">
                  <p className="text-blue-400 font-semibold">{corr.correlation.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Risk Alerts */}
      <Card className="bg-slate-800 border-slate-700 border-green-500/50 bg-green-500/5">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-green-400" />
            Risk Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-green-400">
            <p className="text-sm">✓ All positions within risk limits</p>
            <p className="text-sm mt-2">✓ Account equity above minimum threshold</p>
            <p className="text-sm mt-2">✓ Drawdown within acceptable range</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
