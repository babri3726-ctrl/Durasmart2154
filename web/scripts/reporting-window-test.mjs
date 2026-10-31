/** Boundary tests for the reporting window and target form — `src/lib/reportingWindow.ts`.
 *
 *  A wrong window asks the server a different question than the one on screen, and a quantity the
 *  form lets through becomes a target the backend refuses or silently rescales. The dates here
 *  are local-calendar dates for the reason the module documents: slicing an ISO timestamp would
 *  move a month boundary by a day east of UTC.
 *
 *  What is not tested: no rule here decides whether a target may be written or what a percentage
 *  is. The owner gate, the overlap rule and every figure remain the server's.
 *
 *  No bundler: `node --test` loads the module directly with type stripping.
 *
 *  Usage:  npm run test:reporting
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isoDate,
  monthWindow,
  shiftMonth,
  windowProblem,
  normalizeQuantity,
  targetDraftProblem,
} from '../src/lib/reportingWindow.ts';

const draft = (over = {}) => ({
  employeeId: 'EMP-0001',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  productCategory: '',
  quantity: '20',
  unit: 'MT',
  ...over,
});

// ── the window ───────────────────────────────────────────────────────────

test('a month window is the first and last calendar day', () => {
  assert.deepEqual(monthWindow(new Date(2026, 9, 20)), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(monthWindow(new Date(2026, 1, 10)), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthWindow(new Date(2028, 1, 10)), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthWindow(new Date(2026, 11, 31)), { from: '2026-12-01', to: '2026-12-31' });
});

test('the window is built from calendar fields, not a timestamp slice', () => {
  assert.equal(isoDate(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(isoDate(new Date(2026, 8, 9)), '2026-09-09');
});

test('month arithmetic crosses a year in both directions', () => {
  assert.deepEqual(monthWindow(shiftMonth(new Date(2026, 0, 15), -1)), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(monthWindow(shiftMonth(new Date(2026, 11, 15), 1)), { from: '2027-01-01', to: '2027-01-31' });
});

test('a reversed window is named before it is sent', () => {
  assert.equal(windowProblem('', ''), '');
  assert.equal(windowProblem('2026-10-01', '2026-09-30').includes('ends before it starts'), true);
  assert.equal(windowProblem('2026-10-01', '2026-10-31'), '');
  assert.equal(windowProblem('2026-10-01', '2026-10-01'), '');
});

// ── the target quantity ──────────────────────────────────────────────────

test('a typed quantity takes the wire’s three-decimal shape', () => {
  assert.equal(normalizeQuantity('20'), '20.000');
  assert.equal(normalizeQuantity('0'), '0.000');
  assert.equal(normalizeQuantity('0.000'), '0.000');
  assert.equal(normalizeQuantity('12.5'), '12.500');
  assert.equal(normalizeQuantity('0012.345'), '12.345');
  assert.equal(normalizeQuantity('  7.25  '), '7.250');
});

test('a quantity the column cannot hold is refused, not rounded', () => {
  assert.equal(normalizeQuantity('1.2345'), null);
  assert.equal(normalizeQuantity('-1'), null);
  assert.equal(normalizeQuantity('1,000'), null);
  assert.equal(normalizeQuantity('1.'), null);
  assert.equal(normalizeQuantity('.5'), null);
  assert.equal(normalizeQuantity('abc'), null);
  assert.equal(normalizeQuantity(''), null);
});

// ── the target form ──────────────────────────────────────────────────────

test('a complete target has no problem', () => {
  assert.equal(targetDraftProblem(draft()), '');
});

test('the form names the first missing or incoherent field', () => {
  assert.equal(targetDraftProblem(draft({ employeeId: '' })).includes('Choose the salesperson'), true);
  assert.equal(targetDraftProblem(draft({ periodStart: '' })).includes('both a start and an end'), true);
  assert.equal(targetDraftProblem(draft({ periodEnd: '2026-09-30' })).includes('ends before it starts'), true);
  assert.equal(targetDraftProblem(draft({ quantity: '1.2345' })).includes('at most three decimals'), true);
  assert.equal(targetDraftProblem(draft({ unit: '   ' })).includes('no unit'), true);
});

test('a blank category means the whole book and is not a problem', () => {
  assert.equal(targetDraftProblem(draft({ productCategory: '' })), '');
  assert.equal(targetDraftProblem(draft({ productCategory: 'Fertilizer' })), '');
});
