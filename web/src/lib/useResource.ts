import { useCallback, useEffect, useRef, useState } from 'react';
import { ServerError } from './serverApi';
import type { LiveSync } from './liveSync';

/** One server object, honestly: `loading` while it is in flight, the backend's own message
 *  when it fails, and a retry that re-runs the same request. For detail screens; lists use
 *  `useLiveList`. `fetcher` must be stable (wrap it in `useCallback`) — it is an effect
 *  dependency, and an inline arrow would re-fire the fetch on every render.
 *
 *  `sync` behaves as it does for lists: a refresh re-reads this one row, keeps what is on screen
 *  when it fails, and says when the figures last arrived. A detail screen is where staleness costs
 *  the most — the owner is reading a balance, not scanning a page — so the read it shows has to come
 *  with the time it was taken.
 *
 *  `refreshToken` is P7's invalidation edge: a write elsewhere bumps the key this resource reads
 *  and the new counter arrives here. It re-reads through `refresh`, not through the initial load —
 *  a failed re-read after a successful write keeps the row and says it is stale, where a failed
 *  first read has nothing to keep and must show the error. */
export function useResource<T>(
  fetcher: () => Promise<T>,
  refreshToken = 0,
): {
  state: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string;
  retry: () => void;
  sync: LiveSync;
} {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');

  // See `useLiveList`: the effect advances the number, a refresh only reads it, so a refresh that is
  // overtaken by a new fetch — a different `id`, which is a different `fetcher` — cannot land on top.
  const sequence = useRef(0);
  const refreshInFlight = useRef(false);
  const tokenSeen = useRef(refreshToken);

  useEffect(() => {
    let alive = true;
    const mine = ++sequence.current;
    setState('loading');
    fetcher()
      .then((result) => {
        if (!alive || mine !== sequence.current) return;
        setData(result);
        setState('ready');
        setError('');
        setRefreshError('');
        setSyncedAt(Date.now());
      })
      .catch((cause) => {
        if (!alive || mine !== sequence.current) return;
        setData(null);
        setState('error');
        setError(cause instanceof ServerError ? cause.message : 'The backend did not answer.');
      });
    return () => {
      alive = false;
    };
  }, [fetcher, retryCount]);

  const retry = useCallback(() => setRetryCount((n) => n + 1), []);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const mine = sequence.current;
    setIsRefreshing(true);
    fetcher()
      .then((result) => {
        if (mine !== sequence.current) return;
        setData(result);
        setState('ready');
        setError('');
        setRefreshError('');
        setSyncedAt(Date.now());
      })
      .catch((cause) => {
        if (mine !== sequence.current) return;
        const message = cause instanceof ServerError ? cause.message : 'The backend did not answer.';
        if (syncedAt === null) {
          setState('error');
          setError(message);
          return;
        }
        setRefreshError(message);
      })
      .finally(() => {
        refreshInFlight.current = false;
        setIsRefreshing(false);
      });
  }, [fetcher, syncedAt]);

  useEffect(() => {
    if (tokenSeen.current === refreshToken) return;
    tokenSeen.current = refreshToken;
    refresh();
  }, [refreshToken, refresh]);

  return {
    state,
    data,
    error,
    retry,
    sync: { refresh, isRefreshing, syncedAt, refreshError },
  };
}
