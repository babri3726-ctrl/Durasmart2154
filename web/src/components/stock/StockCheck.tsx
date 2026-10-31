/** Stock Check: what the approved snapshot can prove about itself, and what it cannot.
 *
 *  This is not a physical count and not a reconciliation against the movement ledger. The panel
 *  has no count input and no posting route, and the snapshot carries no product keys that could be
 *  matched to ledger rows. What it can show, exactly as the server sent it:
 *
 *  - whether the file applied is the authorised revision;
 *  - which source rows were withheld and why, with their coordinates;
 *  - which figures are stale, carried forward, negative or warning-flagged;
 *  - the exceptions the server raised for the batch.
 *
 *  No discrepancy is computed here. Withheld rows are the plan's refusals, not a difference the
 *  panel worked out, and the two are labelled apart.
 */

import { useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LiveSyncBar } from '../ui/LiveSync';
import {
  CategoryStatusChip,
  QuantityFigure,
  SnapshotBanner,
  StockChip,
  StockReadState,
} from './StockBits';
import { isNegativeQuantity } from '../../lib/liveDisplay';
import { groupedQuantity, serverTimestampText } from '../../lib/stockView';
import { syncKeys, useSyncToken } from '../../lib/syncStore';
import { useResource } from '../../lib/useResource';
import { readStockSummary, type ServerStockMaterial } from '../../lib/serverApi';

function WithheldTable({ rows }: { rows: ServerStockMaterial[] }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-muted">No source row was withheld by this apply plan.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-field border border-line">
      <table className="w-full min-w-[760px] border-collapse text-[11px]">
        <thead>
          <tr className="bg-canvas/70 text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-extrabold">Category</th>
            <th className="px-3 py-2 font-extrabold">Source row</th>
            <th className="px-3 py-2 text-right font-extrabold">Figure read</th>
            <th className="px-3 py-2 font-extrabold">Why the plan withheld it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.categoryKey}|${row.itemKey}`} className="border-t border-line/60">
              <td className="px-3 py-2">
                <p className="font-bold text-ink">{row.categoryLabel}</p>
                <p className="text-[10px] text-faint">{row.sourceSheet}</p>
              </td>
              <td className="px-3 py-2">
                <p className="font-semibold text-ink">{row.label || '(no label on the sheet)'}</p>
                <p className="text-[10px] text-muted">
                  row {row.rowNumber} · label <span className="text-faint">{row.labelCoordinate}</span>
                  {row.valueCoordinate !== null && (
                    <> · value <span className="text-faint">{row.valueCoordinate}</span></>
                  )}
                </p>
              </td>
              <td className="px-3 py-2 text-right">
                <QuantityFigure value={row.quantity} unit={row.unit} />
                <span className="block text-[10px] text-[#C96B15]">withheld, not applied</span>
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {row.reasons.map((reason) => (
                    <span key={reason} className="chip bg-brand-orange/15 text-[#C96B15]">
                      {reason}
                    </span>
                  ))}
                  {row.reasons.length === 0 && <span className="text-faint">—</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StockCheck() {
  const fetcher = useCallback(() => readStockSummary(), []);
  const token = useSyncToken(syncKeys.stockSummary);
  const { state, data, error, retry, sync } = useResource(fetcher, token);

  const withheld = data?.materials.filter((row) => row.status === 'withheld') ?? [];
  const resolved = data?.materials.filter((row) => row.status === 'resolved') ?? [];
  const negativeRows = resolved.filter((row) => row.quantity !== null && isNegativeQuantity(row.quantity));
  const staleRows = resolved.filter((row) => row.stale);
  const matched =
    data?.snapshot.authorizedSha256 !== null &&
    data?.snapshot.authorizedSha256 !== undefined &&
    data.snapshot.fileSha256 === data.snapshot.authorizedSha256;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-ink">Stock Check</p>
          <p className="mt-0.5 max-w-2xl text-[11px] text-muted">
            An integrity view of the approved reading. It does not count physical stock, and it does
            not net the snapshot against movement-ledger rows — the snapshot has no product keys to
            match, so such a subtraction would be invented.
          </p>
        </div>
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      <StockReadState state={state} error={error} retry={retry} loadingLabel="Checking the approved snapshot…" />

      {state === 'ready' && data !== null && (
        <>
          <SnapshotBanner snapshot={data.snapshot} />

          {!data.available ? (
            <p className="text-xs text-muted">
              No snapshot has been applied, so there is nothing to check. The Movement Ledger tab is
              a different read and remains available.
            </p>
          ) : (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Authorised file</p>
                  <p className={`mt-1 text-[12px] font-black ${matched ? 'text-brand-green' : 'text-brand-red'}`}>
                    {matched ? 'this batch matches the authorised revision' : data.snapshot.authorizedSha256 === null ? 'no revision configured' : 'batch does not match the authorised revision'}
                  </p>
                  <p className="text-[10px] text-muted">checked from the server’s two hashes; the panel computes no hash</p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Withheld source rows</p>
                  <p className="mt-1 text-[20px] font-black tabular-nums text-ink">{withheld.length}</p>
                  <p className="text-[10px] text-muted">plan refusals, shown with coordinates</p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Negative figures</p>
                  <p className={`mt-1 text-[20px] font-black tabular-nums ${negativeRows.length > 0 ? 'text-brand-red' : 'text-ink'}`}>
                    {negativeRows.length}
                  </p>
                  <p className="text-[10px] text-muted">preserved as exceptions, never clamped to zero</p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Stale / carried forward</p>
                  <p className="mt-1 text-[20px] font-black tabular-nums text-ink">{staleRows.length}</p>
                  <p className="text-[10px] text-muted">last approved values, labelled as not this file’s reading</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="mb-2 text-[12px] font-black text-ink">Category status</p>
                <div className="overflow-x-auto rounded-field border border-line">
                  <table className="w-full min-w-[720px] border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-canvas/70 text-left text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-3 py-2 font-extrabold">Category</th>
                        <th className="px-3 py-2 font-extrabold">Status</th>
                        <th className="px-3 py-2 text-right font-extrabold">Figures</th>
                        <th className="px-3 py-2 text-right font-extrabold">Withheld</th>
                        <th className="px-3 py-2 text-right font-extrabold">Negative</th>
                        <th className="px-3 py-2 text-right font-extrabold">Stale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.categories.map((category) => (
                        <tr key={category.key} className="border-t border-line/60">
                          <td className="px-3 py-2 font-bold text-ink">{category.label}</td>
                          <td className="px-3 py-2"><CategoryStatusChip status={category.status} /></td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">{category.figureCount}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {category.withheldCount === 0 ? (
                              <span className="text-faint">—</span>
                            ) : (
                              <span className="font-bold text-[#C96B15]">
                                {category.withheldCount}
                                {category.withheldQuantity !== null && ` · ${groupedQuantity(category.withheldQuantity)}`}
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${category.negativeCount > 0 ? 'font-bold text-brand-red' : 'text-faint'}`}>
                            {category.negativeCount === 0 ? '—' : category.negativeCount}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${category.staleCount > 0 ? 'font-bold text-[#C96B15]' : 'text-faint'}`}>
                            {category.staleCount === 0 ? '—' : category.staleCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mb-4">
                <p className="mb-2 text-[12px] font-black text-ink">Withheld rows, with their source coordinates</p>
                <WithheldTable rows={withheld} />
                <p className="mt-1 text-[10px] text-muted">
                  A withheld row is a reading the apply plan refused to turn into stock. Its figure is
                  shown because the sheet held it, in orange because it is not a balance. Rows withheld
                  because a subtotal’s children could not be supported are still listed; the withheld
                  quantity beside the category excludes those subtotals so the same stock is not
                  counted twice.
                </p>
              </div>

              <div className="mb-4">
                <p className="mb-2 text-[12px] font-black text-ink">Exceptions the server raised</p>
                {data.warnings.length === 0 ? (
                  <p className="text-[11px] text-muted">No exception was raised for this batch.</p>
                ) : (
                  <ul className="divide-y divide-line/60 rounded-field border border-line bg-white">
                    {data.warnings.map((warning) => (
                      <li key={warning.key} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[11px]">
                        <StockChip value={warning.severity} />
                        <span className="min-w-0 flex-1 text-ink">{warning.message}</span>
                        {warning.count > 0 && <span className="text-[10px] tabular-nums text-muted">× {warning.count}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-field border border-line bg-canvas/40 p-3 text-[10px] text-muted">
                <p className="flex items-center gap-1.5 font-bold text-ink">
                  <ShieldCheck size={13} /> What this check cannot say
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>It cannot confirm a physical count; the panel records no count and this build has no posting route.</li>
                  <li>It cannot reconcile the snapshot to movement balances: the snapshot carries no product keys, and no stock movement was posted by the apply.</li>
                  <li>It does not read UPVC ITEM or PRODUCTION into stock; those tabs state the gap instead of showing zero.</li>
                  <li>It does not repair a negative or a withheld figure; both stay visible for an owner’s decision.</li>
                  <li>Its only freshness claim is the batch timestamp shown above: {serverTimestampText(data.snapshot.appliedAt)}.</li>
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
