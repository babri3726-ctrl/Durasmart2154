import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardHeader, PageHeader, Spinner, StatusBadge } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/Overlays';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { fmtDateTime } from '../lib/format';
import { toast } from '../lib/toast';
import { useLiveSession } from '../lib/liveSession';
import { exactRupees, idempotencyKeyFor, type KeyedSubmission } from '../lib/entryRules';
import { useLiveList } from '../lib/useLiveList';
import { useResource } from '../lib/useResource';
import {
  approveCustomer,
  getCustomer,
  getCustomerLedger,
  newIdempotencyKey,
  rejectCustomer,
  serverHost,
  ServerError,
} from '../lib/serverApi';

const LEDGER_LABEL: Record<string, string> = { creditNote: 'credit note' };
const LEDGER_PAGE_SIZE = 50;

/** Whose decision this is, in the panel's own words.
 *
 *  `D-11`: a party a salesperson entered arrives as `pendingApproval` and only the owner moves it
 *  out of there. The server enforces that (`403` for an employee token, `404` for a party outside
 *  the caller's scope) — the gate here is not the protection, it is the honesty of not showing a
 *  button this account will be refused by. An employee sees the same row, the same status and the
 *  sentence saying who has to act.
 *
 *  A decision is a **write**, so it carries one `Idempotency-Key` per press and keeps it across a
 *  retry of the same press; the answer the server gives a replayed key is the first answer, which
 *  is what makes a double click land on one decision. A refusal never toasts success, and a
 *  `409 conflict` — the party was already decided, by this owner or another — is shown as the
 *  ordinary thing it is, then the row is re-read so the screen shows the status it now has. */
function Decision({
  customerId,
  status,
  isOwner,
  onDecided,
}: {
  customerId: string;
  status: string;
  isOwner: boolean;
  onDecided: () => void;
}) {
  const [confirmReject, setConfirmReject] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | ''>('');
  const [error, setError] = useState('');
  const keyRef = useRef<KeyedSubmission | null>(null);

  if (status !== 'pendingApproval') return null;

  async function decide(action: 'approve' | 'reject') {
    if (busy !== '') return;
    setBusy(action);
    setError('');
    const run = action === 'approve' ? approveCustomer : rejectCustomer;
    const submission = idempotencyKeyFor(keyRef.current, { id: customerId, action }, newIdempotencyKey);
    keyRef.current = submission;
    try {
      const row = await run(customerId, submission.key);
      keyRef.current = null;
      toast.success(
        action === 'approve'
          ? `${row.name} approved — the party is active and can take orders`
          : `${row.name} rejected — it stays out of the order picker`,
      );
      onDecided();
    } catch (cause) {
      // The key stays held: pressing the same button again is the same submission, and the server
      // answers a replayed key with the answer it gave the first time.
      setError(
        cause instanceof ServerError
          ? cause.message
          : `${action === 'approve' ? 'Approval' : 'Rejection'} did not reach the backend. Nothing changed.`,
      );
      if (cause instanceof ServerError && cause.code === 'conflict') onDecided();
    } finally {
      setBusy('');
      setConfirmReject(false);
    }
  }

  if (!isOwner) {
    return (
      <p className="mt-3 rounded-field bg-canvas px-3.5 py-2.5 text-[11px] text-muted">
        This party is waiting to be approved. Only an owner account can approve or reject it, and you are not signed
        in as one — the backend refuses the decision for this session, so the buttons are not shown to you.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-field border border-brand-orange/40 bg-brand-orange/10 px-3.5 py-3">
      <p className="text-[12px] font-bold text-[#9A5A0B]">
        This party is waiting for your approval. Until you decide, it cannot be picked for an order.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={() => void decide('approve')} disabled={busy !== ''}>
          {busy === 'approve' ? 'Approving…' : 'Approve customer'}
        </button>
        <button type="button" className="btn-danger btn-sm" onClick={() => setConfirmReject(true)} disabled={busy !== ''}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject customer'}
        </button>
      </div>
      {error !== '' && <p className="mt-2 text-[11px] font-bold text-brand-red">{error}</p>}
      <ConfirmDialog
        open={confirmReject}
        title="Reject this customer?"
        message="The party stays on the backend as rejected, with its history, and is never offered to the order picker. One party takes one decision: this screen cannot reverse it afterwards."
        confirmLabel="Reject on the backend"
        danger
        busy={busy === 'reject'}
        onConfirm={() => void decide('reject')}
        onCancel={() => setConfirmReject(false)}
      />
    </div>
  );
}


/** One customer as the backend derived it: `GET /customers/{id}` for the row and its balance
 *  figures, `GET /customers/{id}/ledger` for the running history behind them.
 *
 *  The two meet on a signed figure this screen does not display. The view defines
 *  `outstanding_paise = GREATEST(ledger_balance_paise, 0)` and
 *  `advance_paise = GREATEST(-ledger_balance_paise, 0)`, so the ledger's final row is
 *  outstanding when money is owed and minus the advance when it is not — the same fact in two
 *  tiles, never one number. Neither client reads `ledgerBalancePaise`, which is why the wording
 *  below names the arithmetic instead of pointing at a figure on screen. */
export default function CustomerDetail() {
  const { id = '' } = useParams();
  const user = useLiveSession((s) => s.user);

  const [ledgerPage, setLedgerPage] = useState(1);
  const customer = useResource(useCallback(() => getCustomer(id), [id]));
  const loadLedger = useCallback(
    (_folded: string, p: number) => getCustomerLedger(id, { page: p, pageSize: LEDGER_PAGE_SIZE }),
    [id],
  );
  const ledger = useLiveList(loadLedger, '', ledgerPage);

  if (customer.state === 'loading') {
    return (
      <div>
        <PageHeader title="Customer" />
        <Card>
          <Spinner label="Loading customer…" />
        </Card>
      </div>
    );
  }

  if (customer.state === 'error' || !customer.data) {
    return (
      <div>
        <PageHeader title="Customer" />
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {customer.error}{' '}
            <button type="button" className="font-bold underline" onClick={customer.retry}>
              Try again
            </button>
          </p>
          <p className="mt-3 text-xs">
            <Link to="/customers" className="font-bold text-brand-blue hover:underline">
              Back to Customers
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const c = customer.data;

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={`Customer on ${serverHost()} — every figure below comes from that source.`}
        actions={<LiveSyncBar sync={customer.sync} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Party" />
          <div className="-mt-3 mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <span className="chip bg-canvas text-muted">source: {c.source}</span>
            {c.isOverdue && <StatusBadge status="overdue" />}
          </div>
          <Decision
            customerId={c.id}
            status={c.status}
            isOwner={user?.role === 'owner'}
            onDecided={() => customer.sync.refresh()}
          />
          {c.status !== 'pendingApproval' && (
            <p className="mt-3 text-[11px] text-muted">
              {c.approvedAt ? (
                <>
                  Approved <b className="text-ink">by the owner</b> on {fmtDateTime(c.approvedAt)}
                  {c.approvedBy ? ` — approver id ${c.approvedBy}` : ''}.
                  {c.approvedBy ? (
                    <span className="mt-1 block text-[10px] text-faint">
                      That is the approver's user id, not a name: the stamp stores `app_user.id` and no mounted
                      route resolves one to a person, so the panel shows the id rather than guessing the name.
                    </span>
                  ) : null}
                </>
              ) : c.status === 'rejected' ? (
                'Rejected — the server keeps no approval stamp for a rejection.'
              ) : (
                'No approval stamp on this row: it did not come through the approve route.'
              )}
            </p>
          )}
          <p className="text-[12px] font-bold text-ink">{c.contactPerson || 'no contact person recorded'}</p>
          <p className="mt-1 text-[11px] text-muted">
            {c.city || '—'}
            {c.district ? ` • ${c.district}` : ''}
            {c.state ? ` • ${c.state}` : ''} • {c.mobile} • {c.creditDays} credit days
          </p>
          {c.address && <p className="mt-2 text-[11px] text-muted">Address: {c.address}</p>}
          {c.notes && <p className="mt-2 text-[11px] text-muted">Notes: {c.notes}</p>}
          <p className="mt-3 text-[10px] text-faint">
            Approving and rejecting a party waiting on the owner is wired from this screen. Editing a party and
            recording a payment are not: the backend mounts no route for either, so neither can be done from
            anywhere in the panel.
          </p>
        </Card>

        <Card>
          <CardHeader title="Balance figures" subtitle="One signed ledger figure — opening + invoices − receipts — shown as Outstanding when money is owed and as Advance when it is not. Only one of the two is ever above zero." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-field bg-canvas px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Outstanding</p>
              <p className="mt-0.5 text-[15px] font-black text-ink">
                {c.outstandingPaise > 0 ? `owes ${exactRupees(c.outstandingPaise)}` : c.advancePaise > 0 ? `advance ${exactRupees(c.advancePaise)}` : 'no balance'}
              </p>
            </div>
            <div className="rounded-field bg-canvas px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Overdue</p>
              <p className="mt-0.5 text-[15px] font-black text-ink">
                {c.isOverdue ? exactRupees(c.overduePaise) : 'nothing overdue'}
              </p>
              <p className="mt-0.5 text-[10px] text-faint">{c.isOverdue ? 'past-due share of billed invoices' : 'capped at outstanding by the server'}</p>
            </div>
            <div className="rounded-field bg-canvas px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Unbilled orders</p>
              <p className="mt-0.5 text-[15px] font-black text-ink">{exactRupees(c.unbilledValuePaise)}</p>
              <p className="mt-0.5 text-[10px] text-faint">confirmed orders not yet invoiced — not yet a receivable, not added to outstanding</p>
            </div>
            <div className="rounded-field bg-canvas px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Submitted orders</p>
              <p className="mt-0.5 text-[15px] font-black text-ink">{c.orderCount}</p>
              <p className="mt-0.5 text-[10px] text-faint">orders the server has printed a number for — a draft joins this count when it is submitted</p>
            </div>
            <div className="rounded-field bg-canvas px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Opening balance</p>
              <p className="mt-0.5 text-[15px] font-black text-ink">{exactRupees(c.openingPaise)}</p>
              <p className="mt-0.5 text-[10px] text-faint">from the opening balances recorded on this account</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-faint">
            {c.invoiceCount} invoice(s)
            {c.lastPaymentDate ? `, last payment ${c.lastPaymentDate}` : ', no payment recorded yet'}.
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Customer ledger"
            subtitle="The running balance is summed in SQL; on the ledger's final page the last row is the signed figure — the Outstanding above when money is owed, minus the Advance when it isn't."
            actions={<LiveSyncBar sync={ledger.sync} busy={ledger.state === 'loading'} />}
          />
          {ledger.state === 'loading' && <Spinner label="Loading ledger…" />}
          {ledger.state === 'error' && (
            <p className="text-xs font-semibold text-brand-red">
              {ledger.error}{' '}
              <button type="button" className="font-bold underline" onClick={ledger.retry}>
                Try again
              </button>
            </p>
          )}
          {ledger.state === 'ready' && ledger.rows.length === 0 && (
            <p className="text-xs text-muted">No ledger rows on the backend for this customer.</p>
          )}
          {ledger.state === 'ready' && ledger.rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-field border border-line">
                <table className="w-full min-w-[640px] text-left text-[11px]">
                  <thead>
                    <tr className="bg-canvas text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Kind</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((r) => (
                      <tr key={r.entryId} className="border-t border-line/60">
                        <td className="px-3 py-2 text-muted">{r.entryDate}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={r.kind} label={LEDGER_LABEL[r.kind]} />
                        </td>
                        <td className="px-3 py-2">
                          {r.reference || '—'}
                          {r.orderId && (
                            <>
                              {' '}
                              <Link to={`/orders/${r.orderId}`} className="font-semibold text-brand-blue hover:underline">
                                order
                              </Link>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{r.debitPaise !== 0 ? exactRupees(r.debitPaise) : '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{r.creditPaise !== 0 ? exactRupees(r.creditPaise) : '—'}</td>
                        <td className="px-3 py-2 text-right font-bold">{exactRupees(r.balancePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={ledgerPage} pageSize={LEDGER_PAGE_SIZE} total={ledger.total} onPage={setLedgerPage} />
            </>
          )}
          <p className="mt-2 text-[10px] text-faint">
            Voided receipts are excluded from this ledger; they remain listed on the Payment screen with their stamp.
          </p>
        </Card>
      </div>
    </div>
  );
}
