/** The stock dashboard both roles read: the latest approved snapshot in its own measures.
 *
 *  The mockup shows one combined "Total Qty" and a donut of shares. This screen does not, because
 *  the workbook states metal in its own unit, UPVC in pieces and footage, and the three cannot be
 *  added. What replaces the combined figure is a card per source group and a coverage view counted
 *  in source rows — arithmetic on counts, not on stock.
 *
 *  Every apply-related action is on the Excel Import / Sync tab. The buttons here only change the
 *  tab; nothing on this screen writes stock. The automatic re-read is a timer over the same
 *  authenticated `GET`, never a server job.
 */

import { useCallback } from 'react';
import { FileSpreadsheet, RefreshCw, ShieldAlert } from 'lucide-react';
import { LiveSyncBar } from '../ui/LiveSync';
import {
  AutoSyncSelect,
  CategoryStatusChip,
  QuantityFigure,
  SnapshotBanner,
  StockChip,
  StockReadState,
  UpvcFigures,
} from './StockBits';
import {
  CATEGORY_VIEW,
  FOOTAGE_NOTE,
  groupedQuantity,
  serverTimestampText,
  type StockView,
} from '../../lib/stockView';
import { syncKeys, useSyncToken } from '../../lib/syncStore';
import { useStockAutoSync } from '../../lib/useStockAutoSync';
import { useResource } from '../../lib/useResource';
import {
  readStockProduction,
  readStockSummary,
  listStockImports,
  type ServerStockCategory,
  type ServerStockSummary,
} from '../../lib/serverApi';

/** The mockup's Category Wise Stock ring, drawn over applied source rows.
 *
 *  It cannot be a ring of quantities: metal rows, UPVC pieces and UPVC footage are three
 *  measures, and a share of one is not comparable with a share of another. Rows are the one
 *  thing every category states, so the ring answers "how was the applied reading distributed",
 *  and the centre says so in those words. `UPVC Total Stock` is left out because it re-counts
 *  the three UPVC bands — including it would draw 155 applied rows as 239.
 */
const DONUT_FILL: Record<string, string> = {
  'steel-coil': '#1DA96B',
  'profile-kanda': '#FF9D43',
  'gp-sheet': '#8750F5',
  'upvc-new': '#ED5DA8',
  'upvc-old': '#19BBA5',
  'upvc-waste': '#E24B5A',
  'upvc-item': '#3977F6',
};

function CategoryDonut({ categories }: { categories: ServerStockCategory[] }) {
  const parts = categories.filter((category) => category.key !== 'upvc-total');
  const total = parts.reduce((sum, category) => sum + category.figureCount, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let swept = 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] shrink-0" role="img">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#E4E8F2" strokeWidth="20" />
        {total > 0 &&
          parts.map((category) => {
            const length = (category.figureCount / total) * circumference;
            const dashOffset = -swept;
            swept += length;
            if (category.figureCount === 0) return null;
            return (
              <circle
                key={category.key}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={DONUT_FILL[category.key] ?? '#738099'}
                strokeWidth="20"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 70 70)"
              />
            );
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-ink" style={{ fontSize: 20, fontWeight: 900 }}>
          {total}
        </text>
        <text x="70" y="82" textAnchor="middle" className="fill-muted" style={{ fontSize: 9, fontWeight: 700 }}>
          applied rows
        </text>
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1 text-[10px]">
        {parts.map((category) => (
          <li key={category.key} className="flex items-baseline gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: DONUT_FILL[category.key] ?? '#738099' }}
            />
            <span className="min-w-0 flex-1 font-bold leading-tight text-ink [overflow-wrap:anywhere]">
              {category.label}
            </span>
            <span className="tabular-nums text-muted">
              {total === 0 ? '—' : `${Math.round((category.figureCount / total) * 100)}%`}
            </span>
            <span className="w-9 text-right font-bold tabular-nums text-ink">{category.figureCount}</span>
          </li>
        ))}
        <li className="pt-1 text-faint">
          Share of applied source rows, not of stock. UPVC Total Stock is excluded because it
          re-counts the three UPVC bands.
        </li>
      </ul>
    </div>
  );
}

/** The mockup's Latest Stock Sync / Import table, over the same applied batches the
 *  Excel Import / Sync tab lists. It is an owner-only read: where the server refuses, the
 *  refusal is shown rather than an empty table. */
function LatestImportTable({ onOpen }: { onOpen: (view: StockView) => void }) {
  const fetcher = useCallback(() => listStockImports({ pageSize: 5 }), []);
  const token = useSyncToken(syncKeys.stockImports);
  const { state, data, error, retry } = useResource(fetcher, token);

  return (
    <div className="rounded-field border border-line bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-black text-ink">Latest stock sync / import</p>
        <button type="button" className="text-[10px] font-black text-brand-blue underline" onClick={() => onOpen('sync')}>
          View all
        </button>
      </div>
      {state === 'loading' && <p className="text-[11px] text-faint">Reading applied batches…</p>}
      {state === 'error' && (
        <p className="text-[11px] font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && data !== null && (
        data.items.length === 0 ? (
          <p className="text-[11px] text-muted">No workbook has been applied yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-1 pr-2 font-extrabold">Applied</th>
                  <th className="py-1 pr-2 font-extrabold">Workbook</th>
                  <th className="py-1 pr-2 font-extrabold">Sheets read</th>
                  <th className="py-1 pr-2 text-right font-extrabold">Applied</th>
                  <th className="py-1 pr-2 text-right font-extrabold">Withheld</th>
                  <th className="py-1 font-extrabold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((batch) => (
                  <tr key={batch.id} className="border-b border-line/50 last:border-b-0">
                    <td className="py-1 pr-2 text-muted">
                      {serverTimestampText(batch.appliedAt)}
                      <span className="block text-[9px] text-faint">by {batch.appliedBy}</span>
                    </td>
                    <td className="py-1 pr-2 font-bold text-ink">{batch.filename}</td>
                    <td className="py-1 pr-2 text-[10px] text-muted">
                      {batch.sheetsRead.join(', ') || 'none'}
                    </td>
                    <td className="py-1 pr-2 text-right font-bold tabular-nums text-ink">
                      {batch.appliedItemCount}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {batch.quarantineCount === 0 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="font-bold text-[#C96B15]">{batch.quarantineCount}</span>
                      )}
                    </td>
                    <td className="py-1">
                      <span className={`chip ${batch.state === 'applied' ? 'bg-brand-green/12 text-brand-green' : 'bg-brand-orange/15 text-[#C96B15]'}`}>
                        {batch.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="mt-1 text-[10px] text-faint">
        Every row is an apply an owner confirmed. A read of this page writes nothing.
      </p>
    </div>
  );
}

function CoverageBars({ categories }: { categories: ServerStockCategory[] }) {
  return (
    <div className="space-y-2">
      {categories.map((category) => {
        const total = category.figureCount + category.withheldCount;
        const resolvedWidth = total === 0 ? 0 : (category.figureCount / total) * 100;
        return (
          <div key={category.key}>
            <div className="flex items-baseline justify-between gap-2 text-[10px]">
              <span className="font-bold text-ink">{category.label}</span>
              <span className="text-muted">
                {category.figureCount} read · {category.withheldCount} withheld
              </span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-line">
              <span className="bg-brand-green/60" style={{ width: `${resolvedWidth}%` }} />
              <span className="bg-brand-orange/60" style={{ width: `${100 - resolvedWidth}%` }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-[10px] text-faint">
        Counted in source rows, not quantities: a share of metal and a share of UPVC footage are not
        the same measure. A withheld row is shown as withheld, never as zero.
      </p>
    </div>
  );
}

function CategoryTable({
  categories,
  onOpen,
}: {
  categories: ServerStockCategory[];
  onOpen: (view: StockView) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-field border border-line">
      <table className="w-full min-w-[720px] border-collapse text-[11px]">
        <thead>
          <tr className="bg-canvas/70 text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-extrabold">Material / Sheet</th>
            <th className="px-3 py-2 text-right font-extrabold">Read</th>
            <th className="px-3 py-2 text-right font-extrabold">Quantity in its own unit</th>
            <th className="px-3 py-2 text-right font-extrabold">Withheld</th>
            <th className="px-3 py-2 text-right font-extrabold">Exceptions</th>
            <th className="px-3 py-2 font-extrabold">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.key} className="border-t border-line/60">
              <td className="px-3 py-2">
                <p className="font-bold text-ink">{category.label}</p>
                <p className="text-[10px] text-faint">{category.sourceSheet ?? 'no source sheet'}</p>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{category.figureCount}</td>
              <td className="px-3 py-2 text-right">
                {category.pieces !== null ? (
                  <UpvcFigures pieces={category.pieces} footage={category.footage} />
                ) : (
                  <QuantityFigure value={category.quantity} unit={category.unit} />
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {category.withheldCount === 0 ? (
                  <span className="text-faint">—</span>
                ) : (
                  <span className="font-bold text-[#C96B15]">
                    {category.withheldCount} row{category.withheldCount === 1 ? '' : 's'}
                    {category.withheldQuantity !== null && ` · ${groupedQuantity(category.withheldQuantity)}`}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="flex flex-wrap justify-end gap-1">
                  {category.negativeCount > 0 && (
                    <span className="chip bg-brand-red/10 text-brand-red">{category.negativeCount} negative</span>
                  )}
                  {category.staleCount > 0 && (
                    <span className="chip bg-brand-orange/15 text-[#C96B15]">{category.staleCount} stale</span>
                  )}
                  {category.negativeCount === 0 && category.staleCount === 0 && <span className="text-faint">none</span>}
                </span>
              </td>
              <td className="px-3 py-2">
                <CategoryStatusChip status={category.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="text-[10px] font-black text-brand-blue underline"
                  onClick={() => onOpen(CATEGORY_VIEW[category.key] ?? 'total')}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningsBlock({ summary }: { summary: ServerStockSummary }) {
  return (
    <div className="space-y-3">
      {summary.warnings.length === 0 ? (
        <p className="text-[11px] text-muted">The server reported no exceptions for this snapshot.</p>
      ) : (
        <ul className="divide-y divide-line/60 rounded-field border border-line">
          {summary.warnings.map((warning) => (
            <li key={warning.key} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[11px]">
              <StockChip value={warning.severity} />
              <span className="min-w-0 flex-1 text-ink">{warning.message}</span>
              {warning.count > 0 && <span className="text-[10px] tabular-nums text-muted">× {warning.count}</span>}
            </li>
          ))}
        </ul>
      )}
      {summary.withheld.length > 0 && (
        <div className="rounded-field border border-brand-orange/30 bg-brand-orange/5 p-3">
          <p className="text-[11px] font-black text-ink">Rows the apply plan withheld</p>
          <ul className="mt-1 space-y-1">
            {summary.withheld.map((group) => (
              <li key={`${group.categoryKey}-${group.sourceSheet}`} className="text-[10px] text-muted">
                <span className="font-bold text-ink">{group.categoryLabel}</span> · {group.count} row
                {group.count === 1 ? '' : 's'}
                {group.quantity !== null && ` · ${groupedQuantity(group.quantity)} withheld`}
                {' — '}
                {Object.entries(group.reasons)
                  .map(([reason, count]) => `${reason} × ${count}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-muted">
            Withheld rows stay visible with their coordinates on Total Stock; they are not stock and
            are not shown as zero.
          </p>
        </div>
      )}
    </div>
  );
}

export default function StockDashboard({ onOpen }: { onOpen: (view: StockView) => void }) {
  const fetchAll = useCallback(async () => {
    const [summary, production] = await Promise.all([readStockSummary(), readStockProduction()]);
    return { summary, production };
  }, []);
  const token = useSyncToken(syncKeys.stockSummary) + useSyncToken(syncKeys.stockProduction);
  const { state, data, error, retry, sync } = useResource(fetchAll, token);
  const auto = useStockAutoSync(sync.refresh);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-muted">
            The approved workbook reading, in the measures the sheet states. Metal quantities are not
            labelled with a unit the sheet never wrote; UPVC pieces and footage are kept apart.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => onOpen('sync')}>
              <FileSpreadsheet size={13} /> Excel import / sync
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => onOpen('check')}>
              <ShieldAlert size={13} /> Stock check
            </button>
          </div>
        </div>
        <AutoSyncSelect seconds={auto.seconds} onChoose={auto.choose} />
      </div>

      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      <StockReadState state={state} error={error} retry={retry} loadingLabel="Reading the approved stock snapshot…" />

      {state === 'ready' && data !== null && (
        <>
          <SnapshotBanner snapshot={data.summary.snapshot} />

          {!data.summary.available ? (
            <div className="rounded-field border border-line bg-white p-5 text-[12px] text-muted">
              <p className="font-black text-ink">No approved stock snapshot yet</p>
              <p className="mt-1">
                An owner applies a workbook on the Excel Import / Sync tab. Until then this dashboard
                has no approved level. The Movement Ledger below still answers from recorded movements.
              </p>
              <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => onOpen('ledger')}>
                <RefreshCw size={13} /> Open the movement ledger
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-field border border-line bg-white p-4">
                  <p className="mb-2 text-[12px] font-black text-ink">Category wise stock</p>
                  <CategoryDonut categories={data.summary.categories} />
                </div>
                <div className="rounded-field border border-line bg-white p-4">
                  <p className="mb-2 text-[12px] font-black text-ink">Category coverage</p>
                  <CoverageBars categories={data.summary.categories} />
                </div>
                <div className="rounded-field border border-line bg-white p-4">
                  <p className="mb-2 text-[12px] font-black text-ink">Production summary</p>
                  {data.production.available ? null : (
                    <p className="text-[11px] text-muted">{data.production.description}</p>
                  )}
                  <p className="mt-2 flex flex-wrap gap-1">
                    {data.production.categories.map((category) => (
                      <span key={category.key} className="chip bg-line text-muted">
                        {category.label}: not imported
                      </span>
                    ))}
                  </p>
                  <p className="mt-2 text-[10px] text-faint">
                    The sheet’s own vocabulary, with no figure beside it: the approved apply plan
                    stores no PRODUCTION row, so a production total here would be invented.
                  </p>
                  <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => onOpen('production')}>
                    Open production
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <LatestImportTable onOpen={onOpen} />
              </div>

              <div className="mb-4">
                <p className="mb-2 text-[12px] font-black text-ink">Category summary</p>
                <CategoryTable categories={data.summary.categories} onOpen={onOpen} />
                <p className="mt-1 text-[10px] text-faint">{FOOTAGE_NOTE}</p>
              </div>

              <div className="mb-4">
                <p className="mb-2 text-[12px] font-black text-ink">Exceptions and warnings</p>
                <WarningsBlock summary={data.summary} />
              </div>

              <p className="text-[10px] text-faint">
                Viewing this dashboard wrote nothing: stock movements created{' '}
                {String(data.summary.stockMovementsCreated)}. A workbook apply writes only the
                approved snapshot and stays on the Excel Import / Sync tab, behind an owner’s
                confirmed action.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
