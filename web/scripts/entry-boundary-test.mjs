/** Boundary tests for the live entry forms — the text-to-request rules in `src/lib/entryRules.ts`.
 *
 *  These rules decide what actually leaves the panel: what "1,20,000.50" means in paise, when a
 *  mobile is usable, and whether a retry after a failure counts as the *same* submission (the
 *  idempotency question the server answers with 409 when it is asked wrong). Getting them wrong
 *  does not render a broken screen — it posts a *wrong number* the server accepts, which is the
 *  one class of bug a screenshot review can never catch.
 *
 *  The mobile cases mirror `backend/app/services/customers.py::normalise_mobile`, and the same
 *  literals are pinned against the server's own copy by `backend/tests/test_manual_entry_api.py`
 *  (`98765 43210` → `9876543210`, `+91 98-765 43211` → `9876543211`). If the two sides drift, one
 *  of the two suites fails rather than the duplicate check quietly missing a duplicate.
 *
 *  No bundler and no database: `node --test` loads the module directly with type stripping, so
 *  the file must stay erasable TypeScript with no imports.
 *
 *  Usage:  npm run test:entry
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paiseFromRupees,
  exactRupees,
  normaliseMobile,
  mobileProblem,
  customerDraftProblems,
  foldTerm,
  canonicalJson,
  idempotencyKeyFor,
} from '../src/lib/entryRules.ts';
import {
  buildOrderLines,
  quantityProblem,
  gstProblem,
  unitProblem,
  hasPositiveQuantity,
  cancelNeedsReason,
} from '../src/lib/orderEntry.ts';
import { orderLabel, orderShareText, qtyLabel, rupees, waNumber, whatsappShareUrl } from '../src/lib/format.ts';

// ── rupees → paise ───────────────────────────────────────────────────────

test('a plain rupee amount becomes paise', () => {
  assert.deepEqual(paiseFromRupees('500'), { ok: true, paise: 50_000 });
});

test('commas, spaces and a leading ₹ are tolerated, because that is how a bill copies out', () => {
  assert.deepEqual(paiseFromRupees('1,20,000.50'), { ok: true, paise: 12_000_050 });
  assert.deepEqual(paiseFromRupees('₹ 1,250'), { ok: true, paise: 125_000 });
  assert.deepEqual(paiseFromRupees(' 99.99 '), { ok: true, paise: 9_999 });
});

test('the smallest expressible amount survives exactly', () => {
  assert.deepEqual(paiseFromRupees('0.01'), { ok: true, paise: 1 });
});

test('zero and blank are refused, with the reason the field will show', () => {
  assert.deepEqual(paiseFromRupees(''), { ok: false, reason: 'Enter an amount in rupees.' });
  assert.equal(paiseFromRupees('0').ok, false);
  assert.equal(paiseFromRupees('0.00').ok, false);
});

test('a negative sign is refused — direction is the radio\'s job, not the amount\'s', () => {
  assert.equal(paiseFromRupees('-5').ok, false);
});

test('finer than a paisa is refused rather than rounded', () => {
  assert.equal(paiseFromRupees('1.234').ok, false);
  assert.equal(paiseFromRupees('0.005').ok, false);
});

test('letters and exponent notation are refused', () => {
  assert.equal(paiseFromRupees('abc').ok, false);
  assert.equal(paiseFromRupees('1e5').ok, false);
  assert.equal(paiseFromRupees('12o').ok, false);
});

test('an amount beyond exact float-integer range is refused, and the boundary itself passes', () => {
  assert.equal(paiseFromRupees('1000000000001').ok, false);
  assert.deepEqual(paiseFromRupees('1000000000000'), { ok: true, paise: 100_000_000_000_000 });
});

// ── exact display: what a confirmation may quote ─────────────────────────

test('an entered amount is displayed exactly, never rounded to a different number', () => {
  assert.equal(exactRupees(125_050), '₹1,250.50');
  assert.equal(exactRupees(5_000), '₹50.00');
  assert.equal(exactRupees(1), '₹0.01');
  assert.equal(exactRupees(0), '₹0.00');
  assert.equal(exactRupees(-5_000), '-₹50.00');
});

test('exact display keeps the Indian grouping the rest of the panel uses', () => {
  assert.equal(exactRupees(120_000_00), '₹1,20,000.00');
  assert.equal(exactRupees(100_000_000_000_000), '₹10,00,00,00,00,000.00');
});

// ── mobile normalisation (mirrors the server's normalise_mobile) ─────────

test('spacing, +91, a bare 91 prefix and a leading zero all fold to the same ten digits', () => {
  const cases = [
    '9876543210',
    '98765 43210', // the literal the backend suite stores
    '+91 98765-43210',
    '+919876543210',
    '91 9876543210',
    '09876543210',
    '(987) 654-3210',
    '+91 98-765 43211', // the literal the backend suite stores, and normalises to ...211
  ];
  assert.equal(normaliseMobile(cases[0]), '9876543210');
  assert.equal(normaliseMobile(cases[1]), '9876543210');
  assert.equal(normaliseMobile(cases[2]), '9876543210');
  assert.equal(normaliseMobile(cases[3]), '9876543210');
  assert.equal(normaliseMobile(cases[4]), '9876543210');
  assert.equal(normaliseMobile(cases[5]), '9876543210');
  assert.equal(normaliseMobile(cases[6]), '9876543210');
  assert.equal(normaliseMobile(cases[7]), '9876543211');
});

test('only an exactly-twelve-digit 91 prefix is treated as a country code', () => {
  // Eleven digits starting "91" is a typo, not a country code; stripping would invent a number.
  assert.equal(normaliseMobile('91987654321'), '91987654321');
  assert.notEqual(mobileProblem('91987654321'), null);
});

test('a usable mobile has no problem; the wrong shape gets the server\'s own sentence', () => {
  assert.equal(mobileProblem('+91 98765-43210'), null);
  assert.equal(mobileProblem('12345'), 'Enter a 10-digit mobile number beginning 6-9.');
  assert.equal(mobileProblem('5876543210'), 'Enter a 10-digit mobile number beginning 6-9.');
  assert.equal(mobileProblem('987654321'), 'Enter a 10-digit mobile number beginning 6-9.');
  assert.equal(mobileProblem(''), 'Enter a 10-digit mobile number beginning 6-9.');
});

// ── whole-draft problems, keyed by the API's field names ─────────────────

function draft(overrides = {}) {
  return {
    name: 'Ravi Steels',
    mobile: '9876543210',
    contactPerson: '',
    city: 'Ludhiana',
    district: 'Ludhiana',
    state: 'Punjab',
    address: '',
    notes: '',
    salespersonId: '',
    creditDays: '',
    ...overrides,
  };
}

test('a well-formed draft has no problems', () => {
  assert.deepEqual(customerDraftProblems(draft()), {});
  assert.deepEqual(customerDraftProblems(draft({ creditDays: '30' })), {});
});

test('a blank name is a problem, and whitespace is blank', () => {
  assert.ok(customerDraftProblems(draft({ name: '   ' })).name);
  assert.ok(customerDraftProblems(draft({ name: '' })).name);
});

test('an unusable mobile is reported under the mobile field', () => {
  const problems = customerDraftProblems(draft({ mobile: '12345' }));
  assert.deepEqual(Object.keys(problems), ['mobile']);
});

test('credit days must be a whole number between 0 and 365, or blank for the business default', () => {
  assert.equal(customerDraftProblems(draft({ creditDays: '0' })).creditDays, undefined);
  assert.equal(customerDraftProblems(draft({ creditDays: '365' })).creditDays, undefined);
  assert.ok(customerDraftProblems(draft({ creditDays: '366' })).creditDays);
  assert.ok(customerDraftProblems(draft({ creditDays: '-1' })).creditDays);
  assert.ok(customerDraftProblems(draft({ creditDays: '3.5' })).creditDays);
  assert.ok(customerDraftProblems(draft({ creditDays: 'abc' })).creditDays);
});

// ── the search fold the match endpoint also applies ──────────────────────

test('a typed term folds the way the server folds it before comparing', () => {
  assert.equal(foldTerm('  Spaced   Steel '), 'spaced steel');
  assert.equal(foldTerm('ABC  DEF'), 'abc def');
  assert.equal(foldTerm('already folded'), 'already folded');
  assert.equal(foldTerm(''), '');
});

// ── idempotency keys: one per submission intent ──────────────────────────

test('canonical JSON ignores key order but not array order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(canonicalJson({ a: [1, { y: 1, x: 2 }] }), canonicalJson({ a: [1, { x: 2, y: 1 }] }));
});

test('a retry of the identical body reuses its key — including when only key order changed', () => {
  let calls = 0;
  const makeKey = () => `key-${++calls}`;
  const first = idempotencyKeyFor(null, { asOf: '2026-04-01', amountPaise: 50000, direction: 'owes' }, makeKey);
  assert.equal(calls, 1);
  const retry = idempotencyKeyFor(first, { direction: 'owes', asOf: '2026-04-01', amountPaise: 50000 }, makeKey);
  assert.equal(retry.key, first.key);
  assert.equal(calls, 1, 'the retry must not mint a second key');
});

test('an edited body is a different submission and gets a fresh key', () => {
  let calls = 0;
  const makeKey = () => `key-${++calls}`;
  const first = idempotencyKeyFor(null, { amountPaise: 50000 }, makeKey);
  const edited = idempotencyKeyFor(first, { amountPaise: 50001 }, makeKey);
  assert.notEqual(edited.key, first.key);
  assert.equal(calls, 2);

  // And once the edit has its own key, retrying *that* stays on it.
  const retryAfterEdit = idempotencyKeyFor(edited, { amountPaise: 50001 }, makeKey);
  assert.equal(retryAfterEdit.key, edited.key);
  assert.equal(calls, 2);
});

// ── order entry: the line as typed, the line as sent ─────────────────────

function line(overrides = {}) {
  // A mapped SKU by default, because a line without any product is the row the next test is about.
  return { productId: 'P-1', productName: '', unit: 'MT', quantity: '5.000', rateRupees: '1200', gstPercent: '', ...overrides };
}

test('a quantity is a decimal string, greater than zero, and no wider than the column', () => {
  assert.equal(quantityProblem('5.000'), null);
  assert.equal(quantityProblem('12.5'), null);
  assert.equal(quantityProblem('0.000001'), null);
  assert.ok(quantityProblem(''));
  assert.equal(quantityProblem('0'), 'The quantity must be greater than zero.');
  assert.ok(quantityProblem('-5'));
  assert.ok(quantityProblem('1e5'));
  assert.ok(quantityProblem('1.1234567')); // seven decimals is wider than the NUMERIC scale
  assert.ok(quantityProblem('5,000')); // a grouping comma is not a decimal string
});

test('GST is optional, and blank is not the same statement as zero', () => {
  assert.equal(gstProblem(''), null);
  assert.equal(gstProblem('0'), null);
  assert.equal(gstProblem('18'), null);
  assert.equal(gstProblem('2.5'), null);
  assert.ok(gstProblem('18.555'));
  assert.ok(gstProblem('abc'));
});

test('a unit is required on every line, because the server stores it and never guesses one', () => {
  assert.equal(unitProblem('MT'), null);
  assert.ok(unitProblem('  '));
});

test('a mapped line sends its id, a typed material sends its name, and never both', () => {
  const built = buildOrderLines([line({ productId: 'P-1', productName: 'ignored', gstPercent: '18' })], paiseFromRupees);
  assert.deepEqual(built.problems, {});
  assert.deepEqual(built.lines, [{ quantity: '5.000', unit: 'MT', ratePaise: 120000, productId: 'P-1', gstRatePercent: '18' }]);

  const typed = buildOrderLines([line({ productId: '', productName: 'Scrap offcut', unit: 'KG', quantity: '12.5' })], paiseFromRupees);
  assert.equal(typed.lines[0].productName, 'Scrap offcut');
  assert.equal(typed.lines[0].productId, undefined);
  assert.deepEqual(typed.problems, {});
});

test('a blank GST field goes out as null, not as an empty string and not as zero', () => {
  const built = buildOrderLines([line()], paiseFromRupees);
  assert.equal(built.lines[0].gstRatePercent, null);
});

test('the rupee rate becomes integer paise on the wire, exactly as the amount rules already decide', () => {
  const built = buildOrderLines([line({ rateRupees: '1,20,000.50' })], paiseFromRupees);
  assert.equal(built.lines[0].ratePaise, 12_000_050);
});

test('an empty row the operator added and did not fill is dropped, not sent and not an error', () => {
  const built = buildOrderLines([line(), line({ productId: '', productName: '', unit: '', quantity: '', rateRupees: '', gstPercent: '' })], paiseFromRupees);
  assert.equal(built.lines.length, 1);
  assert.deepEqual(built.problems, {});
});

test('a half-filled row is a problem on that row, and the rows are numbered as sent', () => {
  const built = buildOrderLines(
    [line({ productId: '', productName: '' }), line({ quantity: '0' })],
    paiseFromRupees,
  );
  assert.ok(built.problems['lines.0.productId']);
  assert.equal(built.problems['lines.1.quantity'], 'The quantity must be greater than zero.');
  assert.equal(built.lines.length, 0);
});

test('a dispatched quantity is positive or it is not, and a negative stays a finding', () => {
  assert.equal(hasPositiveQuantity('0.000'), false);
  assert.equal(hasPositiveQuantity(''), false);
  assert.equal(hasPositiveQuantity('5.000'), true);
  assert.equal(hasPositiveQuantity('-2.000'), false);
});

test('a force-cancel asks for the reason before the server has to refuse one', () => {
  assert.equal(cancelNeedsReason({ status: 'draft', dispatchedQuantity: '0.000' }), false);
  assert.equal(cancelNeedsReason({ status: 'pending', dispatchedQuantity: '0.000' }), false);
  assert.equal(cancelNeedsReason({ status: 'pending', dispatchedQuantity: '2.000' }), true);
  assert.equal(cancelNeedsReason({ status: 'confirmed', dispatchedQuantity: '0.000' }), true);
});

// ── rupees, quantity and the WhatsApp text built from server fields ───────

test('rupees() is exact paise with Indian grouping, and keeps a negative signed', () => {
  assert.equal(rupees(125_050), '₹1,250.50');
  assert.equal(rupees(12_000_050), '₹1,20,000.50');
  assert.equal(rupees(1), '₹0.01');
  assert.equal(rupees(0), '₹0.00');
  assert.equal(rupees(-5_000), '-₹50.00');
});

test('a quantity keeps the digits the server sent', () => {
  assert.equal(qtyLabel('5.000', 'MT'), '5.000 MT');
  assert.equal(qtyLabel('-2.50', 'KG'), '-2.50 KG');
  assert.equal(qtyLabel('12', ''), '12');
});

test('an order is named by its printed number and never by its internal id', () => {
  assert.equal(orderLabel({ number: 'SO-2627-0007' }), 'Order SO-2627-0007');
  // S-10: the id is how a route addresses the row, not a number a person can quote back. When the
  // answer carries no printed number, the only honest label says the number is missing.
  for (const row of [{ number: null }, { number: '' }, {}, { number: null, id: 'ORD-7f3a91' }]) {
    assert.match(orderLabel(row), /no printed number yet/);
    assert.ok(!orderLabel(row).includes('ORD-7f3a91'), 'an internal id reached a person-facing label');
  }
});

test('a wa.me link is built from the row the server sent, or not built at all', () => {
  assert.equal(waNumber('+91 98765-43210'), '919876543210');
  assert.equal(waNumber('9876543210'), '919876543210');
  assert.equal(waNumber('5876543210'), null); // not a mobile the link should guess about
  assert.equal(
    whatsappShareUrl('9876543210', 'a\nb'),
    'https://wa.me/919876543210?text=a%0Ab',
  );
  assert.equal(whatsappShareUrl('', 'anything'), null);
});

test('the share text carries the server’s own number, quantity and value and invents none', () => {
  const text = orderShareText({
    number: 'SO-2627-0007',
    customerName: 'Ravi Steels',
    orderDate: '2026-10-19',
    status: 'pending',
    valuePaise: 60_000_000,
    lines: [{ productName: 'MS Sheet 2mm', quantity: '5.000', unit: 'MT', ratePaise: 120_000_00 }],
  });
  assert.match(text, /Order SO-2627-0007/);
  assert.match(text, /MS Sheet 2mm — 5\.000 MT @ ₹1,20,000\.00/);
  assert.match(text, /Order value: ₹6,00,000\.00/);
});

test('an unsubmitted draft is shared as a draft, because it has no printed number yet', () => {
  const text = orderShareText({
    number: null,
    customerName: 'Ravi Steels',
    valuePaise: 0,
    lines: [{ productName: 'Coil', quantity: '1.5', unit: 'MT' }],
  });
  assert.match(text, /draft \(no number yet\)/);
  assert.doesNotMatch(text, /null/);
});
