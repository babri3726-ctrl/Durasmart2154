import type { ServerUnitProgress } from '../lib/serverApi';
import { qtyLabel } from '../lib/format';
import { monthWindow, shiftMonth, type MonthWindow } from '../lib/reportingWindow';

/** The window control the three P6 screens share. It only shapes the request; the server decides
 *  what the window means (an open end fills to its month boundary, and a window that is not one
 *  whole calendar month cannot use the legacy monthly target). */
export function RangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (window: MonthWindow) => void;
}) {
  const now = new Date();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="report-from">
          From
        </label>
        <input
          id="report-from"
          type="date"
          className="input !w-auto !py-2"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
        />
      </div>
      <div>
        <label className="label" htmlFor="report-to">
          To
        </label>
        <input
          id="report-to"
          type="date"
          className="input !w-auto !py-2"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
        />
      </div>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(monthWindow(now))}>
        This month
      </button>
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => onChange(monthWindow(shiftMonth(now, -1)))}
      >
        Last month
      </button>
    </div>
  );
}

function targetCell(unit: ServerUnitProgress): string {
  if (unit.targetQuantity !== null) return qtyLabel(unit.targetQuantity, unit.unit);
  if (unit.unitMismatch) return 'no target in this unit';
  return 'no target';
}

/** One salesperson's per-unit progress. The dispatch figure is a separate measurement, not part of
 *  achievement, and a remaining quantity keeps its sign — an over-achievement is the server's own
 *  negative, never clamped here. `—` is the server's refusal to divide (no target, a zero target or
 *  a unit mismatch), not a client-side zero. */
export function UnitProgressTable({ units }: { units: ServerUnitProgress[] }) {
  if (units.length === 0) {
    return <p className="text-[11px] text-muted">No confirmed order quantity in this window, in any unit.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-faint">
            <th className="py-1.5 pr-3 font-extrabold">Unit</th>
            <th className="py-1.5 pr-3 font-extrabold">Target</th>
            <th className="py-1.5 pr-3 font-extrabold">Achieved (confirmed orders)</th>
            <th className="py-1.5 pr-3 font-extrabold">Dispatched (separate)</th>
            <th className="py-1.5 pr-3 font-extrabold">Remaining</th>
            <th className="py-1.5 font-extrabold">Progress</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.unit} className="border-b border-line/50 last:border-b-0">
              <td className="py-1.5 pr-3 font-bold text-ink">{unit.unit}</td>
              <td className="py-1.5 pr-3">
                {targetCell(unit)}
                {unit.targetZero && <span className="ml-1 text-[10px] text-faint">(a target of zero)</span>}
              </td>
              <td className="py-1.5 pr-3 font-semibold">{qtyLabel(unit.achievedQuantity, unit.unit)}</td>
              <td className="py-1.5 pr-3">
                {qtyLabel(unit.dispatchedQuantity, unit.unit)}
                {unit.mismatchedDispatchQuantity !== '0.000' && (
                  <span className="ml-1 text-[10px] text-brand-orange">
                    +{qtyLabel(unit.mismatchedDispatchQuantity, 'other unit')} not added
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3">{unit.remainingQuantity === null ? '—' : qtyLabel(unit.remainingQuantity, unit.unit)}</td>
              <td className="py-1.5 font-bold">
                {unit.achievementPercent === null ? '—' : `${unit.achievementPercent}%`}
                {unit.unitMismatch && <span className="ml-1 text-[10px] font-normal text-muted">unit mismatch</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
