/** The stock-preview wire contract, as the Owner Panel sees it.
 *
 *  Phase 2C's one endpoint that answers with a tree instead of a page, so this file is doing two
 *  different jobs, and keeping them together is the point:
 *
 *  1. **Types.** `Server*` interfaces mirroring `StockPreviewOut` and its eleven nested models,
 *     field for field, in the camelCase the server actually sends. Quantities are `string | null`
 *     — the decimal-string wire format the rest of this panel already uses for every
 *     `NUMERIC(14,3)` figure (`ServerStockBalance.onHandQuantity`, `ServerOrderLine.orderedQuantity`
 *     …). Nothing here turns one into a JavaScript number, because a reconciliation figure that has
 *     been through binary float is a figure the owner can no longer check against the workbook.
 *  2. **A runtime shape, declared once.** Every interface has a companion `…_FIELDS` map, typed
 *     `Record<keyof TheInterface, FieldKind>`. That is not decoration in either direction: a
 *     property added to the interface and not to the map fails `npm run typecheck`, and a map key
 *     that is not a property fails it too. The same maps then drive `readStockPreview`, which
 *     refuses a response whose shape is not the one this file declares — so a screen never renders
 *     half a contract, and `scripts/stock-preview-contract-test.mjs` can compare the declared
 *     inventory against the golden read from the backend's own `/openapi.json`.
 *
 *  Deliberately **import-free**, like `entryRules.ts`: `node --test` loads this module directly
 *  with type stripping, so it must stay erasable TypeScript with no imports.
 *
 *  What a refusal means, and what it does not: a field the server added on purpose is not a
 *  refusal (extra keys are ignored — additive fields are backward compatible, and refusing them
 *  would break the screen the day the backend grows one). A declared field that is missing, a
 *  quantity that arrives as a JSON number, or one of the two write flags arriving as `true`
 *  **are** refusals. Those two say the endpoint performed a write, and this panel will not render
 *  an answer that claims it. `readyToApply` is a different thing: it is the server's readiness
 *  signal, not a write claim, and the apply route still demands an explicit owner confirmation.
 */

// ── vocabularies, quoted from the backend ────────────────────────────────

export type ServerStockReadState = 'complete' | 'incomplete';
export type ServerRowRole = 'groupSubtotal' | 'item' | 'grandTotal' | 'metric' | 'detail' | 'warning';
export type ServerSectionKind = 'columnBlocks' | 'colourBlocks' | 'standaloneMetric' | 'stockItemTables';
export type ServerTableFamily =
  | 'columnBlock'
  | 'colourBlock'
  | 'standaloneMetric'
  | 'stockLedger'
  | 'formulaMirror'
  | 'staticPivotSummary';
export type ServerValueSource =
  | 'static'
  | 'cachedFormula'
  | 'cacheMissing'
  | 'cacheUnusable'
  | 'nonNumeric'
  | 'unread';
export type ServerDuplicateState = 'matching' | 'differs' | 'notCompared';
export type ServerCheckStatus = 'passed' | 'warning' | 'failed';

/** Known values get words; anything else renders **as the server said it**. Renaming an unknown
 *  code to the nearest known one would be the panel inventing a fact, so the fallback is the raw
 *  string — the same rule `liveDisplay.ts` applies to dispatch states. */
const ROLE_WORDS: Record<string, string> = {
  groupSubtotal: 'group subtotal',
  item: 'item',
  grandTotal: 'grand total',
  metric: 'metric',
  detail: 'detail row',
  warning: 'warning row',
};
const FAMILY_WORDS: Record<string, string> = {
  columnBlock: 'column block',
  colourBlock: 'colour block',
  standaloneMetric: 'standalone metric',
  stockLedger: 'stock ledger',
  formulaMirror: 'formula mirror',
  staticPivotSummary: 'pivot summary',
};
const SOURCE_WORDS: Record<string, string> = {
  static: 'typed value',
  cachedFormula: 'cached formula',
  cacheMissing: 'no formula cache',
  cacheUnusable: 'unusable formula cache',
  nonNumeric: 'not a number',
  unread: 'not read',
};
const STATE_WORDS: Record<string, string> = { complete: 'complete', incomplete: 'incomplete' };

export const rawVocabulary = (words: Record<string, string>, value: string): string =>
  words[value] ?? value;

export const rowRoleLabel = (role: string): string => rawVocabulary(ROLE_WORDS, role);
export const tableFamilyLabel = (family: string): string => rawVocabulary(FAMILY_WORDS, family);
export const valueSourceLabel = (source: string): string => rawVocabulary(SOURCE_WORDS, source);
export const readStateLabel = (state: string): string => rawVocabulary(STATE_WORDS, state);

// ── the DTOs ─────────────────────────────────────────────────────────────

export interface ServerCellAddress {
  sheet: string;
  coordinate: string;
}

export interface ServerStockColumn {
  index: number;
  coordinate: string;
  label: string;
  key: string;
}

export interface ServerStockCell {
  columnKey: string;
  columnLabel: string;
  columnLabelCoordinate: string;
  coordinate: string;
  rawText: string;
  /** Decimal string, or null when the sheet holds no readable number. Never 0-for-missing. */
  value: string | null;
  source: ServerValueSource;
  isFormula: boolean;
  warnings: string[];
}

export interface ServerStockRow {
  rowNumber: number;
  role: ServerRowRole;
  label: string;
  labelCoordinate: string;
  association: string;
  parentLabel: string | null;
  parentCoordinate: string | null;
  /** Null when the sheet does not state one. No unit is ever appended here. */
  unit: string | null;
  cells: ServerStockCell[];
  warnings: string[];
  strays: string[];
}

export interface ServerReconciliation {
  code: string;
  sheet: string;
  tableId: string;
  displayedTotal: string | null;
  displayedTotalCoordinate: string | null;
  computed: string | null;
  difference: string | null;
  detail: string;
  cell: ServerCellAddress | null;
}

export interface ServerStockTable {
  id: string;
  family: ServerTableFamily;
  sourceSheet: string;
  sourceLabel: string;
  sourceLabelCoordinate: string;
  sourceHeading: string;
  sourceHeadingCoordinate: string;
  displayName: string;
  headerRow: number;
  labelColumn: string;
  valueColumns: ServerStockColumn[];
  firstDataRow: number | null;
  lastDataRow: number | null;
  rowCount: number;
  rows: ServerStockRow[];
  displayedGrandTotal: ServerStockCell | null;
  displayedTotals: ServerStockCell[];
  completeness: ServerStockReadState;
  duplicateOf: string | null;
  duplicateState: ServerDuplicateState | null;
  formulaCacheUsed: boolean;
  warnings: string[];
}

export interface ServerStockSection {
  id: string;
  sourceSheet: string;
  displayName: string;
  sourceLabel: string;
  sourceLabelCoordinate: string;
  kind: ServerSectionKind;
  sectionTitlePresent: boolean;
  aliasApplied: boolean;
  completeness: ServerStockReadState;
  tables: ServerStockTable[];
  reconciliations: ServerReconciliation[];
  warnings: string[];
}

export interface ServerStockWarning {
  code: string;
  message: string;
  sourceSheet: string | null;
  tableId: string | null;
  rowNumber: number | null;
  coordinate: string | null;
  columnLabel: string | null;
}

export interface ServerValidationCheck {
  id: string;
  status: ServerCheckStatus;
  detail: string;
}

export interface ServerValidation {
  status: 'passed' | 'warning' | 'failed';
  checks: ServerValidationCheck[];
  warnings: ServerStockWarning[];
}

export interface ServerProvenance {
  fileSha256: string;
  sizeBytes: number;
  filename: string;
  workbookPropertyModifiedAt: string | null;
  formulaCacheUsed: boolean;
  sheetsEnumerated: string[];
  sheetsRead: string[];
  allowedSheets: string[];
}

/** One reason the server would refuse this reading at apply time. It is a plan error, not a parse
 *  error: the workbook was read, but applying it would write something the server cannot stand
 *  behind. No figure is withheld silently — every code here is shown beside the plan. */
export interface ServerApplyPlanError {
  code: string;
  detail: string;
  sourceSheet: string | null;
  tableId: string | null;
  rowNumber: number | null;
}

export interface ServerStockPreview {
  sourceFormat: string;
  allowedSheets: string[];
  sections: ServerStockSection[];
  validation: ServerValidation;
  provenance: ServerProvenance;
  reconciliations: ServerReconciliation[];
  sheetCount: number;
  allowedSheetsFound: number;
  tableCount: number;
  rowCount: number;
  formulaCellCount: number;
  formulaCacheMissingCount: number;
  formulaCacheUnusableCount: number;
  warningCount: number;
  incompleteTableCount: number;
  previewedAt: string;
  /** The revision the server is configured to accept, or null when no revision is authorised. */
  authorizedFileSha256: string | null;
  authorizedFileMatch: boolean;
  /** The digest the apply route demands back. It binds a confirmation to this file's plan. */
  applyPreviewDigest: string;
  applyableItemCount: number;
  quarantineRowCount: number;
  applyPlanErrors: ServerApplyPlanError[];
  applyBlockedReason: string | null;
  /** Readiness, not consent: true only when the hash is the authorised revision and the plan has no
   *  blocking error. The apply route still demands an owner token, `confirm=true`, the bytes, and
   *  this digest. Viewing this preview writes nothing. */
  readyToApply: boolean;
  businessRecordsCreated: false;
  stockChanged: false;
  disclaimer: string;
}

// ── the declared shape ───────────────────────────────────────────────────

type ModelRef = { readonly model: string };
type ModelList = { readonly modelList: string };

/** `decimalStringOrNull` refuses a JSON number on purpose: a quantity that arrives unquoted has
 *  already lost the exactness the wire format exists to keep, and showing it as though it were the
 *  sheet's figure is the failure this guard exists to catch. */
type FieldKind =
  | 'string'
  | 'stringOrNull'
  | 'integer'
  | 'integerOrNull'
  | 'boolean'
  | 'stringList'
  | 'decimalStringOrNull'
  | 'mustBeFalse'
  | ModelRef
  | ModelList;

export const CELL_ADDRESS_FIELDS: Record<keyof ServerCellAddress, FieldKind> = {
  sheet: 'string',
  coordinate: 'string',
};

export const STOCK_COLUMN_FIELDS: Record<keyof ServerStockColumn, FieldKind> = {
  index: 'integer',
  coordinate: 'string',
  label: 'string',
  key: 'string',
};

export const STOCK_CELL_FIELDS: Record<keyof ServerStockCell, FieldKind> = {
  columnKey: 'string',
  columnLabel: 'string',
  columnLabelCoordinate: 'string',
  coordinate: 'string',
  rawText: 'string',
  value: 'decimalStringOrNull',
  source: 'string',
  isFormula: 'boolean',
  warnings: 'stringList',
};

export const STOCK_ROW_FIELDS: Record<keyof ServerStockRow, FieldKind> = {
  rowNumber: 'integer',
  role: 'string',
  label: 'string',
  labelCoordinate: 'string',
  association: 'string',
  parentLabel: 'stringOrNull',
  parentCoordinate: 'stringOrNull',
  unit: 'stringOrNull',
  cells: { modelList: 'StockCellOut' },
  warnings: 'stringList',
  strays: 'stringList',
};

export const RECONCILIATION_FIELDS: Record<keyof ServerReconciliation, FieldKind> = {
  code: 'string',
  sheet: 'string',
  tableId: 'string',
  displayedTotal: 'decimalStringOrNull',
  displayedTotalCoordinate: 'stringOrNull',
  computed: 'decimalStringOrNull',
  difference: 'decimalStringOrNull',
  detail: 'string',
  cell: { model: 'CellAddressOut' },
};

export const STOCK_TABLE_FIELDS: Record<keyof ServerStockTable, FieldKind> = {
  id: 'string',
  family: 'string',
  sourceSheet: 'string',
  sourceLabel: 'string',
  sourceLabelCoordinate: 'string',
  sourceHeading: 'string',
  sourceHeadingCoordinate: 'string',
  displayName: 'string',
  headerRow: 'integer',
  labelColumn: 'string',
  valueColumns: { modelList: 'StockColumnOut' },
  firstDataRow: 'integerOrNull',
  lastDataRow: 'integerOrNull',
  rowCount: 'integer',
  rows: { modelList: 'StockRowOut' },
  displayedGrandTotal: { model: 'StockCellOut' },
  displayedTotals: { modelList: 'StockCellOut' },
  completeness: 'string',
  duplicateOf: 'stringOrNull',
  duplicateState: 'stringOrNull',
  formulaCacheUsed: 'boolean',
  warnings: 'stringList',
};

export const STOCK_SECTION_FIELDS: Record<keyof ServerStockSection, FieldKind> = {
  id: 'string',
  sourceSheet: 'string',
  displayName: 'string',
  sourceLabel: 'string',
  sourceLabelCoordinate: 'string',
  kind: 'string',
  sectionTitlePresent: 'boolean',
  aliasApplied: 'boolean',
  completeness: 'string',
  tables: { modelList: 'StockTableOut' },
  reconciliations: { modelList: 'ReconciliationOut' },
  warnings: 'stringList',
};

export const STOCK_WARNING_FIELDS: Record<keyof ServerStockWarning, FieldKind> = {
  code: 'string',
  message: 'string',
  sourceSheet: 'stringOrNull',
  tableId: 'stringOrNull',
  rowNumber: 'integerOrNull',
  coordinate: 'stringOrNull',
  columnLabel: 'stringOrNull',
};

export const VALIDATION_CHECK_FIELDS: Record<keyof ServerValidationCheck, FieldKind> = {
  id: 'string',
  status: 'string',
  detail: 'string',
};

export const VALIDATION_FIELDS: Record<keyof ServerValidation, FieldKind> = {
  status: 'string',
  checks: { modelList: 'ValidationCheckOut' },
  warnings: { modelList: 'StockWarningOut' },
};

export const PROVENANCE_FIELDS: Record<keyof ServerProvenance, FieldKind> = {
  fileSha256: 'string',
  sizeBytes: 'integer',
  filename: 'string',
  workbookPropertyModifiedAt: 'stringOrNull',
  formulaCacheUsed: 'boolean',
  sheetsEnumerated: 'stringList',
  sheetsRead: 'stringList',
  allowedSheets: 'stringList',
};

export const APPLY_PLAN_ERROR_FIELDS: Record<keyof ServerApplyPlanError, FieldKind> = {
  code: 'string',
  detail: 'string',
  sourceSheet: 'stringOrNull',
  tableId: 'stringOrNull',
  rowNumber: 'integerOrNull',
};

export const STOCK_PREVIEW_FIELDS: Record<keyof ServerStockPreview, FieldKind> = {
  sourceFormat: 'string',
  allowedSheets: 'stringList',
  sections: { modelList: 'StockSectionOut' },
  validation: { model: 'ValidationOut' },
  provenance: { model: 'ProvenanceOut' },
  reconciliations: { modelList: 'ReconciliationOut' },
  sheetCount: 'integer',
  allowedSheetsFound: 'integer',
  tableCount: 'integer',
  rowCount: 'integer',
  formulaCellCount: 'integer',
  formulaCacheMissingCount: 'integer',
  formulaCacheUnusableCount: 'integer',
  warningCount: 'integer',
  incompleteTableCount: 'integer',
  previewedAt: 'string',
  authorizedFileSha256: 'stringOrNull',
  authorizedFileMatch: 'boolean',
  applyPreviewDigest: 'string',
  applyableItemCount: 'integer',
  quarantineRowCount: 'integer',
  applyPlanErrors: { modelList: 'ApplyPlanErrorOut' },
  applyBlockedReason: 'stringOrNull',
  readyToApply: 'boolean',
  businessRecordsCreated: 'mustBeFalse',
  stockChanged: 'mustBeFalse',
  disclaimer: 'string',
};

/** Model name → declared field kinds, keyed exactly as the backend names them, because the
 *  contract test compares these keys and these lists against the golden read from `/openapi.json`. */
export const STOCK_PREVIEW_MODELS: Record<string, Record<string, FieldKind>> = {
  StockPreviewOut: STOCK_PREVIEW_FIELDS,
  StockSectionOut: STOCK_SECTION_FIELDS,
  StockTableOut: STOCK_TABLE_FIELDS,
  StockRowOut: STOCK_ROW_FIELDS,
  StockCellOut: STOCK_CELL_FIELDS,
  StockColumnOut: STOCK_COLUMN_FIELDS,
  CellAddressOut: CELL_ADDRESS_FIELDS,
  ReconciliationOut: RECONCILIATION_FIELDS,
  ValidationOut: VALIDATION_FIELDS,
  ValidationCheckOut: VALIDATION_CHECK_FIELDS,
  StockWarningOut: STOCK_WARNING_FIELDS,
  ProvenanceOut: PROVENANCE_FIELDS,
  ApplyPlanErrorOut: APPLY_PLAN_ERROR_FIELDS,
};

export const modelFieldNames = (model: string): string[] =>
  Object.keys(STOCK_PREVIEW_MODELS[model] ?? {});

// ── reading a response as this contract ──────────────────────────────────

const DECIMAL_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** A quantity as the wire sends it: decimal text or nothing. Exported because the panel's
 *  existing `isNegativeQuantity` helper is a string test, and this is the type test beside it. */
export const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL_TEXT.test(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const checkModel = (model: string, value: unknown, path: string, errors: string[]): void => {
  if (errors.length >= 12) return;
  if (!isPlainObject(value)) {
    errors.push(`${path || 'the response'}: expected an object for ${model}`);
    return;
  }
  const fields = STOCK_PREVIEW_MODELS[model];
  if (!fields) {
    errors.push(`${path || 'the response'}: ${model} is not a shape this panel declares`);
    return;
  }
  for (const [field, kind] of Object.entries(fields)) {
    const at = path ? `${path}.${field}` : field;
    if (!(field in value)) {
      errors.push(`${at}: the response does not carry this field`);
      continue;
    }
    const actual = value[field];
    if (typeof kind === 'string') {
      switch (kind) {
        case 'string':
          if (typeof actual !== 'string') errors.push(`${at}: expected text, got ${typeof actual}`);
          break;
        case 'stringOrNull':
          if (actual !== null && typeof actual !== 'string')
            errors.push(`${at}: expected text or null, got ${actual === null ? 'null' : typeof actual}`);
          break;
        case 'integer':
          if (typeof actual !== 'number' || !Number.isInteger(actual))
            errors.push(`${at}: expected a whole number, got ${JSON.stringify(actual)}`);
          break;
        case 'integerOrNull':
          if (actual !== null && (typeof actual !== 'number' || !Number.isInteger(actual)))
            errors.push(`${at}: expected a whole number or null`);
          break;
        case 'boolean':
          if (typeof actual !== 'boolean') errors.push(`${at}: expected true or false`);
          break;
        case 'stringList':
          if (!Array.isArray(actual) || actual.some((item) => typeof item !== 'string'))
            errors.push(`${at}: expected a list of text`);
          break;
        case 'decimalStringOrNull':
          if (actual !== null && !isDecimalString(actual))
            errors.push(
              `${at}: expected a decimal string or null, got ${
                typeof actual === 'number' ? 'a JSON number — the wire format has changed' : 'something else'
              }`,
            );
          break;
        case 'mustBeFalse':
          if (actual !== false)
            errors.push(`${at}: this endpoint reports ${JSON.stringify(actual)}, and a write is not something it may claim`);
          break;
      }
      continue;
    }
    if ('model' in kind) {
      if (actual === null) continue;
      checkModel(kind.model, actual, at, errors);
      continue;
    }
    if (!Array.isArray(actual)) {
      errors.push(`${at}: expected a list of ${kind.modelList}`);
      continue;
    }
    actual.forEach((item, index) => checkModel(kind.modelList, item, `${at}[${index}]`, errors));
  }
};

/** Why a response was refused, in words a screen can show. Mirrors `ServerError`'s shape so the
 *  caller can hand it to the same error state as an HTTP refusal. */
export class StockPreviewShapeError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super('The backend answered the stock preview in a shape this panel does not recognise.');
    this.name = 'StockPreviewShapeError';
    this.details = details;
  }
}

/** Validate a parsed JSON body against the declared shape, or throw. Returns the same value typed
 *  as the contract — the cast is safe because every field this panel reads was just checked. */
export function readStockPreviewPayload(payload: unknown): ServerStockPreview {
  const errors: string[] = [];
  checkModel('StockPreviewOut', payload, '', errors);
  if (errors.length > 0) throw new StockPreviewShapeError(errors);
  return payload as ServerStockPreview;
}

// ── display rules, kept away from the component so they can be tested ────

/** A missing figure. `0` is a quantity the sheet wrote, and a cell that holds no readable number
 *  did not write it — Phase 2B's fail-closed rule, repeated here in the one glyph it uses. */
export const UNAVAILABLE_QUANTITY_TEXT = '—';

export const quantityText = (value: string | null): string =>
  value === null ? UNAVAILABLE_QUANTITY_TEXT : value;

/** Units are the sheet's to state. `null` renders as "unit not stated", never as a guess — and no
 *  `MT`, feet or piece is ever appended here, because a unit the API did not send is a unit the
 *  panel invented. */
export const UNIT_NOT_STATED_TEXT = 'unit not stated';

export const unitText = (unit: string | null): string =>
  unit === null || unit.trim() === '' ? UNIT_NOT_STATED_TEXT : unit;

/** `computed − displayed`, stated once. The sign is the backend's convention (schema docstring for
 *  `ReconciliationOut.difference`) and the sentence is the panel's, so a reader knows which way the
 *  gap points without working it out. */
export const DIFFERENCE_CONVENTION_TEXT =
  'Difference is the rows as added by the sheet, minus the total the sheet displays: a positive figure means the rows come to more than the printed total.';

/** Rows are never re-added here. The only arithmetic on quantities in this file is on counts,
 *  which the server sends as integers. */
export const rowsByRole = (
  table: ServerStockTable,
): { body: ServerStockRow[]; subtotals: ServerStockRow[]; totals: ServerStockRow[]; metrics: ServerStockRow[]; warnings: ServerStockRow[] } => {
  const body: ServerStockRow[] = [];
  const subtotals: ServerStockRow[] = [];
  const totals: ServerStockRow[] = [];
  const metrics: ServerStockRow[] = [];
  const warnings: ServerStockRow[] = [];
  for (const row of table.rows) {
    if (row.role === 'grandTotal') totals.push(row);
    else if (row.role === 'groupSubtotal') subtotals.push(row);
    else if (row.role === 'metric') metrics.push(row);
    else if (row.role === 'warning') warnings.push(row);
    else body.push(row);
  }
  return { body, subtotals, totals, metrics, warnings };
};

const isTotalLabel = (label: string): boolean => label.trim().toUpperCase() === 'TOTAL';
const isStockLabel = (label: string): boolean => label.trim().toUpperCase() === 'STOCK';

/** The owner's decision **D-1**, expressed as a rule rather than as a number.
 *
 *  On the four UPVC ledgers the sheet prints two lines for the same families, and the workbook
 *  never says which is the ledger. The Owner answered on 2026-10-16: **TOTAL** is the stock
 *  position. That settles what a screen gives primacy to — it does not settle the underlying
 *  disagreement, so `STOCK` stays rendered, signed and reconciled beside it and neither figure is
 *  ever chosen *over* the other at this layer. */
export const AUTHORITY_HEADING_TEXT = 'Stock position — TOTAL, per owner decision D-1';
export const ALONGSIDE_HEADING_TEXT = 'STOCK line, shown alongside and not discarded';

export interface StockLedgerAuthority {
  readonly authoritative: ServerStockRow | null;
  readonly alongside: ServerStockRow[];
}

export function ledgerAuthority(table: ServerStockTable): StockLedgerAuthority | null {
  if (table.family !== 'stockLedger') return null;
  const grouped = rowsByRole(table);
  const authoritative = grouped.totals.find((row) => isTotalLabel(row.label)) ?? null;
  const alongside = grouped.subtotals.filter((row) => isStockLabel(row.label));
  return { authoritative, alongside };
}

/** The stale-cache caveat belongs next to the figure it qualifies, and D-1 made the formula-backed
 *  line the authoritative one — so the caveat travels with it rather than sitting in a footnote. */
export const freshnessNote = (table: ServerStockTable): string | null => {
  const cached = table.rows.some((row) => row.cells.some((cell) => cell.isFormula));
  if (!cached) return null;
  return table.formulaCacheUsed
    ? 'Figures marked “cached formula” are the result Excel last wrote down, not a result this backend recalculated — a sheet nobody recalculated can display a stale figure.'
    : 'This workbook carries no formula cache for these cells, so nothing here was recalculated and several figures may be unavailable rather than zero.';
};

/** Rows the reading could not claim, stated as counts the server sent. No sum of quantities. */
export interface PreviewSummaryLine {
  readonly text: string;
}

export const summaryLine = (preview: ServerStockPreview): PreviewSummaryLine => ({
  text:
    `${preview.tableCount} tables from ${preview.sections.length} blocks on ${preview.sheetCount} sheets, ` +
    `${preview.rowCount} source rows, ${preview.formulaCellCount} formula cells. ` +
    (preview.readyToApply
      ? `Ready to apply ${preview.applyableItemCount} figures; ${preview.quarantineRowCount} rows are withheld. `
      : `Not ready to apply${preview.applyBlockedReason === null ? '' : `: ${preview.applyBlockedReason}`}. `) +
    `Reading wrote nothing: business records created ${String(preview.businessRecordsCreated)}, ` +
    `stock changed ${String(preview.stockChanged)}.`,
});

/** Readiness in words a screen can show, never as a bare boolean. The three states are distinct on
 *  purpose: a file that is not the authorised revision is a different finding from a plan with a
 *  blocking error, and both are different from a file that is ready. */
export const applyReadinessText = (preview: ServerStockPreview): string => {
  if (preview.readyToApply) {
    return `The server will accept this file for a confirmed import: ${preview.applyableItemCount} figures would be applied and ${preview.quarantineRowCount} read rows withheld.`;
  }
  if (!preview.authorizedFileMatch) {
    return preview.authorizedFileSha256 === null
      ? 'No workbook revision is authorised for stock import on this server, so this file cannot be applied.'
      : 'This file is not the workbook revision the server is authorised to import, so it cannot be applied.';
  }
  return preview.applyBlockedReason ?? 'The apply plan has a blocking error, so this file cannot be applied.';
};

/** D-2 and D-3, as words. The Owner's 2026-10-16 answer was that both remain unresolved, so the
 *  panel reports the association the sheet implied and never repeats it as a fact: a row labelled
 *  `bySuffix` is a row whose parent was *guessed from its own text*, and the reader has to be able
 *  to see that. */
export const unresolvedAssociationWords: Record<string, string> = {
  unassigned: 'no group claimed this row on the sheet',
  bySuffix: 'group suggested by the row’s own text, not by the sheet’s structure',
  positional: 'group taken from the row’s position under it',
  notApplicable: 'this row is not a grouped row',
};

export const associationNote = (association: string): string =>
  unresolvedAssociationWords[association] ?? association;
