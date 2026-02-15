'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSystemData } from '@/context/SystemDataContext';

function stateBadge(state: string) {
  switch (state) {
    case 'triggered':
    case 'executed':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'active':
    case 'pending':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    case 'invalidated':
    case 'expired':
    case 'cancelled':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    case 'none':
      return 'bg-slate-500/20 text-slate-300 border-slate-500/50';
    default:
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
  }
}

export default function ActiveSignalsPage() {
  const { snapshot, isLive } = useSystemData();
  const latestSyncSnapshot = snapshot.latestSyncSnapshot;

  const evaluated = latestSyncSnapshot.rows.filter((row) => row.opportunity !== null);
  const stateCounts = evaluated.reduce<Record<string, number>>((acc, row) => {
    const key = row.opportunity?.signalState ?? 'none';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const actionable = evaluated.filter((row) =>
    ['pending', 'active', 'triggered', 'executed'].includes(row.opportunity?.signalState ?? ''),
  );

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Signal Lifecycle Queue
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>
            Latest result format from check-trading-opportunity (setup_score + signal_state)
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Evaluated Symbols</p>
            <p className="text-3xl font-bold text-white mt-2">{evaluated.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Actionable States</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">{actionable.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">No-Trade States</p>
            <p className="text-3xl font-bold text-slate-200 mt-2">{stateCounts.none ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Telegram Alerts Sent</p>
            <p className="text-3xl font-bold text-green-400 mt-2">
              {evaluated.filter((row) => row.opportunity?.telegramSent).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {actionable.length === 0 && (
        <Card className="bg-slate-800 border-slate-700 border-yellow-500/50">
          <CardContent className="pt-6">
            <p className="text-yellow-300 font-semibold">No actionable signals in the latest run.</p>
            <p className="text-slate-400 text-sm mt-2">
              This is valid behavior when spread/regime filters block entries.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {latestSyncSnapshot.rows.map((row) => (
          <Card key={row.symbol} className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-white text-xl font-bold">{row.symbol}</h3>
                  <p className="text-slate-400 text-xs mt-1">Reason: {row.reason}</p>
                </div>
                <div className="flex gap-2">
                  <Badge className={`border ${stateBadge(row.opportunity?.signalState ?? 'not_checked')}`}>
                    {row.opportunity?.signalState ?? 'not_checked'}
                  </Badge>
                  <Badge
                    className={`border ${
                      row.status === 'updated'
                        ? 'bg-green-500/20 text-green-400 border-green-500/50'
                        : 'bg-slate-500/20 text-slate-300 border-slate-500/50'
                    }`}
                  >
                    {row.status}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 p-3 bg-slate-700 rounded-lg">
                <div>
                  <p className="text-slate-400 text-xs">Setup Score</p>
                  <p className="text-white font-semibold">{row.opportunity?.setupScore ?? '-'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Direction</p>
                  <p className="text-white font-semibold uppercase">{row.opportunity?.direction ?? '-'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">ENTRY</p>
                  <p className="text-white font-semibold">{row.opportunity?.entry ?? '-'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">SL</p>
                  <p className="text-red-400 font-semibold">{row.opportunity?.stopLoss ?? '-'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">TP1 / TP2 / TP3</p>
                  <p className="text-green-400 font-semibold">
                    {row.opportunity?.tp1 ?? '-'} / {row.opportunity?.tp2 ?? '-'} / {row.opportunity?.tp3 ?? '-'}
                  </p>
                </div>
              </div>

              {row.opportunity && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs">
                  <div className="p-3 bg-slate-700 rounded">
                    <p className="text-slate-400 mb-2">Top Reasons</p>
                    {row.opportunity.topReasons.length > 0 ? (
                      <ul className="space-y-1 text-slate-200">
                        {row.opportunity.topReasons.map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-400">No qualifying reason set.</p>
                    )}
                  </div>
                  <div className="p-3 bg-slate-700 rounded">
                    <p className="text-slate-400 mb-2">Invalidation Conditions</p>
                    {row.opportunity.invalidationConditions.length > 0 ? (
                      <ul className="space-y-1 text-slate-200">
                        {row.opportunity.invalidationConditions.map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-400">None.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
