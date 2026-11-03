import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from './ui/Card';
import { Modal } from './ui/Overlays';
import { fmtDateTime } from '../lib/format';
import { DELIVERY_LABEL } from '../lib/liveDisplay';
import { toast } from '../lib/toast';
import { headerChanges, type DispatchHeaderDraft } from '../lib/dispatchEntry';
import { idempotencyKeyFor, type KeyedSubmission } from '../lib/entryRules';
import {
  newIdempotencyKey,
  patchDispatch,
  reviewDispatch,
  setDeliveryStatus,
  voidDispatch,
  ServerError,
  type DeliveryStatus,
  type ServerDispatch,
  type ServerDispatchDetail,
} from '../lib/serverApi';

/** The consignment rows, shared by the dispatch register and the order screen.
 *
 *  One component because the three things a desk may do to a delivery — move it along the road,
 *  correct its paperwork, void it — are the same three on both screens, and a copy of the rules in
 *  each is how the two start refusing different things.
 *
 *  What is *decided* here is nothing. A wrong delivered figure is not editable: `PATCH
 *  /dispatches/{id}` takes the paperwork fields and no quantity, because §3.4 makes a quantity
 *  correction a void plus a fresh consignment so that both figures stay on the record, and the void
 *  is the owner's route alone — D-3's approval covers *correcting* and says expressly it does not
 *  reach *reversing*. Buttons are not the gate: the server re-reads the capability off the employee
 *  row on every call and answers a login it does not authorise with its own `403` / `404` / `409`,
 *  shown here as the backend phrased it. The only thing the flags below change is whether a known
 *  dead end is offered as something to click.
 *
 *  Each row carries its own `version` out as `If-Match`, so a correction written against a
 *  consignment somebody else has already moved is a `409 version_conflict` the desk reads instead
 *  of an overwrite. One `Idempotency-Key` per action per row, kept after a failure and cleared after
 *  a success: pressing the same button twice is one move, and the retry of an identical body is the
 *  same submission. Nothing here touches stock — a consignment is a delivery fact, and the stock
 *  figures come from the approved stock source (D-7). */

const toDraft = (row: ServerDispatch): DispatchHeaderDraft => ({
  dispatchDate: row.dispatchDate,
  vehicle: row.vehicle,
  driver: row.driver,
  driverPhone: row.driverPhone,
  transportName: row.transportName,
  notes: row.notes,
});

const emptyDraft: DispatchHeaderDraft = {
  dispatchDate: '',
  vehicle: '',
  driver: '',
  driverPhone: '',
  transportName: '',
  notes: '',
};

/** The three targets the delivery route accepts. `pending` is absent because it is what a fresh
 *  consignment already is, and a route that could set it backwards would be a way to un-send a
 *  truck by re-labelling it — `DeliveryStatusChange.to` is a `Literal` of exactly these three. */
const DELIVERY_TARGETS: { to: Exclude<DeliveryStatus, 'pending'>; label: string }[] = [
  { to: 'inTransit', label: 'Put in transit' },
  { to: 'partial', label: 'Mark part-delivered' },
  { to: 'delivered', label: 'Mark delivered' },
];

type Action = 'patch' | 'void' | 'review' | Exclude<DeliveryStatus, 'pending'>;

/** What a successful write is worth saying, in the words the answer supports. */
function doneLabel(action: Action, row: ServerDispatchDetail): string {
  if (action === 'patch') return 'the paperwork was corrected on the backend';
  if (action === 'void') return 'voided on the backend — its quantity is back on the order';
  if (action === 'review') return 'reviewed — from now on the owner alone may correct its paperwork';
  return `now ${DELIVERY_LABEL[row.deliveryStatus] ?? row.deliveryStatus}`;
}

function ConsignmentRow({
  row,
  canRecord,
  isOwner,
  userId,
  onChanged,
}: {
  row: ServerDispatch;
  canRecord: boolean;
  isOwner: boolean;
  userId: string | null;
  onChanged: (orderId?: string) => void;
}) {
  const [busy, setBusy] = useState<'' | Action>('');
  const [error, setError] = useState('');
  const [correctOpen, setCorrectOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draft, setDraft] = useState<DispatchHeaderDraft>(emptyDraft);
  const [lineWeights, setLineWeights] = useState<Record<string | number, string>>({});
  const [reason, setReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const keys = useRef<Record<string, KeyedSubmission | null>>({});

  const voided = row.voidedAt !== null;
  const reviewed = row.reviewedAt !== null;
  // §4's "their own, owner always", read off the row rather than guessed at. N-2 narrows the
  // operator half after review: the recorder may correct until the owner stamps it, and after
  // that only the owner may. The server enforces exactly this and answers a stranger's
  // consignment with `404` rather than `403` — a scoped miss must not confirm the id exists — so
  // this line only decides whether to offer a button that is known to be refused.
  const mayCorrect = isOwner || (userId !== null && row.createdBy === userId && !reviewed);
  const changes = correctOpen ? headerChanges(toDraft(row), draft) : {};

  const linesList = ((row as unknown as { lines?: Array<{ dispatchLineId?: number; lineNo?: number; quantity: string; unit?: string; productName?: string; product?: string }> }).lines) || [];
  const changedLines = linesList.map((l) => {
    const key = l.dispatchLineId ?? l.lineNo ?? 1;
    return {
      dispatchLineId: l.dispatchLineId ?? l.lineNo ?? 1,
      quantity: lineWeights[key] ?? l.quantity,
      unit: l.unit ?? 'MT',
    };
  }).filter((l) => {
    const orig = linesList.find((x) => (x.dispatchLineId ?? x.lineNo ?? 1) === l.dispatchLineId)?.quantity;
    return orig !== undefined && l.quantity !== orig && l.quantity.trim() !== '';
  });

  const changedCount = Object.keys(changes).length + changedLines.length;

  /** The one call site for all three actions, so the failure handling cannot drift between them:
   *  the server's sentence on screen, the key kept for a retry of the same body, a success clearing
   *  it and re-reading the row, and a version conflict re-reading rather than retrying blind.
   *  `onDone` runs only after an answer arrived — a modal that closes on a refused write would hide
   *  the refusal. */
  async function act(
    action: Action,
    payload: unknown,
    send: (key: string) => Promise<ServerDispatchDetail>,
    onDone?: () => void,
  ) {
    if (busy !== '') return;
    setBusy(action);
    setError('');
    const submission = idempotencyKeyFor(keys.current[action] ?? null, { id: row.id, payload }, newIdempotencyKey);
    keys.current[action] = submission;
    try {
      const answer = await send(submission.key);
      keys.current[action] = null;
      toast.success(`${answer.number} — ${doneLabel(action, answer)}`);
      onDone?.();
      onChanged(row.orderId);
    } catch (cause) {
      setError(
        cause instanceof ServerError
          ? cause.message
          : 'The backend did not answer, so nothing on this consignment changed.',
      );
      if (cause instanceof ServerError && cause.code === 'version_conflict') onChanged(row.orderId);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="border-b border-line/60 px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink">
            {row.number} <span className="font-semibold text-muted">• {row.customerName}</span>
          </p>
          <p className="text-[10px] text-muted">
            <Link to={`/orders/${row.orderId}`} className="font-bold text-brand-blue hover:underline">
              {row.orderNumber ?? 'order with no printed number'}
            </Link>{' '}
            • left {row.dispatchDate} • {row.lineCount} line{row.lineCount === 1 ? '' : 's'}
            {row.vehicle ? ` • ${row.vehicle}` : ''}
            {row.driver ? ` • ${row.driver}` : ''}
          </p>
          {row.transportName && <p className="text-[10px] text-muted">Transporter: {row.transportName}</p>}
          {row.notes && <p className="text-[10px] text-faint">Note: {row.notes}</p>}
          <p className="mt-0.5 text-[10px] text-faint">
            recorded by {row.createdByName ?? 'a login no longer on the staff book'} • source {row.source}
            {row.deliveredAt ? ` • delivered ${row.deliveredAt.slice(0, 10)}` : ''}
          </p>
        </div>
        {voided ? (
          <StatusBadge status="cancelled" label="voided" />
        ) : (
          <StatusBadge
            status={row.deliveryStatus}
            label={DELIVERY_LABEL[row.deliveryStatus] ?? row.deliveryStatus}
          />
        )}
      </div>

      {voided && (
        <p className="mt-1 text-[10px] text-muted">
          Voided {row.voidedAt?.slice(0, 10)} by {row.voidedByName ?? 'the owner'} — its quantity is back on the
          order and the row stays here with its stamp. Nothing is deleted, and a second void is refused.
        </p>
      )}

      {reviewed && (
        <p className="mt-1 text-[10px] text-muted">
          Reviewed {row.reviewedAt ? fmtDateTime(row.reviewedAt) : ''} by {row.reviewedByName ?? 'the owner'} — the
          correction window is closed; only the owner may correct the paperwork now. The delivery axis and the
          owner-only void rule are unchanged.
        </p>
      )}

      {canRecord && !voided && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {DELIVERY_TARGETS.filter((t) => t.to !== row.deliveryStatus).map((t) => (
            <button
              key={t.to}
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy !== ''}
              onClick={() => void act(t.to, { to: t.to }, (key) => setDeliveryStatus(row.id, t.to, key, row.version))}
            >
              {busy === t.to ? 'Working…' : t.label}
            </button>
          ))}
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy !== '' || !mayCorrect}
            onClick={() => {
              setDraft(toDraft(row));
              setReason('');
              setCorrectOpen(true);
            }}
          >
            Correct paperwork
          </button>
          {isOwner && !reviewed && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy !== ''}
              onClick={() => {
                setReviewNote('');
                setReviewOpen(true);
              }}
            >
              Review
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              className="btn-danger btn-sm"
              disabled={busy !== ''}
              onClick={() => {
                setVoidReason('');
                setVoidOpen(true);
              }}
            >
              Void
            </button>
          )}
          {!mayCorrect && (
            <span className="text-[10px] text-faint">
              {reviewed && !isOwner
                ? 'This consignment has been reviewed; only the owner may correct its paperwork now.'
                : `Only ${row.createdByName ?? 'the login that recorded it'}, or the owner, may correct this consignment’s paperwork.`}
            </span>
          )}
          {!isOwner && (
            <span className="text-[10px] text-faint">
              Voiding a delivery is the owner’s decision — the backend refuses it for this session, so it is not
              offered here.
            </span>
          )}
        </div>
      )}

      {!canRecord && (
        <p className="mt-1 text-[10px] text-faint">
          This login does not hold the dispatch capability, so the delivery axis is read here and not written; the
          backend refuses a write whatever the screen shows.
        </p>
      )}

      {error !== '' && (
        <p className="mt-1.5 rounded-field bg-brand-red/10 px-3 py-1.5 text-[11px] font-bold text-brand-red">
          {error}
        </p>
      )}

      <Modal open={correctOpen} onClose={() => setCorrectOpen(false)} title={`Correct ${row.number}`}>
        <p className="text-[11px] text-muted">
          Correct dispatch details or adjust consignment item weights. Weight changes automatically adjust salesperson dispatch targets.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Date the goods left</label>
            <input
              type="date"
              className="input"
              value={draft.dispatchDate}
              onChange={(e) => setDraft({ ...draft, dispatchDate: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Vehicle</label>
            <input
              className="input"
              maxLength={40}
              value={draft.vehicle}
              onChange={(e) => setDraft({ ...draft, vehicle: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Driver</label>
            <input
              className="input"
              maxLength={120}
              value={draft.driver}
              onChange={(e) => setDraft({ ...draft, driver: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Driver’s phone</label>
            <input
              className="input"
              maxLength={20}
              value={draft.driverPhone}
              onChange={(e) => setDraft({ ...draft, driverPhone: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Transporter</label>
            <input
              className="input"
              maxLength={120}
              value={draft.transportName}
              onChange={(e) => setDraft({ ...draft, transportName: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={2}
              maxLength={2000}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </div>

        {linesList.length > 0 && (
          <div className="mt-3 rounded-card border border-edge/60 bg-surface/50 p-3">
            <label className="label text-[11px] font-bold text-ink">Consignment Line Weights (MT/kg)</label>
            <p className="mb-2 text-[10px] text-muted">Editing line weight automatically adjusts salesperson dispatch targets.</p>
            <div className="space-y-2">
              {linesList.map((l) => {
                const key = l.dispatchLineId ?? l.lineNo ?? 1;
                const pName = l.productName || l.product || `Line #${key}`;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-ink font-medium max-w-[200px]">{pName}</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        className="input w-24 py-1 text-right text-xs"
                        value={lineWeights[key] ?? l.quantity}
                        onChange={(e) => setLineWeights({ ...lineWeights, [key]: e.target.value })}
                      />
                      <span className="text-[11px] text-muted">{l.unit || 'MT'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <label className="label mt-4">
          Reason<span className="text-brand-red"> *</span>
        </label>
        <textarea
          className="input resize-none"
          rows={2}
          maxLength={1900}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this paperwork or weight being corrected? It goes into the audit row with your name."
        />
        <p className="mt-2 text-[10px] text-faint">
          {changedCount === 0
            ? 'Nothing has been changed yet — the backend refuses a correction that changes no field.'
            : `${changedCount} field(s) will change, and the reason is recorded with them.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => setCorrectOpen(false)}>
            Keep it as it is
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== '' || changedCount === 0 || reason.trim() === ''}
            onClick={() => {
              const body = {
                ...changes,
                ...(changedLines.length > 0 ? { lines: changedLines } : {}),
                reason: reason.trim(),
              };
              void act('patch', body, (key) => patchDispatch(row.id, body, key, row.version), () => {
                setCorrectOpen(false);
                setReason('');
                setDraft(emptyDraft);
                setLineWeights({});
              });
            }}
          >
            {busy === 'patch' ? 'Working…' : 'Save the correction'}
          </button>
        </div>
      </Modal>

      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title={`Void ${row.number}`}>
        <p className="text-sm text-ink">
          {row.lineCount} line(s) against {row.orderNumber ?? 'an order with no printed number'} for{' '}
          {row.customerName}, dated {row.dispatchDate}.
        </p>
        <p className="mt-1 text-[11px] text-muted">
          The quantity comes back to the order and the row stays in the register carrying this reason and your name.
          Nothing is deleted, and no stock figure moves. If the figures were wrong, record the consignment again
          afterwards.
        </p>
        <label className="label mt-3">
          Reason<span className="text-brand-red"> *</span>
        </label>
        <textarea
          className="input resize-none"
          rows={3}
          maxLength={1900}
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Why is this consignment being taken off the board?"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => setVoidOpen(false)}>
            Keep the consignment
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={busy !== '' || voidReason.trim() === ''}
            onClick={() => {
              const why = voidReason.trim();
              void act('void', { reason: why }, (key) => voidDispatch(row.id, why, key, row.version), () => {
                setVoidOpen(false);
                setVoidReason('');
              });
            }}
          >
            {busy === 'void' ? 'Working…' : 'Void the consignment'}
          </button>
        </div>
      </Modal>

      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title={`Review ${row.number}`}>
        <p className="text-sm text-ink">
          Closing the correction window on the consignment against{' '}
          {row.orderNumber ?? 'an order with no printed number'} for {row.customerName}.
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Until this stamp the recorder or the owner may correct the paperwork. Afterwards only the owner may. The
          delivery axis and the owner-only void rule are unchanged, no quantity moves, and the parent order's version
          does not change. A second review is refused, and the row stays in the register with your name and the time.
        </p>
        <label className="label mt-3">Note (optional)</label>
        <textarea
          className="input resize-none"
          rows={2}
          maxLength={500}
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="Anything the audit row should carry with this review."
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => setReviewOpen(false)}>
            Keep it unreviewed
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== ''}
            onClick={() => {
              const noted = reviewNote.trim();
              void act('review', { note: noted }, (key) => reviewDispatch(row.id, noted, key, row.version), () => {
                setReviewOpen(false);
                setReviewNote('');
              });
            }}
          >
            {busy === 'review' ? 'Working…' : 'Review the consignment'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** The bordered list both dispatch screens use — the rows the backend sent, in the order it sent
 *  them (newest consignment first), and no client-side re-sorting. */
export function ConsignmentList({
  rows,
  canRecord,
  isOwner,
  userId,
  onChanged,
  emptyMessage,
}: {
  rows: ServerDispatch[];
  canRecord: boolean;
  isOwner: boolean;
  userId: string | null;
  onChanged: (orderId?: string) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted">{emptyMessage}</p>;
  return (
    <div className="overflow-hidden rounded-field border border-line">
      {rows.map((row) => (
        <ConsignmentRow
          key={row.id}
          row={row}
          canRecord={canRecord}
          isOwner={isOwner}
          userId={userId}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
