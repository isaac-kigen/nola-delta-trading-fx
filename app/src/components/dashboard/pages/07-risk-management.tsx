'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle } from 'lucide-react';
import { useSystemData } from '@/context/SystemDataContext';

function parsePair(symbol: string): { base: string; quote: string } | null {
  const parts = symbol.split('/');
  if (parts.length !== 2) return null;
  return { base: parts[0], quote: parts[1] };
}

function exposureVector(symbol: string, direction: 'long' | 'short'): Map<string, number> {
  const parsed = parsePair(symbol);
  if (!parsed) return new Map();

  const baseExposure = direction === 'long' ? 1 : -1;
  const quoteExposure = direction === 'long' ? -1 : 1;

  return new Map<string, number>([
    [parsed.base, baseExposure],
    [parsed.quote, quoteExposure],
  ]);
}

function correlationScore(
  first: { symbol: string; direction: 'long' | 'short' },
  second: { symbol: string; direction: 'long' | 'short' },
): number {
  const left = exposureVector(first.symbol, first.direction);
  const right = exposureVector(second.symbol, second.direction);

  const shared = [...left.keys()].filter((currency) => right.has(currency));
  if (shared.length === 0) return 0;

  const total = shared.reduce((sum, currency) => {
    const leftSign = left.get(currency) ?? 0;
    const rightSign = right.get(currency) ?? 0;
    return sum + (leftSign * rightSign);
  }, 0);

  return total / shared.length;
}

function toRiskLabel(score: number): string {
  const abs = Math.abs(score);
  if (abs >= 0.8) return 'High';
  if (abs >= 0.4) return 'Moderate';
  return 'Low';
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function estimateRiskReward(
  entryPrice: number,
  stopLoss: number,
  tp1: number | null,
  direction: 'long' | 'short',
): number | null {
  if (tp1 === null) return null;

  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return null;

  const reward = direction === 'long'
    ? tp1 - entryPrice
    : entryPrice - tp1;

  return reward / risk;
}

export default function RiskManagementPage() {
  const { snapshot, isLive } = useSystemData();

  const runtime = snapshot.strategyRuntime;
  const accountEquity = runtime?.accountEquityUsd ?? 0;
  const maxTotalRiskPct = runtime?.maxTotalRiskPct ?? 0;
  const maxTotalRiskUsd = accountEquity * (maxTotalRiskPct / 100);

  const openPositions = useMemo(
    () => snapshot.tradingPositions.filter((position) => position.status === 'open'),
    [snapshot.tradingPositions],
  );

  const openRiskUsd = openPositions.reduce((sum, position) => sum + (position.riskAmountUsd ?? 0), 0);
  const riskPercentage = accountEquity > 0 ? (openRiskUsd / accountEquity) * 100 : 0;
  const exposurePercentage = runtime?.maxOpenTrades
    ? Math.min(100, (openPositions.length / runtime.maxOpenTrades) * 100)
    : 0;

  const closedPositionsByTime = useMemo(
    () =>
      snapshot.tradingPositions
        .filter((position) => position.status === 'closed')
        .sort((a, b) => new Date(a.closedAtUtc ?? a.openedAtUtc).getTime() - new Date(b.closedAtUtc ?? b.openedAtUtc).getTime()),
    [snapshot.tradingPositions],
  );

  const maxDrawdownPct = useMemo(() => {
    if (accountEquity <= 0) return 0;

    let equity = accountEquity;
    let peak = accountEquity;
    let drawdown = 0;

    for (const position of closedPositionsByTime) {
      equity += position.realizedPnl ?? 0;
      peak = Math.max(peak, equity);
      if (peak > 0) {
        const currentDrawdown = ((equity - peak) / peak) * 100;
        drawdown = Math.min(drawdown, currentDrawdown);
      }
    }

    return drawdown;
  }, [accountEquity, closedPositionsByTime]);

  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dailyTrades = snapshot.tradingSignals.filter(
    (signal) => new Date(signal.createdAtUtc).getTime() >= startOfDayUtc,
  ).length;

  const correlation = useMemo(() => {
    const pairs: Array<{ pair: string; correlation: number; risk: string }> = [];

    for (let i = 0; i < openPositions.length; i += 1) {
      for (let j = i + 1; j < openPositions.length; j += 1) {
        const left = openPositions[i];
        const right = openPositions[j];
        const score = correlationScore(
          { symbol: left.symbol, direction: left.direction },
          { symbol: right.symbol, direction: right.direction },
        );

        pairs.push({
          pair: `${left.symbol} vs ${right.symbol}`,
          correlation: score,
          risk: toRiskLabel(score),
        });
      }
    }

    return pairs.slice(0, 10);
  }, [openPositions]);

  const marketBySymbol = new Map(snapshot.marketSnapshot.map((row) => [row.symbol, row]));

  const limits = [
    {
      name: 'Daily Risk Usage',
      used: riskPercentage,
      max: maxTotalRiskPct,
      unit: '%',
    },
    {
      name: 'Max Open Trades',
      used: openPositions.length,
      max: runtime?.maxOpenTrades ?? 0,
      unit: '',
    },
    {
      name: 'Daily Trades',
      used: dailyTrades,
      max: runtime?.maxTradesPerDay ?? 0,
      unit: '',
    },
    {
      name: 'Current Drawdown',
      used: Math.abs(maxDrawdownPct),
      max: 15,
      unit: '%',
    },
  ];

  const riskAlerts = [
    {
      ok: maxTotalRiskUsd <= 0 || openRiskUsd <= maxTotalRiskUsd,
      text: `Open risk ${formatCurrency(openRiskUsd)} is within max risk ${formatCurrency(maxTotalRiskUsd)}`,
    },
    {
      ok: runtime?.maxOpenTrades === undefined || openPositions.length <= runtime.maxOpenTrades,
      text: `${openPositions.length} open positions within max open trade cap`,
    },
    {
      ok: Math.abs(maxDrawdownPct) <= 15,
      text: `Drawdown ${maxDrawdownPct.toFixed(2)}% is within configured tolerance`,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Risk Management Dashboard
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>Position risk, exposure, and drawdown from live execution tables</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Account Equity</p>
            <p className="text-2xl font-bold text-white mt-2">{formatCurrency(accountEquity)}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Open Risk USD</p>
            <p className="text-2xl font-bold text-orange-400 mt-2">{formatCurrency(openRiskUsd)}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Max Total Risk</p>
            <p className="text-2xl font-bold text-red-400 mt-2">{formatCurrency(maxTotalRiskUsd)}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Current Exposure</p>
            <p className="text-2xl font-bold text-blue-400 mt-2">{exposurePercentage.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Risk Limits &amp; Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {limits.map((limit) => {
            const progress = limit.max > 0 ? Math.min(100, (Math.abs(limit.used) / Math.abs(limit.max)) * 100) : 0;
            return (
              <div key={limit.name}>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-slate-300">{limit.name}</label>
                  <span className="text-white font-semibold">
                    {limit.used.toFixed(2)} / {limit.max.toFixed(2)}{limit.unit}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Open Positions Risk Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {openPositions.length === 0 ? (
            <p className="text-slate-400 text-sm">No open positions currently tracked.</p>
          ) : (
            <div className="space-y-4">
              {openPositions.map((position) => {
                const market = marketBySymbol.get(position.symbol);
                const currentPrice = market?.price ?? null;
                const size = position.openSizeUnits ?? position.plannedSizeUnits;
                const estimatedPnl = currentPrice !== null && size !== null
                  ? (position.direction === 'long'
                    ? (currentPrice - position.entryPrice) * size
                    : (position.entryPrice - currentPrice) * size)
                  : null;
                const estimatedRR = estimateRiskReward(
                  position.entryPrice,
                  position.stopLoss,
                  position.tp1,
                  position.direction,
                );

                return (
                  <div key={position.id} className="p-4 bg-slate-700 rounded-lg">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-white font-semibold">{position.symbol}</h4>
                        <p className={`text-xs mt-1 ${position.direction === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                          {position.direction.toUpperCase()} @ {position.entryPrice}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${(estimatedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {estimatedPnl === null ? '-' : formatCurrency(estimatedPnl)}
                        </p>
                        <p className="text-xs text-slate-400">{currentPrice ?? '-'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-slate-400">Size</p>
                        <p className="text-white font-semibold">{size === null ? '-' : size.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-400">Risk USD</p>
                        <p className="text-orange-400 font-semibold">{position.riskAmountUsd === null ? '-' : formatCurrency(position.riskAmountUsd)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400">Risk %</p>
                        <p className="text-blue-400 font-semibold">
                          {accountEquity > 0 && position.riskAmountUsd !== null
                            ? `${((position.riskAmountUsd / accountEquity) * 100).toFixed(2)}%`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Risk:Reward</p>
                        <p className="text-green-400 font-semibold">
                          {estimatedRR === null ? '-' : `1:${estimatedRR.toFixed(2)}`}
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

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Position Correlation</CardTitle>
          <CardDescription>Approximate currency exposure overlap from currently open positions</CardDescription>
        </CardHeader>
        <CardContent>
          {correlation.length === 0 ? (
            <p className="text-slate-400 text-sm">Need at least two open FX positions to compute correlation exposure.</p>
          ) : (
            <div className="space-y-3">
              {correlation.map((corr) => (
                <div key={corr.pair} className="flex justify-between items-center p-3 bg-slate-700 rounded">
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
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700 border-green-500/50 bg-green-500/5">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-green-400" />
            Risk Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {riskAlerts.map((alert) => (
              <p key={alert.text} className={`text-sm ${alert.ok ? 'text-green-400' : 'text-red-400'}`}>
                {alert.ok ? 'OK' : 'ALERT'}: {alert.text}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
