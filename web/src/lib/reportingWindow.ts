/** The reporting window and target-form rules that can be decided without a browser.
 *
 *  The server is the authority for every figure and every permission; nothing here divides a
 *  target or decides who may write one. What it does decide is the window a screen *asks* for and
 *  whether a typed target is even a number the API could accept — the two places where a panel
 *  mistake becomes a request the backend has to refuse, or worse, a figure nobody typed.
 *
 *  `monthWindow` builds a window from local calendar fields, not `toISOString()`: a date input is
 *  a calendar date, and trimming an ISO timestamp would move the first of a month to the last of
 *  the previous one east of UTC.
 *
 *  No imports and erasable TypeScript only: `node --test` loads this file directly, the same rule
 *  `entryRules.ts` and `dispatchEntry.ts` follow (`scripts/reporting-window-test.mjs`).
 */

export interface MonthWindow {
  from: string;
  to: string;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function isoDate(day: Date): string {
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The first and last calendar day of the month `day` falls in. */
export function monthWindow(day: Date): MonthWindow {
  return {
    from: isoDate(new Date(day.getFullYear(), day.getMonth(), 1)),
    to: isoDate(new Date(day.getFullYear(), day.getMonth() + 1, 0)),
  };
}

/** The first of the month `delta` months away — the input `monthWindow` expects. */
export function shiftMonth(day: Date, delta: number): Date {
  return new Date(day.getFullYear(), day.getMonth() + delta, 1);
}

/** A reversed window is refused here rather than sent: the inputs are the operator's, and a
 *  request whose end precedes its start is a question no server can answer. */
export function windowProblem(from: string, to: string): string {
  if (from !== '' && to !== '' && to < from) {
    return 'The window ends before it starts — choose an end date on or after the start.';
  }
  return '';
}

const QUANTITY_PATTERN = /^\d+(\.\d{1,3})?$/;

/** A typed quantity as the wire's fixed scale, or null when it is not one the column can hold.
 *  The same three-decimal shape the server's NUMERIC(14,3) keeps, so a saved target reads back
 *  as the figure that was entered instead of being rounded on the way in. */
export function normalizeQuantity(text: string): string | null {
  const trimmed = text.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${(fraction + '000').slice(0, 3)}`;
}

export function targetSourceLabel(source: 'targets' | 'legacy' | 'none'): string {
  if (source === 'targets') return 'Stored target';
  if (source === 'legacy') return 'Legacy monthly target — no stored row covers this window';
  return 'No target for this window';
}

export interface TargetDraft {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  productCategory: string;
  quantity: string;
  unit: string;
}

/** The first reason this draft is not a target the API would accept, in the order a form reads.
 *  Blank category is not a problem: it means the whole book, and the API spells that `null`. */
export function targetDraftProblem(draft: TargetDraft): string {
  if (draft.employeeId.trim() === '') return 'Choose the salesperson this target is for.';
  if (draft.periodStart === '' || draft.periodEnd === '') return 'A target needs both a start and an end date.';
  if (draft.periodEnd < draft.periodStart) return 'The period ends before it starts.';
  if (normalizeQuantity(draft.quantity) === null) {
    return 'The target quantity is a non-negative number with at most three decimals.';
  }
  if (draft.unit.trim() === '') return 'A quantity with no unit cannot be compared with an achievement.';
  return '';
}
