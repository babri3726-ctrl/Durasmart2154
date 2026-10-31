import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardHeader, PageHeader, Spinner, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { DISPATCH_LABEL, isNegativeQuantity } from '../lib/liveDisplay';
import { idempotencyKeyFor, type KeyedSubmission } from '../lib/entryRules';
import {
  buildDispatchBody,
  buildDispatchLines,
  dispatchDateProblem,
  exceedsRemaining,
  type DispatchHeaderDraft,
  type DispatchLineDraft,
} from '../lib/dispatchEntry';
import { hasPositiveQuantity } from '../lib/orderEntry';
import { invalidate, syncKeys, useSyncToken } from '../lib/syncStore';
import { useResource } from '../lib/useResource';
import { toast } from '../lib/toast';
import {
  createDispatch,
  getDispatchBalance,
  mayRecordDispatch,
  newIdempotencyKey,
  serverHost,
  ServerError,
  type ServerDispatchBalance,
  type ServerOrderLine,
} from '../lib/serverApi';

const BLANK_HEADER: DispatchHeaderDraft = {
  dispatchDate: '',
  vehicle: '',
  driver: '',
  driverPhone: '',
  transportName: '',
  notes: '',
};

/** The two states `POST /dispatches` refuses on the order itself (`_NOT_DISPATCHABLE` in
 *  `backend/app/services/dispatches.py`). Checked here so the desk is told before it types rather
 *  than after, and refused by the backend (`412 order_not_dispatchable`) whatever this screen
 *  renders — a draft has not been submitted and a cancelled order is finished, its earlier
 *  consignments kept rather than erased. */
const NOT_DISPATCHABLE = new Set(['draft', 'cancelled']);

/** Local calendar day, and the box starts on it. `toISOString()` is UTC, so a truck that left at
 *  11pm in India would otherwise be dated tomorrow before anyone typed anything. The field stays
 *  editable and the server has no default at all (`DispatchCreate.dispatch_date` is required): the
 *  desk is stating the day the goods left, and this is a starting point, not a silent value. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a remaining figure is exactly zero, decided on the text rather than by arithmetic: every
 *  digit of a `NUMERIC(14,3)` output is a zero. A negative is *not* "nothing left" — it is an
 *  over-dispatch already on the record, and it is said in its own words. */
function isZeroQuantity(text: string): boolean {
  const digits = text.replace(/[^\d]/g, '');
  return digits !== '' && !/[1-9]/.test(digits);
}

/** One line of the consignment being typed: what the order asked for, what has already gone, what is
 *  left, and the box for this trip.
 *
 *  The unit is not editable and there is no product picker, and both halves of that are the server's
 *  rule rather than a layout choice: a dispatch line is cut against an order line, its product is
 *  whatever that line was cut on, and a unit the order was not ordered in is a `422 unit_mismatch` —
 *  §8.1's prohibition on a total that adds MT to NOS, enforced by construction so this form cannot
 *  build one. What is typed is the quantity, and the batch and warehouse the goods went out under. */
function LineRow({
  line,
  typed,
  problem,
  onType,
}: {
  line: ServerOrderLine;
  typed: Partial<DispatchLineDraft>;
  problem: string | undefined;
  onType: (patch: Partial<DispatchLineDraft>) => void;
}) {
  const quantity = (typed.quantity ?? '').trim();
  const warning = quantity !== '' && exceedsRemaining(quantity, line.remainingQuantity);
  const nothingLeft = !isNegativeQuantity(line.remainingQuantity) && isZeroQuantity(line.remainingQuantity);

  return (
    <div className="grid gap-2 border-t border-line/60 py-2.5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-bold text-ink">
          {line.lineNo}. {line.productName || 'material with no name on the master'}
        </p>
        <p className="text-[10px] text-muted">
          ordered {line.orderedQuantity} {line.unit} • gone {line.dispatchedQuantity} {line.unit} •{' '}
          <span className={isNegativeQuantity(line.remainingQuantity) ? 'font-bold text-brand-red' : 'font-semibold'}>
            still to send {line.remainingQuantity} {line.unit}
          </span>
          {isNegativeQuantity(line.remainingQuantity) ? ' — already over-dispatched on the record' : ''}
        </p>
        {nothingLeft && quantity === '' && (
          <p className="text-[10px] text-faint">Every unit of this line has gone; leaving the box empty is correct.</p>
        )}
        {problem && <p className="text-[10px] font-semibold text-brand-red">{problem}</p>}
      </div>
      <div>
        <label className="label !text-[10px]">Quantity in {line.unit}</label>
        <input
          className="input !w-28 !py-1.5"
          inputMode="decimal"
          value={typed.quantity ?? ''}
          onChange={(e) => onType({ quantity: e.target.value })}
          placeholder="0.000"
        />
      </div>
      <div>
        <label className="label !text-[10px]">Batch</label>
        <input
          className="input !w-32 !py-1.5"
          maxLength={60}
          value={typed.batchNo ?? ''}
          onChange={(e) => onType({ batchNo: e.target.value })}
        />
      </div>
      <div>
        <label className="label !text-[10px]">Warehouse</label>
        <input
          className="input !w-32 !py-1.5"
          maxLength={60}
          value={typed.warehouse ?? ''}
          onChange={(e) => onType({ warehouse: e.target.value })}
        />
      </div>
      {warning && (
        <p className="text-[10px] font-semibold text-brand-red sm:col-span-4">
          More than the {line.remainingQuantity} {line.unit} the balance shows. The backend re-checks this against the
          order under a row lock when the request lands, so it may still be refused — another truck could have been
          recorded for this order in the last minute.
        </p>
      )}
    </div>
  );
}

/** Recording what actually left — one consignment against one order, `POST /dispatches`.
 *
 *  The form is loaded from `GET /orders/{id}/dispatch-balance` rather than from the order body,
 *  because those are the exact rows the server will compute the over-dispatch check against a moment
 *  later, under a lock on the order. A quantity box therefore sits beside a figure that was read for
 *  this purpose and is re-read after every consignment, instead of beside one cached from a
 *  different screen at an unknown time.
 *
 *  What the panel does **not** do is decide whether the consignment is allowed. The remaining figure
 *  is shown and an over-long quantity is warned about, but the warning is not a gate: over-dispatch
 *  is the server's `409 over_dispatch` (D-4), and two desks filling two part-load trucks for one
 *  order is precisely the case a client-side check cannot see. So the number goes out and the
 *  backend's own sentence comes back.
 *
 *  Nothing here is asked for that the decision register has not settled: there is no photograph
 *  field (D-9 stays undecided, and the server rejects the key as unknown), no delivery-status picker
 *  (a fresh consignment has not moved — that axis is the register's business), no way to send a
 *  product the order never carried, and no stock figure to adjust. Recording a delivery moves the
 *  order's dispatched quantities and nothing else: stock comes from the approved stock source, and
 *  the ledger is invoiced separately.
 *
 *  One `Idempotency-Key` per submission intent, held across a retry of the identical body and
 *  cleared only once an answer arrived, so a double click is one consignment and a failed send can
 *  be pressed again without a second truck being written. */
export default function DispatchNew() {
  const { orderId = '' } = useParams();
  const dispatchToken = useSyncToken(syncKeys.dispatch(orderId));
  const right = useResource(useCallback(() => mayRecordDispatch(), []));
  const balance = useResource(
    useCallback(() => getDispatchBalance(orderId), [orderId]),
    dispatchToken,
  );

  const [header, setHeader] = useState<DispatchHeaderDraft>({ ...BLANK_HEADER, dispatchDate: today() });
  const [typed, setTyped] = useState<Record<number, Partial<DispatchLineDraft>>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [showSlipModal, setShowSlipModal] = useState(false);
  const slot = useRef<KeyedSubmission | null>(null);

  const canRecord = right.state === 'ready' && right.data === true;
  const bal = balance.data;

  function type(orderLineId: number, patch: Partial<DispatchLineDraft>) {
    setTyped((current) => ({ ...current, [orderLineId]: { ...current[orderLineId], ...patch } }));
  }

  function submit(bal: ServerDispatchBalance) {
    if (busy) return;
    setFailure('');
    const drafts = bal.lines.map((line) => ({
      orderLineId: line.orderLineId,
      unit: line.unit,
      remainingQuantity: line.remainingQuantity,
      quantity: typed[line.orderLineId]?.quantity ?? '',
      batchNo: typed[line.orderLineId]?.batchNo ?? '',
      warehouse: typed[line.orderLineId]?.warehouse ?? '',
    }));
    const built = buildDispatchLines(drafts);
    const next: Record<string, string> = { ...built.problems };
    if (built.message !== '' && Object.keys(next).length === 0) next.lines = built.message;
    const dateProblem = dispatchDateProblem(header.dispatchDate);
    if (dateProblem) next.dispatchDate = dateProblem;
    setProblems(next);
    if (Object.keys(next).length > 0) return;

    const body = buildDispatchBody(bal.orderId, header, built.lines);
    const submission = idempotencyKeyFor(slot.current, { id: bal.orderId, body }, newIdempotencyKey);
    slot.current = submission;
    setBusy(true);
    createDispatch(body, submission.key)
      .then((created) => {
        // The key is cleared only now. A retry of a failed send is the same submission and the
        // server answers a replayed key with the answer it gave the first time.
        slot.current = null;
        setTyped({});
        setRecorded(created.number);
        toast.success(`${created.number} recorded — ${created.lines.length} line(s) against this order`);
        // The balance is the figure the next consignment will be typed against, so it is re-read
        // rather than adjusted from what was just sent. The same write stales the order's status
        // and the lists that show it, and those reads are on other screens.
        invalidate(syncKeys.dispatch(bal.orderId), syncKeys.order(bal.orderId), syncKeys.orderList());
      })
      .catch((cause) => {
        setFailure(
          cause instanceof ServerError
            ? cause.message
            : 'The backend did not answer, so no consignment was recorded. Pressing again sends what is in the boxes.',
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <div>
      <PageHeader
        title="Record a dispatch"
        subtitle={`A delivery record on ${serverHost()} — what actually left on a vehicle, not a stock movement`}
        actions={
          <Link to="/dispatch" className="btn-ghost">
            Back to the queue
          </Link>
        }
      />

      {balance.state === 'loading' && (
        <Card>
          <Spinner label="Reading what this order still owes…" />
        </Card>
      )}

      {balance.state === 'error' && (
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {balance.error}{' '}
            <button type="button" className="font-bold underline" onClick={balance.retry}>
              Try again
            </button>
          </p>
          <p className="mt-2 text-[11px] text-muted">
            The balance is what the over-dispatch check is computed against, so the form is not offered without it. A
            `404` here means the order is outside what this login may read: D-3’s capability widens the order and its
            balance to any submitted order, and nothing else — no ledger, no customer book.
          </p>
        </Card>
      )}

      {!canRecord && balance.state === 'ready' && (
        <Card className="mb-4">
          <p className="text-[12px] font-semibold text-ink">
            {right.state === 'loading'
              ? 'Asking the backend whether this login may record deliveries…'
              : right.state === 'error'
                ? `The backend could not answer whether this login may record deliveries (${right.error}).`
                : 'This login cannot record a dispatch.'}
          </p>
          {right.state === 'ready' && (
            <p className="mt-1.5 text-[11px] text-muted">
              The capability sits on the employee record and the owner grants it there; `POST /dispatches` answers `403`
              without it. What is below is the order’s balance, shown read-only — the figures do not change because the
              form is not offered.
            </p>
          )}
          {/* Asked, not assumed: the answer carries the moment it was true, and a desk waiting on the
              owner to grant the capability can re-ask it without a page reload. */}
          <div className="mt-2">
            <LiveSyncBar sync={right.sync} busy={right.state === 'loading'} />
          </div>
        </Card>
      )}

      {balance.state === 'ready' && bal && (
        <>
          <Card className="mb-4">
            <CardHeader
              title={bal.number ? `Order ${bal.number}` : 'Order with no printed number'}
              subtitle={`${bal.lines.length} line(s) — every quantity is the server’s decimal string, shown as sent`}
              actions={<LiveSyncBar sync={balance.sync} busy={false} />}
            />
            <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={bal.status} />
              <StatusBadge
                status={bal.dispatchStatus}
                label={DISPATCH_LABEL[bal.dispatchStatus] ?? bal.dispatchStatus}
              />
              {bal.customerName && (
                <span className="font-bold text-ink text-xs">Dealer: {bal.customerName}</span>
              )}
              {bal.salespersonName && (
                <span className="text-xs text-brand-blue font-semibold">👤 Booked by: {bal.salespersonName}</span>
              )}
              {bal.state && (
                <span className="chip bg-canvas text-muted text-[11px]">{bal.state}</span>
              )}
            </div>
            {NOT_DISPATCHABLE.has(bal.status) ? (
              <p className="text-[11px] font-semibold text-brand-red">
                A {bal.status} order is not on the dispatch queue: the backend refuses a delivery against it
                with `412 order_not_dispatchable`, so there is no form below. An order appears here once it is
                submitted, and an order the office cancelled keeps the consignments it already had.
              </p>
            ) : (
              <p className="text-[11px] text-muted">
                Still to send on at least one line:{' '}
                {bal.lines
                  .filter((l) => hasPositiveQuantity(l.remainingQuantity))
                  .map((l) => `${l.remainingQuantity} ${l.unit}`)
                  .join(' • ') || 'nothing — every line is finished or over'}
                .
              </p>
            )}
            {recorded !== '' && (
              <p className="mt-2 text-[11px] font-semibold text-brand-green">
                {recorded} recorded on the backend.{' '}
                <Link to={`/orders/${orderId}`} className="underline">
                  See it on the order
                </Link>
                , or in the{' '}
                <Link to="/dispatch/history" className="underline">
                  register
                </Link>
                .
              </p>
            )}
          </Card>

          {bal.slipImageData && (
            <Card className="mb-4 border border-brand-blue/30 bg-brand-blue/5">
              <CardHeader
                title="📸 Handwritten Order Slip Photo"
                subtitle="Cross-check physical slip / WhatsApp note while loading materials onto the truck."
                actions={
                  <button
                    type="button"
                    onClick={() => setShowSlipModal(true)}
                    className="btn-ghost btn-sm font-bold text-brand-blue"
                  >
                    🔍 Zoom Photo
                  </button>
                }
              />
              <div className="flex items-center gap-4 p-2">
                <img
                  src={bal.slipImageData}
                  alt="Order slip"
                  className="h-28 w-28 object-cover rounded-md border border-line shadow-sm cursor-pointer hover:opacity-90"
                  onClick={() => setShowSlipModal(true)}
                />
                <div>
                  <p className="text-xs font-semibold text-ink">Original Handwritten Slip Attached</p>
                  <p className="text-[11px] text-muted">
                    Uploaded during order booking. Click the preview to view full dimensions and verify item details.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSlipModal(true)}
                    className="mt-2 text-xs font-bold text-brand-blue hover:underline"
                  >
                    Click to view full size →
                  </button>
                </div>
              </div>
            </Card>
          )}

          {!NOT_DISPATCHABLE.has(bal.status) && canRecord && (
            <Card>
              <CardHeader
                title="What left"
                subtitle="The unit on each line is the one the order was cut in and cannot be changed here; a consignment in a different unit is refused as a mismatch. A blank box means the line is not on this truck."
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">
                    Date the goods left<span className="text-brand-red"> *</span>
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={header.dispatchDate}
                    onChange={(e) => setHeader({ ...header, dispatchDate: e.target.value })}
                  />
                  {problems.dispatchDate && (
                    <p className="mt-1 text-[11px] font-semibold text-brand-red">{problems.dispatchDate}</p>
                  )}
                  {!problems.dispatchDate && (
                    <p className="mt-1 text-[10px] text-faint">
                      Required, and started on today. Change it if the truck actually went on another day.
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Vehicle</label>
                  <input
                    className="input"
                    maxLength={40}
                    value={header.vehicle}
                    onChange={(e) => setHeader({ ...header, vehicle: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Driver</label>
                  <input
                    className="input"
                    maxLength={120}
                    value={header.driver}
                    onChange={(e) => setHeader({ ...header, driver: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Driver’s phone</label>
                  <input
                    className="input"
                    maxLength={20}
                    value={header.driverPhone}
                    onChange={(e) => setHeader({ ...header, driverPhone: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Transporter</label>
                  <input
                    className="input"
                    maxLength={120}
                    value={header.transportName}
                    onChange={(e) => setHeader({ ...header, transportName: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Notes</label>
                  <textarea
                    className="input resize-none"
                    rows={2}
                    maxLength={2000}
                    value={header.notes}
                    onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-4">
                {bal.lines.map((line) => (
                  <LineRow
                    key={line.orderLineId}
                    line={line}
                    typed={typed[line.orderLineId] ?? {}}
                    problem={problems[`lines.${line.orderLineId}.quantity`]}
                    onType={(patch) => type(line.orderLineId, patch)}
                  />
                ))}
                {problems.lines && (
                  <p className="border-t border-line/60 pt-2 text-[11px] font-semibold text-brand-red">
                    {problems.lines}
                  </p>
                )}
              </div>

              {failure !== '' && (
                <p className="mt-3 rounded-field bg-brand-red/10 px-3 py-2 text-[11px] font-bold text-brand-red">
                  {failure}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-md text-[10px] text-faint">
                  Recording this leaves the customer’s bill untouched and deducts no stock: a consignment is a delivery
                  fact, the ledger is invoiced separately, and the stock figures come from the owner’s approved stock
                  source. If a figure is wrong afterwards it is corrected by voiding this consignment and recording it
                  again — never by editing a quantity, which no route on this API accepts.
                </p>
                <div className="flex gap-2">
                  <Link to={`/orders/${orderId}`} className="btn-ghost">
                    Cancel
                  </Link>
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => submit(bal)}>
                    {busy ? 'Recording…' : 'Record the dispatch'}
                  </button>
                </div>
              </div>
            </Card>
          )}

          {!NOT_DISPATCHABLE.has(bal.status) && !canRecord && (
            <Card>
              <CardHeader title="What is still to send" subtitle="Read-only for this login." />
              {bal.lines.map((line) => (
                <div key={line.orderLineId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 py-2 first:border-t-0">
                  <p className="min-w-0 truncate text-[12px] font-bold text-ink">
                    {line.lineNo}. {line.productName || 'material with no name on the master'}
                  </p>
                  <p className="text-[11px] text-muted">
                    ordered {line.orderedQuantity} • gone {line.dispatchedQuantity} • still to send{' '}
                    <span className={isNegativeQuantity(line.remainingQuantity) ? 'font-bold text-brand-red' : 'font-semibold text-ink'}>
                      {line.remainingQuantity} {line.unit}
                    </span>
                  </p>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {showSlipModal && bal?.slipImageData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowSlipModal(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-xl bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
              <h3 className="text-sm font-bold text-ink">
                Handwritten Slip — Order {bal.number || bal.orderId}
              </h3>
              <button
                type="button"
                className="btn-ghost btn-sm !p-1 text-muted hover:text-ink font-bold"
                onClick={() => setShowSlipModal(false)}
              >
                ✕ Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto text-center">
              <img
                src={bal.slipImageData}
                alt="Full order slip"
                className="mx-auto max-h-[72vh] object-contain rounded border border-line"
              />
            </div>
            <div className="mt-3 flex justify-between items-center text-xs text-muted">
              <span>{bal.customerName ? `Dealer: ${bal.customerName}` : ''}</span>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setShowSlipModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
