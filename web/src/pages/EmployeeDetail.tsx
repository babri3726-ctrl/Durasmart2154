import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardHeader, PageHeader, Spinner, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { buildCapabilityBody, capabilityReasonProblem } from '../lib/dispatchEntry';
import { exactRupees } from '../lib/entryRules';
import { useResource } from '../lib/useResource';
import {
  ServerError,
  listCustomers,
  listEmployees,
  listOrders,
  newIdempotencyKey,
  serverHost,
  setDispatchCapability,
} from '../lib/serverApi';

/** One staff member, read from the owner-only `GET /employees`.

 *  The backend has no `GET /employees/{id}`, so this screen resolves the person through the
 *  paginated list (200 at a time, at most 10 pages); anyone beyond that honestly reports as
 *  "not visible" until a real detail endpoint exists. Their customers and orders come from
 *  the same server-side `salespersonId` scope the Customers screen uses — the panel does not
 *  filter by name in the browser.
 *
 *  One thing here is writable, and it is the one thing Phase 5 left without an actor: D-3's dispatch
 *  capability. Before `POST /employees/{id}/dispatch-capability` a grant was a database edit with no
 *  name against it; now the owner states a reason and the server writes who changed it, from what to
 *  what, when and why. Nothing about this switch is decided in the browser — the route answers `403`
 *  to any login that is not the owner's, and the flag is re-read off the employee row on every
 *  following dispatch request, so a screen showing a stale state could only ever be refused. Adding
 *  a person, editing a payroll field or making a login is still not here.
 *
 *  Refreshing this page is the same scan, not a cheaper call: `GET /employees/{id}` does not exist,
 *  so a refresh re-pages the owner-only list until the id turns up. Cheaper than a wrong answer, and
 *  the reason the two scoped lists below carry their own refresh rather than being folded into one
 *  button for the page. */
export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [refused, setRefused] = useState('');

  const employee = useResource(
    useCallback(async () => {
      for (let p = 1; p <= 10; p += 1) {
        const page = await listEmployees({ page: p, pageSize: 200 });
        const found = page.items.find((e) => e.id === id);
        if (found) return found;
        if (p * 200 >= page.total) break;
      }
      throw new ServerError('No employee with that id is visible to you.', { code: 'not_found', status: 404 });
    }, [id]),
  );

  const customers = useResource(useCallback(() => listCustomers({ salespersonId: id, pageSize: 8 }), [id]));
  const orders = useResource(useCallback(() => listOrders({ salespersonId: id, pageSize: 20 }), [id]));

  if (employee.state === 'loading') {
    return (
      <div>
        <PageHeader title="Employee" />
        <Card>
          <Spinner label="Loading staff record…" />
        </Card>
      </div>
    );
  }

  if (employee.state === 'error' || !employee.data) {
    return (
      <div>
        <PageHeader title="Employee" />
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {employee.error}{' '}
            <button type="button" className="font-bold underline" onClick={employee.retry}>
              Try again
            </button>
          </p>
          <p className="mt-3 text-xs">
            <Link to="/employees" className="font-bold text-brand-blue hover:underline">
              Back to Employees
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const e = employee.data;
  const reasonProblem = capabilityReasonProblem(why);

  /** One switch, and the server decides everything about it. The reason goes in the body because the
   *  audit row is the point of the call, and the same click twice is not two changes: a request for
   *  the state the record already holds answers `changed: false` and writes no event. */
  async function changeCapability(to: boolean): Promise<void> {
    if (reasonProblem !== null || busy) return;
    setBusy(true);
    setNotice('');
    setRefused('');
    try {
      const result = await setDispatchCapability(id, buildCapabilityBody(to, why), newIdempotencyKey());
      setNotice(
        result.changed
          ? `${result.mayDispatch ? 'Granted' : 'Withdrawn'} — ${result.name}'s record now says ${
              result.mayDispatch ? 'yes' : 'no'
            }, and the audit trail holds you, the reason, the two values and the time.`
          : `${result.name} already ${result.mayDispatch ? 'held' : 'did not hold'} the capability, so nothing changed and no event was written.`,
      );
      setWhy('');
      employee.retry();
    } catch (cause) {
      setRefused(cause instanceof ServerError ? cause.message : 'The backend did not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={e.name}
        subtitle={`Staff record on ${serverHost()} — read-only.`}
        actions={<LiveSyncBar sync={employee.sync} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Staff" />
          <div className="-mt-3 mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={e.active ? 'active' : 'draft'} label={e.active ? 'active' : 'inactive'} />
          </div>
          <p className="text-[12px] font-bold text-ink">
            {e.role || '—'}
            {e.department ? ` • ${e.department}` : ''}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {e.city || '—'}
            {e.phone ? ` • ${e.phone}` : ''}
          </p>
          {e.targetUnit && (
            <p className="mt-1 text-[11px] text-muted">
              Monthly target <span className="font-semibold text-ink">{e.monthlyTargetQty}</span> {e.targetUnit}
            </p>
          )}

          <div className="mt-3 border-t border-line/60 pt-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-faint">
              Dispatch capability
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <StatusBadge
                status={e.mayDispatch ? 'active' : 'draft'}
                label={e.mayDispatch ? 'granted' : 'not granted'}
              />
              {e.mayDispatch
                ? 'He may record what actually left on any submitted order — a delivery record only.'
                : 'The backend refuses a delivery record from his login, and a direct API call is the same refusal.'}
            </p>
            <label className="label mt-3">
              Reason<span className="text-brand-red"> *</span>
            </label>
            <textarea
              className="input resize-none"
              rows={2}
              value={why}
              onChange={(ev) => setWhy(ev.target.value)}
              placeholder={
                e.mayDispatch
                  ? 'Why is the dispatch work being taken back?'
                  : 'Why is he recording deliveries now?'
              }
            />
            <p className="mt-1 text-[10px] text-faint">
              Required. The audit trail keeps you, this record, the value before and the value after,
              the reason and the time. An <code>employees</code> login is refused this call whatever
              its own flag says, so the switch is the convenience and the server is the rule.
            </p>
            {reasonProblem && (
              <p className="mt-1 text-[11px] font-semibold text-brand-red">{reasonProblem}</p>
            )}
            {notice && <p className="mt-1 text-[11px] font-semibold text-brand-blue">{notice}</p>}
            {refused && <p className="mt-1 text-[11px] font-semibold text-brand-red">{refused}</p>}
            <button
              type="button"
              className={e.mayDispatch ? 'btn-danger btn-sm mt-2' : 'btn-primary btn-sm mt-2'}
              disabled={busy || reasonProblem !== null}
              onClick={() => void changeCapability(!e.mayDispatch)}
            >
              {busy ? 'Working…' : e.mayDispatch ? 'Withdraw it' : 'Grant it'}
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Customers"
            subtitle="Assigned on the server by this employee's id."
            actions={<LiveSyncBar sync={customers.sync} busy={customers.state === 'loading'} />}
          />
          {customers.state === 'loading' && <Spinner label="Loading customers…" />}
          {customers.state === 'error' && (
            <p className="text-xs font-semibold text-brand-red">
              {customers.error}{' '}
              <button type="button" className="font-bold underline" onClick={customers.retry}>
                Try again
              </button>
            </p>
          )}
          {customers.state === 'ready' && customers.data && (
            <>
              {customers.data.items.length === 0 ? (
                <p className="text-xs text-muted">This employee has no customers assigned.</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-field border border-line">
                    {customers.data.items.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-bold text-ink">
                            <Link to="/debtors" className="hover:underline">
                              {c.name}
                            </Link>
                          </p>
                          <p className="text-[10px] text-muted">
                            {c.city || '—'} • {c.mobile}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold">
                          {c.outstandingPaise > 0
                            ? `owes ${exactRupees(c.outstandingPaise)}`
                            : c.advancePaise > 0
                              ? `advance ${exactRupees(c.advancePaise)}`
                              : 'no balance'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-faint">
                    Showing {customers.data.items.length} of {customers.data.total} customer(s) assigned to this salesperson id.
                  </p>
                </>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Orders"
            subtitle="The server's own salespersonId scope."
            actions={<LiveSyncBar sync={orders.sync} busy={orders.state === 'loading'} />}
          />
          {orders.state === 'loading' && <Spinner label="Loading orders…" />}
          {orders.state === 'error' && (
            <p className="text-xs font-semibold text-brand-red">
              {orders.error}{' '}
              <button type="button" className="font-bold underline" onClick={orders.retry}>
                Try again
              </button>
            </p>
          )}
          {orders.state === 'ready' && orders.data && (
            <>
              {orders.data.items.length === 0 ? (
                <p className="text-xs text-muted">No orders for this employee.</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-field border border-line">
                    {orders.data.items.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-bold text-ink">
                            <Link to={`/orders/${o.id}`} className="hover:underline">
                              {o.number}
                            </Link>
                          </p>
                          <p className="text-[10px] text-muted">
                            {o.orderDate} • {o.customerName}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[11px]">
                          <span className="font-semibold">{exactRupees(o.valuePaise)}</span>
                          {o.cancelledAt ? <StatusBadge status="cancelled" /> : <StatusBadge status={o.status} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-faint">
                    Showing {orders.data.items.length} of {orders.data.total} order(s) booked by this salesperson id.
                  </p>
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
