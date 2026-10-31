/** The latest approved workbook snapshot, read from `GET /stock/imported`.
 *
 *  This is a different answer from the Balances tab: a balance is a SUM over posted movements,
 *  while this is the level the owner confirmed in a workbook. An import posts no movement, so the
 *  two figures can legitimately disagree and neither screen may present one as the other.
 *
 *  The sync control is the "automatic stock update" option: while it is on, this tab re-reads the
 *  approved snapshot on a timer, so a snapshot applied on another machine reaches this screen
 *  without a reload. It changes nothing on the server — it is the same authenticated `GET` the
 *  button makes, repeated. The setting is remembered in this browser only.
 */

import { useCallback } from 'react';
import { Card, EmptyState, Spinner } from './ui/Card';
import { LiveSyncBar } from './ui/LiveSync';
import { AutoSyncSelect } from './stock/StockBits';
import { isNegativeQuantity } from '../lib/liveDisplay';
import { readImportedStock, type ServerStockImportItem } from '../lib/serverApi';
import { unitText } from '../lib/stockPreviewModel';
import { syncKeys, useSyncToken } from '../lib/syncStore';
import { useResource } from '../lib/useResource';
import { useStockAutoSync } from '../lib/useStockAutoSync';

const shortSha = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 16)}…`);

const groupByTable = (items: ServerStockImportItem[]): { key: string; heading: string; items: ServerStockImportItem[] }[] => {
  const groups = new Map<string, { key: string; heading: string; items: ServerStockImportItem[] }>();
  for (const item of items) {
    const key = `${item.sourceSheet}|${item.tableId}`;
    const heading = `${item.tableDisplayName} · ${item.sectionDisplayName} · ${item.sourceSheet}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, heading, items: [item] });
  }
  return [...groups.values()];
};

function ItemLine({ item }: { item: ServerStockImportItem }) {
  const carried = item.stale || item.carriedForward;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-2 text-[13px] font-bold text-ink">
          {item.displayLabel}
          <span className="text-[10px] font-semibold text-muted">{item.columnLabel}</span>
          {carried && (
            <span
              className="chip bg-brand-orange/15 text-[#C96B15]"
              title={
                item.carryReason === 'absentFromWorkbook'
                  ? 'This key was not in the newest workbook, so the last approved figure is carried forward.'
                  : 'This key was unresolved in the newest workbook, so the last approved figure is carried forward.'
              }
            >
              {item.stale ? 'stale — carried forward' : 'carried forward'}
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span className="text-faint">{item.labelCoordinate}</span>
          <span>row {item.rowNumber}</span>
          <span>{item.valueCoordinate}</span>
          {item.sourceLabel !== item.displayLabel && <span>source label “{item.sourceLabel}”</span>}
          {item.dimensionLabel !== null && (
            <span>
              {item.dimensionLabel} {item.dimensionValueText ?? '—'}
              {item.dimensionCoordinate !== null && <span className="text-faint"> · {item.dimensionCoordinate}</span>}
            </span>
          )}
          {item.carriedFromBatchId !== null && <span>carried from batch {item.carriedFromBatchId}</span>}
          {item.warnings.map((warning) => (
            <span key={warning} className="chip bg-brand-red/10 text-brand-red">
              {warning}
            </span>
          ))}
        </p>
      </div>
      <span
        className={`shrink-0 text-[13px] tabular-nums ${
          isNegativeQuantity(item.quantity) ? 'font-black text-brand-red' : 'font-bold text-ink'
        }`}
      >
        {item.quantity} <span className="text-[11px] font-normal text-muted">{unitText(item.unit)}</span>
      </span>
    </div>
  );
}

export default function ApprovedStock() {
  const fetcher = useCallback(() => readImportedStock(), []);
  const token = useSyncToken(syncKeys.stockImported);
  const { state, data, error, retry, sync } = useResource(fetcher, token);
  const auto = useStockAutoSync(sync.refresh);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-[11px] text-muted">
          The stock level in the latest workbook the owner confirmed. A snapshot states a level; the
          Movement Ledger states deltas. An import writes no movement, so these two are shown apart on
          purpose.
        </p>
        <AutoSyncSelect seconds={auto.seconds} onChoose={auto.choose} />
      </div>

      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      {state === 'loading' && <Spinner label="Loading the approved stock snapshot…" />}
      {state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}

      {state === 'ready' && data !== null && !data.available && (
        <EmptyState
          title="No approved stock snapshot yet"
          hint="An owner applies a workbook from the Workbook preview tab. Until then this screen has no approved level to show — the Balances tab is the movement ledger, which is a different question."
        />
      )}

      {state === 'ready' && data !== null && data.available && data.snapshot !== null && (
        <>
          <div className="mb-3 rounded-field border border-line bg-white p-3">
            <p className="flex flex-wrap items-baseline gap-2 text-[12px] font-black text-ink">
              {data.snapshot.filename}
              <span className="chip bg-brand-green/12 text-brand-green">approved snapshot</span>
              <span className="text-[10px] font-semibold text-muted">
                {data.returnedItemCount} figures · {data.staleCount} stale · {data.quarantineCount} withheld
              </span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted">
              <span>
                batch <span className="font-mono text-ink">{data.snapshot.id}</span>
              </span>
              <span>
                applied <span className="font-bold text-ink">{data.snapshot.appliedAt}</span> by{' '}
                <span className="font-bold text-ink">{data.snapshot.appliedBy}</span>
              </span>
              <span>
                SHA-256 <span className="font-mono text-ink">{shortSha(data.snapshot.fileSha256)}</span>
              </span>
              <span>
                {data.snapshot.appliedItemCount} applied · {data.snapshot.carriedForwardCount} carried forward
              </span>
              <span>stock movements created {String(data.stockMovementsCreated)}</span>
            </p>
            <p className="mt-1 text-[10px] text-muted">
              A stale figure is the last approved value for a key the newest workbook no longer
              applied; it is still the effective stock, and it says so rather than passing as this
              morning's reading.
            </p>
          </div>

          {data.items.length === 0 ? (
            <p className="text-xs text-muted">The snapshot holds no effective figures.</p>
          ) : (
            <div className="space-y-3">
              {groupByTable(data.items).map((group) => (
                <div key={group.key} className="overflow-hidden rounded-field border border-line">
                  <p className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-canvas/60 px-3 py-2 text-[11px] font-black text-ink">
                    {group.heading}
                    <span className="text-[10px] font-semibold text-muted">{group.items.length} figures</span>
                  </p>
                  {group.items.map((item) => (
                    <ItemLine key={item.itemKey} item={item} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {state === 'ready' && data === null && <Card className="text-[11px] text-muted">The backend returned no snapshot body.</Card>}
    </div>
  );
}
