/** Phase 5 — the shared stock reads: the body the backend answers with, and what the two metal
 *  tabs do with it.
 *
 *  This is the read-side counterpart of `stock-preview-contract-test.mjs`, and it exists because
 *  Steel Coil (Slit) and Profile / Kanda render the *same* `GET /stock/summary` body as the
 *  dashboard and the phone. Three things are checked, and they fail for different reasons:
 *
 *  * **The golden vs the panel's declared interfaces.** `scripts/stock-read-schema.json` is read
 *    out of the backend's own OpenAPI document by
 *    `scripts/export-stock-read-schema.py`. Set-equality in both directions means a field renamed
 *    on either side fails a test rather than rendering `undefined` in front of an owner. There is
 *    no generated client here, so this comparison is the only thing keeping the two honest.
 *  * **The fixtures.** Every fixture below is written key-for-key against that golden, so a test
 *    cannot pass by drifting from the response shape. The figures are synthetic. The mockup's
 *    numbers are illustrative and none of them is written into either application — the last
 *    section checks the panel's stock source for exactly that.
 *  * **The rules the screens apply.** Filtering, ordering and paging are pure functions in
 *    `src/lib/stockView.ts`, so they are called directly. What a component does with the result is
 *    checked against its source: the category card renders the server's own total, a withheld row
 *    keeps its figure, and no screen adds a quantity.
 *
 *  `src/lib/serverApi.ts` is read as text, not imported — it reaches for `import.meta.env`, so it
 *  belongs to the bundle. `src/lib/stockView.ts` erases cleanly and is imported.
 *
 *  Usage:  node --test scripts/stock-read-contract-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitText } from '../src/lib/stockPreviewModel.ts';
import {
  CATEGORY_VIEW,
  STOCK_TABS,
  VIEW_CATEGORY,
  groupedQuantity,
  materialMatches,
  pageOf,
  selectMaterials,
  serverTimestampText,
} from '../src/lib/stockView.ts';

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = join(here, '..');
const source = (relative) => readFileSync(join(panelRoot, relative), 'utf8');
const golden = JSON.parse(source('scripts/stock-read-schema.json'));

/** The panel's hand-written DTO for each model the backend answers with. Both gap routes share one
 *  interface, which is only legitimate because the two models carry the same fields — a test below
 *  pins that, rather than trusting the naming. */
const DTO = {
  ServerStockSummary: 'StockSummaryOut',
  ServerStockBatchBrief: 'StockBatchBriefOut',
  ServerStockCategory: 'StockCategoryOut',
  ServerStockMaterial: 'StockMaterialOut',
  ServerStockWithheldGroup: 'StockWithheldGroupOut',
  ServerStockWarningBrief: 'StockWarningBriefOut',
  ServerUpvcStock: 'UpvcStockOut',
  ServerUpvcRow: 'UpvcRowOut',
  ServerUpvcGroup: 'UpvcGroupOut',
  ServerUpvcCell: 'UpvcCellOut',
  ServerUpvcTotals: 'UpvcTotalsOut',
  ServerStockGapCategory: 'GapCategoryOut',
  ServerStockGap: 'AccessoryStockOut',
};

const serverApi = source('src/lib/serverApi.ts');

/** The field names one `export interface` declares, from the bundle source this file cannot import. */
function declaredFields(name) {
  const start = serverApi.indexOf(`export interface ${name} {`);
  assert.notEqual(start, -1, `the panel no longer declares ${name}`);
  const end = serverApi.indexOf('\n}', start);
  const body = serverApi
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z0-9_]+)\??:/gm)].map((match) => match[1]);
}

/** The declared type of one field, so far as it fits on its line. */
function declaredType(name, field) {
  const start = serverApi.indexOf(`export interface ${name} {`);
  const line = new RegExp(`^\\s*${field}\\??:\\s*(.+);$`, 'm').exec(serverApi.slice(start, serverApi.indexOf('\n}', start)));
  assert.notEqual(line, null, `${name}.${field} is not declared`);
  return line[1];
}

// ── fixtures: the response shape, with synthetic figures ─────────────────

const STEEL = 'steel-coil';
const PROFILE = 'profile-kanda';

const categoryFields = golden.models.StockCategoryOut;
const materialFields = golden.models.StockMaterialOut;
const groupFields = golden.models.StockWithheldGroupOut;
const briefFields = golden.models.StockBatchBriefOut;
const summaryFields = golden.models.StockSummaryOut;
const warningFields = golden.models.StockWarningBriefOut;

const syntheticSha = 'a'.repeat(64);

const category = (overrides = {}) => ({
  key: STEEL,
  label: 'Steel Coil (Slit)',
  sourceSheet: 'TOTAL STOCK',
  status: 'resolved',
  figureCount: 4,
  withheldCount: 0,
  quantity: '1150.000',
  withheldQuantity: null,
  unit: null,
  pieces: null,
  footage: null,
  negativeCount: 1,
  staleCount: 1,
  note: 'SLIT COIL block of the TOTAL STOCK sheet. The sheet states no unit for this block.',
  ...overrides,
});

const material = (overrides = {}) => ({
  itemKey: 'steel-1',
  categoryKey: STEEL,
  categoryLabel: 'Steel Coil (Slit)',
  sourceSheet: 'TOTAL STOCK',
  sectionId: 'total_stock.slit_coil',
  sectionName: 'Slit Coil',
  tableId: 'slit.A2',
  tableDisplayName: 'Slit',
  label: 'Coil 0.18 Red',
  columnLabel: 'Qty',
  status: 'resolved',
  rowNumber: 3,
  sourceLabel: 'COIL 0.18 RED',
  labelCoordinate: 'A3',
  company: 'North',
  quantity: '25.000',
  unit: null,
  stockType: null,
  colour: null,
  dimensionLabel: null,
  dimensionValue: null,
  lengthFt: null,
  footage: null,
  reasons: [],
  warnings: [],
  stale: false,
  sourceBatchId: 'SIM-0000000001',
  carriedFromBatchId: null,
  carryReason: null,
  valueCoordinate: 'B3',
  ...overrides,
});

const snapshot = (overrides = {}) => ({
  available: true,
  batchId: 'SIM-0000000001',
  filename: 'workbook.xlsx',
  appliedAt: '2026-01-01T09:01:08+05:30',
  appliedByName: 'Owner',
  fileSha256: syntheticSha,
  authorizedSha256: syntheticSha,
  itemCount: 8,
  appliedItemCount: 5,
  staleCount: 1,
  quarantineCount: 3,
  sheetsRead: ['TOTAL STOCK'],
  ...overrides,
});

const withheldGroup = (overrides = {}) => ({
  categoryKey: PROFILE,
  categoryLabel: 'Profile / Kanda',
  sourceSheet: 'TOTAL STOCK',
  count: 2,
  quantity: '12.000',
  reasons: { parentRowWithoutGroup: 1, labelWithoutValue: 1 },
  ...overrides,
});

const warning = (overrides = {}) => ({
  key: 'negativeQuantity',
  severity: 'warning',
  message: 'A negative quantity is kept as the sheet wrote it.',
  count: 1,
  ...overrides,
});

/** The rows the summary carries for the two metal sections plus GP. Steel keeps a stale carry, a
 *  negative and a row with no unit; Profile keeps one withheld row that still holds a figure and
 *  one withheld row with nothing to show. GP is withheld as a category. */
const metalMaterials = [
  material({ itemKey: 'steel-1' }),
  material({
    itemKey: 'steel-2',
    label: 'Coil 0.25 Blue',
    company: 'South',
    quantity: '1200.000',
    rowNumber: 4,
    labelCoordinate: 'A4',
    valueCoordinate: 'B4',
    sourceLabel: 'COIL 0.25 BLUE',
  }),
  material({
    itemKey: 'steel-3',
    label: 'Coil 0.50',
    quantity: '-75.000',
    rowNumber: 5,
    labelCoordinate: 'A5',
    valueCoordinate: 'B5',
    sourceLabel: 'COIL 0.50',
    company: null,
    warnings: ['negativeQuantity'],
  }),
  material({
    itemKey: 'steel-4',
    label: 'Coil 0.60',
    quantity: '5.000',
    rowNumber: 6,
    labelCoordinate: 'A6',
    valueCoordinate: 'B6',
    sourceLabel: 'COIL 0.60',
    stale: true,
    carriedFromBatchId: 'SIM-0000000000',
    carryReason: 'not in the newest file',
  }),
  material({
    itemKey: 'profile-1',
    categoryKey: PROFILE,
    categoryLabel: 'Profile / Kanda',
    sectionId: 'total_stock.profile_kanda',
    sectionName: 'Profile Kanda',
    tableId: 'profile.A2',
    tableDisplayName: 'Profile',
    label: 'Profile 50 White',
    rowNumber: 7,
    labelCoordinate: 'A7',
    valueCoordinate: 'B7',
    sourceLabel: 'PROFILE 50 WHITE',
    colour: 'White',
    dimensionLabel: 'Size',
    dimensionValue: '50',
    quantity: '30.000',
  }),
  material({
    itemKey: 'profile-2',
    categoryKey: PROFILE,
    categoryLabel: 'Profile / Kanda',
    sectionId: 'total_stock.profile_kanda',
    sectionName: 'Profile Kanda',
    tableId: 'profile.A2',
    tableDisplayName: 'Profile',
    label: 'Profile 75 Black',
    rowNumber: 8,
    labelCoordinate: 'A8',
    sourceLabel: 'PROFILE 75 BLACK',
    colour: 'Black',
    company: 'North',
    status: 'withheld',
    quantity: '12.000',
    valueCoordinate: 'B8',
    reasons: ['parentRowWithoutGroup'],
    sourceBatchId: null,
  }),
  material({
    itemKey: 'profile-3',
    categoryKey: PROFILE,
    categoryLabel: 'Profile / Kanda',
    sectionId: 'total_stock.profile_kanda',
    sectionName: 'Profile Kanda',
    tableId: 'profile.A2',
    tableDisplayName: 'Profile',
    label: '',
    rowNumber: 9,
    labelCoordinate: 'A9',
    sourceLabel: '',
    company: null,
    status: 'withheld',
    quantity: null,
    valueCoordinate: null,
    reasons: ['labelWithoutValue'],
    sourceBatchId: null,
  }),
  material({
    itemKey: 'gp-1',
    categoryKey: 'gp-sheet',
    categoryLabel: 'GP Sheet',
    sectionId: 'total_stock.gp',
    sectionName: 'GP',
    tableId: 'gp.A2',
    tableDisplayName: 'GP',
    label: 'GP 0.35',
    rowNumber: 10,
    labelCoordinate: 'A10',
    valueCoordinate: 'B10',
    sourceLabel: 'GP 0.35',
    status: 'withheld',
    quantity: '77.000',
    reasons: ['ambiguousGrouping'],
    sourceBatchId: null,
  }),
];

const categories = [
  category(),
  category({
    key: PROFILE,
    label: 'Profile / Kanda',
    figureCount: 1,
    withheldCount: 2,
    quantity: '30.000',
    withheldQuantity: '12.000',
    negativeCount: 0,
    staleCount: 0,
    note: 'Profile Kanda block of the TOTAL STOCK sheet. Resolved company children are applied; a company subtotal is not added to them.',
  }),
  category({
    key: 'gp-sheet',
    label: 'GP Sheet',
    status: 'withheld',
    figureCount: 0,
    withheldCount: 1,
    quantity: null,
    withheldQuantity: '77.000',
    negativeCount: 0,
    staleCount: 0,
    note: 'The parser could not assign these rows to a company group, so the plan withholds them.',
  }),
  category({
    key: 'upvc-new',
    label: 'UPVC New',
    sourceSheet: 'UPVC TOTAL STOCK',
    figureCount: 12,
    withheldCount: 0,
    quantity: null,
    withheldQuantity: null,
    unit: null,
    pieces: '210.000',
    footage: '1680.000',
    negativeCount: 0,
    staleCount: 0,
    note: 'New stock band of the UPVC TOTAL STOCK sheet.',
  }),
];

const stockSummary = (overrides = {}) => ({
  available: true,
  snapshot: snapshot(),
  categories,
  materials: metalMaterials,
  withheld: [withheldGroup()],
  warnings: [warning()],
  stockMovementsCreated: false,
  ...overrides,
});

/** Every key the fixture carries, and only those, for one model of the golden. */
function assertShape(node, model, trail) {
  const want = golden.models[model];
  assert.ok(want, `the golden declares no ${model}`);
  assert.deepEqual(
    Object.keys(node).sort(),
    [...want].sort(),
    `${trail} is not a ${model}: fixture has ${Object.keys(node).sort().join(', ')}; the backend answers with ${[...want].sort().join(', ')}`,
  );
}

// ── the routes, and what they answer with ────────────────────────────────

test('every stock read the panel calls is a documented GET route', () => {
  assert.deepEqual(golden.routes, {
    summary: '/api/v1/stock/summary',
    upvc: '/api/v1/stock/upvc',
    accessories: '/api/v1/stock/accessories',
    production: '/api/v1/stock/production',
  });
  const quote = "['`\x22]";
  for (const [alias, route] of Object.entries(golden.routes)) {
    const path = route.slice('/api/v1'.length);
    // The literal call argument is the documented path; a query string may follow it.
    const call = new RegExp(`send<Server[A-Za-z]+>\\(\\s*${quote}${path}`);
    assert.match(serverApi, call, `${alias}: the panel does not call ${route}`);
  }
  assert.deepEqual(golden.queryParams.upvc, ['colour', 'lengthFt', 'q', 'type']);
  assert.deepEqual(golden.queryParams.summary, []);
  // The UPVC read sends the server's filters as query parameters and nothing else — a screen-side
  // re-filter would be a second, drifting definition of what "New stock, White, 10 ft" means.
  const upvcRead = serverApi.slice(
    serverApi.indexOf('export function readUpvcStock'),
    serverApi.indexOf('// ── the two honest gaps'),
  );
  assert.deepEqual(
    [...upvcRead.matchAll(/query\.set\('([A-Za-z]+)'/g)].map((match) => match[1]).sort(),
    golden.queryParams.upvc,
  );
});

test('the panel declares the body the backend answers with, field for field', () => {
  const drift = [];
  for (const [name, model] of Object.entries(DTO)) {
    const declared = declaredFields(name);
    const answer = golden.models[model];
    assert.ok(answer, `the golden declares no ${model}`);
    const missing = answer.filter((field) => !declared.includes(field));
    const extra = declared.filter((field) => !answer.includes(field));
    if (missing.length > 0 || extra.length > 0) {
      drift.push(`${name} ↔ ${model}: response has but panel does not — ${missing.join(', ') || 'nothing'}; panel has but response does not — ${extra.join(', ') || 'nothing'}`);
    }
  }
  assert.deepEqual(drift, [], `the stock DTOs drifted against the backend:\n${drift.join('\n')}`);
});

test('the two gap routes answer with the same fields, so one interface can serve both', () => {
  assert.deepEqual(golden.models.AccessoryStockOut, golden.models.ProductionStockOut);
  const declared = declaredFields('ServerStockGap');
  assert.deepEqual([...declared].sort(), [...golden.models.ProductionStockOut].sort());
});

test('every decimal-text field is typed as text, and nothing on the wire is a float', () => {
  assert.ok(golden.decimalStringFields.length > 0, 'the golden stopped classifying decimal fields');
  for (const path of golden.decimalStringFields) {
    const [model, field] = path.split('.');
    const name = Object.keys(DTO).find((candidate) => DTO[candidate] === model);
    assert.ok(name, `no panel DTO declares ${model}`);
    const type = declaredType(name, field);
    assert.ok(/string/.test(type), `${name}.${field} is typed ${type}: a decimal-text field is not a string`);
    assert.ok(!/number/.test(type), `${name}.${field} is typed ${type}: a quantity must never be a number`);
  }
  // lengthFt is an integer on the wire, which is a different rule from a quantity.
  assert.equal(declaredType('ServerStockMaterial', 'lengthFt'), 'number | null');
});

test('a stock read says it wrote nothing, and that claim is a constant on the wire', () => {
  for (const [model, isConst] of Object.entries(golden.readCreatesNothingIsConstFalse)) {
    assert.equal(isConst, true, `${model}.${golden.readCreatesNothingField} is no longer a const false`);
    const name = Object.keys(DTO).find((candidate) => DTO[candidate] === model);
    assert.equal(declaredType(name, golden.readCreatesNothingField), 'false');
  }
  assert.equal(stockSummary().stockMovementsCreated, false);
  const reads = serverApi.slice(serverApi.indexOf('export function readStockSummary'), serverApi.indexOf('// ── the UPVC floor read'));
  assert.ok(!reads.includes('method:'), 'a stock read is no longer a GET');
});

// ── the fixtures are the response shape ──────────────────────────────────

test('the fixtures are the response shape, key for key', () => {
  const body = stockSummary();
  assertShape(body, 'StockSummaryOut', 'GET /stock/summary');
  assertShape(body.snapshot, 'StockBatchBriefOut', 'summary.snapshot');
  assertShape(body.withheld[0], 'StockWithheldGroupOut', 'summary.withheld[0]');
  assertShape(body.warnings[0], 'StockWarningBriefOut', 'summary.warnings[0]');
  for (const item of body.categories) assertShape(item, 'StockCategoryOut', `category ${item.key}`);
  for (const item of body.materials) assertShape(item, 'StockMaterialOut', `material ${item.itemKey}`);

  // The same field lists drive both clients, so a fixture that dropped one would pass here and
  // fail on the phone. Nothing may be optional in the fixture that is required on the wire.
  assert.deepEqual(Object.keys(body).sort(), [...summaryFields].sort());
  assert.deepEqual(Object.keys(body.materials[0]).sort(), [...materialFields].sort());
  assert.deepEqual(Object.keys(body.categories[0]).sort(), [...categoryFields].sort());
  assert.deepEqual(Object.keys(body.snapshot).sort(), [...briefFields].sort());
  assert.deepEqual(Object.keys(body.withheld[0]).sort(), [...groupFields].sort());
  assert.deepEqual(Object.keys(body.warnings[0]).sort(), [...warningFields].sort());
});

test("every category the panel can open is one the backend emits, with the backend's own label", () => {
  const emitted = new Map(golden.categories.map((item) => [item.key, item]));
  for (const [view, key] of Object.entries(VIEW_CATEGORY)) {
    assert.ok(emitted.has(key), `the ${view} tab narrows to ${key}, which the server never emits`);
  }
  for (const key of [STEEL, PROFILE, 'gp-sheet']) {
    assert.ok(Object.keys(CATEGORY_VIEW).includes(key), `${key} has no view to open`);
  }
  const tabLabel = (key) => STOCK_TABS.find((tab) => tab.key === key)?.label;
  assert.equal(tabLabel('steel'), emitted.get(STEEL).label);
  assert.equal(tabLabel('profile'), emitted.get(PROFILE).label);
  assert.equal(golden.sectionCategories.find((item) => item.categoryKey === STEEL).sectionId, 'total_stock.slit_coil');
  assert.equal(golden.sectionCategories.find((item) => item.categoryKey === PROFILE).sectionId, 'total_stock.profile_kanda');
  // A category the panel has no tab for still has an address, so a new server key cannot be a dead card.
  const list = source('src/components/stock/StockKpiStrip.tsx');
  assert.match(list, /CATEGORY_VIEW\[category\.key\] \?\? 'total'/);
});

// ── Steel Coil (Slit) ────────────────────────────────────────────────────

const steelFilter = { term: '', categoryKey: STEEL, status: 'all', sort: 'source' };

test('the steel tab lists only the slit-coil rows the server sent', () => {
  const rows = selectMaterials(stockSummary().materials, steelFilter);
  assert.deepEqual(rows.map((row) => row.itemKey), ['steel-1', 'steel-2', 'steel-3', 'steel-4']);
  assert.ok(rows.every((row) => row.categoryKey === STEEL), 'a steel row came from another category');
  assert.ok(rows.every((row) => row.sectionId === 'total_stock.slit_coil'));
});

test('the steel tab keeps its own server total, not a sum of the rows on screen', () => {
  const body = stockSummary();
  const steel = body.categories.find((item) => item.key === STEEL);
  const shown = groupedQuantity(steel.quantity);
  // Grouping only adds separators: what the card renders is the server's figure, digit for digit.
  assert.equal(shown.replaceAll(',', ''), steel.quantity);
  assert.equal(shown, '1,150.000');
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /category\.quantity[\s\S]{0,80}category\.unit/);
  assert.match(list, /const category = data\?\.categories\.find\(\(item\) => item\.key === categoryKey\)/);
  assert.match(list, /No grand total is shown/);
});

test('searching steel matches label, company, sheet and coordinate — and nothing outside steel', () => {
  const materials = stockSummary().materials;
  const forTerm = (term) =>
    selectMaterials(materials, { ...steelFilter, term }).map((row) => row.itemKey);
  assert.deepEqual(forTerm('blue'), ['steel-2']);
  assert.deepEqual(forTerm('south'), ['steel-2']);
  assert.deepEqual(forTerm('A5'), ['steel-3']);
  assert.deepEqual(forTerm('slit'), ['steel-1', 'steel-2', 'steel-3', 'steel-4']);
  // 'North' is a company on two steel rows and on a profile row: the tab cannot cross into it.
  assert.deepEqual(forTerm('north'), ['steel-1', 'steel-4']);
  assert.ok(
    selectMaterials(materials, { term: 'north', categoryKey: '', status: 'all', sort: 'source' })
      .some((row) => row.categoryKey === PROFILE),
    'the fixture no longer puts a profile row under the same company',
  );
  assert.deepEqual(
    selectMaterials(materials, { ...steelFilter, term: 'profile' }).map((row) => row.itemKey),
    [],
  );
  assert.ok(!materialMatches(materials.find((row) => row.itemKey === 'profile-1'), 'slit'));
});

test('a steel row states no unit because the sheet states none, and never invents one', () => {
  const rows = selectMaterials(stockSummary().materials, steelFilter);
  assert.ok(rows.every((row) => row.unit === null));
  assert.equal(unitText(null), 'unit not stated');
  const strip = source('src/components/stock/StockKpiStrip.tsx');
  assert.match(strip, /category\.unit === null \? 'unit not stated by the sheet' : category\.unit/);
  for (const invented of ['kg', 'ton', 'tons', 'quintal']) {
    assert.ok(
      !new RegExp(`\\b${invented}s?\\b`, 'i').test(strip),
      `the KPI strip names ${invented}, which the sheet never stated`,
    );
  }
});

test('a negative steel figure is kept, flagged and not clamped', () => {
  const rows = selectMaterials(stockSummary().materials, steelFilter);
  const negative = rows.find((row) => row.itemKey === 'steel-3');
  assert.equal(negative.quantity, '-75.000');
  assert.equal(groupedQuantity(negative.quantity), '-75.000');
  assert.deepEqual(negative.warnings, ['negativeQuantity']);
  const category = categories.find((item) => item.key === STEEL);
  assert.equal(category.negativeCount, 1);
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /isNegativeQuantity\(material\.quantity\)/);
  assert.match(list, />negative</);
});

test('a stale steel row says which batch it was carried from', () => {
  const stale = selectMaterials(stockSummary().materials, steelFilter).find((row) => row.stale);
  assert.equal(stale.itemKey, 'steel-4');
  assert.equal(stale.carryReason, 'not in the newest file');
  assert.equal(stale.sourceBatchId, 'SIM-0000000001');
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /stale — \{material\.carryReason \?\? 'carried forward'\}/);
});

// ── Profile / Kanda ──────────────────────────────────────────────────────

const profileFilter = { term: '', categoryKey: PROFILE, status: 'all', sort: 'source' };

test('the profile tab lists its rows in sheet order, applied and withheld together', () => {
  const rows = selectMaterials(stockSummary().materials, profileFilter);
  assert.deepEqual(rows.map((row) => row.itemKey), ['profile-1', 'profile-2', 'profile-3']);
  assert.deepEqual(rows.map((row) => row.status), ['resolved', 'withheld', 'withheld']);
});

test('a withheld profile row keeps its figure and its reason, and has no source batch', () => {
  const withheld = selectMaterials(stockSummary().materials, profileFilter).find((row) => row.status === 'withheld');
  assert.equal(withheld.itemKey, 'profile-2');
  assert.equal(withheld.quantity, '12.000');
  assert.deepEqual(withheld.reasons, ['parentRowWithoutGroup']);
  assert.equal(withheld.sourceBatchId, null, 'a withheld row was never written to a stock batch');
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /<QuantityFigure value=\{material\.quantity\} unit=\{material\.unit\} \/>/);
  assert.match(list, /withheld because: \{material\.reasons\.join\(', '\)\}/);
  assert.match(list, /no stock batch was written/i);
});

test('a withheld row with nothing to show stays absent rather than becoming zero', () => {
  const empty = selectMaterials(stockSummary().materials, profileFilter).find((row) => row.itemKey === 'profile-3');
  assert.equal(empty.quantity, null);
  assert.equal(empty.valueCoordinate, null);
  assert.deepEqual(empty.reasons, ['labelWithoutValue']);
  const bits = source('src/components/stock/StockBits.tsx');
  assert.match(bits, /if \(value === null\) return <span className="text-faint">—<\/span>/);
  assert.ok(!/0<\/span>/.test(bits), 'a null figure is rendered as a zero somewhere in StockBits');
});

test('the status filter splits applied from withheld without moving a figure', () => {
  const materials = stockSummary().materials;
  assert.deepEqual(
    selectMaterials(materials, { ...profileFilter, status: 'resolved' }).map((row) => row.itemKey),
    ['profile-1'],
  );
  assert.deepEqual(
    selectMaterials(materials, { ...profileFilter, status: 'withheld' }).map((row) => row.itemKey),
    ['profile-2', 'profile-3'],
  );
  const after = stockSummary();
  assert.deepEqual(after.categories, categories, 'filtering changed a category figure');
});

test('a withheld category shows the withheld amount beside the words withheld, never a stock quantity', () => {
  const gp = categories.find((item) => item.key === 'gp-sheet');
  assert.equal(gp.quantity, null);
  assert.equal(gp.withheldQuantity, '77.000');
  assert.equal(gp.status, 'withheld');
  const strip = source('src/components/stock/StockKpiStrip.tsx');
  assert.match(strip, /category\.status === 'withheld' && category\.quantity === null/);
  assert.match(strip, /held back by the plan/);
  assert.match(strip, /\$\{category\.withheldCount\} withheld/);
  const bits = source('src/components/stock/StockBits.tsx');
  assert.match(bits, /'withheld by the plan'/);
  assert.match(bits, /'not imported'/);
});

test("the profile card carries the server's own figure counts and withheld group", () => {
  const profile = categories.find((item) => item.key === PROFILE);
  assert.equal(profile.figureCount, 1);
  assert.equal(profile.withheldCount, 2);
  assert.equal(groupedQuantity(profile.withheldQuantity), '12.000');
  const group = stockSummary().withheld[0];
  assert.equal(group.count, profile.withheldCount);
  assert.equal(group.quantity, profile.withheldQuantity);
  assert.deepEqual(group.reasons, { parentRowWithoutGroup: 1, labelWithoutValue: 1 });
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /\{category\.figureCount\} figure/);
  assert.match(list, /\{category\.withheldCount\} withheld row/);
});

// ── search, sort and pagination ──────────────────────────────────────────

test('sheet order walks the source blocks in order and never re-reads a quantity as a number', () => {
  const body = stockSummary();
  const rows = selectMaterials(body.materials, { term: '', categoryKey: '', status: 'all', sort: 'source' });
  assert.equal(rows.length, body.materials.length, 'an unfiltered read dropped a source row');
  // The order the panel calls "Sheet order" is the workbook's own reading order: category block,
  // then table, then row number. It is not the array order the server happened to send.
  assert.deepEqual(rows.map((row) => row.categoryKey), [
    'gp-sheet',
    PROFILE,
    PROFILE,
    PROFILE,
    STEEL,
    STEEL,
    STEEL,
    STEEL,
  ]);
  assert.deepEqual(rows.map((row) => row.rowNumber), [10, 7, 8, 9, 3, 4, 5, 6]);
  for (const key of [STEEL, PROFILE]) {
    const inCategory = rows.filter((row) => row.categoryKey === key).map((row) => row.rowNumber);
    assert.deepEqual(inCategory, [...inCategory].sort((a, b) => a - b), `${key} is not in row order`);
  }
  // The same rows in a different array order come back the same way: order is derived, not inherited.
  const shuffled = selectMaterials([...body.materials].reverse(), { term: '', categoryKey: '', status: 'all', sort: 'source' });
  assert.deepEqual(shuffled.map((row) => row.itemKey), rows.map((row) => row.itemKey));
});

test('label order and withheld-first order are both stable inside a tie', () => {
  // Labels that do not run in the same order as the rows, so an accidental numeric or
  // insertion-order sort cannot pass for a label sort.
  const coils = [
    material({ itemKey: 'z-1', label: 'Zinc coil', rowNumber: 11, labelCoordinate: 'A11' }),
    material({ itemKey: 'a-1', label: 'Aluminium coil', rowNumber: 12, labelCoordinate: 'A12' }),
    material({ itemKey: 'm-1', label: 'Mill coil', rowNumber: 2, labelCoordinate: 'A2' }),
    material({ itemKey: 'a-2', label: 'Aluminium coil', rowNumber: 13, labelCoordinate: 'A13' }),
  ];
  assert.deepEqual(
    selectMaterials(coils, { ...steelFilter, sort: 'label' }).map((row) => row.itemKey),
    ['a-1', 'a-2', 'm-1', 'z-1'],
    'a label sort must break a tie by source order, not by arrival',
  );
  const materials = stockSummary().materials;
  assert.deepEqual(
    selectMaterials(materials, { ...profileFilter, sort: 'status' }).map((row) => row.itemKey),
    ['profile-2', 'profile-3', 'profile-1'],
  );
  assert.deepEqual(
    selectMaterials(materials, { ...steelFilter, sort: 'status' }).map((row) => row.itemKey),
    ['steel-1', 'steel-2', 'steel-3', 'steel-4'],
    'an all-applied category keeps its sheet order under a status sort',
  );
});

test('quantity order compares the decimal texts and parks the absent ones last', () => {
  const materials = stockSummary().materials;
  assert.deepEqual(
    selectMaterials(materials, { ...steelFilter, sort: 'quantity-asc' }).map((row) => row.quantity),
    ['-75.000', '5.000', '25.000', '1200.000'],
  );
  assert.deepEqual(
    selectMaterials(materials, { ...steelFilter, sort: 'quantity-desc' }).map((row) => row.quantity),
    ['1200.000', '25.000', '5.000', '-75.000'],
  );
  assert.deepEqual(
    selectMaterials(materials, { ...profileFilter, sort: 'quantity-asc' }).map((row) => row.itemKey),
    ['profile-2', 'profile-1', 'profile-3'],
  );
});

test('quantity order is offered only inside one category, where the measure is the same', () => {
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /const quantitySortOffered = filter !== '' && filter !== 'upvc-total';/);
  assert.match(list, /Quantity ordering is not offered across categories: unlike units are not comparable/);
  assert.match(list, /where every row uses the same measure/);
  // A page that mixes categories must not order by quantity at all.
  const mixed = selectMaterials(stockSummary().materials, { term: '', categoryKey: '', status: 'all', sort: 'quantity-asc' });
  assert.equal(mixed.length, stockSummary().materials.length);
});

test('the list pages 25 rows at a time, and a page past the end clamps to the last one', () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    material({
      itemKey: `bulk-${index}`,
      label: `Coil bulk ${index}`,
      rowNumber: index + 2,
      quantity: `${index}.000`,
    }),
  );
  const rows = selectMaterials(many, steelFilter);
  assert.equal(rows.length, 30);
  assert.deepEqual(pageOf(rows, 1, 25).map((row) => row.itemKey).slice(0, 2), ['bulk-0', 'bulk-1']);
  assert.equal(pageOf(rows, 1, 25).length, 25);
  assert.equal(pageOf(rows, 2, 25).length, 5);
  assert.deepEqual(pageOf(rows, 2, 25).map((row) => row.itemKey), ['bulk-25', 'bulk-26', 'bulk-27', 'bulk-28', 'bulk-29']);
  assert.deepEqual(pageOf(rows, 9, 25), [], 'a page past the end would render rows the server never sent');

  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /const PAGE_SIZE = 25;/);
  assert.match(list, /const currentPage = Math\.min\(page, Math\.max\(1, Math\.ceil\(rows\.length \/ PAGE_SIZE\)\)\);/);
  assert.match(list, /<Pager page=\{currentPage\} pageSize=\{PAGE_SIZE\} total=\{rows\.length\} onPage=\{setPage\} \/>/);
  // Every control that changes the result returns to page one, so a filter cannot land on page 4.
  for (const setter of ['setTerm', 'setSelectedCategory', 'setStatus', 'setSort']) {
    assert.match(
      list,
      new RegExp(`${setter}\\(event\\.target\\.value(?: as [A-Za-z]+)?\\);\\s*\\n\\s*setPage\\(1\\);`),
      `${setter} does not return the list to page one`,
    );
  }
  assert.equal([...list.matchAll(/setPage\(1\)/g)].length, 4);
  const pager = source('src/components/ui/Pager.tsx');
  assert.match(pager, /Showing \{from\}–\{to\} of \{total\}/);
});

test('a filtered page is a view of the snapshot, never a second total', () => {
  const body = stockSummary();
  const rows = selectMaterials(body.materials, { term: 'coil', categoryKey: STEEL, status: 'withheld', sort: 'source' });
  assert.deepEqual(rows, []);
  const some = selectMaterials(body.materials, { term: '', categoryKey: '', status: 'resolved', sort: 'source' });
  assert.ok(some.length < body.materials.length);
  for (const row of some) {
    assert.ok(body.materials.includes(row), 'a row appeared that the server did not send');
  }
  assert.deepEqual(stockSummary().categories, categories, 'reading rows changed a category figure');
  assert.equal(stockSummary().stockMovementsCreated, false);
});

// ── the states, and what the source must not say ─────────────────────────

test('loading, error, empty and no-snapshot each have their own words', () => {
  const bits = source('src/components/stock/StockBits.tsx');
  assert.match(bits, /if \(state === 'loading'\) return <Spinner label=\{loadingLabel\} \/>/);
  assert.match(bits, /onClick=\{retry\}/);
  assert.match(bits, /Try again/);
  assert.match(bits, /No workbook has been applied/);
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /<StockReadState state=\{state\} error=\{error\} retry=\{retry\}/);
  assert.match(list, /No approved snapshot to list/);
  assert.match(list, /The approved snapshot holds no material rows/);
  assert.match(list, /No source row matches those filters/);
  assert.match(list, /Reading this list wrote nothing/);

  // An unavailable snapshot is not an empty godown, and the panel says so on the phone too.
  const flutter = source('../mobile/lib/features/stock/stock_home_screen.dart');
  assert.match(flutter, /available/);
});

test("the last-read time is the server's own, with the offset it arrived with", () => {
  assert.equal(serverTimestampText('2026-01-01T09:01:08+05:30'), '2026-01-01 09:01:08 +05:30');
  assert.equal(serverTimestampText(null), 'not recorded');
  assert.equal(serverTimestampText('  '), 'not recorded');
  const bits = source('src/components/stock/StockBits.tsx');
  assert.match(bits, /serverTimestampText\(snapshot\.appliedAt\)/);
  const list = source('src/components/stock/StockMaterialList.tsx');
  assert.match(list, /snapshot applied/);
});

test("no figure, filename or hash from the workbook is written into the panel's stock source", () => {
  const files = [
    'src/lib/stockView.ts',
    'src/lib/stockPreviewModel.ts',
    'src/components/stock/StockBits.tsx',
    'src/components/stock/StockMaterialList.tsx',
    'src/components/stock/StockDashboard.tsx',
    'src/components/stock/StockKpiStrip.tsx',
    'src/components/stock/StockUpvc.tsx',
    'src/components/stock/StockCheck.tsx',
    'src/components/stock/StockGapView.tsx',
    'src/components/stock/WatchedWorkbook.tsx',
    'src/components/stock/StockSyncView.tsx',
    'src/pages/Stock.tsx',
  ];
  const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of files) {
    const text = source(file);
    // Comments may illustrate a rule with a number; code may not carry one. A grouped figure in
    // the source is a pasted mockup value, and a mockup value is never written into either app.
    const code = withoutComments(text);
    const grouped = code.match(/\d{1,3}(?:,\d{3}){2,}/g);
    assert.ok(grouped === null, `${file} hardcodes the grouped figure ${grouped?.join(', ')}`);
    const decimals = code.match(/['"`]-?\d+\.\d{3}['"`]/g);
    assert.ok(decimals === null, `${file} hardcodes the decimal literal ${decimals?.join(', ')}`);
    const hashes = text.match(/['"`][0-9a-f]{32,}['"`]/gi);
    assert.ok(hashes === null, `${file} hardcodes a file hash`);
    const lower = text.toLowerCase();
    assert.ok(!lower.includes('onedrive'), `${file} names OneDrive`);
    assert.ok(!lower.includes('1-8-26'), `${file} names the real workbook`);
  }
});

test('a displayed quantity is only ever grouped, never converted or added', () => {
  const files = [
    'src/lib/stockView.ts',
    'src/components/stock/StockBits.tsx',
    'src/components/stock/StockMaterialList.tsx',
    'src/components/stock/StockKpiStrip.tsx',
    'src/components/stock/StockUpvc.tsx',
  ];
  for (const file of files) {
    const text = source(file);
    for (const line of text.split(/\r?\n/)) {
      if (!/parseFloat\(|parseInt\(|Number\(/.test(line)) continue;
      // Two coercions are legitimate and neither one touches a figure: the automatic re-read
      // interval, in seconds, and `lengthFt`, which is an integer on the wire and a filter value.
      assert.match(
        line,
        /lengthFt|seconds|interval|onChoose/i,
        `${file} converts a displayed figure to a number: ${line.trim()}`,
      );
    }
    assert.ok(!text.includes('reduce('), `${file} adds a list of figures together`);
    assert.ok(!text.includes('+='), `${file} accumulates a figure`);
  }
  // The one sum on the dashboard is a sum of row *counts*, which is what the ring says.
  const dashboard = source('src/components/stock/StockDashboard.tsx');
  assert.match(dashboard, /reduce\(\(sum, category\) => sum \+ category\.figureCount, 0\)/);
  assert.match(dashboard, /Share of applied source rows, not of stock/);
});

test('the two metal screens wrap their controls instead of overflowing them', () => {
  const list = source('src/components/stock/StockMaterialList.tsx');
  const bits = source('src/components/stock/StockBits.tsx');
  const strip = source('src/components/stock/StockKpiStrip.tsx');
  assert.match(list, /className="mb-3 flex flex-wrap items-end gap-2"/);
  assert.match(list, /flex w-full flex-wrap items-center justify-between gap-3/);
  assert.match(list, /className="min-w-0">/);
  assert.match(list, /shrink-0 text-right/);
  assert.match(list, /sm:grid-cols-2/);
  assert.match(bits, /flex flex-wrap items-baseline gap-2/);
  assert.match(strip, /grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8/);
  assert.match(strip, /\[overflow-wrap:anywhere\]/);
  // A control with no text label is a control nobody can find on a narrow window.
  const labels = [...list.matchAll(/<label className="text-\[10px\][^"]*">\s*\n\s*([A-Z][a-z]+)/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Search', 'Category', 'Status', 'Order']);
});
