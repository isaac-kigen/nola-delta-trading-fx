'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { buildEmptySystemSnapshot } from '@/lib/system-defaults';
import type {
  SystemActionName,
  SystemActionResult,
  SystemSnapshot,
  SystemSnapshotResponse,
} from '@/lib/system-types';

interface SystemDataContextValue {
  snapshot: SystemSnapshot;
  isLive: boolean;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  runAction: (action: SystemActionName, payload?: Record<string, unknown>) => Promise<SystemActionResult>;
}

const SystemDataContext = createContext<SystemDataContextValue | undefined>(undefined);
const POLL_INTERVAL_MS = 20_000;

async function fetchSnapshot(): Promise<SystemSnapshotResponse> {
  const response = await fetch('/api/system/snapshot', {
    method: 'GET',
    cache: 'no-store',
  });
  const data = (await response.json()) as SystemSnapshotResponse;
  if (!response.ok) {
    const message = typeof data.warning === 'string' ? data.warning : `Snapshot fetch failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export function SystemDataProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot>(() => buildEmptySystemSnapshot(null));
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchSnapshot();
      setSnapshot(data.snapshot);
      setIsLive(data.live);
      setError(data.warning ?? null);
    } catch (err) {
      setIsLive(false);
      setError(err instanceof Error ? err.message : 'Failed loading system snapshot');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = useCallback(
    async (action: SystemActionName, payload: Record<string, unknown> = {}) => {
      const response = await fetch(`/api/system/actions/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as SystemActionResult;
      await refresh();
      return {
        ok: response.ok && data.ok,
        status: response.status,
        action,
        data: data.data,
      };
    },
    [refresh],
  );

  const value = useMemo<SystemDataContextValue>(
    () => ({
      snapshot,
      isLive,
      loading,
      error,
      refreshing,
      refresh,
      runAction,
    }),
    [snapshot, isLive, loading, error, refreshing, refresh, runAction],
  );

  return (
    <SystemDataContext.Provider value={value}>
      {children}
    </SystemDataContext.Provider>
  );
}

export function useSystemData(): SystemDataContextValue {
  const context = useContext(SystemDataContext);
  if (!context) {
    throw new Error('useSystemData must be used within SystemDataProvider');
  }
  return context;
}
