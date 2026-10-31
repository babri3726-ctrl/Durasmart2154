import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ClipboardList,
  IndianRupee,
  PackageCheck,
  Target,
  TrendingUp,
  BarChart3,
  PlusCircle,
  UserPlus,
  Truck,
  Boxes,
  ArrowRight,
  Clock,
  ShieldAlert,
  ChevronRight,
  MapPin,
  User,
} from 'lucide-react';
import { Card, CardHeader, KpiCard, PageHeader } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { RangePicker } from '../components/Reporting';
import { qtyLabel, rupees } from '../lib/format';
import { monthWindow, windowProblem } from '../lib/reportingWindow';
import { dashboardCockpit, serverHost } from '../lib/serverApi';
import { useResource } from '../lib/useResource';
import { syncKeys, useSyncPrefix, useSyncToken } from '../lib/syncStore';
import SalesTargetKpis from '../components/dashboard/SalesTargetKpis';
import FinancialAnalytics from '../components/dashboard/FinancialAnalytics';

function orderStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Approved</span>;
    case 'dispatched':
    case 'partiallyDispatched':
      return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">Dispatched</span>;
    case 'completed':
      return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-800">Completed</span>;
    case 'pendingApproval':
    default:
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Pending</span>;
  }
}

/** The Executive Cockpit Component (`GET /api/v1/dashboard/cockpit`) */
function CockpitSummary({ from, to }: { from: string; to: string }) {
  const orderToken = useSyncPrefix(syncKeys.orderList(''));
  const debtorToken = useSyncToken(syncKeys.debtors);
  const customerToken = useSyncToken(syncKeys.customers);
  const paymentToken = useSyncToken(syncKeys.payments);
  const dashboardToken = useSyncToken(syncKeys.dashboard);
  const stockToken = useSyncToken(syncKeys.stockSummary);
  const dispatchToken = useSyncPrefix(syncKeys.dispatchRegister);

  const load = useCallback(
    () => dashboardCockpit({ from: from || undefined, to: to || undefined }),
    // Re-fetch automatically whenever order, debtor, customer, payment, dashboard, stock or dispatch sync tokens update
    [from, to, orderToken, debtorToken, customerToken, paymentToken, dashboardToken, stockToken, dispatchToken]
  );
  const { state, data, error, retry, sync } = useResource(load);

  // Background live update pulse (every 8 seconds + on window focus)
  useEffect(() => {
    const handleFocus = () => sync.refresh();
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(() => {
      sync.refresh();
    }, 8000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [sync]);

  return (
    <div className="space-y-6">
      {/* Sync Status Bar */}
      <div className="flex items-center justify-between">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
        {data && (
          <span className="text-[11px] font-medium text-faint">
            Period: <span className="font-semibold text-ink">{data.summary.periodStart}</span> to{' '}
            <span className="font-semibold text-ink">{data.summary.periodEnd}</span>
          </span>
        )}
      </div>

      {state === 'loading' && !data && (
        <Card>
          <div className="flex items-center gap-3 py-6 text-sm text-muted">
            <Clock className="animate-spin text-brand-blue" size={20} />
            Loading real-time executive cockpit metrics…
          </div>
        </Card>
      )}

      {state === 'error' && (
        <Card className="border-brand-red/30 bg-red-50/40">
          <p className="text-xs font-semibold text-brand-red">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={retry}>
              Retry load
            </button>
          </p>
        </Card>
      )}

      {data && (
        <>
          {/* Executive KPI Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Orders Booked"
              value={String(data.summary.orderCount)}
              hint={`${rupees(data.summary.ordersValuePaise)} in period`}
              gradient="from-blue-600 to-indigo-600"
              icon={<ClipboardList size={20} />}
              to="/orders"
            />
            <KpiCard
              label="Collections"
              value={rupees(data.summary.collectedPaise)}
              hint="Verified receipts in window"
              gradient="from-emerald-600 to-teal-600"
              icon={<IndianRupee size={20} />}
              to="/payment"
            />
            <KpiCard
              label="Receivables"
              value={rupees(data.summary.outstandingPaise)}
              hint="Across 137 verified dealers"
              gradient="from-amber-600 to-orange-600"
              icon={<AlertTriangle size={20} />}
              to="/debtors"
            />
            <KpiCard
              label="Overdue Balance"
              value={rupees(data.summary.overduePaise)}
              hint="Past agreed credit terms"
              gradient="from-red-600 to-rose-600"
              icon={<ShieldAlert size={20} />}
              to="/debtors"
            />
            <KpiCard
              label="Delayed Orders"
              value={String(data.summary.delayedOrderCount)}
              hint="Pending past delivery date"
              gradient="from-purple-600 to-pink-600"
              icon={<PackageCheck size={20} />}
              to="/dispatch"
            />
            <KpiCard
              label="Dispatches"
              value={
                data.summary.dispatched.length > 0
                  ? qtyLabel(data.summary.dispatched[0].dispatchedQuantity, data.summary.dispatched[0].unit)
                  : '0.000 MT'
              }
              hint="Consignments in window"
              gradient="from-cyan-600 to-blue-600"
              icon={<Truck size={20} />}
              to="/dispatch"
            />
          </div>

          {/* Territory Realization Targets: Punjab vs Haryana */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-l-4 border-l-brand-blue bg-gradient-to-br from-panel to-blue-50/20">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-brand-blue" />
                    <h3 className="text-sm font-bold tracking-tight text-ink">Punjab Territory Progress</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {data.territories.punjab.dealers} active dealers in quota target network
                  </p>
                </div>
                <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-black text-brand-blue">
                  {data.territories.punjab.percent.toFixed(1)}% Achieved
                </span>
              </div>

              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-line/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-blue to-indigo-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, data.territories.punjab.percent))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted">
                    Dispatched:{' '}
                    <span className="font-bold text-ink">{data.territories.punjab.dispatched.toFixed(1)} MT</span>
                  </span>
                  <span className="text-muted">
                    Monthly Quota:{' '}
                    <span className="font-bold text-ink">{data.territories.punjab.target.toFixed(1)} MT</span>
                  </span>
                </div>
              </div>
            </Card>

            <Card className="border-l-4 border-l-emerald-600 bg-gradient-to-br from-panel to-emerald-50/20">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                    <h3 className="text-sm font-bold tracking-tight text-ink">Haryana Territory Progress</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {data.territories.haryana.dealers} active dealers in quota target network
                  </p>
                </div>
                <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800">
                  {data.territories.haryana.percent.toFixed(1)}% Achieved
                </span>
              </div>

              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-line/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, data.territories.haryana.percent))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted">
                    Dispatched:{' '}
                    <span className="font-bold text-ink">{data.territories.haryana.dispatched.toFixed(1)} MT</span>
                  </span>
                  <span className="text-muted">
                    Monthly Quota:{' '}
                    <span className="font-bold text-ink">{data.territories.haryana.target.toFixed(1)} MT</span>
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* Dual Operational Feeds: Recent Orders & Top Debtors */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Orders Feed */}
            <Card>
              <CardHeader
                title="Recent Order Stream"
                subtitle="Live activity from active order bookings"
                actions={
                  <Link
                    to="/orders"
                    className="inline-flex items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
                  >
                    View All Orders <ArrowRight size={13} />
                  </Link>
                }
              />
              {data.recentOrders.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">No recorded orders in system.</p>
              ) : (
                <div className="divide-y divide-line/60 overflow-hidden rounded-field border border-line">
                  {data.recentOrders.map((o) => (
                    <Link
                      key={o.id}
                      to={`/orders/${o.id}`}
                      className="flex items-center justify-between px-3.5 py-2.5 transition hover:bg-line/20"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-ink text-xs">{o.number}</span>
                          {orderStatusBadge(o.status)}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">{o.customerName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-black text-ink">{rupees(o.totalPaise)}</p>
                        <p className="text-[10px] text-faint">{o.date}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Top Debtors Balance Feed */}
            <Card>
              <CardHeader
                title="Top Receivables & Debtor Ledger"
                subtitle="Highest balances across active authorized distributors"
                actions={
                  <Link
                    to="/debtors"
                    className="inline-flex items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
                  >
                    View All Debtors <ArrowRight size={13} />
                  </Link>
                }
              />
              {data.topDebtors.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">No debtor balances recorded.</p>
              ) : (
                <div className="divide-y divide-line/60 overflow-hidden rounded-field border border-line">
                  {data.topDebtors.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between px-3.5 py-2.5 transition hover:bg-line/20"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-ink">{d.name}</span>
                          {d.city && (
                            <span className="inline-flex items-center text-[10px] text-faint">
                              <MapPin size={10} className="mr-0.5" />
                              {d.city}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 flex items-center text-[11px] text-muted">
                          <User size={10} className="mr-1" />
                          {d.salesperson}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-black text-brand-red">
                          {rupees(Math.round(d.balance * 100))}
                        </p>
                        <Link
                          to="/debtors"
                          className="inline-flex items-center text-[10px] font-bold text-brand-blue hover:underline"
                        >
                          Details <ChevronRight size={11} />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Quick Stock Snapshot */}
          <Card className="bg-gradient-to-r from-panel via-panel to-line/20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <h3 className="section-title flex items-center gap-2">
                  <Boxes size={16} className="text-brand-blue" />
                  Live Godown Stock Snapshot
                </h3>
                <p className="text-xs text-muted">Latest verified figures from factory warehouses</p>
              </div>
              <Link
                to="/stock"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-line/40"
              >
                Open Stock Manager <ArrowRight size={13} />
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-line/70 bg-panel/70 p-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-wider">Metal Coil Stock</p>
                <p className="mt-1 text-base font-black text-ink">
                  {qtyLabel(data.stockQuick.metalKg, 'kg')}
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel/70 p-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-wider">Profile / Kanda</p>
                <p className="mt-1 text-base font-black text-ink">
                  {qtyLabel(data.stockQuick.profileKg, 'kg')}
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel/70 p-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-wider">UPVC Profiles</p>
                <p className="mt-1 text-base font-black text-ink">
                  {data.stockQuick.upvcPieces.toLocaleString('en-IN')} pcs
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel/70 p-3">
                <p className="text-[11px] font-bold text-muted uppercase tracking-wider">Accessories / Fasteners</p>
                <p className="mt-1 text-base font-black text-ink">
                  {data.stockQuick.accessoriesPieces.toLocaleString('en-IN')} pcs
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [window, setWindow] = useState(() => monthWindow(new Date()));
  const [activeTab, setActiveTab] = useState<'overview' | 'sales-targets' | 'financial-analytics'>('overview');
  const problem = windowProblem(window.from, window.to);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Executive Operations Cockpit"
        subtitle={`Live operational control, performance analytics, and financial telemetry on ${serverHost()}`}
        actions={
          activeTab === 'overview' ? (
            <RangePicker from={window.from} to={window.to} onChange={setWindow} />
          ) : undefined
        }
      />

      {/* High-Impact Executive Quick-Action Bar */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-panel p-2 shadow-sm">
        <span className="px-2 text-xs font-bold uppercase tracking-wider text-muted">Quick Actions:</span>
        <Link
          to="/orders/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
        >
          <PlusCircle size={14} /> + New Order
        </Link>
        <Link
          to="/debtors"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <UserPlus size={14} /> + Add Debtor
        </Link>
        <Link
          to="/payment"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 py-1.5 text-xs font-bold text-ink transition hover:bg-line/40"
        >
          <IndianRupee size={14} /> Record Payment
        </Link>
        <Link
          to="/dispatch"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 py-1.5 text-xs font-bold text-ink transition hover:bg-line/40"
        >
          <Truck size={14} /> Dispatch Yard
        </Link>
        <Link
          to="/stock"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 py-1.5 text-xs font-bold text-ink transition hover:bg-line/40"
        >
          <Boxes size={14} /> Stock Manager
        </Link>
      </div>

      {/* Interactive Cockpit Tab Navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
            activeTab === 'overview'
              ? 'bg-ink text-white shadow-sm'
              : 'bg-panel text-muted hover:bg-line/50 hover:text-ink'
          }`}
        >
          <BarChart3 size={15} /> Overview & Operations
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sales-targets')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
            activeTab === 'sales-targets'
              ? 'bg-brand-blue text-white shadow-sm'
              : 'bg-panel text-muted hover:bg-line/50 hover:text-ink'
          }`}
        >
          <Target size={15} /> Sales Targets & Quota KPIs
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('financial-analytics')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
            activeTab === 'financial-analytics'
              ? 'bg-brand-green text-white shadow-sm'
              : 'bg-panel text-muted hover:bg-line/50 hover:text-ink'
          }`}
        >
          <TrendingUp size={15} /> Financial & Risk Analytics
        </button>
      </div>

      {/* Tab 1: Overview & Ops */}
      {activeTab === 'overview' && (
        <>
          {problem === '' ? (
            <CockpitSummary from={window.from} to={window.to} />
          ) : (
            <Card>
              <p className="text-xs font-semibold text-brand-red">{problem}</p>
            </Card>
          )}
        </>
      )}

      {/* Tab 2: Sales Targets & Quota KPIs */}
      {activeTab === 'sales-targets' && <SalesTargetKpis />}

      {/* Tab 3: Financial & Risk Analytics */}
      {activeTab === 'financial-analytics' && <FinancialAnalytics />}
    </div>
  );
}
