import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageHeader, Spinner } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { ConsignmentList } from '../components/Consignments';
import { useLiveSession } from '../lib/liveSession';
import { invalidate, syncKeys, useSyncPrefix } from '../lib/syncStore';
import { useLiveList } from '../lib/useLiveList';
import { useResource } from '../lib/useResource';
import { listDispatches, mayRecordDispatch, serverHost } from '../lib/serverApi';

const PAGE_SIZE = 20;

/** Every consignment the register holds, newest delivery date first, with the three actions the
 *  backend authorises on each row.
 *
 *  Mounted only once the login is known to hold the capability, because `GET /dispatches` is gated
 *  on it and a screen that mounted anyway would spend a request to display a refusal. The order of
 *  rows, the paging and the voided rows being *in* the list rather than dropped from it are all the
 *  server's doing: nothing here re-sorts, re-counts or hides a row it has been sent.
 *
 *  The register includes consignments the office has voided, carrying `voidedAt` and who stamped it.
 *  A list that quietly lost a cancelled delivery would leave the desk staring at order quantities
 *  that moved and came back with nobody on record to have moved them — the same discipline a voided
 *  receipt has kept since P1. */
function Register({
  isOwner,
  userId,
  employeeId,
  isSalesperson,
}: {
  isOwner: boolean;
  userId: string | null;
  employeeId?: string | null;
  isSalesperson: boolean;
}) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) =>
      listDispatches({
        q: folded || undefined,
        salespersonId: isSalesperson && employeeId ? employeeId : undefined,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [isSalesperson, employeeId],
  );
  // Any consignment write names its order under `dispatches:<orderId>`; the register depends on
  // all of them, so it follows the prefix rather than one id it does not own.
  const registerToken = useSyncPrefix(syncKeys.dispatchRegister);
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page, registerToken);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[11px] text-muted">
          Every quantity on a consignment is the server’s decimal string. A search matches the dispatch number, the
          order number, the vehicle or the driver — the four columns the backend searches, and no more.
        </p>
        <input
          className="input !w-auto !py-2"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          placeholder="Search DSP number, order, vehicle, driver…"
        />
      </div>
      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>
      {state === 'loading' && <p className="text-xs text-faint">Loading the register…</p>}
      {state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && (
        <ConsignmentList
          rows={rows}
          canRecord
          isOwner={isOwner}
          userId={userId}
          onChanged={(orderId) =>
            invalidate(
              syncKeys.dispatchRegister,
              syncKeys.orderList(),
              ...(orderId ? [syncKeys.dispatch(orderId), syncKeys.order(orderId)] : []),
            )
          }
          emptyMessage={
            term
              ? 'No consignment matches that search.'
              : 'Nothing has been dispatched from this book yet. A record appears here the moment one is saved.'
          }
        />
      )}
      {state === 'ready' && <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
    </Card>
  );
}

/** The consignment register — `GET /dispatches`, the deliveries themselves.
 *
 *  Reached from the queue, and deliberately not a navigation item: who may open this address is the
 *  backend's business, not the menu's, and a menu entry that a login cannot use would be a permission
 *  model drawn on the sidebar rather than enforced on the row.
 *
 *  The capability is asked of the server rather than read off the role, because the two are different
 *  questions — the owner needs no grant and a desk needs the flag on its employee record, and only
 *  the backend can see either. A refusal is shown as the sentence the backend chose, and the register
 *  is not mounted at all until the answer says it can be read. */
export default function DispatchHistory() {
  const user = useLiveSession((s) => s.user);
  const isOwner = user?.role === 'owner';
  const isSalesperson = user?.role === 'employee' && user?.department === 'Sales';
  const right = useResource(useCallback(() => mayRecordDispatch(), []));

  return (
    <div>
      <PageHeader
        title="Consignment register"
        subtitle={`Deliveries recorded on ${serverHost()} — the paper record of what left, not a stock movement`}
        actions={
          <Link to="/dispatch" className="btn-ghost">
            Back to the queue
          </Link>
        }
      />

      {right.state === 'loading' && (
        <Card>
          <Spinner label="Asking the backend whether this login may read the register…" />
        </Card>
      )}

      {right.state === 'error' && (
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {right.error}{' '}
            <button type="button" className="font-bold underline" onClick={right.retry}>
              Try again
            </button>
          </p>
          <p className="mt-2 text-[11px] text-muted">
            Nothing is assumed while the answer is missing: the register is not shown, and no figure here is a
            consignment the backend has not sent.
          </p>
        </Card>
      )}

      {right.state === 'ready' && right.data === false && (
        <Card>
          <p className="text-[12px] font-semibold text-ink">The register is not open to this login.</p>
          <p className="mt-1.5 text-[11px] text-muted">
            `GET /dispatches` sits behind D-3’s dispatch capability and the backend answered `403`: recording a
            dispatch needs the flag on the employee record. The owner grants it there; this panel has no route that
            grants a capability to itself, and it would not pretend to if the button existed.
          </p>
          {/* Refusing to mount the register is the whole point, and the answer that decided it has a
              moment on it: an owner who grants the capability while this page is open can be caught
              by the button below rather than by a reload. */}
          <div className="mt-2">
            <LiveSyncBar sync={right.sync} busy={false} />
          </div>
        </Card>
      )}

      {right.state === 'ready' && right.data === true && (
        <Register
          isOwner={isOwner}
          userId={user?.id ?? null}
          employeeId={user?.employeeId ?? null}
          isSalesperson={isSalesperson}
        />
      )}
    </div>
  );
}
