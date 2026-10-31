/** Contract tests for the debtor preview→apply workflow the owner panel puts on top of the
 *  backend's two routes.
 *
 *  Two things are checked, and they fail for different reasons:
 *
 *  * **The panel's own decisions, driven by synthetic fixtures.** `src/lib/debtorImport.ts` is
 *    import-free, so `node --test` loads it with type stripping and every branch runs here with no
 *    browser and no database. This is the sentence-level truth of the screen: whether an Apply is
 *    offered, how a success/replay/failure is worded, and which refusal — and only which one — offers
 *    a second, replacement approval. It is tested against the *shape* the backend answers with, never
 *    against a real workbook's figures: a test that pinned a live balance would pass for the wrong
 *    reason the moment the sheet changed.
 *  * **The transport and the screen, read as text.** `src/lib/serverApi.ts` reaches for
 *    `import.meta.env` and `Debtors.tsx` is JSX, so neither is node-importable; the assertions below
 *    are about which lines they contain — that the preview reader still refuses a write claim but now
 *    allows the computed `applyAvailable` and demands the digest, that `confirm` is sent only from the
 *    apply, that the apply re-sends the previewed bytes/hash/digest, and that the screen is owner-only
 *    and refreshes the list on success.
 *
 *  The safety invariants this file exists to keep honest: readiness is the server's word (never
 *  re-derived from counts here), a file applies whole or not at all (no partial import offered), a
 *  write claim is refused at the transport, and replacing a stored figure is a second explicit yes the
 *  panel never infers.
 *
 *  Usage:  node --test scripts/debtor-apply-contract-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDebtorApplyError,
  debtorApplyFailureDetail,
  debtorApplyFailureHeadline,
  debtorApplyOutcomeText,
  debtorEligibility,
  formatFailureFields,
  offersReplacementApproval,
} from '../src/lib/debtorImport.ts';

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = join(here, '..');
const source = (relative) => readFileSync(join(panelRoot, relative), 'utf8');

// ── synthetic fixtures: shapes only, no company figures ──────────────────

const eligibilityInput = (overrides = {}) => ({
  applyAvailable: false,
  applyBlockedReason: '',
  unresolvedRowCount: 0,
  blockers: [],
  ...overrides,
});

const outcomeInput = (overrides = {}) => ({
  replayed: false,
  databaseRowsWritten: true,
  createdRowCount: 0,
  unchangedRowCount: 0,
  replacedRowCount: 0,
  snapshotRowCount: 0,
  businessRecordsCreated: false,
  asOf: '2026-10-01',
  ...overrides,
});

// ── readiness is the server's word, never the panel's ────────────────────

test('eligibility is exactly applyAvailable, not a count the panel recomputes', () => {
  assert.equal(debtorEligibility(eligibilityInput({ applyAvailable: true })).eligible, true);
  assert.equal(debtorEligibility(eligibilityInput({ applyAvailable: false })).eligible, false);

  // Zero unresolved rows and no blockers still do NOT make a file eligible if the server said false:
  // the panel must never disagree with the backend and offer an apply the backend would refuse.
  const serverRefusesDespiteCleanCounts = debtorEligibility(
    eligibilityInput({
      applyAvailable: false,
      applyBlockedReason: 'the workbook states no verified balance date',
      unresolvedRowCount: 0,
      blockers: [{ code: 'asOfUnverified', message: 'no explicit date' }],
    }),
  );
  assert.equal(serverRefusesDespiteCleanCounts.eligible, false);
  assert.equal(serverRefusesDespiteCleanCounts.reviewCount, 0);
  assert.equal(serverRefusesDespiteCleanCounts.blockedReason, 'the workbook states no verified balance date');

  // An eligible file's blocked reason is empty, not the string the preview happened to carry.
  assert.equal(debtorEligibility(eligibilityInput({ applyAvailable: true, applyBlockedReason: 'ignored' })).blockedReason, '');
});

// ── the outcome wording, split by what actually happened ─────────────────

test('a replay is described as a no-op and a real apply as a write, in two different sentences', () => {
  const replay = debtorApplyOutcomeText(
    outcomeInput({ replayed: true, databaseRowsWritten: false, unchangedRowCount: 5, snapshotRowCount: 5 }),
  );
  assert.match(replay.title, /Already applied/);
  assert.match(replay.detail, /nothing was written a second time/i);

  const applied = debtorApplyOutcomeText(
    outcomeInput({
      replayed: false,
      databaseRowsWritten: true,
      createdRowCount: 3,
      unchangedRowCount: 1,
      replacedRowCount: 2,
      snapshotRowCount: 6,
    }),
  );
  assert.match(applied.title, /Debtor balances applied/);
  assert.match(applied.detail, /3 stored/);
  assert.match(applied.detail, /2 replaced under explicit approval/);
  // The two rules D-10 and the apply docstring insist on, stated rather than implied:
  assert.match(applied.detail, /Debit and credit stayed separate rows/);
  assert.match(applied.detail, /no netted total/i);
  assert.match(applied.detail, /no\s+customer, ledger mapping or stock movement/i);
  // A real apply must not be worded like a replay, and vice versa.
  assert.doesNotMatch(replay.detail, /Debtor balances applied/);
});

// ── failure classification and the single second-approval gate ───────────

test('every backend apply code maps to a kind, unknown ones to "other"', () => {
  const byCode = {
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
  for (const [code, kind] of Object.entries(byCode)) {
    assert.equal(classifyDebtorApplyError(code), kind, `${code} should map to ${kind}`);
    // Every mapped code has a headline and a detail — nothing renders as `undefined`.
    assert.ok(debtorApplyFailureHeadline(code).length > 0, `${code} has no headline`);
    assert.ok(debtorApplyFailureDetail(code).length > 0, `${code} has no detail`);
  }
  assert.equal(classifyDebtorApplyError('aCodeInventedTomorrow'), 'other');
  assert.ok(debtorApplyFailureHeadline('aCodeInventedTomorrow').length > 0);
});

test('a blocked apply is stated as an entire-file refusal, not a partial import', () => {
  assert.match(debtorApplyFailureHeadline('debtor_import_blocked'), /entire import was refused/i);
  assert.match(debtorApplyFailureDetail('debtor_import_blocked'), /No partial import is attempted/i);
});

test('only a replacement refusal offers the second, separate approval', () => {
  assert.equal(offersReplacementApproval('debtor_import_replacement_requires_approval'), true);
  // Nothing here turns any other refusal into an approval offer — a blocked or unauthorised apply
  // has no hidden yes waiting to be ticked.
  for (const code of [
    'debtor_import_blocked',
    'forbidden',
    'unauthorized',
    'preview_mismatch',
    'file_hash_mismatch',
    'confirmation_required',
    'validation_error',
    'aCodeInventedTomorrow',
  ]) {
    assert.equal(offersReplacementApproval(code), false, `${code} must not offer a replacement approval`);
  }
});

test('the refusal fields are shown verbatim and never re-counted by the panel', () => {
  assert.deepEqual(
    formatFailureFields({ unresolvedRowCount: '3', blockers: 'no_reference, multiple_identities' }),
    ['unresolvedRowCount: 3', 'blockers: no_reference, multiple_identities'],
  );
  assert.deepEqual(formatFailureFields(undefined), []);
  assert.deepEqual(formatFailureFields({}), []);
});

// ── the transport reader, asserted from the source it lives in ───────────

const client = source('src/lib/serverApi.ts');

test('the debtor preview reader refuses a write claim but allows the computed readiness flag', () => {
  // Only the two write flags are pinned false now — `applyAvailable` is a readiness verdict, a real
  // boolean, and a reader that kept pinning it false would reject every eligible preview.
  assert.match(
    client,
    /for \(const key of \['businessRecordsCreated', 'databaseRowsWritten'\] as const\)/,
    'the reader no longer refuses exactly the two write flags',
  );
  assert.ok(
    !client.includes("['applyAvailable', 'businessRecordsCreated'"),
    'applyAvailable is still caught in the write-flag refusal loop',
  );
  // It checks readiness is a boolean and the digest is a 64-char string before the screen trusts it.
  assert.match(client, /typeof preview\.applyAvailable !== 'boolean'/);
  assert.match(client, /typeof preview\.applyPreviewDigest !== 'string' \|\| preview\.applyPreviewDigest\.length !== 64/);
  // The type itself: applyAvailable is boolean, the two write flags stay literal false, digest present.
  assert.match(client, /applyAvailable: boolean;/);
  assert.match(client, /applyPreviewDigest: string;/);
});

test('the debtor apply reader allows a data write but not a business-record claim', () => {
  assert.match(client, /if \(outcome\.businessRecordsCreated !== false\)/);
  // databaseRowsWritten true is the point of an apply, so it must NOT be refused. The slice is
  // bounded to this reader: the provisional sync reader below has its own, unrelated coherence
  // check for `databaseRowsWritten !== false` on a replay, and reading to end-of-file would
  // mistake that route's rule for this one's.
  const applyReader = client.slice(
    client.indexOf('function readDebtorApplyPayload'),
    client.indexOf('// ── provisional debtors'),
  );
  assert.ok(applyReader.length > 0, 'the apply reader was not found');
  assert.ok(!/databaseRowsWritten !== false/.test(applyReader),
    'the apply reader wrongly refuses databaseRowsWritten: true');
});

test('the routes are the ones the backend documents and the body is bytes', () => {
  assert.match(client, /`\/debtors\/imports\/preview\?\$\{query\.toString\(\)\}`/);
  assert.match(client, /`\/debtors\/imports\/apply\?\$\{query\.toString\(\)\}`/);
  const previewFn = client.slice(
    client.indexOf('export async function previewDebtorWorkbook'),
    client.indexOf('export interface ServerDebtorApply'),
  );
  const applyFn = client.slice(
    client.indexOf('export async function applyDebtorWorkbook'),
    client.indexOf('// ── customer ledger'),
  );
  assert.ok(previewFn.length > 0 && applyFn.length > 0, 'a debtor function was not found');
  assert.match(previewFn, /bytes,/);
  assert.match(applyFn, /bytes,/);
  assert.match(applyFn, /confirm: 'true'/);
  assert.match(applyFn, /if \(input\.allowReplacement\) query\.set\('allowReplacement', 'true'\)/);
});

test('confirmation is sent only from the apply, never from the preview', () => {
  const previewFn = client.slice(
    client.indexOf('export async function previewDebtorWorkbook'),
    client.indexOf('export interface ServerDebtorApply'),
  );
  // Check the query-param tokens, not the word "confirm" (which appears in prose like "confirmed").
  assert.ok(!previewFn.includes("confirm:"), 'the preview call sends a confirmation param');
  assert.ok(!previewFn.includes('allowReplacement'), 'the preview call sends a replacement approval');
  assert.ok(!previewFn.includes('applyDebtorWorkbook'), 'the preview call applies the file');
});

// ── the screen, asserted from its source ─────────────────────────────────

const screen = source('src/pages/Debtors.tsx');

test('the preview/apply card is owner-only and the list re-reads after an apply', () => {
  assert.match(screen, /user\?\.role === 'owner' && <DebtorWorkbookPreview \/>/);
  assert.match(screen, /useSyncToken\(syncKeys\.debtors\)/, 'the list does not subscribe to the debtors key');
  assert.match(screen, /invalidate\(syncKeys\.debtors\)/, 'a successful apply does not refresh the list');
});

test('the apply button is gated on an explicit confirmation and re-sends the previewed bytes', () => {
  assert.match(screen, /type="checkbox"/);
  assert.match(screen, /disabled=\{!confirmed \|\| applyState\.kind === 'applying'\}/);
  assert.match(screen, /applyDebtorWorkbook\(phase\.bytes, \{/);
  assert.match(screen, /fileSha256: phase\.preview\.fileSha256,/);
  assert.match(screen, /previewDigest: phase\.preview\.applyPreviewDigest,/);
  assert.match(screen, /allowReplacement: withReplacement,/);
  // The apply re-checks the server verdict before calling, so a stray click cannot bypass it.
  assert.match(screen, /if \(!debtorEligibility\(phase\.preview\)\.eligible\) return;/);
  // An ineligible preview gets no Apply control at all.
  assert.match(screen, /\{ready && !applied && \(/);
  assert.ok(!screen.includes('type="submit"'), 'a form submit could apply without the confirmation click');
});

test('the replacement approval is a second checkbox, offered only for the replacement refusal', () => {
  assert.match(screen, /offersReplacementApproval\(applyState\.code\)/);
  assert.match(screen, /disabled=\{!replacementApproved\}/);
  // Every new reading resets both yeses: neither survives onto a different file.
  assert.match(screen, /setConfirmed\(false\)/);
  assert.match(screen, /setReplacementApproved\(false\)/);
});

test('the screen never invents a netted total or matches a party by name', () => {
  // The whole point of the two-figures display: there is no subtraction and no `outstanding` here.
  for (const file of ['src/pages/Debtors.tsx', 'src/lib/debtorImport.ts']) {
    const text = source(file);
    assert.ok(!/debitPaise\s*-/.test(text), `${file} nets a credit against a debit`);
    assert.ok(!/outstanding/i.test(text), `${file} shows an "outstanding" total the backend never sends`);
  }
});
