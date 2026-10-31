import { useCallback, useState } from 'react';
import { Card, CardHeader, PageHeader } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { RangePicker, UnitProgressTable } from '../components/Reporting';
import { qtyLabel, rupees } from '../lib/format';
import { monthWindow, targetSourceLabel, windowProblem } from '../lib/reportingWindow';
import { dashboardSummary, salespersonPerformance, serverHost } from '../lib/serverApi';
import { useResource } from '../lib/useResource';

/** The Reports page, filled with the two aggregate reads that exist.
 *
 *  `GET /reports/{type}` and `/reports/{type}/meta` are **not built** (§2.15), so this page does
 *  not pretend to be a report generator: it shows the owner's KPI block and the per-salesperson
 *  performance table over the chosen window, with each figure's source named. Both come from the
 *  same views the module screens read, which is why the order value and collections here tie out
 *  to the Orders and Payment lists instead of being a second book. There is no CSV download and no
 *  report type selector, because neither exists over HTTP yet.
 */
function Report({ from, to }: { from: string; to: string }) {
  const load = useCallback(async () => {
    const [summary, performance] = await Promise.all([
      dashboardSummary({ from: from || undefined, to: to || undefined }),
      salespersonPerformance({ from: from || undefined, to: to || undefined }),
    ]);
    return { summary, performance };
  }, [from, to]);
  const { state, data, error, retry, sync } = useResource(load);

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
        </div>
        {state === 'loading' && <p className="text-xs text-faint">Reading the report figures…</p>}
        {state === 'error' && (
          <p className="text-xs font-semibold text-brand-red">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={retry}>
              Try again
            </button>
          </p>
        )}
        {state === 'ready' && data !== null && (
          <div>
            <CardHeader
              title="Window totals"
              subtitle={`The server read ${data.summary.periodStart} to ${data.summary.periodEnd}. Each figure names the rows it was summed from.`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-faint">
                    <th className="py-1.5 pr-3 font-extrabold">Figure</th>
                    <th className="py-1.5 pr-3 font-extrabold">Value</th>
                    <th className="py-1.5 font-extrabold">Source and window rule</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Orders booked</td>
                    <td className="py-1.5 pr-3 font-semibold">{data.summary.orderCount}</td>
                    <td className="py-1.5 text-muted">
                      `GET /orders?from=&to=` rows — drafts excluded, every other status counted, dated by order date
                    </td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Order value</td>
                    <td className="py-1.5 pr-3 font-semibold">{rupees(data.summary.ordersValuePaise)}</td>
                    <td className="py-1.5 text-muted">The same rows' `valuePaise`, summed by the server</td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Collected</td>
                    <td className="py-1.5 pr-3 font-semibold">{rupees(data.summary.collectedPaise)}</td>
                    <td className="py-1.5 text-muted">Non-voided receipts dated in the window</td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Outstanding</td>
                    <td className="py-1.5 pr-3 font-semibold">{rupees(data.summary.outstandingPaise)}</td>
                    <td className="py-1.5 text-muted">Current customer balances — ignores the window</td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Overdue</td>
                    <td className="py-1.5 pr-3 font-semibold">{rupees(data.summary.overduePaise)}</td>
                    <td className="py-1.5 text-muted">The owed part past its due date — a balance, not a period figure</td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Delayed orders</td>
                    <td className="py-1.5 pr-3 font-semibold">{data.summary.delayedOrderCount}</td>
                    <td className="py-1.5 text-muted">
                      A count of orders whose expected dispatch date passed; kept separate from overdue money
                    </td>
                  </tr>
                  <tr className="border-b border-line/50">
                    <td className="py-1.5 pr-3 font-bold text-ink">Customers waiting</td>
                    <td className="py-1.5 pr-3 font-semibold">{data.summary.pendingApprovalCustomers}</td>
                    <td className="py-1.5 text-muted">Entries in `pendingApproval`</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 font-bold text-ink">Dispatched</td>
                    <td className="py-1.5 pr-3 font-semibold">
                      {data.summary.dispatched.length === 0
                        ? 'nothing in the window'
                        : data.summary.dispatched
                            .map((row) => qtyLabel(row.dispatchedQuantity, row.unit))
                            .join(' • ')}
                    </td>
                    <td className="py-1.5 text-muted">
                      Non-voided consignments dated in the window, per unit; mismatched units are named on the
                      Dashboard and never added
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {state === 'ready' && data !== null && (
        <Card>
          <CardHeader
            title="Salesperson achievement"
            subtitle="Confirmed order quantity per unit in the window, beside each target. Dispatch is not achievement."
          />
          {data.performance.rows.length === 0 && (
            <p className="text-xs text-muted">No employee is on the staff book yet.</p>
          )}
          <div className="space-y-4">
            {data.performance.rows.map((row) => (
              <div key={row.employeeId} className="rounded-field border border-line p-3">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] font-bold text-ink">{row.employeeName}</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {targetSourceLabel(row.targetSource)}
                  </span>
                </div>
                {row.excludedTargetRows > 0 && (
                  <p className="mb-2 text-[10px] text-brand-orange">
                    {row.excludedTargetRows} target row(s) cross the window edge and were not prorated.
                  </p>
                )}
                <UnitProgressTable units={row.units} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function Reports() {
  const [window, setWindow] = useState(() => monthWindow(new Date()));
  const problem = windowProblem(window.from, window.to);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`The figures that exist on ${serverHost()} — totals read from the module views, not a report snapshot`}
        actions={<RangePicker from={window.from} to={window.to} onChange={setWindow} />}
      />
      {problem === '' ? (
        <Report from={window.from} to={window.to} />
      ) : (
        <Card>
          <p className="text-xs font-semibold text-brand-red">{problem}</p>
        </Card>
      )}
      <p className="mt-3 text-[11px] text-faint">
        `GET /reports/&#123;type&#125;` and its `meta` route are not built, so there is no CSV export and no report
        type selector here. The day-book, GST, stock and ledger reports named in §2.15 remain specifications.
      </p>
    </div>
  );
}
