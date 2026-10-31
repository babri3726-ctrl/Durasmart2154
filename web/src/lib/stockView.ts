/** Display rules for the shared stock section: which tab shows which source category, how a
 *  decimal text is grouped for reading, and the filters the Total Stock list applies to the rows
 *  the server already returned.
 *
 *  No figure here is computed from two quantities. Grouping adds thousands separators and nothing
 *  else; sorting compares decimal texts as written; filtering only removes rows. Every number a
 *  screen shows beside a material comes from the snapshot the server applied, and the category
 *  totals are the server's own, never a sum over the rows on screen.
 */

import type { ServerStockMaterial } from './serverApi';

export type StockView =
  | 'dashboard'
  | 'total'
  | 'steel'
  | 'profile'
  | 'gp'
  | 'upvc-new'
  | 'upvc-old'
  | 'upvc-waste'
  | 'upvc-item'
  | 'upvc-total'
  | 'production'
  | 'check'
  | 'sync'
  | 'ledger';

export const STOCK_TABS: { key: StockView; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'total', label: 'Total Stock' },
  { key: 'steel', label: 'Steel Coil (Slit)' },
  { key: 'profile', label: 'Profile / Kanda' },
  { key: 'gp', label: 'GP Sheet' },
  { key: 'upvc-new', label: 'UPVC New' },
  { key: 'upvc-old', label: 'UPVC Old' },
  { key: 'upvc-waste', label: 'UPVC Waste' },
  { key: 'upvc-total', label: 'UPVC Total Stock' },
  { key: 'upvc-item', label: 'UPVC Item' },
  { key: 'production', label: 'Production' },
  { key: 'check', label: 'Stock Check' },
  { key: 'sync', label: 'Excel Import / Sync' },
  { key: 'ledger', label: 'Movement Ledger' },
];

/** The material categories a tab narrows the source rows to. `null` means "every category",
 *  which is what the dashboard, the check and the import views read. */
export const VIEW_CATEGORY: Partial<Record<StockView, string>> = {
  steel: 'steel-coil',
  profile: 'profile-kanda',
  gp: 'gp-sheet',
  'upvc-new': 'upvc-new',
  'upvc-old': 'upvc-old',
  'upvc-waste': 'upvc-waste',
  'upvc-total': 'upvc-total',
  'upvc-item': 'upvc-item',
};

/** Where a dashboard category card opens. A category the panel has no dedicated tab for still
 *  has an address, so a new server category cannot produce a dead card. */
export const CATEGORY_VIEW: Record<string, StockView> = {
  'steel-coil': 'steel',
  'profile-kanda': 'profile',
  'gp-sheet': 'gp',
  'upvc-new': 'upvc-new',
  'upvc-old': 'upvc-old',
  'upvc-waste': 'upvc-waste',
  'upvc-total': 'upvc-total',
  'upvc-item': 'upvc-item',
};

/** The integer part of a decimal string, grouped for reading. The fraction is left exactly as
 *  the server sent it, so `1250000.000` reads `1,250,000.000` and never `1.25M`. */
export function groupedQuantity(value: string): string {
  const text = value.trim();
  if (/[eE]/.test(text)) return text;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? '' : body.slice(dot);
  if (!/^\d+$/.test(whole)) return text;
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

/** The server's own timestamp, shown without a browser-locale conversion. The offset travels with
 *  it: `09:01:08+05:30` is what the backend recorded, and moving it to the reader's clock would
 *  make two machines disagree about when the same batch landed. */
export function serverTimestampText(value: string | null): string {
  if (value === null || value.trim() === '') return 'not recorded';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (match === null) return value;
  return `${match[1]} ${match[2]}${match[3] === undefined ? '' : ` ${match[3]}`}`;
}

/** `footage` is pieces × the row's length in feet, computed by the server. The panel never
 *  multiplies, and never calls the sheet's `Feet` column footage — that column is a length class. */
export const FOOTAGE_NOTE =
  'Pieces are the workbook’s Total column. Footage is the server’s per-row pieces × length; the sheet’s Feet column is a length class and is never summed as footage.';

export const PIECES_UNIT_TEXT = 'pcs';
export const FOOTAGE_UNIT_TEXT = 'ft';

export function materialMatches(material: ServerStockMaterial, foldedTerm: string): boolean {
  if (foldedTerm === '') return true;
  const haystack = [
    material.label,
    material.sourceLabel,
    material.columnLabel,
    material.categoryLabel,
    material.sectionName,
    material.tableDisplayName,
    material.sourceSheet,
    material.company,
    material.colour,
    material.stockType,
    material.dimensionLabel,
    material.dimensionValue,
    material.labelCoordinate,
    material.valueCoordinate,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ')
    .toLowerCase();
  return haystack.includes(foldedTerm);
}

export type MaterialStatusFilter = 'all' | 'resolved' | 'withheld';
export type MaterialSort = 'source' | 'label' | 'status' | 'quantity-asc' | 'quantity-desc';

export interface MaterialFilter {
  term: string;
  categoryKey: string;
  status: MaterialStatusFilter;
  sort: MaterialSort;
}

/** Filter and order the rows the server sent. Nothing is added: a filtered page is a view of the
 *  snapshot, not a second total. */
export function selectMaterials(
  materials: readonly ServerStockMaterial[],
  filter: MaterialFilter,
): ServerStockMaterial[] {
  const term = filter.term.trim().toLowerCase();
  const rows = materials.filter(
    (material) =>
      (filter.categoryKey === '' || material.categoryKey === filter.categoryKey) &&
      (filter.status === 'all' || material.status === filter.status) &&
      materialMatches(material, term),
  );
  const sourceOrder = (left: ServerStockMaterial, right: ServerStockMaterial) =>
    left.categoryKey.localeCompare(right.categoryKey) ||
    left.sourceSheet.localeCompare(right.sourceSheet) ||
    left.tableId.localeCompare(right.tableId) ||
    left.rowNumber - right.rowNumber;

  const ordered = [...rows];
  switch (filter.sort) {
    case 'label':
      ordered.sort((left, right) => left.label.localeCompare(right.label) || sourceOrder(left, right));
      break;
    case 'status':
      ordered.sort(
        (left, right) =>
          (left.status === right.status ? 0 : left.status === 'withheld' ? -1 : 1) || sourceOrder(left, right),
      );
      break;
    case 'quantity-asc':
    case 'quantity-desc': {
      const direction = filter.sort === 'quantity-asc' ? 1 : -1;
      ordered.sort((left, right) => {
        if (left.quantity === null && right.quantity === null) return sourceOrder(left, right);
        if (left.quantity === null) return 1;
        if (right.quantity === null) return -1;
        return compareDecimalText(left.quantity, right.quantity) * direction || sourceOrder(left, right);
      });
      break;
    }
    default:
      ordered.sort(sourceOrder);
  }
  return ordered;
}

/** Compare two decimal texts without converting either to a float. Used only to order rows inside
 *  one category, where the unit is the same. */
export function compareDecimalText(left: string, right: string): number {
  const parse = (value: string): { negative: boolean; whole: string; fraction: string } | null => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (match === null) return null;
    return {
      negative: match[1] === '-',
      whole: match[2].replace(/^0+(?=\d)/, ''),
      fraction: (match[3] ?? '').replace(/0+$/, ''),
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (a === null || b === null) return left.localeCompare(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const direction = a.negative ? -1 : 1;
  if (a.whole.length !== b.whole.length) return (a.whole.length - b.whole.length) * direction;
  if (a.whole !== b.whole) return (a.whole < b.whole ? -1 : 1) * direction;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, '0');
  const bFraction = b.fraction.padEnd(width, '0');
  if (aFraction === bFraction) return 0;
  return (aFraction < bFraction ? -1 : 1) * direction;
}

/** Page a client-side list the same way the server pages its own: 1-based, clamped. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (Math.max(1, page) - 1) * pageSize);
  return rows.slice(start, start + pageSize);
}
