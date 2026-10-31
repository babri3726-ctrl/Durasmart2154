/** The text-to-request rules for the two dispatch forms the owner and the desk fill in, kept pure so
 *  `node --test` can load them: recording a delivery, and the switch that decides who may.
 *
 *  Same reason `entryRules.ts` and `orderEntry.ts` exist: a form is where typed text becomes a
 *  request body, and the two honest failures are sending something the server will refuse, or
 *  sending something *different* from what the person typed. On this screen the second one has a
 *  specific shape — a quantity that leaves with more decimals than `NUMERIC(14,3)` holds gets
 *  rounded on its way into the column, so the delivery record would say a figure nobody typed.
 *
 *  What this file deliberately does **not** do is decide whether a consignment is allowed. The
 *  remaining quantity beside each line is read from `GET /orders/{id}/dispatch-balance` and shown,
 *  but no rule here stops a bigger number being sent: over-dispatch is the server's `409
 *  over_dispatch` (D-4), computed under a row lock on the order from the same view, because two
 *  desks filling two part-load trucks for one order is the case a client-side check cannot see.
 *  The panel warns; the backend decides. A local gate would only make a screen that disagrees with
 *  the ledger.
 *
 *  No imports except from the pure `orderEntry.ts` (which has none itself), because
 *  `serverApi.ts` reads `import.meta.env` and is not loadable by `node --test`. The payload
 *  interfaces below are therefore restated — structurally identical to the `serverApi` types, which
 *  TypeScript accepts interchangeably.
 */

import { hasPositiveQuantity } from './orderEntry.ts';

/** One line of the consignment as it was typed. `orderLineId` and `unit` are not typed at all:
 *  they come off the balance row the screen loaded, and they travel with the quantity so the two
 *  cannot be separated by a re-render. */
export interface DispatchLineDraft {
  orderLineId: number;
  /** The unit the order line was cut in. Sent verbatim — a dispatch line in a unit the order was
   *  not ordered in is the server's `422 unit_mismatch`, and the picker gives no way to cause one. */
  unit: string;
  /** The server's decimal string, shown next to the box. Never arithmetic. */
  remainingQuantity: string;
  quantity: string;
  batchNo: string;
  warehouse: string;
}

/** The consignment's own header. `dispatchDate` is required and typed, not defaulted by the
 *  server: a delivery record says goods left on a date, and the desk knows which date that was. */
export interface DispatchHeaderDraft {
  dispatchDate: string;
  vehicle: string;
  driver: string;
  driverPhone: string;
  transportName: string;
  notes: string;
}

/** `POST /dispatches` as it leaves the browser. Mirrors `serverApi.DispatchCreateBody`. */
export interface DispatchCreatePayload {
  orderId: string;
  dispatchDate: string;
  vehicle?: string;
  driver?: string;
  driverPhone?: string;
  transportName?: string;
  notes?: string;
  lines: DispatchLinePayload[];
}

export interface DispatchLinePayload {
  orderLineId: number;
  quantity: string;
  unit: string;
  batchNo?: string;
  warehouse?: string;
}

/** `PATCH /dispatches/{id}` — only the fields that actually changed, plus the reason. Mirrors
 *  `serverApi.DispatchPatchBody` with `reason` left out: this function answers "what moved", and
 *  the page supplies the why. Sending a field that already holds that value would be a change the
 *  audit row describes as nothing. */
export type DispatchFieldChanges = Partial<DispatchHeaderDraft>;

/** `YYYY-MM-DD`, and not before 1990 — the same floor `DispatchCreate.dispatch_date` types
 *  (`Field(ge=date(1990, 1, 1))`), because a dropped leading digit reads `0180-01-01` and lands in
 *  a period nobody is asking about. An ISO date compares correctly as text, so no `Date` parse and
 *  no timezone is involved in the comparison. */
export function dispatchDateProblem(text: string): string | null {
  const d = (text ?? '').trim();
  if (d === '') return 'Enter the date the goods left, as YYYY-MM-DD.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Enter the date as YYYY-MM-DD.';
  if (d < '1990-01-01') return 'That date is too early to be a delivery date — check for a dropped digit.';
  return null;
}

/** The quantity, exactly as the column can hold it: plain digits, at most three decimal places and
 *  at most eleven whole ones (`NUMERIC(14,3)`), and greater than zero. Stricter than
 *  `orderEntry.quantityProblem`, which allows six decimals, and both halves of that are deliberate:
 *  a finer figure is rounded on its way into the column by `money.to_quantity`, so a delivery record
 *  would say a number nobody typed, and a wider figure is not rounded but refused by PostgreSQL as a
 *  field overflow — an error with no field name in it. Neither is a thing to discover after the
 *  truck has gone. `422 quantity_not_positive` is the server's sentence for the zero and negative
 *  half, which is a business rule (D-4) rather than a column limit and so stays the server's. */
export function dispatchQuantityProblem(text: string): string | null {
  const q = (text ?? '').trim();
  if (q === '') return null;
  const shape = /^(0|[1-9]\d*)(\.\d{1,3})?$/.exec(q);
  if (!shape) {
    return 'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.';
  }
  if (shape[1].length > 11) {
    return 'That is more whole units than this column can hold (11 digits before the point). Check for a paste that brought the wrong figure.';
  }
  if (!hasPositiveQuantity(q)) {
    return 'A line with nothing on it is not a dispatch. Leave the box empty, or send a quantity above zero.';
  }
  return null;
}

export interface BuildDispatchResult {
  lines: DispatchLinePayload[];
  /** Keyed `lines.<index>.quantity`, the same shape `buildOrderLines` uses. */
  problems: Record<string, string>;
  message: string;
}

/** Turn the typed rows into the body's lines. A blank quantity means "this line is not on this
 *  truck", and a part-consignment is exactly that on most trips, so blanks are dropped rather than
 *  refused — the server requires at least one line (`min_length=1`), and this says so when nothing
 *  was filled in. A row with a quantity that will not validate is a problem, never a silent drop:
 *  dropping a half-typed line is how a truck leaves the yard one crate short. */
export function buildDispatchLines(drafts: DispatchLineDraft[]): BuildDispatchResult {
  const lines: DispatchLinePayload[] = [];
  const problems: Record<string, string> = {};

  drafts.forEach((draft) => {
    const quantity = (draft.quantity ?? '').trim();
    const batchNo = (draft.batchNo ?? '').trim();
    const warehouse = (draft.warehouse ?? '').trim();
    if (quantity === '' && batchNo === '' && warehouse === '') return;
    if (quantity === '') {
      // Batch or warehouse typed on a line with no quantity: the desk meant this line and the
      // number is missing. Dropping it would send a truck one crate short of what the desk filled in.
      problems[`lines.${draft.orderLineId}.quantity`] =
        'This line has batch or warehouse details but no quantity. Enter how much left, or clear the line.';
      return;
    }
    const problem = dispatchQuantityProblem(quantity);
    if (problem) {
      problems[`lines.${draft.orderLineId}.quantity`] = problem;
      return;
    }
    const line: DispatchLinePayload = {
      orderLineId: draft.orderLineId,
      quantity,
      unit: draft.unit,
    };
    if (batchNo !== '') line.batchNo = batchNo;
    if (warehouse !== '') line.warehouse = warehouse;
    lines.push(line);
  });

  const message =
    Object.keys(problems).length === 0
      ? lines.length === 0
        ? 'Nothing is filled in. A consignment needs at least one line with a quantity.'
        : ''
      : 'Some quantity needs fixing before this can be recorded.';
  return { lines, problems, message };
}

/** The create body, assembled from the header and the built lines. Optional text is sent only when
 *  it holds something, so the stored row does not carry a field the desk never looked at. */
export function buildDispatchBody(
  orderId: string,
  header: DispatchHeaderDraft,
  lines: DispatchLinePayload[],
): DispatchCreatePayload {
  const body: DispatchCreatePayload = {
    orderId,
    dispatchDate: header.dispatchDate.trim(),
    lines,
  };
  (
    [
      ['vehicle', header.vehicle],
      ['driver', header.driver],
      ['driverPhone', header.driverPhone],
      ['transportName', header.transportName],
      ['notes', header.notes],
    ] as const
  ).forEach(([field, text]) => {
    const value = text.trim();
    if (value !== '') body[field] = value;
  });
  return body;
}

/** Is this typed quantity more than the balance row says is left? Exact decimal-string comparison —
 *  padded to the column's three places and read as an integer count of thousandths, never through a
 *  float, because `12.3456` and a float multiply are how a screen ends up disagreeing with a ledger.
 *
 *  This drives a **warning on the form and nothing else**. It is not a gate: over-dispatch is the
 *  server's `409 over_dispatch` under a row lock (§3.3, D-4), and the figure the desk was shown a
 *  minute ago is not the figure the server will read when the request lands — two part-load trucks
 *  for one order is exactly the case a client cannot see. A `false` here therefore means "this has
 *  not been refused yet", never "this will be accepted". */
export function exceedsRemaining(quantity: string, remainingQuantity: string): boolean {
  const typed = toTicks(quantity);
  if (typed === null) return false;
  const left = toTicks(remainingQuantity);
  if (left === null) return false;
  return typed > left;
}

/** `NUMERIC(14,3)` as an integer count of thousandths. `null` for anything the column could not
 *  hold, including a negative — and a negative *remaining* figure is a real state of the row (an
 *  over-dispatch already on record), so callers treat `null` as "no comparison to make" rather than
 *  as zero. */
function toTicks(text: string): bigint | null {
  const m = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/.exec((text ?? '').trim());
  if (!m) return null;
  return BigInt(m[1] + (m[2] ?? '').padEnd(3, '0'));
}

/** What the operator changed on a consignment's paperwork. Only the fields whose trimmed text
 *  differs from the row as read go out, because the server refuses a patch that changes nothing
 *  (`nothing_to_update`) and because `reason` belongs with a change rather than with a click.
 *  `dispatchDate` is compared as the ISO text it is. */
export function headerChanges(
  before: DispatchHeaderDraft,
  after: DispatchHeaderDraft,
): DispatchFieldChanges {
  const changed: DispatchFieldChanges = {};
  (
    ['dispatchDate', 'vehicle', 'driver', 'driverPhone', 'transportName', 'notes'] as const
  ).forEach((field) => {
    if ((before[field] ?? '').trim() !== (after[field] ?? '').trim()) changed[field] = after[field].trim();
  });
  return changed;
}

/** The owner's dispatch-capability switch (`POST /employees/{id}/dispatch-capability`), same rule
 *  as above: what the backend will accept as a body, and what it will refuse before the row moves.
 *
 *  Only the reason is decided here, and only because the server decided it first — `reason` is
 *  required and trimmed to a maximum of 1900 characters. Whether this *person* may be granted the
 *  capability is not a client question at all: the route is owner-only on the server, and the flag
 *  is re-read off the employee row on every following dispatch request. Nothing below is an
 *  authority, and a screen that guessed wrong can only ever be refused. */
export const CAPABILITY_REASON_LIMIT = 1900;

export function capabilityReasonProblem(reason: string): string | null {
  const why = (reason ?? '').trim();
  if (why === '') return 'Say why in the reason box. The backend refuses a change to the capability without one.';
  if (why.length > CAPABILITY_REASON_LIMIT) {
    return `That reason is longer than the backend accepts (${CAPABILITY_REASON_LIMIT} characters).`;
  }
  return null;
}

/** The body as the server wants it, with the reason trimmed for the same reason `headerChanges`
 *  trims: the audit row should hold what the owner meant to say, not what the box happened to keep
 *  around it. */
export function buildCapabilityBody(requested: boolean, reason: string): { mayDispatch: boolean; reason: string } {
  return { mayDispatch: requested, reason: (reason ?? '').trim() };
}
