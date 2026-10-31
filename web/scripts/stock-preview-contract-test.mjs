/** Contract tests for the Phase 2C stock preview — the shape the backend sends and the words the
 *  panel puts around it.
 *
 *  Three separate things are being checked here, and they fail for different reasons:
 *
 *  * **The golden file vs the panel's declared field lists.** The golden was read out of the
 *    backend's own `/openapi.json` (`scripts/export-stock-preview-schema.py`); the lists are
 *    `Record<keyof TheInterface, FieldKind>` maps in `src/lib/stockPreviewModel.ts`. Set-equality
 *    means a field renamed on either side fails a test rather than rendering `undefined`. The panel
 *    is hand-written TypeScript with no generated client, so this comparison is the only thing that
 *    keeps the two honest with each other.
 *  * **The runtime reader.** A response is refused — not half-rendered — when a declared field is
 *    missing, when a quantity arrives as a JSON number (the wire format is decimal *text*, and an
 *    unquoted figure has already been through a float), or when `businessRecordsCreated` or
 *    `stockChanged` arrives as `true`. Those two are the write claims; `readyToApply` is the
 *    server's readiness signal, a plain boolean, and the apply route still demands an owner token,
 *    `confirm=true`, the bytes and the plan digest.
 *  * **The wording and the source.** Synthetic fixtures only — no figure from the real workbook is
 *    written into this file, because a test that pins `1,577,529` passes for the wrong reason the
 *    moment the sheet changes.
 *
 *  No bundler and no database: `node --test` loads `stockPreviewModel.ts` directly with type
 *  stripping, which is why that module stays erasable TypeScript with no imports.
 *  `src/lib/serverApi.ts` is read as text, not imported — it reaches for `import.meta.env`, so it
 *  belongs to the bundle, and the guards below are about which lines it contains.
 *
 *  Usage:  node --test scripts/stock-preview-contract-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STOCK_PREVIEW_MODELS,
  StockPreviewShapeError,
  UNAVAILABLE_QUANTITY_TEXT,
  applyReadinessText,
  associationNote,
  freshnessNote,
  isDecimalString,
  ledgerAuthority,
  modelFieldNames,
  quantityText,
  readStockPreviewPayload,
  rowsByRole,
  summaryLine,
  unitText,
  valueSourceLabel,
} from '../src/lib/stockPreviewModel.ts';
import {
  STOCK_TABS,
  compareDecimalText,
  groupedQuantity,
  pageOf,
  selectMaterials,
} from '../src/lib/stockView.ts';

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = join(here, '..');
const source = (relative) => readFileSync(join(panelRoot, relative), 'utf8');
const golden = JSON.parse(source('scripts/stock-preview-schema.json'));

// ── synthetic fixtures: shapes only, no company figures ──────────────────

const cell = (overrides = {}) => ({
  columnKey: 'qty',
  columnLabel: 'Qty',
  columnLabelCoordinate: 'B2',
  coordinate: 'B3',
  rawText: '630',
  value: '630.000',
  source: 'static',
  isFormula: false,
  warnings: [],
  ...overrides,
});

const row = (overrides = {}) => ({
  rowNumber: 3,
  role: 'item',
  label: '45*WHITE*SOME CO',
  labelCoordinate: 'A3',
  association: 'positional',
  parentLabel: 'SOME CO',
  parentCoordinate: 'A2',
  unit: null,
  cells: [cell()],
  warnings: [],
  strays: [],
  ...overrides,
});

const table = (overrides = {}) => ({
  id: 'item.A2',
  family: 'stockLedger',
  sourceSheet: 'UPVC ITEM',
  sourceLabel: 'SOME CO',
  sourceLabelCoordinate: 'A2',
  sourceHeading: 'UPVC',
  sourceHeadingCoordinate: 'A1',
  displayName: 'Some Co',
  headerRow: 2,
  labelColumn: 'A',
  valueColumns: [{ index: 2, coordinate: 'B2', label: 'Qty', key: 'qty' }],
  firstDataRow: 3,
  lastDataRow: 4,
  rowCount: 2,
  rows: [
    row({ rowNumber: 3, role: 'groupSubtotal', label: 'STOCK', association: 'notApplicable', parentLabel: null, parentCoordinate: null }),
    row({ rowNumber: 4, role: 'grandTotal', label: 'TOTAL', association: 'notApplicable', parentLabel: null, parentCoordinate: null }),
  ],
  displayedGrandTotal: cell({ coordinate: 'B4', value: '540.000' }),
  displayedTotals: [cell({ coordinate: 'B4', value: '540.000' })],
  completeness: 'complete',
  duplicateOf: null,
  duplicateState: null,
  formulaCacheUsed: true,
  warnings: [],
  ...overrides,
});

const section = (overrides = {}) => ({
  id: 'item.A2',
  sourceSheet: 'UPVC ITEM',
  displayName: 'Some Co',
  sourceLabel: 'SOME CO',
  sourceLabelCoordinate: 'A2',
  kind: 'stockItemTables',
  sectionTitlePresent: true,
  aliasApplied: false,
  completeness: 'complete',
  tables: [table()],
  reconciliations: [
    {
      code: 'stockVsTotal',
      sheet: 'UPVC ITEM',
      tableId: 'item.A2',
      displayedTotal: '540.000',
      displayedTotalCoordinate: 'B4',
      computed: '575.000',
      difference: '35.000',
      detail: 'The STOCK line and the TOTAL line for the same families differ.',
      cell: { sheet: 'UPVC ITEM', coordinate: 'B3' },
    },
  ],
  warnings: [],
  ...overrides,
});

const warning = (overrides = {}) => ({
  code: 'negativeQuantity',
  message: 'A negative quantity is kept as the sheet wrote it.',
  sourceSheet: 'UPVC ITEM',
  tableId: 'item.A2',
  rowNumber: 9,
  coordinate: 'K45',
  columnLabel: 'Qty',
  ...overrides,
});

const preview = (overrides = {}) => ({
  sourceFormat: 'xlsx',
  allowedSheets: ['TOTAL STOCK', 'UPVC TOTAL STOCK', 'UPVC ITEM'],
  sections: [section()],
  validation: {
    status: 'warning',
    checks: [
      { id: 'stockTotalDifference', status: 'warning', detail: '16 columns differ.' },
      { id: 'noBusinessRecordsWritten', status: 'passed', detail: 'The endpoint opened no session.' },
    ],
    warnings: [warning()],
  },
  provenance: {
    fileSha256: 'a'.repeat(64),
    sizeBytes: 4096,
    filename: 'workbook.xlsx',
    workbookPropertyModifiedAt: '2026-10-16T05:48:35',
    formulaCacheUsed: true,
    sheetsEnumerated: ['TOTAL STOCK', 'UPVC ITEM', 'Sheet4'],
    sheetsRead: ['TOTAL STOCK', 'UPVC ITEM'],
    allowedSheets: ['TOTAL STOCK', 'UPVC TOTAL STOCK', 'UPVC ITEM'],
  },
  reconciliations: section().reconciliations,
  sheetCount: 3,
  allowedSheetsFound: 2,
  tableCount: 1,
  rowCount: 2,
  formulaCellCount: 2,
  formulaCacheMissingCount: 0,
  formulaCacheUnusableCount: 0,
  warningCount: 1,
  incompleteTableCount: 0,
  previewedAt: '2026-10-20T09:00:00Z',
  authorizedFileSha256: 'a'.repeat(64),
  authorizedFileMatch: true,
  applyPreviewDigest: 'b'.repeat(64),
  applyableItemCount: 12,
  quarantineRowCount: 2,
  applyPlanErrors: [],
  applyBlockedReason: null,
  readyToApply: true,
  businessRecordsCreated: false,
  stockChanged: false,
  disclaimer: 'Read-only preview. Nothing was imported.',
  ...overrides,
});

// ── the golden file against the panel's declared types ───────────────────

test('every model the backend answers with is declared by the panel, field for field', () => {
  const drift = [];
  for (const [model, fields] of Object.entries(golden.models)) {
    const declared = modelFieldNames(model);
    if (declared.length === 0) {
      drift.push(`${model}: the panel declares no shape for it at all`);
      continue;
    }
    const missing = fields.filter((field) => !declared.includes(field));
    const extra = declared.filter((field) => !fields.includes(field));
    if (missing.length > 0 || extra.length > 0) {
      drift.push(`${model}: response has but panel does not — ${missing.join(', ') || 'nothing'}; panel has but response does not — ${extra.join(', ') || 'nothing'}`);
    }
  }
  for (const model of Object.keys(STOCK_PREVIEW_MODELS)) {
    if (!(model in golden.models)) drift.push(`${model}: the panel declares a model the backend no longer answers with`);
  }
  assert.deepEqual(drift, [], `field inventory drifted against /openapi.json:\n${drift.join('\n')}`);
});

test('the four quantity fields are the ones the panel types as decimal text', () => {
  const declared = [];
  for (const [model, kinds] of Object.entries(STOCK_PREVIEW_MODELS)) {
    for (const [field, kind] of Object.entries(kinds)) {
      if (kind === 'decimalStringOrNull') declared.push(`${model}.${field}`);
    }
  }
  assert.deepEqual(
    declared.sort(),
    [...golden.decimalStringFields].sort(),
    'a quantity field on the wire is not typed as a decimal string here, or the reverse',
  );
});

test('the two write flags are constants on the wire and enforced off the panel', () => {
  assert.deepEqual(golden.writeFlagsAreConstFalse, {
    businessRecordsCreated: false,
    stockChanged: false,
  });
  const declared = Object.entries(STOCK_PREVIEW_MODELS.StockPreviewOut)
    .filter(([, kind]) => kind === 'mustBeFalse')
    .map(([field]) => field);
  assert.deepEqual(declared.sort(), Object.keys(golden.writeFlagsAreConstFalse).sort());
  assert.equal(
    STOCK_PREVIEW_MODELS.StockPreviewOut.readyToApply,
    'boolean',
    'readyToApply is a readiness signal, not a write claim; it must not be pinned false',
  );
});

test('the route the panel calls is the route the backend documents, and it takes bytes', () => {
  assert.equal(golden.route, '/api/v1/imports/excel/stock-preview');
  assert.ok(golden.requestBodyMediaTypes.includes('application/octet-stream'));
  assert.ok(!golden.requestBodyMediaTypes.some((type) => type.startsWith('multipart/')));
  const client = source('src/lib/serverApi.ts');
  assert.match(client, /previewStockWorkbook/);
  assert.match(client, /`\/imports\/excel\/stock-preview\?\$\{query\.toString\(\)\}`/);
});

// ── the runtime reader ───────────────────────────────────────────────────

test('a response in the declared shape is read', () => {
  const body = preview();
  assert.deepEqual(Object.keys(readStockPreviewPayload(body)).sort(), Object.keys(body).sort());
});

test('a quantity that arrives as a JSON number is refused, not displayed', () => {
  const body = preview();
  body.sections[0].tables[0].rows[0].cells[0].value = 630;
  assert.throws(
    () => readStockPreviewPayload(body),
    (error) => error instanceof StockPreviewShapeError && error.details.some((line) => line.includes('a JSON number')),
  );
});

test('a declared field the response omits is refused rather than rendered as undefined', () => {
  const body = preview();
  delete body.provenance.fileSha256;
  assert.throws(
    () => readStockPreviewPayload(body),
    (error) => error instanceof StockPreviewShapeError && error.details.some((line) => line.includes('fileSha256')),
  );
});

test('a response claiming a write is not a preview this screen will show', () => {
  for (const flag of ['businessRecordsCreated', 'stockChanged']) {
    const body = preview({ [flag]: true });
    assert.throws(
      () => readStockPreviewPayload(body),
      (error) =>
        error instanceof StockPreviewShapeError &&
        error.details.some((line) => line.includes(flag) && line.includes('a write is not something it may claim')),
      `${flag}: true must be refused`,
    );
  }
  // Readiness is not a write claim: a ready reading is a reading this screen shows.
  assert.equal(readStockPreviewPayload(preview()).readyToApply, true);
});

test('an absent value stays absent through the reader, and a bare body is refused', () => {
  const body = preview();
  body.sections[0].tables[0].rows[0].cells[0] = cell({ value: null, source: 'cacheMissing', rawText: '=SUM(B3:B9)', warnings: ['formulaCacheMissing'] });
  const read = readStockPreviewPayload(body);
  assert.equal(read.sections[0].tables[0].rows[0].cells[0].value, null);
  assert.throws(() => readStockPreviewPayload(undefined), StockPreviewShapeError);
  assert.throws(() => readStockPreviewPayload([]), StockPreviewShapeError);
  assert.throws(() => readStockPreviewPayload('xlsx'), StockPreviewShapeError);
});

test('an integer field that arrives as a string is refused', () => {
  const body = preview();
  body.provenance.sizeBytes = '4096';
  assert.throws(() => readStockPreviewPayload(body), StockPreviewShapeError);
});

// ── display rules ────────────────────────────────────────────────────────

test('a missing figure renders as the dash, and never as zero', () => {
  assert.equal(quantityText(null), UNAVAILABLE_QUANTITY_TEXT);
  assert.notEqual(quantityText(null), '0');
  assert.ok(!/0/.test(quantityText(null)));
  assert.equal(valueSourceLabel('cacheMissing'), 'no formula cache');
  assert.equal(valueSourceLabel('somethingTheBackendInventedLater'), 'somethingTheBackendInventedLater');
});

test('a decimal string renders exactly as sent, with its own digits and sign', () => {
  assert.equal(quantityText('1234.5678'), '1234.5678');
  assert.equal(quantityText('-10.000'), '-10.000');
  assert.equal(quantityText('0.000'), '0.000');
  assert.ok(isDecimalString('1E+25'));
  assert.ok(!isDecimalString('1.2.3'));
});

test('a unit the API did not send is stated as not sent, never invented', () => {
  assert.equal(unitText(null), 'unit not stated');
  assert.equal(unitText(''), 'unit not stated');
  assert.equal(unitText('MT'), 'MT');
  for (const invented of [' MT', ' feet', ' pcs', ' pieces', ' kg']) {
    assert.ok(!unitText(null).includes(invented.trim()), `the panel would append “${invented}” to a unitless row`);
  }
});

test('TOTAL is the stock position and STOCK stays rendered beside it', () => {
  const ledger = ledgerAuthority(table());
  assert.notEqual(ledger, null);
  assert.equal(ledger.authoritative.role, 'grandTotal');
  assert.equal(ledger.authoritative.label, 'TOTAL');
  assert.deepEqual(ledger.alongside.map((item) => [item.rowNumber, item.label]), [[3, 'STOCK']]);
  assert.equal(ledgerAuthority(table({ family: 'columnBlock' })), null);
});

test('grand totals are footers, and the body rows are not added into them', () => {
  const grouped = rowsByRole(table());
  assert.deepEqual(grouped.totals.map((item) => item.rowNumber), [4]);
  assert.deepEqual(grouped.subtotals.map((item) => item.rowNumber), [3]);
  assert.deepEqual(grouped.body, []);
});

test('the freshness caveat travels with the formula-backed table', () => {
  const cached = table({
    rows: [row({ cells: [cell({ isFormula: true, source: 'cachedFormula' })] })],
    formulaCacheUsed: true,
  });
  assert.match(freshnessNote(cached), /Excel last wrote down/);
  const withoutCache = table({
    rows: [row({ cells: [cell({ isFormula: true, source: 'cacheMissing' })] })],
    formulaCacheUsed: false,
  });
  assert.match(freshnessNote(withoutCache), /no formula cache/);
  assert.equal(freshnessNote(table({ rows: [row({ cells: [cell({ isFormula: false })] })] })), null);
});

test('a row whose group was guessed is still reported as guessed', () => {
  const note = associationNote('bySuffix');
  assert.match(note, /own text/);
  for (const claim of ['resolved', 'reconciled', 'corrected', 'assigned to']) {
    assert.ok(!note.toLowerCase().includes(claim), `D-2/D-3 are open, so “${claim}” cannot appear here`);
  }
  assert.equal(associationNote('aVocabularyAddedLater'), 'aVocabularyAddedLater');
});

test('the summary line states readiness and repeats the write flags', () => {
  const line = summaryLine(preview()).text;
  assert.match(line, /Ready to apply 12 figures/);
  assert.match(line, /2 rows are withheld/);
  assert.match(line, /business records created false/);
  assert.match(line, /stock changed false/);
  const blocked = summaryLine(
    preview({ readyToApply: false, authorizedFileMatch: false, applyBlockedReason: 'C4 is missing.' }),
  ).text;
  assert.match(blocked, /Not ready to apply/);
});

test('readiness is described by what blocks it, not by a bare false', () => {
  assert.match(applyReadinessText(preview({ readyToApply: false, authorizedFileMatch: false })), /not the workbook revision/);
  assert.match(
    applyReadinessText(preview({ readyToApply: false, authorizedFileMatch: false, authorizedFileSha256: null })),
    /No workbook revision is authorised/,
  );
  assert.match(
    applyReadinessText(preview({ readyToApply: false, authorizedFileMatch: true, applyBlockedReason: 'C4 is missing.' })),
    /C4 is missing/,
  );
  assert.match(applyReadinessText(preview()), /12 figures would be applied and 2 read rows withheld/);
});

// ── the stock section's display rules ────────────────────────────────────

test('a quantity is grouped for reading without changing a digit', () => {
  assert.equal(groupedQuantity('1250000.000'), '1,250,000.000');
  assert.equal(groupedQuantity('-75.000'), '-75.000');
  assert.equal(groupedQuantity('0.000'), '0.000');
  assert.equal(groupedQuantity('12345678901234567890.500'), '12,345,678,901,234,567,890.500');
  assert.equal(groupedQuantity('1E+25'), '1E+25');
});

test('decimal texts are ordered without converting them to floats', () => {
  assert.ok(compareDecimalText('-75.000', '0.000') < 0);
  assert.ok(compareDecimalText('999.000', '1000.000') < 0);
  assert.ok(compareDecimalText('12.500', '12.250') > 0);
  assert.ok(compareDecimalText('-84.000', '-7.000') < 0);
  assert.equal(compareDecimalText('5.000', '5'), 0);
});

test('the material list narrows the server rows and never creates a row', () => {
  const material = (overrides = {}) => ({
    itemKey: 'item-1',
    categoryKey: 'steel-coil',
    categoryLabel: 'Steel Coil (Slit)',
    sourceSheet: 'TOTAL STOCK',
    sectionId: 'total_stock.slit_coil',
    sectionName: 'Slit Coil',
    tableId: 'slit.A2',
    tableDisplayName: 'Slit',
    label: 'MS Coil 0.18',
    columnLabel: 'Qty',
    status: 'resolved',
    rowNumber: 3,
    sourceLabel: 'MS COIL 0.18',
    labelCoordinate: 'A3',
    company: 'Jindal',
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
    sourceBatchId: 'B1',
    carriedFromBatchId: null,
    carryReason: null,
    valueCoordinate: 'B3',
    ...overrides,
  });
  const rows = [
    material({ itemKey: 'item-1' }),
    material({ itemKey: 'item-2', label: 'GP Sheet 0.35', company: 'JSW', quantity: '560.000' }),
    material({
      itemKey: 'item-3',
      status: 'withheld',
      reasons: ['labelWithoutValue'],
      quantity: null,
      sourceBatchId: null,
    }),
  ];

  assert.equal(selectMaterials(rows, { term: '', categoryKey: '', status: 'all', sort: 'source' }).length, 3);
  assert.deepEqual(
    selectMaterials(rows, { term: 'jsw', categoryKey: '', status: 'all', sort: 'source' }).map((row) => row.itemKey),
    ['item-2'],
  );
  assert.deepEqual(
    selectMaterials(rows, { term: '', categoryKey: '', status: 'withheld', sort: 'source' }).map((row) => row.itemKey),
    ['item-3'],
  );
  assert.deepEqual(
    selectMaterials(rows, { term: '', categoryKey: 'steel-coil', status: 'all', sort: 'quantity-asc' }).map((row) => row.itemKey),
    ['item-1', 'item-2', 'item-3'],
  );
  assert.deepEqual(pageOf([1, 2, 3, 4], 2, 3), [4]);
  assert.equal(STOCK_TABS.length, 14);
});

test('a successful apply marks every stock read stale, not only the screen that applied', () => {
  const preview = source('src/components/StockWorkbookPreview.tsx');
  assert.match(preview, /invalidate\(/);
  for (const key of ['stockSummary', 'stockUpvc', 'stockAccessories', 'stockProduction', 'stockImported', 'stockImports']) {
    assert.match(preview, new RegExp(`syncKeys\\.${key}`), `an apply does not invalidate ${key}`);
  }
});

// ── what the source must not contain ─────────────────────────────────────

const previewFiles = [
  'src/lib/stockPreviewModel.ts',
  'src/components/StockWorkbookPreview.tsx',
  'src/lib/serverApi.ts',
];

test('no quantity on this screen is ever converted to a JavaScript number', () => {
  for (const file of previewFiles) {
    const text = source(file);
    for (const coercion of ['parseFloat(', 'parseInt(', 'Number(']) {
      assert.ok(!text.includes(coercion), `${file} coerces with ${coercion}`);
    }
  }
});

test('the preview never invents a unit, and the only apply control is an explicit confirmed action', () => {
  const component = source('src/components/StockWorkbookPreview.tsx');
  for (const unit of ["'MT'", '"MT"', 'feet', 'pieces', "' pcs'", '" pcs"']) {
    assert.ok(!component.includes(unit), `the screen carries the unit literal ${unit}`);
  }
  assert.match(component, /type="checkbox"/, 'the apply action has no explicit confirmation');
  assert.match(
    component,
    /disabled=\{!confirmed \|\| applyState\.kind === 'applying'\}/,
    'the apply button is not gated on the confirmation',
  );
  assert.match(component, /applyStockImport\(phase\.bytes, \{/, 'the apply action does not send the previewed bytes');
  assert.match(component, /fileSha256: phase\.preview\.provenance\.fileSha256/, 'the apply action does not declare the previewed hash');
  assert.match(component, /previewDigest: phase\.preview\.applyPreviewDigest/, 'the apply action does not declare the previewed plan');
  assert.ok(!component.includes('type="submit"'));

  const client = source('src/lib/serverApi.ts');
  assert.match(client, /confirm: 'true'/, 'the client never sends the explicit confirmation');
  const previewBody = client.slice(
    client.indexOf('export async function previewStockWorkbook'),
    client.indexOf('// ── confirmed stock import'),
  );
  assert.ok(previewBody.length > 0, 'the preview function was not found');
  assert.ok(!previewBody.includes('applyStockImport'), 'the preview call applies the file without a confirmation');
});

test('no workbook path or real filename reaches the panel source', () => {
  const files = ['src/lib/stockPreviewModel.ts', 'src/components/StockWorkbookPreview.tsx', 'src/lib/serverApi.ts', 'src/pages/Stock.tsx'];
  for (const file of files) {
    const lower = source(file).toLowerCase();
    assert.ok(!lower.includes('onedrive'), `${file} names OneDrive`);
    assert.ok(!lower.includes('1-8-26'), `${file} names the real workbook`);
    assert.ok(!lower.includes('c:\\'), `${file} carries an absolute Windows path`);
  }
});

test('the navigation is untouched and the stock section follows the mockup order', () => {
  const shell = source('src/components/layout/Shell.tsx');
  const labels = [...shell.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(labels.length, 18);
  assert.deepEqual(labels, [
    'Dashboard', 'Sales', 'Payment', 'Marketing', 'Dispatch', 'Stock', 'Account',
    'Vaccant Area', 'Tour Plan', 'Task Alarm', 'Customers', 'Debtor List',
    'Provisional Debtors', 'Orders', 'New Order', 'Employees', 'Reports', 'Settings',
  ]);
  const stock = source('src/pages/Stock.tsx');
  const views = source('src/lib/stockView.ts');
  const tabs = [...views.matchAll(/\{ key: '[^']+', label: '([^']+)' \}/g)].map((match) => match[1]);
  assert.deepEqual(tabs, [
    'Dashboard', 'Total Stock', 'Steel Coil (Slit)', 'Profile / Kanda', 'GP Sheet',
    'UPVC New', 'UPVC Old', 'UPVC Waste', 'UPVC Total Stock', 'UPVC Item', 'Production',
    'Stock Check', 'Excel Import / Sync', 'Movement Ledger',
  ]);
  assert.equal(tabs.length, 14, 'the stock screen gained or lost a view without this test knowing');
  const ledger = [...stock.matchAll(/key: '\w+', label: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(ledger, ['Balances', 'Movements', 'Products']);
  assert.match(stock, /StockGapView/, 'the two unsupported sheets lost their honest gap view');
  assert.match(stock, /StockCheck/, 'the integrity check is no longer reachable');
});

test('only the stock-preview route gets a longer budget, and the global one is still 20 seconds', () => {
  const client = source('src/lib/serverApi.ts');
  const exportMatch = client.match(/export const STOCK_PREVIEW_TIMEOUT_MS = ([\d_]+);/);
  assert.notEqual(exportMatch, null, 'the preview route has no timeout of its own');
  const previewTimeout = Number(exportMatch[1].replaceAll('_', ''));
  assert.ok(previewTimeout > 20_000, `${previewTimeout} ms is not longer than the backend's 20 s parse budget`);
  const defaultMatch = client.match(/const DEFAULT_TIMEOUT_MS = ([\d_]+);/);
  assert.notEqual(defaultMatch, null);
  assert.equal(Number(defaultMatch[1].replaceAll('_', '')), 20_000);
  assert.match(client, /timeoutMs \?\? DEFAULT_TIMEOUT_MS/);
  assert.match(client, /signal: AbortSignal\.timeout\(budgetMs\)/);
  assert.ok(!/AbortSignal\.timeout\(20_000\)/.test(client), 'a hard-coded 20 s call is still in the request core');
});

test('bytes go as bytes, and the JSON path is unchanged for every other call', () => {
  const client = source('src/lib/serverApi.ts');
  assert.match(client, /headers\['Content-Type'\] = 'application\/octet-stream'/);
  assert.match(client, /body: bytes !== undefined \? bytes : body === undefined \? undefined : JSON\.stringify\(body\)/);
  assert.match(client, /if \(bytes !== undefined\) headers\['Content-Type'\]/);
  assert.match(client, /else if \(body !== undefined\) headers\['Content-Type'\] = 'application\/json'/);
});

test('the workbook label is a name, and the client strips a path before it can reach a URL', () => {
  const client = source('src/lib/serverApi.ts');
  assert.ok(client.includes('export function workbookLabel('), 'no label guard on the upload path');
  assert.ok(client.includes('name.split(/[\\\\/]/)'), 'the label is not reduced to its last path segment');
  assert.ok(client.includes('{ fileName: workbookLabel(fileName) }'), 'the raw name is what gets sent');
});
