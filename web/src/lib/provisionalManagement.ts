/** The management screen's decisions and wording, kept out of the page and the transport.
 *
 *  Deliberately **import-free**, like `provisionalSync.ts`: `node --test` loads this module with
 *  type stripping, so `scripts/provisional-management-contract-test.mjs` can drive the rupee
 *  parser, the edit gate and the assignment eligibility with no browser and no backend.
 *
 *  Four rules live here rather than in JSX:
 *
 *  1. **Money is integer paise at the edge.** The owner types rupees with at most two decimals;
 *     `parsePaiseInput` is the only place that text becomes a number, and it refuses a third
 *     decimal, a sign, an exponent or a blank rather than rounding. The server also refuses
 *     malformed amounts — this parser keeps the dialog from sending one in the first place.
 *  2. **A balance change needs a reason.** `evaluateEdit` compares the draft with the row's
 *     effective values and says whether the reason field is required. A rename alone is not a
 *     balance change; a reset to the imported value is still a change to the effective side.
 *  3. **Edited and imported are different facts.** `nameManuallyEdited`/`amountsManuallyEdited`
 *     are what the screen shows; an edit that returns a value to exactly the imported side ends
 *     the difference. Nothing here compares original and effective and calls the result "edited".
 *  4. **An assignment is an employee, not a new account.** Eligibility is the existing
 *     `employee.active` flag; an inactive person is shown but not offered, and the server refuses
 *     the same id even if a stale screen sent it.
 */

export const PROVISIONAL_LABEL = 'PROVISIONAL — NOT VERIFIED TALLY IDENTITIES';
export const PROVISIONAL_AS_OF = '2026-04-01';
export const PROVISIONAL_SOURCE_PERIOD = '1-Apr-26 to 31-Oct-26';
export const PROVISIONAL_PERIOD_WARNING =
  `The source workbook's reporting period is ${PROVISIONAL_SOURCE_PERIOD}. ` +
  `${PROVISIONAL_AS_OF} is the owner-selected provisional balance date — the workbook does not ` +
  'independently verify a balance on that day, and no record here is a verified Tally identity.';

export const UNASSIGNED_FILTER = 'unassigned';

export type ProvisionalArchiveView = 'active' | 'archived' | 'all';

export interface ProvisionalManagementFiltersView {
  q: string;
  salespersonId: string;
  reviewed: '' | 'reviewed' | 'unreviewed';
  archived: ProvisionalArchiveView;
  conflictOnly: boolean;
}

export const EMPTY_MANAGEMENT_FILTERS: ProvisionalManagementFiltersView = {
  q: '',
  salespersonId: '',
  reviewed: '',
  archived: 'active',
  conflictOnly: false,
};

/** Translate the screen's controls into the list route's query names. Omitted controls are omitted
 *  from the object, so the transport sends the server's default rather than an invented `false`. */
export function managementFilterParams(filters: ProvisionalManagementFiltersView): {
  q?: string;
  salespersonId?: string;
  reviewed?: boolean;
  archived: ProvisionalArchiveView;
  hasConflict?: boolean;
} {
  return {
    q: filters.q.trim() || undefined,
    salespersonId: filters.salespersonId || undefined,
    reviewed:
      filters.reviewed === 'reviewed' ? true : filters.reviewed === 'unreviewed' ? false : undefined,
    archived: filters.archived,
    hasConflict: filters.conflictOnly ? true : undefined,
  };
}

// ── money text ↔ integer paise ───────────────────────────────────────────

export interface PaiseParseOk {
  ok: true;
  paise: number;
}

export interface PaiseParseError {
  ok: false;
  error: string;
}

export type PaiseParse = PaiseParseOk | PaiseParseError;

const RUPEE_TEXT = /^\d+(?:\.\d{1,2})?$/;

/** Strict rupees-to-paise conversion for an input field.
 *
 *  Accepts `1300`, `1300.7`, `1,300.75` and a leading `₹`; refuses a negative, a third decimal,
 *  exponent notation, a blank, and anything whose paise value is not a safe integer. It never
 *  rounds: `12.345` is an error, not `12.35`, because a figure the owner typed must be the figure
 *  that is stored or not stored at all. */
export function parsePaiseInput(raw: string): PaiseParse {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: false, error: 'Enter an amount, or leave the other side as it is.' };
  const normalised = trimmed.replace(/^₹\s*/, '').replace(/,/g, '');
  if (!RUPEE_TEXT.test(normalised)) {
    return {
      ok: false,
      error: 'Enter rupees with at most two decimals (for example 1,300.75); no sign or exponent.',
    };
  }
  const [whole, fraction = ''] = normalised.split('.');
  const rupees = Number(whole);
  const paise = rupees * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) {
    return { ok: false, error: 'That amount is too large to store exactly.' };
  }
  return { ok: true, paise };
}

/** Integer paise → the text an edit field starts with. Exact: the paisa fraction survives. */
export function formatPaiseInput(paise: number): string {
  const whole = Math.floor(paise / 100);
  const fraction = String(paise % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

// ── the edit gate ────────────────────────────────────────────────────────

export interface EditableProvisionalRow {
  partyName: string;
  debitPaise: number;
  creditPaise: number;
  importedPartyName: string;
  importedDebitPaise: number;
  importedCreditPaise: number;
}

export interface EditDraft {
  partyName: string;
  debitText: string;
  creditText: string;
}

export function editDraft(row: EditableProvisionalRow): EditDraft {
  return {
    partyName: row.partyName,
    debitText: formatPaiseInput(row.debitPaise),
    creditText: formatPaiseInput(row.creditPaise),
  };
}

export type EditEvaluation =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      partyName: string;
      debitPaise: number;
      creditPaise: number;
      nameChanged: boolean;
      debitChanged: boolean;
      creditChanged: boolean;
      balanceChanged: boolean;
      /** True when the draft equals the effective row: the server would answer `changed: false`. */
      unchanged: boolean;
      /** True when the balance change needs a reason before the server will accept it. */
      reasonRequired: boolean;
    };

/** Validate a draft and describe exactly what it changes. */
export function evaluateEdit(row: EditableProvisionalRow, draft: EditDraft): EditEvaluation {
  const name = draft.partyName.trim();
  if (name === '') return { ok: false, error: 'A party name cannot be blank.' };
  const debit = parsePaiseInput(draft.debitText);
  if (!debit.ok) return { ok: false, error: `Debit: ${debit.error}` };
  const credit = parsePaiseInput(draft.creditText);
  if (!credit.ok) return { ok: false, error: `Credit: ${credit.error}` };

  const nameChanged = name !== row.partyName;
  const debitChanged = debit.paise !== row.debitPaise;
  const creditChanged = credit.paise !== row.creditPaise;
  const balanceChanged = debitChanged || creditChanged;
  return {
    ok: true,
    partyName: name,
    debitPaise: debit.paise,
    creditPaise: credit.paise,
    nameChanged,
    debitChanged,
    creditChanged,
    balanceChanged,
    unchanged: !nameChanged && !balanceChanged,
    reasonRequired: balanceChanged,
  };
}

/** The names the list shows when the effective side differs from the last accepted source side. */
export function manualEditLabels(row: EditableProvisionalRow & {
  nameManuallyEdited: boolean;
  amountsManuallyEdited: boolean;
}): string[] {
  const labels: string[] = [];
  if (row.nameManuallyEdited) labels.push('name edited');
  if (row.amountsManuallyEdited) labels.push('amounts edited');
  return labels;
}

/** The side the owner's accepted source last stated, for the edit dialog's reference block. */
export function importedSideText(row: EditableProvisionalRow): string {
  return (
    `${row.importedPartyName} · debit ${formatPaiseInput(row.importedDebitPaise)} · ` +
    `credit ${formatPaiseInput(row.importedCreditPaise)}`
  );
}

// ── status labels ────────────────────────────────────────────────────────

export interface ProvisionalStateRow {
  reviewed: boolean;
  hasConflict: boolean;
  archived: boolean;
}

export function reviewStateLabel(row: ProvisionalStateRow): string {
  if (row.archived) return 'archived';
  if (row.hasConflict) return 'conflict open';
  return row.reviewed ? 'reviewed' : 'unreviewed';
}

export function archiveStateLabel(row: ProvisionalStateRow): string {
  return row.archived ? 'archived' : 'active';
}

/** Reviewing is a statement about the figures on screen, so a conflict or an archived row cannot
 *  be signed off. The backend refuses both; the button is disabled for the same reason. */
export function canReview(row: ProvisionalStateRow): boolean {
  return !row.archived && !row.hasConflict && !row.reviewed;
}

/** An archived record is restored only by the explicit control, never by an upload. */
export function canRestore(row: ProvisionalStateRow): boolean {
  return row.archived;
}

// ── assignment ───────────────────────────────────────────────────────────

export interface AssignableEmployee {
  id: string;
  name: string;
  active: boolean;
}

/** Active employees only. The server refuses an inactive id; this list keeps a stale screen from
 *  offering one in the first place. A currently assigned person who was later deactivated is not
 *  offered again, but the list row still names them and flags the assignment as stale. */
export function assignableEmployees<T extends AssignableEmployee>(employees: readonly T[]): T[] {
  return employees.filter((employee) => employee.active);
}

export function assignmentSummary(row: {
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  assignedEmployeeActive: boolean | null;
}): string {
  if (!row.assignedEmployeeId) return 'Unassigned';
  const name = row.assignedEmployeeName ?? row.assignedEmployeeId;
  return row.assignedEmployeeActive === false ? `${name} (inactive)` : name;
}

// ── history ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  'debtor_provisional.edit': 'Owner edit',
  'debtor_provisional.archive': 'Archived',
  'debtor_provisional.restore': 'Restored',
  'debtor_provisional.assign': 'Assigned',
  'debtor_provisional.unassign': 'Unassigned',
  'debtor_provisional.review': 'Reviewed',
  'debtor_provisional.conflict_accept': 'Conflict — source accepted',
  'debtor_provisional.conflict_keep': 'Conflict — manual value kept',
};

export function managementActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const CHANGE_FIELDS: { key: string; label: string; money?: boolean }[] = [
  { key: 'partyName', label: 'name' },
  { key: 'debitPaise', label: 'debit', money: true },
  { key: 'creditPaise', label: 'credit', money: true },
  { key: 'assignedEmployeeId', label: 'salesperson' },
  { key: 'reviewed', label: 'reviewed' },
  { key: 'archived', label: 'archived' },
];

function changeValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (key.endsWith('Paise') && typeof value === 'number') return formatPaiseInput(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** The before/after lines an audit row carries. Only fields the trail actually states are printed;
 *  a missing side is omitted rather than invented, and the reason is shown separately by the caller. */
export function describeAuditChanges(changes: Record<string, unknown> | null | undefined): string[] {
  if (!changes) return [];
  const before = (changes.before ?? null) as Record<string, unknown> | null;
  const after = (changes.after ?? null) as Record<string, unknown> | null;
  if (!before && !after) return [];
  const lines: string[] = [];
  for (const field of CHANGE_FIELDS) {
    const from = before ? before[field.key] : undefined;
    const to = after ? after[field.key] : undefined;
    if (from === undefined && to === undefined) continue;
    if (from === to) continue;
    lines.push(`${field.label}: ${changeValue(field.key, from)} → ${changeValue(field.key, to)}`);
  }
  return lines;
}

export function auditReason(changes: Record<string, unknown> | null | undefined): string {
  const reason = changes?.reason;
  return typeof reason === 'string' ? reason : '';
}

// ── reconciliation ───────────────────────────────────────────────────────

export interface SummaryTotals {
  recordCount: number;
  debitPaise: number;
  creditPaise: number;
  reviewedCount: number;
  unreviewedCount: number;
  conflictCount: number;
  archivedCount: number;
  unassignedCount: number;
}

export interface PageTotals {
  debitPaise: number;
  creditPaise: number;
}

/** Sum a page's two sides without netting them. Used only to check a page against the summary
 *  when the page is the whole filtered set; a partial page is not compared to a whole-set total. */
export function pageTotals(rows: readonly { debitPaise: number; creditPaise: number }[]): PageTotals {
  return rows.reduce(
    (totals, row) => ({
      debitPaise: totals.debitPaise + row.debitPaise,
      creditPaise: totals.creditPaise + row.creditPaise,
    }),
    { debitPaise: 0, creditPaise: 0 },
  );
}

export type Reconciliation =
  | { comparable: false; reason: string }
  | { comparable: true; matches: boolean; mismatches: string[] };

/** Compare a page with the filtered summary only when the page holds every matching record.
 *  `recordCount` is the server's count for the filter; `rowsOnPage` is what the list returned. A
 *  capped page is reported as not comparable, never as a mismatch. */
export function reconcilePage(
  summary: SummaryTotals,
  rows: readonly { debitPaise: number; creditPaise: number }[],
  rowsOnPage: number,
): Reconciliation {
  if (rowsOnPage !== summary.recordCount) {
    return {
      comparable: false,
      reason: `The summary covers ${summary.recordCount} record(s); this page holds ${rowsOnPage}.`,
    };
  }
  const totals = pageTotals(rows);
  const mismatches: string[] = [];
  if (totals.debitPaise !== summary.debitPaise) mismatches.push('debit');
  if (totals.creditPaise !== summary.creditPaise) mismatches.push('credit');
  if (summary.reviewedCount + summary.unreviewedCount !== summary.recordCount) {
    mismatches.push('review count');
  }
  return { comparable: true, matches: mismatches.length === 0, mismatches };
}

/** A salesperson group's line, worded so an inactive holder is not presented as current. */
export function groupStateLabel(group: {
  employeeId: string | null;
  employeeActive: boolean | null;
}): string {
  if (!group.employeeId) return 'unassigned';
  if (group.employeeActive === false) return 'inactive — reassign';
  return 'active';
}

export const CSV_FILENAME = `provisional-debtors-${PROVISIONAL_AS_OF}.csv`;
