import { useCallback, useEffect, useRef, useState } from 'react';
import { foldTerm } from './entryRules';
import { ServerError, type ServerPage } from './serverApi';
import type { LiveSync } from './liveSync';

/** The live-list state machine the Customers screen proved, shared by every wired read screen.
 *
 *  What it keeps honest:
 *  - the search term is debounced (350 ms) and folded the same way the server folds it, and
 *    only a non-empty term waits — the first page loads immediately;
 *  - `state` is genuinely `'loading'` while a fetch is in flight, so a screen never shows an
 *    empty list that is really a list that hasn't arrived;
 *  - a failure surfaces the backend's own message (`ServerError`), never a friendlier
 *    invention, and `retry` re-runs the same request;
 *  - `sync.refresh` re-runs it too, but over the top of the rows already on screen, and a failed
 *    refresh says so through `sync.refreshError` instead of pretending the rows are current.
 *
 *  `load` must be stable across renders (wrap it in `useCallback`) — it is an effect
 *  dependency, and an inline arrow would re-fire the fetch on every render. */
export function useLiveList<T>(
  load: (foldedTerm: string, page: number) => Promise<ServerPage<T>>,
  term: string,
  page: number,
  refreshToken = 0,
): {
  state: 'loading' | 'ready' | 'error';
  rows: T[];
  total: number;
  error: string;
  retry: () => void;
  sync: LiveSync;
} {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');

  // Advanced by the effect only. A refresh records the number in force when it started and drops its
  // own answer if the operator has since searched or turned the page, because those rows belong to a
  // request the screen no longer makes. A refresh must not advance it either: the load in flight would
  // then discard its answer and the screen would sit on "Loading…" for good.
  const sequence = useRef(0);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    const mine = ++sequence.current;
    const folded = foldTerm(term);
    setState('loading');
    const timer = setTimeout(
      () => {
        load(folded, page)
          .then((result) => {
            if (!alive || mine !== sequence.current) return;
            setRows(result.items);
            setTotal(result.total);
            setState('ready');
            setError('');
            setRefreshError('');
            setSyncedAt(Date.now());
          })
          .catch((cause) => {
            if (!alive || mine !== sequence.current) return;
            setState('error');
            setError(cause instanceof ServerError ? cause.message : 'The backend did not answer.');
          });
      },
      folded ? 350 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load, term, page, refreshToken, retry]);

  const refresh = useCallback(() => {
    // Two taps are one request. The server answers both identically and the second would only
    // overwrite the first, so the tap that arrives while one is running is dropped rather than queued.
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const mine = sequence.current;
    setIsRefreshing(true);
    load(foldTerm(term), page)
      .then((result) => {
        if (mine !== sequence.current) return;
        setRows(result.items);
        setTotal(result.total);
        setState('ready');
        setError('');
        setRefreshError('');
        setSyncedAt(Date.now());
      })
      .catch((cause) => {
        if (mine !== sequence.current) return;
        const message = cause instanceof ServerError ? cause.message : 'The backend did not answer.';
        if (syncedAt === null) {
          // Nothing has ever arrived, so this is not a stale table — it is a table that failed, and
          // the screen's own error branch has to say so with this attempt's message.
          setState('error');
          setError(message);
          return;
        }
        // The rows stay put. What changes is the claim made about them — see `liveSync.ts`.
        setRefreshError(message);
      })
      .finally(() => {
        refreshInFlight.current = false;
        setIsRefreshing(false);
      });
  }, [load, term, page, syncedAt]);

  return {
    state,
    rows,
    total,
    error,
    retry: () => setRetry((n) => n + 1),
    sync: { refresh, isRefreshing, syncedAt, refreshError },
  };
}
