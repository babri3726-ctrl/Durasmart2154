import { RefreshCw } from 'lucide-react';
import { formatSyncTime, syncNotice, syncSentence, type LiveSync } from '../../lib/liveSync';

/** The refresh control every live screen carries, and the sentence that says what its rows are worth.

    Placed next to the data it describes rather than once per page: a screen can hold two independent
    reads — CustomerDetail has the customer row and its ledger — and one shared notice could only ever
    be true of one of them.

    The button is disabled while the screen's own first load is running (`busy`) because a second
    identical request for the same page proves nothing; a tap during a refresh is already ignored by
    the hook behind `sync.refresh`. */
export function LiveSyncBar({ sync, busy = false }: { sync: LiveSync; busy?: boolean }) {
  const notice = syncNotice(sync);
  const time = sync.syncedAt === null ? '' : formatSyncTime(sync.syncedAt);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={sync.refresh}
        disabled={busy || sync.isRefreshing}
      >
        <RefreshCw size={13} className={sync.isRefreshing ? 'animate-spin' : ''} />
        {sync.isRefreshing ? 'Refreshing…' : 'Refresh from server'}
      </button>
      <p
        className={`text-[10px] ${
          notice === 'stale' ? 'font-semibold text-brand-red' : 'text-faint'
        }`}
      >
        {syncSentence(sync, time)}
      </p>
    </div>
  );
}
