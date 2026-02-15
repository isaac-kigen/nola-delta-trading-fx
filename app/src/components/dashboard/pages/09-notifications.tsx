'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSystemData } from '@/context/SystemDataContext';
import { useToast } from '@/context/ToastContext';
import type { OpsRun, SystemActionName } from '@/lib/system-types';

function statusClass(status: string) {
  switch (status) {
    case 'success':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'warning':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    case 'error':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/50';
  }
}

export default function NotificationsPage() {
  const { snapshot, isLive, runAction, refreshing, refresh } = useSystemData();
  const { showToast } = useToast();
  const [runningAction, setRunningAction] = useState<SystemActionName | null>(null);
  const [selectedRun, setSelectedRun] = useState<OpsRun | null>(null);

  const latestSyncSnapshot = snapshot.latestSyncSnapshot;
  const edgeFunctionLinks = snapshot.edgeFunctionLinks;
  const opsRuns = snapshot.opsRuns;

  const telegramEligible = latestSyncSnapshot.rows.filter((row) => row.opportunity?.shouldNotify).length;
  const telegramSent = latestSyncSnapshot.rows.filter((row) => row.opportunity?.telegramSent).length;

  const describeRun = (run: OpsRun) => {
    if (run.functionName === 'sync-latest-candle') {
      const symbolsProcessed = Number(run.payload.symbols_processed ?? 0);
      const apiCalls = Number(run.payload.api_calls_used ?? 0);
      return `${symbolsProcessed} symbols processed, ${apiCalls} API calls`;
    }
    if (run.functionName === 'backfill-candle-history') {
      const symbol = String(run.payload.symbol ?? '');
      const savedRows = Number(run.payload.saved_rows ?? 0);
      return `${symbol || 'symbol'} saved ${savedRows} candles`;
    }
    if (run.functionName === 'validate-strategy') {
      const symbol = String(run.payload.symbol ?? '');
      const totalCandles = Number(run.payload.total_candles_used ?? 0);
      return `${symbol || 'symbol'} validated on ${totalCandles} candles`;
    }
    return `Trace: ${run.traceId}`;
  };

  const executeAction = async (action: SystemActionName, payload: Record<string, unknown>) => {
    setRunningAction(action);
    try {
      const result = await runAction(action, payload);
      if (result.ok) {
        showToast(`${action} completed`, 'success');
      } else {
        showToast(`${action} failed (${result.status})`, 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Failed running ${action}`, 'error');
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            Notifications & Ops
            <Badge
              className={`border ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'}`}
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </Badge>
          </CardTitle>
          <CardDescription>
            Function health, alert flow, and quick links to your deployed edge endpoints
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Manual Function Triggers</CardTitle>
          <CardDescription>Executes edge functions through secure server-side proxy routes</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => executeAction('sync', { run_opportunity_check: true })}
            disabled={runningAction !== null}
          >
            {runningAction === 'sync' ? 'Running sync...' : 'Run Sync + Check'}
          </Button>
          <Button
            className="bg-slate-600 hover:bg-slate-500 text-white"
            onClick={() =>
              executeAction('backfill', {
                symbol: 'EUR/USD',
                start_date_utc: '2025-01-01',
                end_date_utc: '2026-01-01',
                chunk_days: 180,
                dry_run: true,
              })}
            disabled={runningAction !== null}
          >
            {runningAction === 'backfill' ? 'Running backfill...' : 'Dry-Run Backfill'}
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() =>
              executeAction('validate', {
                symbol: 'EUR/USD',
                from_time_utc: '2018-01-01T00:00:00Z',
                to_time_utc: '2026-02-11T14:00:00Z',
                walk_forward_ratio: 0.7,
                max_candles: 100000,
              })}
            disabled={runningAction !== null}
          >
            {runningAction === 'validate' ? 'Running validation...' : 'Run Validation'}
          </Button>
          <Button
            variant="outline"
            className="border-slate-500 text-slate-200 hover:bg-slate-700"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Ops Events (Recent)</p>
            <p className="text-3xl text-white font-bold mt-2">{opsRuns.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Telegram Eligible</p>
            <p className="text-3xl text-blue-400 font-bold mt-2">{telegramEligible}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-6">
            <p className="text-slate-400 text-sm">Telegram Sent</p>
            <p className="text-3xl text-green-400 font-bold mt-2">{telegramSent}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Recent Ops Runs</CardTitle>
          <CardDescription>Click a run to inspect full trace payload from ops_function_runs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {opsRuns.map((run) => (
            <div key={`${run.id}-${run.traceId}`} className="p-3 bg-slate-700 rounded-lg">
              <div className="flex flex-wrap justify-between gap-3 items-start">
                <div>
                  <p className="text-white font-semibold">{run.functionName}</p>
                  <p className="text-xs text-slate-300 mt-1">{describeRun(run)}</p>
                  <p className="text-xs text-slate-400 mt-1">Trace: {run.traceId}</p>
                </div>
                <div className="text-right space-y-2">
                  <Badge className={`border ${statusClass(run.status)}`}>{run.status}</Badge>
                  <p className="text-xs text-slate-400">{run.finishedAtUtc ?? run.startedAtUtc}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-slate-500 text-slate-200 hover:bg-slate-600"
                    onClick={() => setSelectedRun(run)}
                  >
                    View Trace
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Edge Function Links</CardTitle>
          <CardDescription>Copy the endpoint URL and authenticate with the listed cron secret header</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {edgeFunctionLinks.map((fn) => (
              <div key={fn.name} className="p-3 bg-slate-700 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/50 border">{fn.method}</Badge>
                  <p className="text-white font-semibold">{fn.name}</p>
                </div>
                <p className="text-xs text-slate-300 break-all">{fn.url}</p>
                <p className="text-xs text-slate-400 mt-1">Auth: {fn.authHeader}</p>
                <p className="text-xs text-slate-400 mt-1">{fn.purpose}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={selectedRun !== null} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <DialogContent className="max-w-4xl bg-slate-900 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle>Trace Details</DialogTitle>
            <DialogDescription className="text-slate-400">
              Raw payload and metadata for a single ops_function_runs record
            </DialogDescription>
          </DialogHeader>

          {selectedRun && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <p><span className="text-slate-400">Run ID:</span> {selectedRun.id}</p>
                <p><span className="text-slate-400">Function:</span> {selectedRun.functionName}</p>
                <p><span className="text-slate-400">Trace ID:</span> {selectedRun.traceId}</p>
                <p><span className="text-slate-400">Status:</span> {selectedRun.status}</p>
                <p><span className="text-slate-400">Started:</span> {selectedRun.startedAtUtc}</p>
                <p><span className="text-slate-400">Finished:</span> {selectedRun.finishedAtUtc ?? '-'}</p>
                <p><span className="text-slate-400">Duration:</span> {selectedRun.durationMs ?? '-'} ms</p>
              </div>

              <div className="rounded border border-slate-700 bg-slate-950 p-3 max-h-[52vh] overflow-auto">
                <p className="text-xs text-slate-400 mb-2">Payload JSON</p>
                <pre className="text-xs leading-5 whitespace-pre-wrap break-all">
                  {JSON.stringify(selectedRun.payload, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
