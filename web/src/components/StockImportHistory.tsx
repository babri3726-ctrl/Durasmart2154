/** Applied stock snapshots, read from the owner-only history routes.
 *
 *  The list is the batches that were fully written. A failed apply rolls its batch back with
 *  everything else, so there is no half-applied row to explain. Opening one shows the quarantine
 *  the plan withheld and the differences the reading reported — the findings the owner applied
 *  under, not a second reconciliation.
 *
 *  Owner-only on the server. This screen does not pre-check the role: an employee who reaches it
 *  gets the server's `403` as the screen's error, which is the same answer the route gives.
 */

import { useCallback, useState } from 'react';
import { Pager } from './ui/Pager';
import { Card, EmptyState, Spinner } from './ui/Card';
import { isNegativeQuantity } from '../lib/liveDisplay';
import { syncKeys, useSyncPrefix } from '../lib/syncStore';
import {
  getStockImport,
  listStockImportItems,
  listStockImports,
  type ServerStockImportBatch,
  type ServerStockImportItem,
  type ServerStockImportQuarantine,
} from '../lib/serverApi';
import { unitText } from '../lib/stockPreviewModel';
import { useLiveList } from '../lib/useLiveList';
import { useResource } from '../lib/useResource';

const PAGE_SIZE = 20;

const shortSha = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 16)}…`);

function QuarantineLine({ item }: { item: ServerStockImportQuarantine }) {
  return (
    <li className="border-b border-line/50 py-1.5 last:border-b-0">
      <p className="flex flex-wrap items-baseline gap-2 text-[11px] font-bold text-ink">
        {item.sourceLabel || '(no label on the sheet)'}
        <span className="text-[10px] font-normal text-muted">{item.columnLabel}</span>
        {item.quantity !== null && (
          <span className={isNegativeQuantity(item.quantity) ? 'tabular-nums text-brand-red' : 'tabular-nums text-ink'}>
            {item.quantity} {unitText(item.unit)}
          </span>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span>{item.sourceSheet}</span>
        <span>row {item.rowNumber}</span>
        <span>{item.labelCoordinate}</span>
        {item.valueCoordinate !== null && <span>{item.valueCoordinate}</span>}
        {item.parentLabel !== null && <span>parent “{item.parentLabel}”</span>}
        {item.reasons.map((reason) => (
          <span key={reason} className="chip bg-brand-orange/15 text-[#C96B15]">
            {reason}
          </span>
        ))}
        {item.warnings.map((warning) => (
          <span key={warning} className="chip bg-brand-red/10 text-brand-red">
            {warning}
          </span>
        ))}
      </p>
    </li>
  );
}

function ItemLine({ item }: { item: ServerStockImportItem }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 px-3 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-2 text-[11px] font-bold text-ink">
          {item.displayLabel}
          <span className="text-[10px] font-normal text-muted">{item.columnLabel}</span>
          {item.stale && (
            <span className="chip bg-brand-orange/15 text-[#C96B15]">
              stale — {item.carryReason ?? 'carried forward'}
            </span>
          )}
        </p>
        <p className="text-[10px] text-muted">
          {item.sourceSheet} · row {item.rowNumber} · {item.valueCoordinate}
          {item.carriedFromBatchId !== null && ` · carried from ${item.carriedFromBatchId}`}
        </p>
      </div>
      <span className={isNegativeQuantity(item.quantity) ? 'text-[12px] font-black tabular-nums text-brand-red' : 'text-[12px] font-bold tabular-nums text-ink'}>
        {item.quantity} <span className="text-[10px] font-normal text-muted">{unitText(item.unit)}</span>
      </span>
    </div>
  );
}

function BatchDetail({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const token = useSyncPrefix(syncKeys.stockImports);
  const fetcher = useCallback(() => getStockImport(batchId), [batchId]);
  const detail = useResource(fetcher, token);
  const [page, setPage] = useState(1);
  const loadItems = useCallback(
    (_folded: string, p: number) => listStockImportItems(batchId, { page: p, pageSize: PAGE_SIZE }),
    [batchId],
  );
  const items = useLiveList(loadItems, '', page, token);

  return (
    <div>
      <button type="button" className="btn-ghost btn-sm mb-3" onClick={onBack}>
        ← All applied imports
      </button>
      {detail.state === 'loading' && <Spinner label="Loading this applied batch…" />}
      {detail.state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {detail.error}{' '}
          <button type="button" className="font-bold underline" onClick={detail.retry}>
            Try again
          </button>
        </p>
      )}
      {detail.state === 'ready' && detail.data !== null && (
        <>
          <div className="mb-3 rounded-field border border-line bg-white p-3">
            <p className="flex flex-wrap items-baseline gap-2 text-[12px] font-black text-ink">
              {detail.data.batch.filename}
              <span className="chip bg-brand-green/12 text-brand-green">{detail.data.batch.state}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted">
              <span>
                batch <span className="font-mono text-ink">{detail.data.batch.id}</span>
              </span>
              <span>applied {detail.data.batch.appliedAt} by {detail.data.batch.appliedBy}</span>
              <span>
                SHA-256 <span className="font-mono text-ink">{shortSha(detail.data.batch.fileSha256)}</span>
              </span>
              <span>{detail.data.batch.itemCount} figures</span>
              <span>{detail.data.batch.appliedItemCount} applied</span>
              <span>{detail.data.batch.carriedForwardCount} carried forward</span>
              <span>{detail.data.batch.staleCount} stale</span>
              <span>{detail.data.batch.quarantineCount} withheld</span>
              <span>validation {detail.data.batch.validationStatus}</span>
              <span>{detail.data.batch.warningCount} warnings counted</span>
              <span>sheets {detail.data.batch.sheetsRead.join(', ') || 'none'}</span>
            </p>
            <p className="mt-1 text-[10px] text-muted">
              This batch wrote a snapshot and no stock movement. Its findings are kept exactly as
              they were applied; nothing below is re-read from the current workbook.
            </p>
          </div>

          <div className="mb-3 rounded-field border border-line bg-white p-3">
            <p className="text-[11px] font-black text-ink">
              Rows withheld by the plan ({detail.data.quarantine.length})
            </p>
            {detail.data.quarantine.length === 0 ? (
              <p className="mt-1 text-[10px] text-muted">No read row was withheld in this batch.</p>
            ) : (
              <ul className="mt-1">
                {detail.data.quarantine.map((item) => (
                  <QuarantineLine key={item.itemKey} item={item} />
                ))}
              </ul>
            )}
          </div>

          {detail.data.reconciliations.length > 0 && (
            <div className="mb-3 rounded-field border border-line bg-white p-3">
              <p className="text-[11px] font-black text-ink">
                Differences reported when this batch was applied ({detail.data.reconciliations.length})
              </p>
              <ul className="mt-1">
                {detail.data.reconciliations.map((item, index) => (
                  <li key={`${item.code}-${index}`} className="border-b border-line/50 py-1.5 text-[11px] last:border-b-0">
                    <span className="font-bold text-ink">{item.code}</span>{' '}
                    <span className="text-muted">{item.tableId} · {item.sheet}</span>{' '}
                    <span className="tabular-nums">
                      displayed {item.displayedTotal ?? '—'} · rows {item.computed ?? '—'} · difference{' '}
                      <span className="font-bold">{item.difference ?? '—'}</span>
                    </span>
                    <span className="block text-[10px] text-muted">{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.data.warnings.length > 0 && (
            <div className="mb-3 rounded-field border border-line bg-white p-3">
              <p className="text-[11px] font-black text-ink">
                Warnings listed with this batch ({detail.data.warnings.length})
              </p>
              <ul className="mt-1 space-y-1 text-[10px] text-muted">
                {detail.data.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>
                    <span className="chip bg-brand-orange/15 text-[#C96B15]">{warning.code}</span>{' '}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-field border border-line">
            <p className="border-b border-line bg-canvas/60 px-3 py-2 text-[11px] font-black text-ink">
              Effective figures in this batch
            </p>
            {items.state === 'loading' && <p className="px-3 py-2 text-[10px] text-muted">Loading figures…</p>}
            {items.state === 'error' && (
              <p className="px-3 py-2 text-[10px] font-semibold text-brand-red">
                {items.error}{' '}
                <button type="button" className="underline" onClick={items.retry}>
                  Try again
                </button>
              </p>
            )}
            {items.state === 'ready' && items.rows.length === 0 && (
              <p className="px-3 py-2 text-[10px] text-muted">No effective figure in this batch.</p>
            )}
            {items.state === 'ready' &&
              items.rows.map((item) => <ItemLine key={item.itemKey} item={item} />)}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={items.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: ServerStockImportBatch; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-ink">
          {batch.filename} <span className="font-mono text-[10px] font-semibold text-muted">{shortSha(batch.fileSha256)}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span>{batch.appliedAt}</span>
          <span>by {batch.appliedBy}</span>
          <span>batch {batch.id}</span>
          <span>{batch.appliedItemCount} applied</span>
          <span>{batch.carriedForwardCount} carried</span>
          <span>{batch.staleCount} stale</span>
          <span>{batch.quarantineCount} withheld</span>
        </p>
      </div>
      <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onOpen}>
        Open
      </button>
    </div>
  );
}

export default function StockImportHistory() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(
    (folded: string, p: number) => listStockImports({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const token = useSyncPrefix(syncKeys.stockImports);
  const { state, rows, total, error, retry } = useLiveList(load, term, page, token);

  if (selected !== null) {
    return <BatchDetail batchId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-[11px] text-muted">
          Every stock import that was committed, newest first. Each one wrote a dated snapshot; the
          rows it withheld and the differences it reported are kept with the batch.
        </p>
        <input
          className="input !w-auto !py-2"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setPage(1);
          }}
          placeholder="Search filename…"
        />
      </div>
      {state === 'loading' && <Spinner label="Loading applied imports…" />}
      {state === 'error' && (
        <Card className="border border-brand-red/30">
          <p className="text-xs font-semibold text-brand-red">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={retry}>
              Try again
            </button>
          </p>
          <p className="mt-1 text-[10px] text-muted">
            This history is owner-only on the server. A staff token is refused here; the refusal is
            the server's answer, not an empty history.
          </p>
        </Card>
      )}
      {state === 'ready' && rows.length === 0 && (
        <EmptyState
          title={term ? 'No import matches that search' : 'No stock import has been applied yet'}
          hint="The Workbook preview tab is where an owner reads a workbook and confirms an import."
        />
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-field border border-line">
            {rows.map((batch) => (
              <BatchRow key={batch.id} batch={batch} onOpen={() => setSelected(batch.id)} />
            ))}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
