/** Boundary tests for the dispatch entry rules — the text-to-request rules in `src/lib/dispatchEntry.ts`.
 *
 *  Same reason `entry-boundary-test.mjs` exists: a form is where typed text becomes a request body,
 *  and the two honest failures are sending something the server will refuse, or sending something
 *  *different* from what the person typed. On this screen the second one has a specific shape — a
 *  quantity finer than `NUMERIC(14,3)` is rounded on its way into the column by
 *  `backend/app/money.py::to_quantity`, so the delivery record would carry a figure nobody typed, and
 *  a quantity wider than the column is not rounded at all but refused by PostgreSQL as an overflow.
 *
 *  What is *not* tested here is deliberately as important as what is: no rule in this file decides
 *  whether a consignment is allowed. `exceedsRemaining` is a warning on the form, and over-dispatch
 *  stays the backend's `409 over_dispatch` under a row lock (D-4) — the case two desks filling two
 *  part-load trucks for one order is precisely what a client cannot see. A test that pinned a local
 *  gate at the remaining figure would be a test that the panel had invented a permission.
 *
 *  No bundler and no database: `node --test` loads the module directly with type stripping, so
 *  `dispatchEntry.ts` must stay erasable TypeScript with no imports but the pure `orderEntry.ts`.
 *
 *  Usage:  npm run test:dispatch
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchDateProblem,
  dispatchQuantityProblem,
  buildDispatchLines,
  buildDispatchBody,
  exceedsRemaining,
  headerChanges,
  capabilityReasonProblem,
  buildCapabilityBody,
  CAPABILITY_REASON_LIMIT,
} from '../src/lib/dispatchEntry.ts';

const draft = (orderLineId, over = {}) => ({
  orderLineId,
  unit: 'MT',
  remainingQuantity: '10.000',
  quantity: '',
  batchNo: '',
  warehouse: '',
  ...over,
});

const paperwork = (over = {}) => ({
  dispatchDate: '2026-10-19',
  vehicle: '',
  driver: '',
  driverPhone: '',
  transportName: '',
  notes: '',
  ...over,
});

// ── the date the goods left ──────────────────────────────────────────────

test('a blank dispatch date is refused with the sentence the field will show', () => {
  assert.equal(dispatchDateProblem(''), 'Enter the date the goods left, as YYYY-MM-DD.');
  assert.equal(dispatchDateProblem('   '), 'Enter the date the goods left, as YYYY-MM-DD.');
});

test('a date in any other shape is refused, because the column parses none of them', () => {
  for (const text of ['2026-1-5', '05-01-2026', '2026/01/05', '20260105', '19-10-2026', '2026-10-1']) {
    assert.equal(dispatchDateProblem(text), 'Enter the date as YYYY-MM-DD.', text);
  }
});

test('the 1990 floor is the server’s, typed the same way on both sides', () => {
  // `DispatchCreate.dispatch_date` carries `Field(ge=date(1990, 1, 1))`. A dropped leading digit
  // reads `0180-01-01` and would otherwise land in a period nobody is asking about.
  assert.equal(dispatchDateProblem('1989-12-31'), 'That date is too early to be a delivery date — check for a dropped digit.');
  assert.equal(dispatchDateProblem('1800-01-01'), 'That date is too early to be a delivery date — check for a dropped digit.');
  assert.equal(dispatchDateProblem('1990-01-01'), null);
});

test('a future date is not refused — the server types a floor and no ceiling', () => {
  // A truck booked to leave tonight is recorded against the day it goes, and the desk may fill the
  // paperwork first. `ge=date(1990,1,1)` is the whole rule; inventing a "not after today" here
  // would be the panel refusing a date the ledger accepts.
  assert.equal(dispatchDateProblem('2031-04-01'), null);
});

test('the date box is trimmed before it is compared and before it is sent', () => {
  assert.equal(dispatchDateProblem(' 2026-10-19 '), null);
  assert.equal(buildDispatchBody('o-1', paperwork({ dispatchDate: ' 2026-10-19 ' }), []).dispatchDate, '2026-10-19');
});

// ── the quantity ─────────────────────────────────────────────────────────

test('an empty quantity is not a problem — it means this line is not on this truck', () => {
  assert.equal(dispatchQuantityProblem(''), null);
  assert.equal(dispatchQuantityProblem('   '), null);
});

test('a figure the column holds exactly is accepted as typed', () => {
  for (const text of ['1', '12', '12.5', '12.50', '12.345', '0.001']) {
    assert.equal(dispatchQuantityProblem(text), null, text);
  }
});

test('finer than three decimals is refused rather than sent for the column to round', () => {
  // `money.to_quantity` quantizes with banker's rounding, so `12.3456` would become `12.346` on its
  // way in and the record would say a number the desk did not type.
  assert.equal(
    dispatchQuantityProblem('12.3456'),
    'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.',
  );
  assert.equal(dispatchQuantityProblem('1.000000'), 'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.');
});

test('more whole units than NUMERIC(14,3) can hold are refused here, not as a database error', () => {
  // Eleven digits before the point is the column's own ceiling; past it PostgreSQL raises a field
  // overflow, which is a 500 with no field name in it rather than a sentence about the box.
  assert.equal(dispatchQuantityProblem('123456789012'), 'That is more whole units than this column can hold (11 digits before the point). Check for a paste that brought the wrong figure.');
  assert.equal(dispatchQuantityProblem('99999999999.999'), null);
  assert.equal(dispatchQuantityProblem('999999999999.999').startsWith('That is more whole units'), true);
});

test('zero is refused as a line that is not a dispatch, and so is a negative', () => {
  // D-4 keeps quantity ≤ 0 in the business-rule band, so the server answers `422
  // quantity_not_positive`; the desk is told before the request is spent.
  assert.equal(dispatchQuantityProblem('0'), 'A line with nothing on it is not a dispatch. Leave the box empty, or send a quantity above zero.');
  assert.equal(dispatchQuantityProblem('0.000'), 'A line with nothing on it is not a dispatch. Leave the box empty, or send a quantity above zero.');
  assert.equal(dispatchQuantityProblem('-5'), 'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.');
});

test('punctuation and notation a column cannot read are refused by the shape rule', () => {
  for (const text of ['1,5', '1e3', '.5', '12.', '007', '12.3.4', 'abc', '₹12']) {
    assert.equal(dispatchQuantityProblem(text), 'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.', text);
  }
});

// ── the lines of the consignment ─────────────────────────────────────────

test('a blank row is dropped rather than refused — a part-load is the normal case', () => {
  const built = buildDispatchLines([draft(1), draft(2, { quantity: '4' }), draft(3)]);
  assert.deepEqual(built.lines, [{ orderLineId: 2, quantity: '4', unit: 'MT' }]);
  assert.deepEqual(built.problems, {});
  assert.equal(built.message, '');
});

test('nothing filled in is said once, and no line is sent', () => {
  const built = buildDispatchLines([draft(1), draft(2)]);
  assert.deepEqual(built.lines, []);
  assert.deepEqual(built.problems, {});
  assert.equal(built.message, 'Nothing is filled in. A consignment needs at least one line with a quantity.');
});

test('the unit travels with the line and is never re-typed here', () => {
  // A dispatch line in a unit the order line was not cut in is the server's `422 unit_mismatch`;
  // the screen gives no picker, so the only unit that can leave is the one that arrived.
  const built = buildDispatchLines([draft(7, { quantity: '2.5', unit: 'NOS' })]);
  assert.deepEqual(built.lines, [{ orderLineId: 7, quantity: '2.5', unit: 'NOS' }]);
});

test('a row with batch or warehouse but no quantity is a problem, never a silent drop', () => {
  // The desk meant this line and the number is missing. Sending the row without it, or dropping the
  // row, is how a truck leaves one crate short of what was filled in.
  const built = buildDispatchLines([draft(4, { batchNo: 'B-11' })]);
  assert.deepEqual(built.lines, []);
  assert.deepEqual(built.problems, {
    'lines.4.quantity': 'This line has batch or warehouse details but no quantity. Enter how much left, or clear the line.',
  });
  assert.equal(built.message, 'Some quantity needs fixing before this can be recorded.');
});

test('a quantity that will not validate is a problem on its own line, and the good lines still build', () => {
  const built = buildDispatchLines([
    draft(1, { quantity: '3' }),
    draft(2, { quantity: '3.4567' }),
    draft(3, { quantity: '0' }),
  ]);
  assert.deepEqual(built.lines, [{ orderLineId: 1, quantity: '3', unit: 'MT' }]);
  assert.deepEqual(Object.keys(built.problems), ['lines.2.quantity', 'lines.3.quantity']);
  // Keyed by the order line's id, not its position: the id is what the server names the line by.
  assert.equal(built.problems['lines.2.quantity'], 'Enter a plain quantity of at most three decimal places — the column holds 14 digits and 3 decimals.');
});

test('batch and warehouse are sent only when the desk filled them in, and trimmed when it did', () => {
  const built = buildDispatchLines([draft(1, { quantity: '2', batchNo: '  B-7  ', warehouse: '  ' })]);
  assert.deepEqual(built.lines, [{ orderLineId: 1, quantity: '2', unit: 'MT', batchNo: 'B-7' }]);
});

// ── the body ─────────────────────────────────────────────────────────────

test('an untouched header field is absent from the body rather than an empty string', () => {
  // `dispatch.vehicle` would otherwise carry a blank the desk never looked at, and the audit row
  // would read as though somebody cleared a field that was already empty.
  const body = buildDispatchBody('o-9', paperwork(), [{ orderLineId: 1, quantity: '2', unit: 'MT' }]);
  assert.deepEqual(body, {
    orderId: 'o-9',
    dispatchDate: '2026-10-19',
    lines: [{ orderLineId: 1, quantity: '2', unit: 'MT' }],
  });
  assert.equal('vehicle' in body, false);
  assert.equal('notes' in body, false);
});

test('a filled header field is forwarded trimmed, and a whitespace-only one is not forwarded', () => {
  const body = buildDispatchBody(
    'o-9',
    paperwork({ vehicle: ' MH-12 AB 1234 ', driver: '   ', notes: ' loaded at 6am ' }),
    [],
  );
  assert.equal(body.vehicle, 'MH-12 AB 1234');
  assert.equal('driver' in body, false);
  assert.equal(body.notes, 'loaded at 6am');
});

// ── the advisory over-remaining comparison ───────────────────────────────

test('exactly what is left is not more than what is left', () => {
  assert.equal(exceedsRemaining('10.000', '10.000'), false);
  assert.equal(exceedsRemaining('10', '10.000'), false);
  assert.equal(exceedsRemaining('10.001', '10.000'), true);
});

test('the two sides are compared at the column’s scale, not as typed', () => {
  assert.equal(exceedsRemaining('12.5', '12.500'), false);
  assert.equal(exceedsRemaining('12.501', '12.5'), true);
  assert.equal(exceedsRemaining('0.001', '0'), true);
});

test('beyond float precision the answer is still exact', () => {
  // 99999999999.001 and 99999999999 are the same IEEE double; read as thousandths they are not.
  assert.equal(exceedsRemaining('99999999999.001', '99999999999.000'), true);
  assert.equal(exceedsRemaining('99999999999.000', '99999999999.000'), false);
});

test('a figure either side cannot be read is no comparison, so nothing is warned', () => {
  assert.equal(exceedsRemaining('', '10.000'), false);
  assert.equal(exceedsRemaining('abc', '10.000'), false);
  // A *negative remaining* figure is a real state of the row — an over-dispatch already on record —
  // and not a zero. The screen says so in its own words; this returns false rather than inventing
  // an equality with nothing.
  assert.equal(exceedsRemaining('1', '-2.000'), false);
});

test('the warning does not gate: an over-long quantity still builds a line to send', () => {
  // The `409` has to come from the server under the order's row lock, so the panel must not be the
  // thing that stops the request — otherwise two desks cannot both record a part-load truck.
  assert.equal(exceedsRemaining('999', '1.000'), true);
  const built = buildDispatchLines([draft(1, { quantity: '999', remainingQuantity: '1.000' })]);
  assert.deepEqual(built.lines, [{ orderLineId: 1, quantity: '999', unit: 'MT' }]);
  assert.deepEqual(built.problems, {});
});

// ── what a correction is allowed to change ───────────────────────────────

test('only the fields whose text actually moved come back from the comparison', () => {
  assert.deepEqual(
    headerChanges(paperwork({ vehicle: 'MH-01', driver: 'Ravi', notes: 'x' }), paperwork({ vehicle: 'MH-02', driver: 'Ravi', notes: 'x' })),
    { vehicle: 'MH-02' },
  );
});

test('a field cleared to nothing is a change with an empty value, which is what unsets it', () => {
  // `DispatchPatch` reads `model_dump(exclude_unset=True)`, so an absent key means "leave alone" and
  // a sent empty string means "clear it". Sending nothing for a cleared box would leave the vehicle
  // on the record that the desk just deleted.
  assert.deepEqual(headerChanges(paperwork({ vehicle: 'MH-01' }), paperwork({ vehicle: '' })), { vehicle: '' });
});

test('whitespace on either side is not a change', () => {
  // The service strips before it compares (`patch_dispatch`), so a panel that called `' MH-01 '` a
  // new value would post a correction the audit row cannot describe.
  assert.deepEqual(headerChanges(paperwork({ vehicle: ' MH-01 ' }), paperwork({ vehicle: 'MH-01' })), {});
  assert.deepEqual(headerChanges(paperwork({ notes: 'a' }), paperwork({ notes: 'a  ' })), {});
});

test('the date compares as the ISO text it is, with no timezone involved', () => {
  assert.deepEqual(headerChanges(paperwork({ dispatchDate: '2026-10-18' }), paperwork({ dispatchDate: '2026-10-19' })), {
    dispatchDate: '2026-10-19',
  });
  assert.deepEqual(headerChanges(paperwork({ dispatchDate: '2026-10-19' }), paperwork({ dispatchDate: '2026-10-19' })), {});
});

test('nothing moved is an empty change set, which is the case the save button refuses', () => {
  const before = paperwork({ vehicle: 'MH-01', driver: 'Ravi', transportName: 'Fastway' });
  assert.deepEqual(headerChanges(before, { ...before }), {});
});

// ── the owner's dispatch-capability switch (P5.1 §1) ──────────────────────
// The one panel form that changes *who may use the panel's dispatch screens*. Its tests are about
// the shape of the request, not about who is allowed: `POST /employees/{id}/dispatch-capability` is
// owner-only on the server, and the flag is re-read off the employee row on every dispatch request,
// so a rule here that decided permission would be a second, drift-prone copy of a decision the
// backend has already made. Pinning the *body* is what a client can honestly test.

test('a capability change with no reason is refused before it leaves the browser', () => {
  // `DispatchCapabilityChange.reason` is `min_length=1` and the server strips it, so a blank box is
  // a `400 validation_error` the owner would only read as "the panel is being difficult".
  assert.match(capabilityReasonProblem(''), /reason box/);
  assert.match(capabilityReasonProblem('   \n\t '), /reason box/);
  assert.equal(capabilityReasonProblem('He covers the mill runs while Desk One is away.'), null);
});

test('a reason longer than the column is refused, one exactly at it is not', () => {
  assert.match(capabilityReasonProblem('x'.repeat(CAPABILITY_REASON_LIMIT + 1)), /longer than the backend/);
  assert.equal(capabilityReasonProblem('x'.repeat(CAPABILITY_REASON_LIMIT)), null);
});

test('the body is the flag as asked and the reason as meant, with nothing else in it', () => {
  // Two things pinned at once: the text is trimmed because the audit row should hold what the owner
  // said rather than what the box kept around it, and no other key rides along. A `role`, a `userId`
  // or a photograph in this body would be the panel inventing authority (S-9) or inventing D-9, and
  // `DispatchCapabilityChange` answers `extra="forbid"` to both — a refusal, not a quiet ignore.
  assert.deepEqual(buildCapabilityBody(true, '  covers the mill runs  '), {
    mayDispatch: true,
    reason: 'covers the mill runs',
  });
  assert.deepEqual(buildCapabilityBody(false, 'Desk One is back.'), {
    mayDispatch: false,
    reason: 'Desk One is back.',
  });
  assert.deepEqual(Object.keys(buildCapabilityBody(true, 'x')).sort(), ['mayDispatch', 'reason']);
});

test('the switch asks for a state, not a direction, so a repeat asks for the same state', () => {
  // The server answers `changed: false` and writes no event for a request that asks for what the row
  // already holds. The panel's job is only to keep sending the *state* rather than a toggle, so the
  // second click cannot be read as a revocation of a grant.
  const granted = buildCapabilityBody(true, 'granted once');
  const again = buildCapabilityBody(true, 'granted twice');
  assert.equal(granted.mayDispatch, again.mayDispatch);
});
