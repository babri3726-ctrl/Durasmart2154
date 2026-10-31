import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle, Copy, Share2 } from 'lucide-react';
import { Card, CardHeader, PageHeader, Spinner, StatusBadge } from '../components/ui/Card';
import { Modal } from '../components/ui/Overlays';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { ConsignmentList } from '../components/Consignments';
import { orderLabel, orderShareText, whatsappShareUrl, type ShareLine } from '../lib/format';
import { exactRupees, idempotencyKeyFor, type KeyedSubmission } from '../lib/entryRules';
import { cancelNeedsReason, hasPositiveQuantity } from '../lib/orderEntry';
import { DISPATCH_LABEL, isNegativeQuantity } from '../lib/liveDisplay';
import { useLiveSession } from '../lib/liveSession';
import { invalidate, syncKeys, useSyncToken } from '../lib/syncStore';
import { useResource } from '../lib/useResource';
import { toast } from '../lib/toast';
import {
  getCustomer,
  getDispatchBalance,
  getOrder,
  listDispatches,
  mayRecordDispatch,
  newIdempotencyKey,
  quickDispatchOrder,
  serverHost,
  setOrderStatus,
  ServerError,
  type OrderStatus,
  type ServerOrderDetail,
  type ServerOrderLine,
} from '../lib/serverApi';

/** Quantities render exactly as the server's NUMERIC columns serialized them — the string in,
 *  the unit out. A negative is a finding, not an error to hide: it is shown in red and, for a
 *  remaining figure, named. */
function Qty({ value, unit }: { value: string; unit: string }) {
  return (
    <span className={isNegativeQuantity(value) ? 'font-bold text-brand-red' : 'font-semibold'}>
      {value} <span className="font-normal text-muted">{unit}</span>
    </span>
  );
}

function Remaining({ line }: { line: ServerOrderLine }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Qty value={line.remainingQuantity} unit={line.unit} />
      {isNegativeQuantity(line.remainingQuantity) && <StatusBadge status="over-dispatched" />}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-field bg-canvas px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] font-black text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-faint">{hint}</p>}
    </div>
  );
}

/** The order's status moves, and only the edges this screen offers: submit a draft, cancel an
 *  order, and — for an owner — confirm a submitted one. `POST /orders/{id}/status` takes the row's
 *  own `version` as `If-Match`, so a move written against a row someone else has already changed is
 *  refused by the server instead of quietly overwriting it.
 *
 *  What a role may not do is hidden, not enforced: a confirmation is owner-only, and a salesman may
 *  cancel only an order that was never confirmed. The backend refuses those edges whatever this
 *  screen renders, and its `403` / `409 illegal_transition` / `422` is shown as its own sentence —
 *  never as a success toast. A force-cancel (an order that already carries dispatched quantity)
 *  needs a `reason`, so the prompt marks it required before the call rather than after the refusal.
 *
 *  One `Idempotency-Key` per press, held across a retry of that same press: a double click is one
 *  move. After any answer, good or refused, the row is re-read, because a refusal on an illegal
 *  edge usually means it already moved elsewhere. */
function OrderActions({
  order,
  isOwner,
  onChanged,
}: {
  order: ServerOrderDetail;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'' | OrderStatus>('');
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const submitKey = useRef<KeyedSubmission | null>(null);
  const cancelKey = useRef<KeyedSubmission | null>(null);

  const cancelled = order.cancelledAt !== null || order.status === 'cancelled';
  const reasonRequired = cancelNeedsReason(order);
  const mayCancel = !cancelled && (isOwner || order.status === 'draft' || order.status === 'pending');

  async function move(to: OrderStatus, why?: string) {
    if (busy !== '') return;
    setBusy(to);
    setError('');
    const body = why && why.trim() !== '' ? { to, reason: why.trim() } : { to };
    const slot = to === 'cancelled' ? cancelKey : submitKey;
    const submission = idempotencyKeyFor(slot.current, { id: order.id, body }, newIdempotencyKey);
    slot.current = submission;
    try {
      const updated = await setOrderStatus(order.id, body, submission.key, order.version);
      slot.current = null;
      toast.success(
        to === 'pending'
          ? updated.number
            ? `Order ${updated.number} submitted — that number is the one the server printed`
            : 'Submitted on the backend, but the answer carried no printed number'
          : to === 'cancelled'
            ? `${orderLabel(updated)} cancelled on the backend`
            : `${orderLabel(updated)} is ${updated.status} on the backend`,
      );
      setReason('');
      onChanged();
    } catch (cause) {
      // The key is kept, not cleared: pressing the same button again is the same move, and the
      // server answers a replayed key with the answer it gave the first time.
      setError(
        cause instanceof ServerError
          ? cause.message
          : 'The backend did not answer, so the order has not moved.',
      );
      if (cause instanceof ServerError && (cause.code === 'illegal_transition' || cause.code === 'conflict')) {
        onChanged();
      }
    } finally {
      setBusy('');
      setCancelOpen(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {order.status === 'draft' && (
        <button type="button" className="btn-primary btn-sm" disabled={busy !== ''} onClick={() => void move('pending')}>
          {busy === 'pending' ? 'Submitting…' : 'Submit order'}
        </button>
      )}
      {order.status === 'pending' && isOwner && (
        <button type="button" className="btn-primary btn-sm" disabled={busy !== ''} onClick={() => void move('confirmed')}>
          {busy === 'confirmed' ? 'Working…' : 'Confirm order'}
        </button>
      )}
      {mayCancel && (
        <button type="button" className="btn-danger btn-sm" disabled={busy !== ''} onClick={() => setCancelOpen(true)}>
          Cancel order
        </button>
      )}
      {!isOwner && !cancelled && (
        <span className="text-[10px] text-faint">
          Confirming an order, and cancelling one already confirmed, are owner decisions — the backend refuses them
          for this session, so they are not offered here.
        </span>
      )}
      {error !== '' && (
        <p className="basis-full rounded-field bg-brand-red/10 px-3 py-2 text-[11px] font-bold text-brand-red">
          {error}
        </p>
      )}

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order on the backend">
        <p className="text-sm text-ink">
          {order.number ? `Order ${order.number}` : 'This draft'} for {order.customerName} — <StatusBadge status={order.status} />.
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {reasonRequired
            ? 'This order already has dispatched quantity, so the backend will only accept a cancel that says why. The reason is required.'
            : 'A reason is optional here; the backend records it with the cancellation when you give one.'}
        </p>
        <label className="label mt-3">
          Reason
          {reasonRequired && <span className="text-brand-red"> *</span>}
        </label>
        <textarea
          className="input resize-none"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={reasonRequired ? 'Why is this order being cancelled?' : 'Optional note for the backend'}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setCancelOpen(false)} disabled={busy !== ''}>
            Keep the order
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={busy !== '' || (reasonRequired && reason.trim() === '')}
            onClick={() => void move('cancelled', reason)}
          >
            {busy === 'cancelled' ? 'Working…' : 'Cancel the order'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** The WhatsApp handoff — client-side text only (`D-12`).
 *
 *  Nothing is sent from the panel: there is no messaging route on the backend and no request to
 *  WhatsApp here. The text is built from fields this screen already read — the printed order number,
 *  the party's name, each line's product name with its ordered quantity and unit, and the order
 *  value straight from `valuePaise` — and the operator either copies it or opens a `wa.me` link the
 *  browser handles. A draft has no number, so the text says it is a draft instead of inventing one,
 *  and no line's amount is multiplied here: the figure is the server's.
 *
 *  The one thing the order row does not carry is the party's mobile, so it is read from
 *  `GET /customers/{id}` — the row the backend already sent for that party, not a lookup. When the
 *  number is unusable or the party is outside this caller's scope, no link is offered and the copy
 *  button stays, because a wrong `wa.me` address sends a good message to a stranger. */
function OrderShare({ order }: { order: ServerOrderDetail }) {
  const party = useResource(useCallback(() => getCustomer(order.customerId), [order.customerId]));
  const lines: ShareLine[] = order.lines.map((l) => ({
    productName: l.productName,
    quantity: l.orderedQuantity,
    unit: l.unit,
    ratePaise: l.ratePaise,
  }));
  const text = orderShareText({
    number: order.number,
    customerName: order.customerName,
    orderDate: order.orderDate,
    status: order.status,
    valuePaise: order.valuePaise,
    lines,
  });
  const mobile = party.state === 'ready' && party.data ? party.data.mobile : '';
  const url = mobile === '' ? null : whatsappShareUrl(mobile, text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Order summary copied — paste it into WhatsApp yourself');
    } catch {
      toast.error('The browser would not take the text. Select the summary and copy it.');
    }
  }

  return (
    <div className="mt-4">
      <LiveSyncBar sync={party.sync} busy={party.state === 'loading'} />
      <label className="label mt-2">Share text — built on this device, sent by nobody from this panel</label>
      <textarea className="input resize-none font-mono text-[11px]" rows={7} readOnly value={text} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => void copy()}>
          <Copy size={13} /> Copy summary
        </button>
        {url ? (
          <a className="btn-primary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
            <Share2 size={13} /> Open WhatsApp for {order.customerName}
          </a>
        ) : (
          <span className="text-[10px] text-faint">
            {party.state === 'loading'
              ? 'Reading the party’s mobile from the backend…'
              : party.state === 'error'
                ? `The customer row could not be read (${party.error}), so no WhatsApp link is offered — copy the summary instead.`
                : 'The customer row carries no usable mobile, so no WhatsApp link is offered — copy the summary instead.'}
          </span>
        )}
      </div>
    </div>
  );
}

/** The deliveries this order went out on, read from `GET /dispatches?orderId=`.
 *
 *  Mounted only when the backend says this login may read the register, because that route sits
 *  behind D-3's capability and has no row scope on it — the same three consignments a desk sees from
 *  its own screen. A salesman who sold the order but does not hold the capability gets the sentence
 *  below instead of a `403` dressed up as a failure, and the figures that salesman *is* entitled to
 *  (the order, its lines, its balance) are on this screen anyway.
 *
 *  What is on each row is the server's: the consignment number it printed, the delivery axis, and
 *  who recorded it. Nothing here adds a quantity up across lines or units — §8.1 forbids the total,
 *  and the per-line figures already live in the balance card above. */
function OrderConsignments({
  orderId,
  isOwner,
  userId,
}: {
  orderId: string;
  isOwner: boolean;
  userId: string | null;
}) {
  const token = useSyncToken(syncKeys.dispatch(orderId));
  const rows = useResource(
    useCallback(() => listDispatches({ orderId, pageSize: 100 }), [orderId]),
    token,
  );

  return (
    <Card>
      <CardHeader
        title="Consignments for this order"
        subtitle="Every delivery recorded against it, newest first, voided ones included with their stamp."
        actions={<LiveSyncBar sync={rows.sync} busy={rows.state === 'loading'} />}
      />
      {rows.state === 'loading' && <Spinner label="Loading consignments…" />}
      {rows.state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {rows.error}{' '}
          <button type="button" className="font-bold underline" onClick={rows.retry}>
            Try again
          </button>
        </p>
      )}
      {rows.state === 'ready' && rows.data && (
        <>
          <ConsignmentList
            rows={rows.data.items}
            canRecord
            isOwner={isOwner}
            userId={userId}
            onChanged={() =>
              invalidate(syncKeys.dispatch(orderId), syncKeys.order(orderId), syncKeys.orderList())
            }
            emptyMessage="Nothing has been dispatched against this order yet — the balance above is still the whole of it."
          />
          {rows.data.total > rows.data.items.length && (
            <p className="mt-2 text-[10px] text-faint">
              Showing the {rows.data.items.length} most recent of {rows.data.total} consignments; the register at{' '}
              <Link to="/dispatch/history" className="font-bold text-brand-blue hover:underline">
                /dispatch/history
              </Link>{' '}
              pages through all of them.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** One order as the server derived it: `GET /orders/{id}` for the body and lines, and
 *  `GET /orders/{id}/dispatch-balance` as its own live read — the second card is deliberately
 *  fetched separately because those are the exact rows the dispatch write is validated against under
 *  the order's row lock, not a value cached from the first call.
 *
 *  The first card is no longer read-only: a draft can be edited (`/orders/{id}/edit`) and submitted,
 *  and an order can be cancelled or confirmed, all through `POST /orders/{id}/status` with the row
 *  version this screen read. A delivery can be recorded from the balance card and its consignments
 *  are listed below. Payment entry is still not wired from here. */
export default function OrderDetail() {
  const { id = '' } = useParams();
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [quickDispatchModalOpen, setQuickDispatchModalOpen] = useState(false);
  const [vehicleNo, setVehicleNo] = useState('PB 10 CT 4421');
  const [dispatchNotes, setDispatchNotes] = useState('Full load dispatched from yard');
  const [submittingDispatch, setSubmittingDispatch] = useState(false);
  const user = useLiveSession((s) => s.user);

  // One write can stale three reads: a dispatch changes the order's own dispatch status, the
  // per-line balance and the consignment list. Each reads the key that write bumps, so the card
  // beside the form is re-read rather than left showing pre-dispatch figures until remount.
  const orderToken = useSyncToken(syncKeys.order(id));
  const dispatchToken = useSyncToken(syncKeys.dispatch(id));
  const order = useResource(useCallback(() => getOrder(id), [id]), orderToken + dispatchToken);
  const balance = useResource(useCallback(() => getDispatchBalance(id), [id]), dispatchToken);
  const right = useResource(useCallback(() => mayRecordDispatch(), []));
  const canRecord = right.state === 'ready' && right.data === true;

  const handleQuickDispatch = async () => {
    if (submittingDispatch) return;
    setSubmittingDispatch(true);
    try {
      await quickDispatchOrder(id, { vehicleNo, notes: dispatchNotes });
      invalidate(
        syncKeys.dispatch(id),
        syncKeys.dispatchRegister,
        syncKeys.order(id),
        syncKeys.orderList(),
        syncKeys.dashboard,
      );
      toast.success('Order marked as fully dispatched!');
      setQuickDispatchModalOpen(false);
      order.retry();
      balance.retry();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dispatch order');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  if (order.state === 'loading') {
    return (
      <div>
        <PageHeader title="Order" />
        <Card>
          <Spinner label="Loading order…" />
        </Card>
      </div>
    );
  }

  if (order.state === 'error' || !order.data) {
    return (
      <div>
        <PageHeader title="Order" />
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {order.error}{' '}
            <button type="button" className="font-bold underline" onClick={order.retry}>
              Try again
            </button>
          </p>
          <p className="mt-3 text-xs">
            <Link to="/orders" className="font-bold text-brand-blue hover:underline">
              Back to Orders
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const o = order.data;
  const cancelled = o.cancelledAt !== null || o.status === 'cancelled';

  return (
    <div>
      <PageHeader
        // An unnumbered draft takes PB-2c's compact label in the title slot, with no "Order" in
        // front of a number that is not there, and the caption slot explains it. The id is not a
        // number and never appears here in one's place.
        title={o.number === null ? 'Draft — number on submit' : `Order ${o.number}`}
        subtitle={
          o.number === null
            ? `Draft on ${serverHost()} — the printed number is minted when it is submitted; the lines are editable until then`
            : `Order record on ${serverHost()} — its status and its deliveries are handled from here, its payments are not`
        }
        actions={<LiveSyncBar sync={order.sync} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Order" />

          {/* Real-time Dispatch Progress Banner */}
          <div
            className={`-mt-2 mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-lg p-3 border ${
              o.dispatchStatus === 'dispatched'
                ? 'border-brand-green/30 bg-brand-green/10 text-brand-green'
                : o.dispatchStatus === 'partial'
                ? 'border-brand-blue/30 bg-brand-blue/10 text-brand-blue'
                : 'border-brand-orange/30 bg-brand-orange/10 text-[#B45309]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {o.dispatchStatus === 'dispatched' ? '✅' : o.dispatchStatus === 'partial' ? '🚚' : '⏳'}
              </span>
              <div>
                <p className="text-xs font-black">
                  {o.dispatchStatus === 'dispatched'
                    ? 'Order Fully Dispatched'
                    : o.dispatchStatus === 'partial'
                    ? 'Partially Dispatched'
                    : '⏳ Pending Dispatch (Awaiting Yard Loading)'}
                </p>
                <p className="text-[10px] text-muted">
                  {o.dispatchStatus === 'dispatched'
                    ? `Dispatched on ${o.lastDispatchDate || o.orderDate} • All items sent`
                    : o.dispatchStatus === 'partial'
                    ? `Partially sent • ${o.dispatchedQuantity} of ${o.orderedQuantity} MT sent`
                    : 'Booked by sales officer — waiting for dispatch desk to load and dispatch.'}
                </p>
              </div>
            </div>

            {canRecord && !cancelled && o.dispatchStatus !== 'dispatched' && (
              <button
                type="button"
                onClick={() => setQuickDispatchModalOpen(true)}
                className="btn-primary btn-sm !bg-brand-green !border-brand-green text-white font-bold inline-flex items-center gap-1 shadow-sm"
              >
                <CheckCircle size={13} /> ✓ Mark Dispatched
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {o.cancelledAt ? <StatusBadge status="cancelled" /> : <StatusBadge status={o.status} />}
            <StatusBadge status={o.dispatchStatus} label={DISPATCH_LABEL[o.dispatchStatus]} />
            {!o.isBilled && <StatusBadge status="draft" label="not billed yet" />}
            <span className="chip bg-canvas text-muted">source: {o.source}</span>
          </div>
          <p className="text-[13px] font-bold text-ink">
            <Link to={`/customers/${o.customerId}`} className="hover:underline">
              {o.customerName}
            </Link>
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Ordered {o.orderDate}
            {o.dueDate ? ` • due ${o.dueDate}` : ''}
            {o.expectedDispatchDate ? ` • expected dispatch ${o.expectedDispatchDate}` : ''}
          </p>
          {(o.salespersonName || o.salespersonId) && (
            <p className="mt-1 text-[11px] font-bold text-brand-blue">
              👤 Area Sales Officer: {o.salespersonName || o.salespersonId}
            </p>
          )}
          {o.paymentTerms && <p className="mt-1 text-[11px] text-muted">Terms: {o.paymentTerms}</p>}
          {o.notes && <p className="mt-1 text-[11px] text-muted">Notes: {o.notes}</p>}
          {o.status === 'draft' && (
            <p className="mt-2 text-[11px]">
              <Link to={`/orders/${o.id}/edit`} className="font-bold text-brand-blue hover:underline">
                Edit this draft
              </Link>{' '}
              <span className="text-faint">— a PATCH writes the whole line list back, against version {o.version}</span>
            </p>
          )}
          <OrderActions
            order={o}
            isOwner={user?.role === 'owner'}
            onChanged={() => invalidate(syncKeys.order(o.id), syncKeys.orderList())}
          />
          <p className="mt-3 text-[10px] text-faint">
            Submitting, confirming and cancelling are wired from this screen, and a delivery is recorded from the
            balance card below it. Payment entry is not wired from here. Every figure stays the server’s own, and
            nothing on this screen is recomputed in the browser.
          </p>
        </Card>

        <Card>
          <CardHeader title="Send the order to the party" subtitle="A text and a link this device builds — the panel sends nothing." />
          <OrderShare order={o} />
        </Card>
      </div>

      {o.slipImageData && (
        <div className="mt-4">
          <Card className="border border-brand-blue/30 bg-brand-blue/5">
            <CardHeader
              title="📸 Handwritten Order Slip Photo"
              subtitle="Original physical slip / WhatsApp note captured when this order was booked."
            />
            <div className="p-3 text-center">
              <img
                src={o.slipImageData}
                alt="Handwritten order slip"
                className="max-h-72 mx-auto rounded-lg border border-line shadow-sm cursor-pointer hover:opacity-95"
                onClick={() => setShowSlipModal(true)}
              />
              <p className="mt-2 text-xs font-bold text-brand-blue cursor-pointer" onClick={() => setShowSlipModal(true)}>
                Click to Enlarge Slip Photo
              </p>
            </div>
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card>
          <CardHeader title="Figures on the server" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Order value" value={exactRupees(o.valuePaise)} hint={`${o.lineCount} line(s)`} />
            <Stat label="Billed" value={exactRupees(o.billedPaise)} hint={`${o.invoiceCount} invoice(s)`} />
            <Stat
              label="Paid against this order"
              value={exactRupees(o.paidPaise)}
              hint={`${o.paymentCount} receipt(s) naming this order — an account payment moves the customer's ledger instead`}
            />
            <Stat
              label={o.orderBalancePaise < 0 ? 'Credit against this order' : 'Balance on this order'}
              value={exactRupees(o.orderBalancePaise < 0 ? -o.orderBalancePaise : o.orderBalancePaise)}
              hint="signed by the server; a credit is shown as one, never clamped to zero"
            />
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Order lines" subtitle="Every quantity is the server's own decimal string; nothing here is recomputed in the browser." />
          <div className="overflow-x-auto rounded-field border border-line">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead>
                <tr className="bg-canvas text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Ordered</th>
                  <th className="px-3 py-2">Dispatched</th>
                  <th className="px-3 py-2">Remaining</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">GST %</th>
                  <th className="px-3 py-2">Line value</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.orderLineId} className="border-t border-line/60">
                    <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                    <td className="px-3 py-2 font-semibold text-ink">{l.productName || '—'}</td>
                    <td className="px-3 py-2"><Qty value={l.orderedQuantity} unit={l.unit} /></td>
                    <td className="px-3 py-2"><Qty value={l.dispatchedQuantity} unit={l.unit} /></td>
                    <td className="px-3 py-2"><Remaining line={l} /></td>
                    <td className="px-3 py-2">{exactRupees(l.ratePaise)}</td>
                    <td className="px-3 py-2">{l.gstRatePercent ?? '—'}</td>
                    <td className="px-3 py-2 font-semibold">{exactRupees(l.valuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Dispatch balance"
            subtitle="Read live from the dispatch-balance endpoint — the same figures the server checks before accepting a dispatch."
            actions={<LiveSyncBar sync={balance.sync} busy={balance.state === 'loading'} />}
          />
          {balance.state === 'loading' && <Spinner label="Loading dispatch balance…" />}
          {balance.state === 'error' && (
            <p className="text-xs font-semibold text-brand-red">
              {balance.error}{' '}
              <button type="button" className="font-bold underline" onClick={balance.retry}>
                Try again
              </button>
            </p>
          )}
          {balance.state === 'ready' && balance.data && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canRecord && (
                <Link to={`/dispatch/record/${o.id}`} className="btn-primary btn-sm">
                  Record a dispatch
                </Link>
              )}
              {canRecord && !balance.data.lines.some((l) => hasPositiveQuantity(l.remainingQuantity)) && (
                <span className="text-[10px] text-faint">
                  Every line’s remaining figure is already zero or negative, so there is nothing this order is asking
                  for — a further consignment is refused as `over_dispatch` unless one is voided first.
                </span>
              )}
              {right.state === 'ready' && !canRecord && !cancelled && (
                <span className="text-[10px] text-faint">
                  Recording a delivery needs the dispatch capability on the employee record, so it is not offered
                  here; the balance above is still what the order owes.
                </span>
              )}
              <LiveSyncBar sync={right.sync} busy={right.state === 'loading'} />
            </div>
          )}
          {balance.state === 'ready' && balance.data && (
            <div className="overflow-x-auto rounded-field border border-line">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead>
                  <tr className="bg-canvas text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Ordered</th>
                    <th className="px-3 py-2">Dispatched</th>
                    <th className="px-3 py-2">Still dispatchable</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.data.lines.map((l) => (
                    <tr key={l.orderLineId} className="border-t border-line/60">
                      <td className="px-3 py-2 text-muted">{l.lineNo}</td>
                      <td className="px-3 py-2 font-semibold text-ink">{l.productName || '—'}</td>
                      <td className="px-3 py-2"><Qty value={l.orderedQuantity} unit={l.unit} /></td>
                      <td className="px-3 py-2"><Qty value={l.dispatchedQuantity} unit={l.unit} /></td>
                      <td className="px-3 py-2"><Remaining line={l} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        {canRecord ? (
          <OrderConsignments orderId={id} isOwner={user?.role === 'owner'} userId={user?.id ?? null} />
        ) : (
          <Card>
            <CardHeader
              title="Consignments for this order"
              subtitle="The delivery register sits behind D-3’s dispatch capability rather than behind the order."
            />
            <p className="text-[11px] text-muted">
              {right.state === 'loading'
                ? 'Asking the backend whether this login may read the register…'
                : right.state === 'error'
                  ? `The backend could not answer (${right.error}), so the register is not shown. Nothing about this order’s own figures changes: the balance above is still the server’s.`
                  : 'This login does not hold the capability, so the consignments behind those figures are not open to it. The order’s own lines and balance above are what this session may read.'}
            </p>
          </Card>
        )}
      </div>

      <Modal open={showSlipModal} onClose={() => setShowSlipModal(false)} title="Handwritten Order Slip" wide>
        {o.slipImageData && (
          <div className="flex flex-col items-center">
            <img src={o.slipImageData} alt="Handwritten order slip" className="max-h-[75vh] w-auto rounded-lg object-contain shadow-md" />
            <p className="mt-3 text-xs text-muted font-bold">Attached slip for {o.customerName}</p>
          </div>
        )}
      </Modal>

      {/* Modal: Quick Dispatch Confirmation */}
      <Modal
        open={quickDispatchModalOpen}
        onClose={() => setQuickDispatchModalOpen(false)}
        title="✓ Mark Order Dispatched"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3">
            <p className="text-xs font-bold text-ink">
              {o.number ? `Order ${o.number}` : 'Order'} • {o.customerName}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Booked by: <strong className="text-brand-blue">{o.salespersonName || o.salespersonId || 'Area Officer'}</strong>{' '}
              • Ordered Quantity: <strong>{o.orderedQuantity} MT</strong>
            </p>
          </div>

          <div>
            <label className="label">Vehicle / Truck Number</label>
            <input
              className="input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="e.g. PB 10 CT 4421, HR 02 AB 1234..."
            />
          </div>

          <div>
            <label className="label">Gate Pass / Dispatch Notes</label>
            <input
              className="input"
              value={dispatchNotes}
              onChange={(e) => setDispatchNotes(e.target.value)}
              placeholder="e.g. Full order dispatched, Driver verified..."
            />
          </div>

          <p className="text-[11px] text-muted">
            Marking this order as dispatched will fulfill all lines, record a consignment, and update the sales officer’s order tracker from <strong>Pending</strong> to <strong className="text-brand-green">Dispatched</strong>.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setQuickDispatchModalOpen(false)}
              disabled={submittingDispatch}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm !bg-brand-green !border-brand-green text-white font-bold inline-flex items-center gap-1.5"
              onClick={handleQuickDispatch}
              disabled={submittingDispatch}
            >
              <CheckCircle size={14} />
              {submittingDispatch ? 'Dispatching…' : 'Confirm & Mark Dispatched'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
