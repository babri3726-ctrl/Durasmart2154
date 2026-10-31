import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Card, PageHeader, StatusBadge, Tabs } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { LiveCustomerModal } from '../components/LiveCustomerEntry';
import { OpeningBalanceModal, type OpeningBalancePreset } from '../components/OpeningBalanceModal';
import { exactRupees } from '../lib/entryRules';
import { useLiveList } from '../lib/useLiveList';
import { useLiveSession } from '../lib/liveSession';
import { listCustomers, serverHost } from '../lib/serverApi';

const PAGE_SIZE = 20;

/** The status queue, in the server's own vocabulary.
 *
 *  The tab keys *are* the `?status=` values — `active`, `pendingApproval`, `rejected` — so the
 *  screen never translates a status into something the backend does not recognise, and 'All' is
 *  the absence of the parameter rather than a made-up word. A salesperson's entry lands in
 *  `pendingApproval` (`D-11`) and stays there until the owner decides, which is why this filter is
 *  offered to an owner session and not to an employee one: an employee cannot act on the queue, and
 *  the server would answer their approve call with `403` anyway.
 *
 *  The list itself is the server's page, not a browser-side pass over it: a pending party the
 *  backend did not send this page is simply not here, and the count in the footer is the server's. */
const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pendingApproval', label: 'Pending approval' },
  { key: 'rejected', label: 'Rejected' },
];

/** The customer master, read from the backend this panel is configured with.
 *
 *  Every row here is a saved server record; opening balances are recorded against exactly these
 *  rows. Paging follows the server's own `total`, the same way every other list here does.
 *  Refreshes on `refreshToken` after a create or an opening-balance save, so a freshly
 *  created customer becomes selectable for its opening figure in the same visit, and the operator can
 *  re-read this page at any time without leaving it — the write paths above stay exactly as they were,
 *  so nothing here can post a customer twice.
 *
 *  The status queue is the server's own vocabulary — see `STATUS_TABS` — and a row's status chip is
 *  `StatusBadge`, so a pending party reads the way it looks on its detail screen. */
function CustomersCard({
  refreshToken,
  status,
  onOpenBalance,
}: {
  refreshToken: number;
  status: string;
  onOpenBalance: (customer: { id: string; name: string }) => void;
}) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) =>
      listCustomers({
        q: folded || undefined,
        // Empty means "no filter", which is the parameter's absence, not `?status=`.
        status: status || undefined,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [status],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page, refreshToken);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black text-ink">Customers</h2>
          <p className="text-[11px] text-muted">
            Saved records on {serverHost()} — opening balances are recorded against these rows.
          </p>
        </div>
        <input
          className="input !w-auto !py-2"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          placeholder="Search customers…"
        />
      </div>
      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>
      {state === 'loading' && <p className="text-xs text-faint">Loading customers…</p>}
      {state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && rows.length === 0 && (
        <p className="text-xs text-muted">
          {term
            ? 'No customer matches that search.'
            : status === 'pendingApproval'
              ? 'Nothing is waiting for your approval — every party on this backend has been decided.'
              : status === 'rejected'
                ? 'No rejected party on this backend.'
                : 'No customers yet — the Add Customer button above creates the first one on the backend.'}
        </p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-field border border-line">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink">
                    <Link to={`/customers/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>{' '}
                    <span className="ml-1 inline-flex align-middle">
                      <StatusBadge status={r.status} />
                    </span>
                  </p>
                  <p className="text-[10px] text-muted">
                    {r.city || '—'} • {r.mobile} • {r.creditDays} credit days • {r.id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] font-semibold">
                    {r.outstandingPaise > 0
                      ? `owes ${exactRupees(r.outstandingPaise)}`
                      : r.advancePaise > 0
                        ? `advance ${exactRupees(r.advancePaise)}`
                        : 'no balance'}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onOpenBalance({ id: r.id, name: r.name })}
                  >
                    Opening Balance
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

export default function Customers() {
  const [liveAddOpen, setLiveAddOpen] = useState(false);
  const [balancePreset, setBalancePreset] = useState<OpeningBalancePreset | null>(null);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('');
  const user = useLiveSession((s) => s.user);
  const isOwner = user?.role === 'owner';

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`Master customer book on ${serverHost()}`}
        actions={
          <>
            <Link to="/orders/new" className="btn-ghost">
              <Plus size={15} /> New order for an active party
            </Link>
            <button className="btn-primary" onClick={() => setLiveAddOpen(true)}>
              <Plus size={15} /> Add Customer
            </button>
          </>
        }
      />

      {isOwner && (
        <div className="mb-3">
          <Tabs
            tabs={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
            active={status}
            onChange={(k) => setStatus(k)}
          />
        </div>
      )}

      <CustomersCard
        refreshToken={refresh}
        status={isOwner ? status : ''}
        onOpenBalance={(customer) => {
          setBalancePreset(customer);
          setBalanceOpen(true);
        }}
      />

      <LiveCustomerModal
        open={liveAddOpen}
        onClose={() => setLiveAddOpen(false)}
        onCreated={() => setRefresh((n) => n + 1)}
      />
      <OpeningBalanceModal
        open={balanceOpen}
        onClose={() => {
          setBalanceOpen(false);
          setBalancePreset(null);
        }}
        preset={balancePreset}
        onSaved={() => setRefresh((n) => n + 1)}
      />
    </div>
  );
}
