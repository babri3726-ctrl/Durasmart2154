/** What a screen is allowed to claim about how current its numbers are.

    This panel holds no cache of its own: every screen asks the backend when it mounts, so a screen
    that has been left open is the only way it can be out of date. That makes two facts worth stating
    separately rather than merging into one "loading" flag — the rows on screen, and when they last
    arrived. A refresh that fails keeps the rows and changes the claim, because throwing away figures
    the operator is reading is worse than showing them under a sentence that says what they are.

    Decided here rather than in a component so `scripts/live-refresh-test.mjs` can assert it: this file
    imports nothing, which is what the panel's `node --test` infrastructure can load. */

export type LiveSync = {
  /** Re-run this screen's current request over the rows already on screen. */
  refresh: () => void;
  /** Whether one of those runs is in flight right now. */
  isRefreshing: boolean;
  /** `Date.now()` of the last response that actually landed, or `null` if none ever has. */
  syncedAt: number | null;
  /** The backend's own message from the last failed refresh; empty when the last attempt arrived. */
  refreshError: string;
};

export type SyncNotice = 'never' | 'syncing' | 'fresh' | 'stale';

/** The one ordering that matters: an attempt in flight outranks anything said about the last one,
 *  and a failed attempt over rows that did arrive is *stale*, not *fresh* and not *error*. */
export function syncNotice(sync: LiveSync): SyncNotice {
  if (sync.isRefreshing) return 'syncing';
  if (sync.syncedAt === null) return 'never';
  return sync.refreshError === '' ? 'fresh' : 'stale';
}

/** The sentence under the table. `time` is the last answer that arrived, formatted by
 *  `formatSyncTime` below, so the stale case can point at a real moment instead of a warning colour. */
export function syncSentence(sync: LiveSync, time: string): string {
  switch (syncNotice(sync)) {
    case 'syncing':
      return 'Asking the server again…';
    case 'never':
      return 'Nothing has arrived from the server yet.';
    case 'fresh':
      return `Read from the server at ${time}.`;
    case 'stale':
      return `Refresh failed at ${time} — these are the last figures that arrived: ${sync.refreshError}`;
  }
}

/** Local wall time, written out by hand rather than through `toLocaleTimeString`: the panel is used
 *  in one office and the notice has to look the same on every machine there, including the ones
 *  whose locale would otherwise add an am/pm or swap the separators. */
export function formatSyncTime(epochMs: number): string {
  const date = new Date(epochMs);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
