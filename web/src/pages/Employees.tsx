import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageHeader, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { useLiveList } from '../lib/useLiveList';
import { listEmployees, serverHost } from '../lib/serverApi';

const PAGE_SIZE = 20;

/** The staff directory, read from the owner-only `GET /employees`. `RequireOwner` guards this
 *  route and the endpoint answers `403` for an employee token — hiding the menu was never the
 *  control. New logins are created on the server; this screen shows records, it does not add
 *  or edit them. The one flag a row carries that the *detail* screen writes is D-3's dispatch
 *  capability, and the badge here is the same column the backend re-reads on every dispatch
 *  request — shown so the owner can see who may record deliveries, enforced by the server. */
export default function Employees() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listEmployees({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  return (
    <div>
      <PageHeader title="Employees" subtitle={`Staff directory on ${serverHost()} — owner-only; new logins are created on the server.`} />
      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <p className="text-[11px] text-muted">
            Open a row for the staff member&apos;s own customers and orders, and for his dispatch capability.
          </p>
          <input
            className="input !w-auto !py-2"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, role or department…"
          />
        </div>
        <div className="mb-3">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
        </div>
        {state === 'loading' && <p className="text-xs text-faint">Loading staff…</p>}
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
            {term ? 'No staff member matches that search.' : 'No staff records on the backend yet.'}
          </p>
        )}
        {state === 'ready' && rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-field border border-line">
              {rows.map((e) => (
                <Link
                  key={e.id}
                  to={`/employees/${e.id}`}
                  className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0 hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-ink">{e.name}</p>
                    <p className="text-[10px] text-muted">
                      {e.role || '—'}
                      {e.department ? ` • ${e.department}` : ''}
                      {e.city ? ` • ${e.city}` : ''}
                      {e.phone ? ` • ${e.phone}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px]">
                    {e.mayDispatch && (
                      <span className="text-muted">
                        dispatch <span className="font-semibold text-ink">granted</span>
                      </span>
                    )}
                    {e.targetUnit && (
                      <span className="text-muted">
                        target <span className="font-semibold text-ink">{e.monthlyTargetQty}</span> {e.targetUnit}
                      </span>
                    )}
                    <StatusBadge status={e.active ? 'active' : 'draft'} label={e.active ? 'active' : 'inactive'} />
                  </div>
                </Link>
              ))}
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
        <p className="mt-2 text-[10px] text-faint">New logins are created on the server with scripts/create_user.py.</p>
      </Card>
    </div>
  );
}
