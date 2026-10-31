/** The text-to-request rules for order entry, kept pure so `node --test` can load them.
 *
 *  Same reason `entryRules.ts` exists: a form is where typed text becomes a request body, and the
 *  two honest failures are sending something the server will refuse, or sending something
 *  *different* from what the person typed. Here that is the quantity, the unit, the rate and the
 *  GST percent on a material line — a `12.5` typed into a quantity box that leaves as `12.5 MT`
 *  is fine, and one that leaves as `12.500000000000002` is not.
 *
 *  No imports at all, including type-only ones: `scripts/entry-boundary-test.mjs` loads this file
 *  with type stripping and no bundler, and `serverApi.ts` reads `import.meta.env`, which is not
 *  Node. The line payload is therefore declared again below, structurally identical to
 *  `serverApi.OrderLineInput`; TypeScript's structural typing means the two are interchangeable
 *  without one file importing the other.
 */

/** One line as the operator typed it. Every field is a string because every field arrives from a
 *  text input: a quantity parsed into a `number` on the way in is where the digits go. */
export interface OrderLineDraft {
  /** `''` when the material is not a mapped SKU and the name was typed instead. */
  productId: string;
  productName: string;
  /** From the picked product, or chosen from the unit list for a typed material. Never guessed. */
  unit: string;
  quantity: string;
  /** Rupees as typed. Becomes integer paise through `entryRules.paiseFromRupees` at build time. */
  rateRupees: string;
  /** `''` means "no GST on this line"; `'0'` means the operator said zero. Different things. */
  gstPercent: string;
}

/** The wire shape of a line — mirrors `serverApi.OrderLineInput` field for field. */
export interface OrderLinePayload {
  productId?: string;
  productName?: string;
  quantity: string;
  unit: string;
  ratePaise: number;
  gstRatePercent?: string | null;
}

/** Units the business orders in, for a material that is not a mapped SKU. The server owns this
 *  vocabulary; the list is a picker, not a validation gate — an unknown unit is the server's
 *  `validation_error` to give, and it is shown rather than pre-empted here. */
export const ORDER_UNITS = ['MT', 'SHEET', 'KG', 'MTR'] as const;

const QUANTITY = /^(0|[1-9]\d*)(\.\d{1,6})?$/;
const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;

/** A decimal string the server will store as-is: plain digits, at most six decimal places, and
 *  greater than zero. Sent verbatim, never through a float. */
export function quantityProblem(text: string): string | null {
  const q = (text ?? '').trim();
  if (q === '') return 'Enter a quantity.';
  if (!QUANTITY.test(q)) return 'Enter a plain decimal quantity, up to six decimal places.';
  if (Number(q) <= 0) return 'The quantity must be greater than zero.';
  return null;
}

/** Optional GST percent: blank, or a whole/short decimal up to 99.99. */
export function gstProblem(text: string): string | null {
  const g = (text ?? '').trim();
  if (g === '') return null;
  if (!PERCENT.test(g)) return 'Enter the GST percent as a number like 5, 12 or 18.5, or leave it blank.';
  return null;
}

export function unitProblem(text: string): string | null {
  const u = (text ?? '').trim();
  return u === '' ? 'The line needs the unit the material is ordered in.' : null;
}

/** A line that is empty in every field is a row the operator added and did not fill in, not an
 *  order for nothing. `Add line` leaves one blank row so the next material has somewhere to go;
 *  the build drops those and refuses only when nothing is left. */
export function isBlankLine(line: OrderLineDraft): boolean {
  const noProduct = !line.productId?.trim() && !line.productName?.trim();
  const noQuantity = !line.quantity?.trim();
  const emptyDefaults =
    (!line.unit?.trim() || line.unit.trim() === 'MT') &&
    (!line.rateRupees?.trim() || line.rateRupees.trim() === '0') &&
    !line.gstPercent?.trim();
  return noProduct && noQuantity && emptyDefaults;
}

export interface BuildLinesResult {
  lines: OrderLinePayload[];
  /** Keyed `lines.<index>.<field>` — the same paths the form puts its messages on. */
  problems: Record<string, string>;
  message: string;
}

/** Turn the drafts into the payload, refusing anything the server would send back. `toPaise` is
 *  injected rather than imported so this file stays loadable by `node --test`; the page passes
 *  `entryRules.paiseFromRupees`, whose rules are already pinned. */
export function buildOrderLines(
  drafts: OrderLineDraft[],
  toPaise: (text: string) => { ok: true; paise: number } | { ok: false; reason: string },
): BuildLinesResult {
  const lines: OrderLinePayload[] = [];
  const problems: Record<string, string> = {};
  const kept: OrderLineDraft[] = [];

  drafts.forEach((draft) => {
    if (isBlankLine(draft)) return;
    const i = kept.length;
    kept.push(draft);
    const quantity = quantityProblem(draft.quantity);
    if (quantity) problems[`lines.${i}.quantity`] = quantity;
    const unit = unitProblem(draft.unit);
    if (unit) problems[`lines.${i}.unit`] = unit;
    const gst = gstProblem(draft.gstPercent);
    if (gst) problems[`lines.${i}.gstPercent`] = gst;
    if (!draft.productId.trim() && !draft.productName.trim()) {
      problems[`lines.${i}.productId`] = 'Pick a product, or type the material name below.';
    }
    const rate = toPaise(draft.rateRupees);
    if (!rate.ok) problems[`lines.${i}.rateRupees`] = rate.reason;
    if (quantity || unit || gst || !rate.ok) return;
    if (!draft.productId.trim() && !draft.productName.trim()) return;

    const productId = draft.productId.trim();
    const line: OrderLinePayload = {
      quantity: draft.quantity.trim(),
      unit: draft.unit.trim(),
      ratePaise: rate.paise,
    };
    if (productId) line.productId = productId;
    else line.productName = draft.productName.trim();
    const gstText = draft.gstPercent.trim();
    line.gstRatePercent = gstText === '' ? null : gstText;
    lines.push(line);
  });

  const message =
    Object.keys(problems).length === 0
      ? lines.length === 0
        ? 'An order needs at least one material line.'
        : ''
      : 'Some line needs fixing before it can be saved.';
  return { lines, problems, message };
}

/** Does this order carry any dispatched quantity? A decimal string comparison — no float maths: a
 *  value is zero exactly when every digit it holds is a zero. Used to decide when the server will
 *  demand a `reason` for a cancel, so the panel asks before the refusal instead of after. */
export function hasPositiveQuantity(quantity: string | null | undefined): boolean {
  const q = (quantity ?? '').trim();
  if (q === '') return false;
  if (q.startsWith('-')) return false;
  const digits = q.replace(/[^\d]/g, '');
  return /[1-9]/.test(digits);
}

/** A cancel the backend will only accept with a reason: an order that has already moved stock is
 *  owner-only and force-cancelled with a stated reason. */
export function cancelNeedsReason(order: {
  status?: string | null;
  dispatchedQuantity?: string | null;
}): boolean {
  if (hasPositiveQuantity(order.dispatchedQuantity)) return true;
  const status = order.status ?? '';
  return status === 'confirmed' || status === 'pendingDispatch' || status === 'dispatched' || status === 'completed';
}
