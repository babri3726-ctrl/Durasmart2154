import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle } from 'lucide-react';
import { Card, PageHeader, StatusBadge, Tabs } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Modal } from '../components/ui/Overlays';
import { Pager } from '../components/ui/Pager';
import { DISPATCH_LABEL } from '../lib/liveDisplay';
import { useLiveList } from '../lib/useLiveList';
import { useResource } from '../lib/useResource';
import { invalidate, syncKeys } from '../lib/syncStore';
import { toast } from '../lib/toast';
import {
  listOrders,
  mayRecordDispatch,
  quickDispatchOrder,
  serverHost,
  type DispatchStatusFilter,
  type ServerOrder,
} from '../lib/serverApi';

const PAGE_SIZE = 20;

/** The three words `v_order_summary.dispatch_progress` can produce, in the order a desk reads them.
 *  They are the view's own CASE (`e4b7c0a9d312`), not a vocabulary this screen invented, and asking
 *  for a fourth is a `400` the backend gives rather than an empty page that looks like a finished
 *  day. */
const QUEUE: { key: DispatchStatusFilter; label: string }[] = [
  { key: 'pending', label: 'Awaiting dispatch' },
  { key: 'partial', label: 'Partly sent' },
  { key: 'dispatched', label: 'Everything sent' },
];

/** The dispatch desk: the orders the book says still need sending, read live from the shared
 *  backend, and the way onto the form that records what actually left.
 *
 *  This screen is D-3's capability doing its one unusual job. `GET /orders?dispatchStatus=` is the
 *  one read on the order book that reaches past the salesman's own orders, and it does so **only
 *  when the queue is named** — the plain `GET /orders` a caller makes stays that caller's own book, so
 *  the widening is visible in the request rather than being a default that quietly applies to a
 *  capability holder's every screen. That is also why the panel asks for a queue at all instead of
 *  reusing `/orders`: a desk that loads trucks has no orders of its own to list.
 *
 *  What the widening does **not** open is a write. An operator sees an order they did not sell and may
 *  record a delivery against it; they may not confirm it, cancel it or edit someone else's draft, and
 *  those stay the office's — the backend refuses them whatever this screen renders. Nothing about
 *  whose customer book or ledger they may read changes either, which is why a queue row links to the
 *  order (a read the capability covers) rather than to the customer's account.
 *
 *  Whether the login may record a delivery is asked of the server (`mayRecordDispatch`), not assumed
 *  from the role, and while that answer is arriving the screen says so instead of showing an empty
 *  queue — an empty page on a desk is the sentence that sends people home. The grant itself is the
 *  owner's, on the staff record (`Employees` → the person → dispatch capability), and it is the
 *  server that reads the flag back on every request this screen makes.
 *
 *  What is *not* on this queue: an order the office cancelled that never sent anything. Since P5.1 the
 *  backend leaves it off `GET /orders?dispatchStatus=` rather than showing it as work with a record
 *  link the write would refuse. A cancelled order that did send something stays, because the desk
 *  still has to see the load that went, and every one of these rows is still in Orders and on the
 *  register. */
export default function Dispatch() {
  const [tab, setTab] = useState<DispatchStatusFilter>('pending');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);

  const [quickDispatchOrderTarget, setQuickDispatchOrderTarget] = useState<ServerOrder | null>(null);
  const [slipModalImage, setSlipModalImage] = useState<{ url: string; title: string } | null>(null);
  const [vehicleNo, setVehicleNo] = useState('PB 10 CT 4421');
  const [dispatchNotes, setDispatchNotes] = useState('Full order dispatched from yard');
  const [submittingDispatch, setSubmittingDispatch] = useState(false);

  const right = useResource(useCallback(() => mayRecordDispatch(), []));
  const canRecord = right.state === 'ready' && right.data === true;

  const load = useCallback(
    (folded: string, p: number) =>
      listOrders({
        q: folded || undefined,
        dispatchStatus: tab,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [tab],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  const handleQuickDispatch = async () => {
    if (!quickDispatchOrderTarget || submittingDispatch) return;
    setSubmittingDispatch(true);
    try {
      await quickDispatchOrder(quickDispatchOrderTarget.id, {
        vehicleNo,
        notes: dispatchNotes,
      });
      invalidate(
        syncKeys.dispatch(quickDispatchOrderTarget.id),
        syncKeys.order(quickDispatchOrderTarget.id),
        syncKeys.orderList(),
      );
      toast.success(
        `Order ${quickDispatchOrderTarget.number ?? quickDispatchOrderTarget.id} marked as fully dispatched!`,
      );
      setQuickDispatchOrderTarget(null);
      retry();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dispatch order');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Dispatch"
        subtitle={`Delivery queue on ${serverHost()} — what the book still owes a vehicle, and what has gone`}
        actions={
          <Link to="/dispatch/history" className="btn-ghost">
            Consignment register
          </Link>
        }
      />

      <Card className="mb-4">
        <p className="text-[11px] text-muted">
          {right.state === 'loading'
            ? 'Asking the backend whether this login may record deliveries…'
            : right.state === 'error'
              ? `The backend could not answer whether this login may record deliveries (${right.error}), so the queue is shown read-only. Nothing is assumed either way — a write is gated by the server on every call.`
              : canRecord
                ? 'This login holds D-3’s dispatch capability, so it may record what actually left against any submitted order on the queue — a delivery record only. It does not confirm or cancel an order, and recording a dispatch moves no stock figure: stock comes from the approved stock source.'
                : 'This login does not hold the dispatch capability on its employee record, so deliveries can be read here and not recorded. The queue is still what the book says needs sending; the owner grants or withdraws the capability on the staff record under Employees.'}
        </p>
        <div className="mt-2">
          <LiveSyncBar sync={right.sync} busy={right.state === 'loading'} />
        </div>
      </Card>

      <Tabs
        tabs={QUEUE.map((q) => ({ key: q.key, label: q.label }))}
        active={tab}
        onChange={(key) => {
          setTab(key as DispatchStatusFilter);
          setPage(1);
        }}
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <p className="text-[11px] text-muted">
            Ordered and dispatched are the server’s cross-unit sums from `GET /orders`; the per-line figures and what
            is still dispatchable are on the order.
          </p>
          <input
            className="input !w-auto !py-2"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search order number or party…"
          />
        </div>
        <div className="mb-3">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
        </div>
        {state === 'loading' && <p className="text-xs text-faint">Loading the queue…</p>}
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
              ? 'No order on this part of the queue matches that search.'
              : `Nothing reads ${QUEUE.find((q) => q.key === tab)?.label.toLowerCase()} on the backend right now. An order appears here when it is submitted — a draft is not on the queue.`}
          </p>
        )}
        {state === 'ready' &&
          rows.map((o) => {
            const cancelled = o.cancelledAt !== null || o.status === 'cancelled';
            return (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-bold text-ink">
                      <Link to={`/orders/${o.id}`} className="hover:underline">
                        {o.number ?? 'order with no printed number'}
                      </Link>{' '}
                      <span className="font-semibold text-muted">• {o.customerName}</span>
                    </p>
                    {o.state && (
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-bold text-muted border border-line">
                        {o.state.toLowerCase() === 'punjab' ? '🌾 Punjab' : '🏢 Haryana'}
                      </span>
                    )}
                    {o.slipImageData && (
                      <button
                        type="button"
                        onClick={() =>
                          setSlipModalImage({
                            url: o.slipImageData!,
                            title: `Handwritten Slip • ${o.customerName}`,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded bg-brand-blue/10 px-2 py-0.5 text-[10px] font-bold text-brand-blue hover:bg-brand-blue/20 transition cursor-pointer"
                        title="Click to view handwritten order slip"
                      >
                        <Camera size={11} /> 📸 Slip Attached
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {o.orderDate} • {o.lineCount} line{o.lineCount === 1 ? '' : 's'} • {o.dispatchCount}{' '}
                    dispatch{o.dispatchCount === 1 ? '' : 'es'}
                    {o.lastDispatchDate ? ` • last ${o.lastDispatchDate}` : ' • nothing dispatched yet'}
                    {(o.salespersonName || o.salespersonId) && (
                      <span className="ml-2 font-bold text-brand-blue">
                        • 👤 Booked by: {o.salespersonName || o.salespersonId}
                      </span>
                    )}
                  </p>
                  {cancelled && (
                    <p className="mt-0.5 text-[10px] text-faint">
                      The office cancelled this order, so the backend refuses a delivery against it
                      (`412 order_not_dispatchable`). It is still listed because{' '}
                      {o.dispatchCount} consignment{o.dispatchCount === 1 ? '' : 's'} went out on it
                      before that, and goods that left the yard stay on the record whatever the order
                      was afterwards called. A cancellation with nothing on a vehicle is left off the
                      queue altogether; it stays under Orders.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2.5 text-[11px]">
                  <span>
                    <span className="text-muted">ordered </span>
                    <span className="font-semibold">{o.orderedQuantity}</span>
                  </span>
                  <span>
                    <span className="text-muted">dispatched </span>
                    <span className="font-semibold">{o.dispatchedQuantity}</span>
                  </span>
                  <StatusBadge status={o.status} />
                  <StatusBadge
                    status={o.dispatchStatus}
                    label={DISPATCH_LABEL[o.dispatchStatus] ?? o.dispatchStatus}
                  />
                  {canRecord && !cancelled && o.dispatchStatus !== 'dispatched' && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickDispatchOrderTarget(o);
                        setVehicleNo('PB 10 CT 4421');
                        setDispatchNotes('Full order dispatched from yard');
                      }}
                      className="btn-primary btn-sm !bg-brand-green !border-brand-green hover:!opacity-90 text-white inline-flex items-center gap-1 font-bold shadow-sm"
                    >
                      <CheckCircle size={13} /> ✓ Mark Dispatched
                    </button>
                  )}
                  {canRecord && !cancelled && (
                    <Link to={`/dispatch/record/${o.id}`} className="btn-ghost btn-sm text-xs border border-line">
                      Detailed Consignment
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        {state === 'ready' && <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
      </Card>

      {/* Modal: Quick Dispatch Confirmation */}
      <Modal
        open={quickDispatchOrderTarget !== null}
        onClose={() => setQuickDispatchOrderTarget(null)}
        title="✓ Mark Order Dispatched"
      >
        {quickDispatchOrderTarget && (
          <div className="space-y-4">
            <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3">
              <p className="text-xs font-bold text-ink">
                Order {quickDispatchOrderTarget.number ?? quickDispatchOrderTarget.id} •{' '}
                {quickDispatchOrderTarget.customerName}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                Booked by:{' '}
                <strong className="text-brand-blue">
                  {quickDispatchOrderTarget.salespersonName ||
                    quickDispatchOrderTarget.salespersonId ||
                    'Area Officer'}
                </strong>{' '}
                • Ordered Quantity: <strong>{quickDispatchOrderTarget.orderedQuantity} MT</strong>
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
              Clicking below immediately marks all lines on this order as fully dispatched. The salesperson who
              booked this order will instantly see the status flip from <strong>Pending</strong> to{' '}
              <strong className="text-brand-green">Dispatched</strong>.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setQuickDispatchOrderTarget(null)}
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
        )}
      </Modal>

      {/* Modal: View Handwritten Slip */}
      <Modal
        open={slipModalImage !== null}
        onClose={() => setSlipModalImage(null)}
        title={slipModalImage?.title ?? 'Handwritten Slip Photo'}
        wide
      >
        {slipModalImage && (
          <div className="flex flex-col items-center">
            <img
              src={slipModalImage.url}
              alt="Handwritten order slip"
              className="max-h-[75vh] w-auto rounded-lg object-contain shadow-md border border-line"
            />
            <p className="mt-3 text-xs text-muted font-bold">{slipModalImage.title}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
