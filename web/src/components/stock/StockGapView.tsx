/** The two source sheets the approved apply plan does not store: UPVC ITEM (accessories) and
 *  PRODUCTION.
 *
 *  Both endpoints say `available: false` and name the sheet's own sections. This screen renders
 *  that structure and no figures — a table of zeros would be a claim about the godown and the
 *  floor that neither the database nor this build can support. The workbook may well contain
 *  these sheets; the Workbook Preview tab reads them for reference, and the preview says what it
 *  saw. Turning that reading into stock needs an approved plan change and a migration.
 */

import { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState } from '../ui/Card';
import { LiveSyncBar } from '../ui/LiveSync';
import { SnapshotBanner, StockReadState } from './StockBits';
import { serverTimestampText } from '../../lib/stockView';
import { syncKeys, useSyncToken } from '../../lib/syncStore';
import { useResource } from '../../lib/useResource';
import {
  readStockAccessories,
  readStockProduction,
  readStockSummary,
  type ServerStockGap,
} from '../../lib/serverApi';

export default function StockGapView({
  kind,
  heading,
  description,
}: {
  kind: 'accessories' | 'production';
  heading: string;
  description: string;
}) {
  const readGap = useCallback(
    () => (kind === 'accessories' ? readStockAccessories() : readStockProduction()),
    [kind],
  );
  const readSnapshot = useCallback(() => readStockSummary(), []);
  const gapToken = useSyncToken(kind === 'accessories' ? syncKeys.stockAccessories : syncKeys.stockProduction);
  const snapshotToken = useSyncToken(syncKeys.stockSummary);
  const gap = useResource(readGap, gapToken);
  const snapshot = useResource(readSnapshot, snapshotToken);
  const gapBody: ServerStockGap | null = gap.data;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-ink">{heading}</p>
          <p className="mt-0.5 max-w-2xl text-[11px] text-muted">{description}</p>
        </div>
        <LiveSyncBar sync={gap.sync} busy={gap.state === 'loading'} />
      </div>

      <StockReadState
        state={gap.state}
        error={gap.error}
        retry={gap.retry}
        loadingLabel={`Reading the ${kind === 'accessories' ? 'accessory' : 'production'} gap…`}
      />

      {gap.state === 'ready' && gapBody !== null && (
        <>
          {snapshot.state === 'ready' && snapshot.data !== null && <SnapshotBanner snapshot={snapshot.data.snapshot} />}

          <div className="mb-4 rounded-field border border-brand-orange/40 bg-brand-orange/5 p-4">
            <p className="flex items-center gap-2 text-[13px] font-black text-ink">
              <AlertTriangle size={16} className="text-[#C96B15]" />
              {gapBody.sourceLabel} is not in the approved snapshot
            </p>
            <p className="mt-1 max-w-3xl text-[11px] text-ink">{gapBody.description}</p>
            <p className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted">
              <span>
                source sheet <span className="font-bold text-ink">{gapBody.sourceSheet}</span>
              </span>
              <span>
                reason code <span className="font-mono text-ink">{gapBody.reason}</span>
              </span>
              <span>
                latest batch <span className="font-mono text-ink">{gapBody.batchId ?? 'none'}</span>
              </span>
              <span>
                applied <span className="font-bold text-ink">{serverTimestampText(gapBody.appliedAt)}</span>
              </span>
            </p>
          </div>

          {kind === 'production' ? (
            <div className="mb-4">
              <p className="mb-2 text-[12px] font-black text-ink">PRODUCTION worksheet sections</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {gapBody.categories.map((category) => (
                  <div key={category.key} className="rounded-field border border-line bg-white p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink">{category.label}</p>
                    <p className="mt-1 text-[11px] font-bold text-muted">— not imported</p>
                    <p className="mt-0.5 text-[10px] text-faint">
                      The sheet names this section; the approved plan stores no row for it.
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">
                No production figure, date filter or history is rendered because the backend holds
                none. A production figure here would be invented, and double counting is impossible
                only because nothing is counted at all. The Workbook Preview tab reads the sheet for
                reference without storing it.
              </p>
            </div>
          ) : (
            <div className="mb-4">
              <p className="mb-2 text-[12px] font-black text-ink">Accessory groups named by UPVC ITEM</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {gapBody.categories.map((category) => (
                  <div key={category.key} className="rounded-field border border-line bg-white p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink">{category.label}</p>
                    <p className="mt-1 text-[11px] font-bold text-muted">— no approved balance</p>
                    <p className="mt-0.5 text-[10px] text-faint">
                      Named by the sheet; not part of the applied snapshot.
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">
                Colour and search filters are not offered here: the server has no accessory rows to
                filter, and an empty filter result would look like zero stock.
              </p>
            </div>
          )}

          <div className="rounded-field border border-line bg-canvas/40 p-3 text-[10px] text-muted">
            <p className="font-bold text-ink">What would make this screen real</p>
            <p className="mt-0.5">
              An owner-approved change to the apply plan plus a database migration that stores
              {kind === 'production' ? ' the production sections and their dates' : ' accessory balances by group and colour'}.
              Neither is performed by this build, and applying the same workbook again does not add
              them. Until then this is the server’s honest gap, not a loading state.
            </p>
          </div>
        </>
      )}

      {gap.state === 'ready' && gapBody === null && (
        <EmptyState title="The backend returned no gap description" hint="The read succeeded without a body; nothing is shown rather than guessed." />
      )}
    </div>
  );
}
