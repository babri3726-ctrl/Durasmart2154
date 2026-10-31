/** Total Stock and the three metal category tabs: every source row in the approved snapshot,
 *  resolved or withheld, with the coordinates a reader can go and check.
 *
 *  The rows are the server's. Filtering and ordering happen on this screen because the snapshot
 *  body already holds every material; nothing is added, and the category figures above the list
 *  are the server's totals rather than a sum of what happens to be on the page. A withheld row
 *  shows the figure the sheet held and says it was not applied — it does not become zero, and it
 *  does not become stock.
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Card, EmptyState } from '../ui/Card';
import { LiveSyncBar } from '../ui/LiveSync';
import { Pager } from '../ui/Pager';
import {
  CategoryStatusChip,
  QuantityFigure,
  SnapshotBanner,
  StockReadState,
  UpvcFigures,
} from './StockBits';
import { isNegativeQuantity } from '../../lib/liveDisplay';
import { unitText } from '../../lib/stockPreviewModel';
import {
  FOOTAGE_NOTE,
  groupedQuantity,
  pageOf,
  selectMaterials,
  serverTimestampText,
  type MaterialSort,
  type MaterialStatusFilter,
} from '../../lib/stockView';
import { syncKeys, useSyncToken } from '../../lib/syncStore';
import { useResource } from '../../lib/useResource';
import {
  readStockSummary,
  type ServerStockCategory,
  type ServerStockMaterial,
  type ServerStockSummary,
} from '../../lib/serverApi';

const PAGE_SIZE = 25;

const SORT_LABELS: Record<MaterialSort, string> = {
  source: 'Sheet order',
  label: 'Label A–Z',
  status: 'Withheld first',
  'quantity-asc': 'Quantity, low to high',
  'quantity-desc': 'Quantity, high to low',
};

function isUpvc(material: ServerStockMaterial): boolean {
  return material.stockType !== null || material.categoryKey.startsWith('upvc-');
}

/** One figure for a row. A resolved UPVC row says pieces and footage; a metal row says its own
 *  quantity and the sheet's unit (or that no unit was stated). */
function MaterialFigure({ material }: { material: ServerStockMaterial }) {
  if (material.status === 'withheld') {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#C96B15]">withheld</span>
        {isUpvc(material) && material.quantity !== null ? (
          <UpvcFigures pieces={material.quantity} footage={material.footage} />
        ) : (
          <QuantityFigure value={material.quantity} unit={material.unit} />
        )}
      </span>
    );
  }
  if (isUpvc(material)) {
    return <UpvcFigures pieces={material.quantity} footage={material.footage} />;
  }
  return <QuantityFigure value={material.quantity} unit={material.unit} />;
}

function MaterialRow({
  material,
  snapshotAppliedAt,
  open,
  onToggle,
}: {
  material: ServerStockMaterial;
  snapshotAppliedAt: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const withheld = material.status === 'withheld';
  return (
    <div className={`border-b border-line/60 last:border-b-0 ${withheld ? 'bg-brand-orange/5' : ''}`}>
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2 text-left hover:bg-canvas/40"
        onClick={onToggle}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 text-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-2 text-[13px] font-bold text-ink">
              {material.label === '' ? <span className="italic text-faint">no label on the sheet</span> : material.label}
              <span className="text-[10px] font-semibold text-muted">{material.columnLabel}</span>
              {withheld && <span className="chip bg-brand-orange/15 text-[#C96B15]">not applied</span>}
              {material.stale && (
                <span className="chip bg-brand-orange/15 text-[#C96B15]">
                  stale — {material.carryReason ?? 'carried forward'}
                </span>
              )}
              {material.quantity !== null && isNegativeQuantity(material.quantity) && (
                <span className="chip bg-brand-red/10 text-brand-red">negative</span>
              )}
              {material.warnings.map((warning) => (
                <span key={warning} className="chip bg-brand-red/10 text-brand-red">
                  {warning}
                </span>
              ))}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
              <span>{material.categoryLabel}</span>
              <span>{material.sourceSheet}</span>
              <span>row {material.rowNumber}</span>
              <span className="text-faint">{material.labelCoordinate}</span>
              {material.company !== null && <span>{material.company}</span>}
              {material.colour !== null && <span>colour {material.colour}</span>}
              {material.dimensionLabel !== null && (
                <span>
                  {material.dimensionLabel} {material.dimensionValue ?? '—'}
                </span>
              )}
              {material.lengthFt !== null && <span>{material.lengthFt} ft length</span>}
              {material.reasons.map((reason) => (
                <span key={reason} className="chip bg-brand-orange/15 text-[#C96B15]">
                  {reason}
                </span>
              ))}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <MaterialFigure material={material} />
        </span>
      </button>

      {open && (
        <div className="grid gap-3 border-t border-line/50 bg-canvas/30 px-9 py-3 text-[11px] sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Source</p>
            <p className="mt-0.5 text-ink">
              {material.sourceSheet} · {material.sectionName}
            </p>
            <p className="text-muted">
              {material.tableDisplayName} · {material.tableId}
            </p>
            <p className="text-muted">
              label <span className="text-faint">{material.labelCoordinate}</span>
              {material.valueCoordinate !== null && (
                <>
                  {' '}· value <span className="text-faint">{material.valueCoordinate}</span>
                </>
              )}
            </p>
            <p className="text-muted">source label “{material.sourceLabel}”</p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Detail</p>
            <p className="mt-0.5 text-ink">
              status <span className="font-bold">{material.status}</span>
              {' · '}unit <span className="font-bold">{unitText(material.unit)}</span>
            </p>
            {material.company !== null && <p className="text-muted">company {material.company}</p>}
            {material.stockType !== null && <p className="text-muted">UPVC {material.stockType}</p>}
            {material.colour !== null && <p className="text-muted">colour {material.colour}</p>}
            {material.dimensionLabel !== null && (
              <p className="text-muted">
                {material.dimensionLabel} {material.dimensionValue ?? '—'}
              </p>
            )}
            {material.lengthFt !== null && (
              <p className="text-muted">
                length {material.lengthFt} ft · footage {material.footage === null ? '—' : groupedQuantity(material.footage)}
              </p>
            )}
            {material.warnings.length > 0 && (
              <p className="text-brand-red">warnings: {material.warnings.join(', ')}</p>
            )}
            {material.reasons.length > 0 && (
              <p className="text-[#C96B15]">withheld because: {material.reasons.join(', ')}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Source history the server holds</p>
            {material.status === 'resolved' ? (
              <p className="mt-0.5 text-muted">
                supplied by batch <span className="font-mono font-bold text-ink">{material.sourceBatchId ?? '—'}</span>
                {' · '}snapshot applied <span className="font-bold text-ink">{serverTimestampText(snapshotAppliedAt)}</span>
                {material.carriedFromBatchId !== null && (
                  <> · carried from batch <span className="font-mono text-ink">{material.carriedFromBatchId}</span></>
                )}
                {material.carryReason !== null && <> · {material.carryReason}</>}
                {material.stale && <> · this figure is not from the newest file</>}
              </p>
            ) : (
              <p className="mt-0.5 text-muted">
                Read from the newest file and withheld by the apply plan. No stock batch was written
                for this row, so it has no source batch.
              </p>
            )}
            <p className="mt-1 text-[10px] text-faint">
              An imported snapshot is a level, not a movement ledger. The server holds no dated
              purchase/sale/production history for this row, so this screen does not invent one;
              movement history lives in the Movement Ledger, which is a separate read.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryFigures({ category }: { category: ServerStockCategory }) {
  return (
    <div className="rounded-field border border-line bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[12px] font-black text-ink">{category.label}</p>
        <CategoryStatusChip status={category.status} />
        <span className="text-[10px] text-muted">{category.sourceSheet ?? '—'}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-3 text-[12px]">
        {category.pieces !== null ? (
          <UpvcFigures pieces={category.pieces} footage={category.footage} strong />
        ) : (
          <QuantityFigure value={category.quantity} unit={category.unit} strong />
        )}
        {category.withheldQuantity !== null && (
          <span className="text-[10px] font-bold text-[#C96B15]">
            {groupedQuantity(category.withheldQuantity)} withheld
          </span>
        )}
        <span className="text-[10px] text-muted">
          {category.figureCount} figure{category.figureCount === 1 ? '' : 's'} · {category.withheldCount} withheld row
          {category.withheldCount === 1 ? '' : 's'}
        </span>
        {category.negativeCount > 0 && (
          <span className="chip bg-brand-red/10 text-brand-red">{category.negativeCount} negative</span>
        )}
        {category.staleCount > 0 && (
          <span className="chip bg-brand-orange/15 text-[#C96B15]">{category.staleCount} stale</span>
        )}
      </p>
      {category.note !== null && <p className="mt-1 text-[10px] text-muted">{category.note}</p>}
    </div>
  );
}

export default function StockMaterialList({
  categoryKey = '',
  heading,
  description,
}: {
  categoryKey?: string;
  heading: string;
  description: string;
}) {
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<MaterialStatusFilter>('all');
  const [sort, setSort] = useState<MaterialSort>('source');
  const [selectedCategory, setSelectedCategory] = useState(categoryKey);
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const fetcher = useCallback(() => readStockSummary(), []);
  const token = useSyncToken(syncKeys.stockSummary);
  const { state, data, error, retry, sync } = useResource(fetcher, token);

  const filter = selectedCategory;
  const rows = useMemo(
    () => (data === null ? [] : selectMaterials(data.materials, { term, categoryKey: filter, status, sort })),
    [data, term, filter, status, sort],
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const visible = pageOf(rows, currentPage, PAGE_SIZE);
  const category = data?.categories.find((item) => item.key === categoryKey) ?? null;
  const activeCategories = data?.categories.filter((item) => item.key !== 'upvc-total') ?? [];
  const quantitySortOffered = filter !== '' && filter !== 'upvc-total';

  const summary: ServerStockSummary | null = data;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-ink">{heading}</p>
          <p className="mt-0.5 max-w-2xl text-[11px] text-muted">{description}</p>
        </div>
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      <StockReadState state={state} error={error} retry={retry} loadingLabel="Reading the approved stock snapshot…" />

      {state === 'ready' && summary !== null && (
        <>
          <SnapshotBanner snapshot={summary.snapshot} />

          {!summary.available ? (
            <EmptyState
              title="No approved snapshot to list"
              hint="An owner applies a workbook on the Excel Import / Sync tab. The Movement Ledger is separate and still answers from recorded movements."
            />
          ) : (
            <>
              {category !== null && (
                <div className="mb-3">
                  <CategoryFigures category={category} />
                </div>
              )}
              {categoryKey === '' && (
                <p className="mb-3 rounded-field border border-line bg-canvas/40 px-3 py-2 text-[10px] text-muted">
                  This list holds {summary.materials.length} source rows across the applied sections.
                  No grand total is shown: the sheet states metal in its own unit, UPVC in pieces and
                  footage, and those measures are never added together. Each category keeps its own
                  server total.
                </p>
              )}

              <div className="mb-3 flex flex-wrap items-end gap-2">
                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Search
                  <span className="relative mt-1 block">
                    <Search size={13} className="pointer-events-none absolute left-2 top-2 text-faint" />
                    <input
                      className="input !w-64 !py-1.5 !pl-7 normal-case font-semibold text-ink"
                      value={term}
                      onChange={(event) => {
                        setTerm(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Label, company, colour, sheet, coordinate…"
                    />
                  </span>
                </label>

                {categoryKey === '' && (
                  <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                    Category
                    <select
                      className="input mt-1 block !w-56 !py-1.5 normal-case font-semibold text-ink"
                      value={selectedCategory}
                      onChange={(event) => {
                        setSelectedCategory(event.target.value);
                        setPage(1);
                        if (event.target.value === '') setSort('source');
                      }}
                    >
                      <option value="">All categories</option>
                      {activeCategories.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Status
                  <select
                    className="input mt-1 block !w-36 !py-1.5 normal-case font-semibold text-ink"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value as MaterialStatusFilter);
                      setPage(1);
                    }}
                  >
                    <option value="all">All rows</option>
                    <option value="resolved">Applied only</option>
                    <option value="withheld">Withheld only</option>
                  </select>
                </label>

                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Order
                  <select
                    className="input mt-1 block !w-52 !py-1.5 normal-case font-semibold text-ink"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as MaterialSort);
                      setPage(1);
                    }}
                  >
                    {(['source', 'label', 'status'] as MaterialSort[]).map((key) => (
                      <option key={key} value={key}>
                        {SORT_LABELS[key]}
                      </option>
                    ))}
                    {quantitySortOffered && (
                      <>
                        <option value="quantity-asc">{SORT_LABELS['quantity-asc']}</option>
                        <option value="quantity-desc">{SORT_LABELS['quantity-desc']}</option>
                      </>
                    )}
                  </select>
                </label>
                <p className="pb-1 text-[10px] text-faint">
                  {quantitySortOffered
                    ? 'Quantity ordering is offered inside one category, where every row uses the same measure.'
                    : 'Quantity ordering is not offered across categories: unlike units are not comparable.'}
                </p>
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-muted">
                  {summary.materials.length === 0
                    ? 'The approved snapshot holds no material rows.'
                    : 'No source row matches those filters. The filters only narrow rows the server sent; nothing was re-totalled.'}
                </p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-field border border-line bg-white">
                    {visible.map((material) => (
                      <MaterialRow
                        key={`${material.categoryKey}|${material.status}|${material.itemKey}`}
                        material={material}
                        snapshotAppliedAt={summary.snapshot.appliedAt}
                        open={openKey === `${material.categoryKey}|${material.status}|${material.itemKey}`}
                        onToggle={() =>
                          setOpenKey((current) =>
                            current === `${material.categoryKey}|${material.status}|${material.itemKey}`
                              ? null
                              : `${material.categoryKey}|${material.status}|${material.itemKey}`,
                          )
                        }
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Pager page={currentPage} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
                    <p className="mt-2 max-w-xl text-[10px] text-faint">
                      {rows.length} of {summary.materials.length} source rows match. {FOOTAGE_NOTE}
                    </p>
                  </div>
                </>
              )}

              <Card className="mt-4 text-[10px] text-muted">
                Reading this list wrote nothing. Stock movements created{' '}
                {String(summary.stockMovementsCreated)}.
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
