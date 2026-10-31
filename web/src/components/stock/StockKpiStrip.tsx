/** The coloured figure strip the mockup puts above the tabs, on every stock tab.
 *
 *  It is the same `GET /stock/summary` the dashboard reads, drawn as one card per source group so
 *  the owner sees the level before choosing a tab. A card shows its group's own measure and
 *  nothing else: metal carries no unit because the sheet states none, and UPVC keeps pieces and
 *  footage as two numbers. There is no combined total across the strip for the same reason —
 *  coils, pieces and feet added together is a figure the workbook never states.
 *
 *  A card whose rows the plan withheld shows the withheld amount and says so. A group with no
 *  stored rows says "not imported". Neither is ever drawn as a zero.
 */

import { useCallback } from 'react';
import { useSyncToken, syncKeys } from '../../lib/syncStore';
import { useResource } from '../../lib/useResource';
import { readStockSummary, type ServerStockCategory } from '../../lib/serverApi';
import { CATEGORY_VIEW, groupedQuantity, type StockView } from '../../lib/stockView';

const TONE: Record<string, string> = {
  'steel-coil': 'bg-brand-green',
  'profile-kanda': 'bg-brand-orange',
  'gp-sheet': 'bg-brand-purple',
  'upvc-new': 'bg-brand-pink',
  'upvc-old': 'bg-brand-teal',
  'upvc-waste': 'bg-brand-red',
  'upvc-total': 'bg-brand-blue',
  'upvc-roofing': 'bg-brand-blue',
  'upvc-item': 'bg-brand-grad',
};

const UPVC_KEYS = new Set(['upvc-new', 'upvc-old', 'upvc-waste', 'upvc-total', 'upvc-roofing', 'upvc-item']);

function figure(category: ServerStockCategory) {
  if (UPVC_KEYS.has(category.key)) {
    if (category.pieces === null) return <span className="text-[13px] font-bold">no figure</span>;
    return (
      <>
        <span className="text-[22px] font-black leading-none tabular-nums">
          {groupedQuantity(category.pieces)}
        </span>
        <span className="block text-[10px] font-semibold opacity-90">
          Total Pieces
          {category.footage !== null && ` · ${groupedQuantity(category.footage)} Ft`}
        </span>
      </>
    );
  }
  if (category.status === 'withheld' && category.quantity === null) {
    return (
      <>
        <span className="text-[22px] font-black leading-none tabular-nums">
          {category.withheldQuantity === null ? '—' : groupedQuantity(category.withheldQuantity)}
        </span>
        <span className="block text-[10px] font-semibold opacity-90">held back by the plan</span>
      </>
    );
  }
  if (category.quantity === null) return <span className="text-[13px] font-bold">no figure</span>;
  return (
    <>
      <span className="text-[22px] font-black leading-none tabular-nums">
        {groupedQuantity(category.quantity)}
      </span>
      <span className="block text-[10px] font-semibold opacity-90">
        {category.unit === null ? 'unit not stated by the sheet' : category.unit}
      </span>
    </>
  );
}

export default function StockKpiStrip({ onOpen }: { onOpen: (view: StockView) => void }) {
  const fetcher = useCallback(() => readStockSummary(), []);
  const token = useSyncToken(syncKeys.stockSummary);
  const { state, data } = useResource(fetcher, token);

  if (state === 'loading') {
    return (
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => index).map((index) => (
          <div key={index} className="h-[74px] animate-pulse rounded-card bg-line/60" />
        ))}
      </div>
    );
  }

  if (data === null) return null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
      {data.categories.map((category) => (
        <button
          key={category.key}
          type="button"
          onClick={() => onOpen(CATEGORY_VIEW[category.key] ?? 'total')}
          className={`${TONE[category.key] ?? 'bg-navy'} rounded-card px-3 py-2.5 text-left text-white transition hover:opacity-90`}
        >
          <p className="text-[10px] font-extrabold uppercase leading-tight tracking-wide opacity-90">
            {category.label}
          </p>
          <div className="mt-1 [overflow-wrap:anywhere]">{figure(category)}</div>
          <p className="mt-1 text-[9px] font-semibold opacity-90">
            {category.status === 'resolved' &&
              `${category.figureCount} row${category.figureCount === 1 ? '' : 's'} read`}
            {category.status === 'withheld' && 'withheld by the apply plan'}
            {category.status === 'unavailable' && 'not in the approved snapshot'}
            {category.withheldCount > 0 && ` · ${category.withheldCount} withheld`}
            {category.negativeCount > 0 && ` · ${category.negativeCount} negative`}
          </p>
        </button>
      ))}
    </div>
  );
}
