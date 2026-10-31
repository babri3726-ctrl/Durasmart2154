/** The debtor apply's decisions and its wording, kept out of both the component and the transport.
 *
 *  Deliberately **import-free**, like `entryRules.ts` and `sessionRules.ts`: `node --test` loads
 *  this module directly with type stripping, so `scripts/debtor-apply-contract-test.mjs` can drive
 *  every branch with a synthetic fixture and no browser, and the `.tsx` screen reads the same one
 *  answer it is tested against.
 *
 *  What lives here is the sentence-level truth of the workflow, and three rules the whole module
 *  exists to keep visible rather than restate in JSX:
 *
 *  1. **Readiness is the server's word, never the panel's.** `applyAvailable` from the preview is
 *     the only thing that decides whether an Apply control appears. This module does not re-derive
 *     eligibility from the counts, because a screen that recomputed it could disagree with the
 *     backend and offer an apply the backend would refuse.
 *  2. **A file applies whole or not at all.** An `unresolvedRowCount` above zero, a blocker, or a
 *     missing balance date refuses the *entire* file — the panel offers no partial import and no
 *     per-row approve, because no debtor quarantine surface exists to withhold rows into.
 *  3. **A write claim is refused, and a replacement is a second yes.** A preview that says it wrote
 *     anything is not a preview; an apply that says it created business records is not an apply. And
 *     a figure that differs from a stored one is replaced only under a separate explicit
 *     `allowReplacement`, which the owner must choose after seeing the refusal, never inferred.
 *
 *  Nothing here matches on a party name, nets a debit against a credit, or turns a reporting period
 *  into a balance date — the backend decides all three, and this module only explains its answer.
 */

/** The minimal fields this module reads off a preview. Structural, so the panel passes its own
 *  `ServerDebtorPreview` without importing it here (that would pull `import.meta.env` in). */
export interface DebtorEligibilityInput {
  applyAvailable: boolean;
  applyBlockedReason: string;
  unresolvedRowCount: number;
  blockers: readonly { code: string; message: string }[];
}

export interface DebtorEligibility {
  /** The server's own verdict, surfaced unchanged — this is what gates the Apply control. */
  eligible: boolean;
  /** How many rows the owner must clear before the file could apply. */
  reviewCount: number;
  /** The reason an apply would refuse, in the backend's words; empty when it is eligible. */
  blockedReason: string;
}

export function debtorEligibility(preview: DebtorEligibilityInput): DebtorEligibility {
  return {
    eligible: preview.applyAvailable === true,
    reviewCount: preview.unresolvedRowCount,
    // The blocked reason is only meaningful when the server said it is blocked; an eligible file's
    // reason is empty, and we do not fabricate one from the counts.
    blockedReason: preview.applyAvailable === true ? '' : preview.applyBlockedReason,
  };
}

/** Fields read off a confirmed apply's outcome. */
export interface DebtorApplyOutcomeInput {
  replayed: boolean;
  databaseRowsWritten: boolean;
  createdRowCount: number;
  unchangedRowCount: number;
  replacedRowCount: number;
  snapshotRowCount: number;
  businessRecordsCreated: boolean;
  asOf: string;
}

export interface DebtorApplyOutcomeText {
  /** A replay stored nothing; a real apply did. Shown as two different facts, not one label. */
  title: string;
  /** Counts in plain language, including the "nothing moved" case a no-op apply is. */
  detail: string;
}

export function debtorApplyOutcomeText(outcome: DebtorApplyOutcomeInput): DebtorApplyOutcomeText {
  if (outcome.replayed || !outcome.databaseRowsWritten) {
    return {
      title: 'Already applied — this exact file was imported before',
      detail:
        `Every figure in this file is already stored for its ledger at ${outcome.asOf} with exactly ` +
        `this value, so nothing was written a second time and no new audit line was made. ` +
        `${outcome.unchangedRowCount} of ${outcome.snapshotRowCount} planned balance(s) were unchanged.`,
    };
  }
  const parts = [`${outcome.createdRowCount} stored`];
  if (outcome.unchangedRowCount > 0) parts.push(`${outcome.unchangedRowCount} already present`);
  if (outcome.replacedRowCount > 0)
    parts.push(`${outcome.replacedRowCount} replaced under explicit approval`);
  return {
    title: 'Debtor balances applied',
    detail:
      `Applied as of ${outcome.asOf}: ${parts.join(', ')}. Debit and credit stayed separate rows — ` +
      `no netted total was written. Only dated balance snapshots and audit rows were stored; no ` +
      `customer, ledger mapping or stock movement was created or changed.`,
  };
}

/** Every stable `error.code` the apply route can answer with, plus the transport codes shared with
 *  the preview. Kept as an exhaustive union so a new backend code shows up as a compile gap, not a
 *  silently mislabelled failure on screen. */
export type DebtorApplyFailureKind =
  | 'confirmation_required'
  | 'file_hash_mismatch'
  | 'preview_mismatch'
  | 'blocked'
  | 'replacement_requires_approval'
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'too_large'
  | 'unsupported_media_type'
  | 'workbook_unreadable'
  | 'network'
  | 'other';

const FAILURE_BY_CODE: Record<string, DebtorApplyFailureKind> = {
  confirmation_required: 'confirmation_required',
  file_hash_mismatch: 'file_hash_mismatch',
  preview_mismatch: 'preview_mismatch',
  debtor_import_blocked: 'blocked',
  debtor_import_replacement_requires_approval: 'replacement_requires_approval',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  validation_error: 'validation',
  payload_too_large: 'too_large',
  unsupported_media_type: 'unsupported_media_type',
  workbook_unreadable: 'workbook_unreadable',
  network: 'network',
};

export function classifyDebtorApplyError(code: string): DebtorApplyFailureKind {
  return FAILURE_BY_CODE[code] ?? 'other';
}

/** A replacement refusal is the one failure that offers a *second*, separate approval. Nothing
 *  here turns any other refusal into one — a blocked or unauthorised apply has no hidden yes. */
export function offersReplacementApproval(code: string): boolean {
  return classifyDebtorApplyError(code) === 'replacement_requires_approval';
}

const HEADLINE_BY_KIND: Record<DebtorApplyFailureKind, string> = {
  confirmation_required: 'No confirmation was given, so nothing was read or applied',
  file_hash_mismatch: 'The file sent is not the file that was previewed',
  preview_mismatch: 'The preview no longer matches the current mappings — re-preview and confirm again',
  blocked: 'This file is not whole, so the entire import was refused',
  replacement_requires_approval: 'Some figures differ from what is already stored',
  unauthorized: 'This session is not signed in',
  forbidden: 'Only an owner can apply a debtor workbook',
  validation: 'The request was rejected before the file was read',
  too_large: 'The workbook is larger than the upload limit',
  unsupported_media_type: 'The body was not an Excel workbook the backend could open',
  workbook_unreadable: 'The workbook could not be read far enough to plan an apply',
  network: 'The backend could not be reached',
  other: 'The apply failed',
};

const DETAIL_BY_KIND: Record<DebtorApplyFailureKind, string> = {
  confirmation_required:
    'Applying requires its own explicit confirmation; viewing a preview never counts as one.',
  file_hash_mismatch:
    'The declared SHA-256 did not match the bytes received, so this is a different file than the one previewed.',
  preview_mismatch:
    'Identity is decided by server mappings, and one moved between the preview and this apply. Nothing was applied against a stale reading.',
  blocked:
    'At least one row is missing, ambiguous, invalid, or the file states no verified balance date. No partial import is attempted and no rows were written.',
  replacement_requires_approval:
    'A stored figure would be overwritten. That is a separate decision from importing the file, so it needs its own explicit approval before anything is written.',
  unauthorized: 'No apply was sent.',
  forbidden:
    'The backend refuses an employee apply before reading a byte of the body; the panel hides the control, but hiding is not what enforced this.',
  validation: 'The failure is about the request shape (hash length, sheet name), not the workbook’s figures.',
  too_large: 'Nothing was parsed; the file exceeded the configured limit.',
  unsupported_media_type: 'Nothing was parsed; the body was not an Office Open XML workbook.',
  workbook_unreadable: 'Nothing was written; the file could not be planned.',
  network: 'No answer means nothing was written. Retry the apply; the server is idempotent for an identical file.',
  other: 'No rows were written. The backend reported a refusal or an error, and the transaction rolled back.',
};

export function debtorApplyFailureHeadline(code: string): string {
  return HEADLINE_BY_KIND[classifyDebtorApplyError(code)];
}

export function debtorApplyFailureDetail(code: string): string {
  return DETAIL_BY_KIND[classifyDebtorApplyError(code)];
}

/** The refusal's own `fields` (unresolvedRowCount / blockers / replacementCount / ledgerRefs) are
 *  the accountant's pointer. They are shown verbatim and never re-counted or trimmed by the panel. */
export function formatFailureFields(fields: Record<string, string> | undefined): string[] {
  if (!fields) return [];
  return Object.entries(fields).map(([field, value]) => `${field}: ${value}`);
}
