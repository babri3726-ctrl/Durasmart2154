import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  ClipboardList,
  Flag,
  PlusCircle,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { Card, KpiCard } from '../components/ui/Card';
import HrPbTargetsCard from '../components/HrPbTargetsCard';
import { listSalesTargets, syncHrPbTargets } from '../lib/serverApi';
import { toast } from '../lib/toast';

interface SalespersonSummary {
  salesperson: string;
  territory: string;
  parties_count: number;
  total_target_mt: string;
  total_dispatched_mt: string;
  total_pending_mt: string;
  achievement_percent: string;
}

export default function Sales() {
  const [summary, setSummary] = useState<SalespersonSummary[]>([]);
  const [totalTarget, setTotalTarget] = useState<number>(0);
  const [totalDispatched, setTotalDispatched] = useState<number>(0);
  const [totalPending, setTotalPending] = useState<number>(0);
  const [overallAchievement, setOverallAchievement] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);

  const loadData = async () => {
    try {
      const res = await listSalesTargets();
      const sps = (res.salesperson_summary as unknown as SalespersonSummary[]) || [];
      setSummary(sps);

      const targetSum = sps.reduce((acc, s) => acc + (parseFloat(s.total_target_mt) || 0), 0);
      const dispatchedSum = sps.reduce((acc, s) => acc + (parseFloat(s.total_dispatched_mt) || 0), 0);
      const pendingSum = sps.reduce((acc, s) => acc + (parseFloat(s.total_pending_mt) || 0), 0);

      setTotalTarget(targetSum);
      setTotalDispatched(dispatchedSum);
      setTotalPending(pendingSum);
      setOverallAchievement(targetSum > 0 ? (dispatchedSum / targetSum) * 100 : 0);
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handle1ClickSync = async () => {
    setSyncing(true);
    try {
      await syncHrPbTargets();
      toast.success('HR-PB targets synchronized successfully!');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      toast.error(`Sync failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-black tracking-tight text-ink">Sales Command Cockpit</h1>
          <p className="mt-0.5 text-sm text-muted">
            Regional sales targets, party orders, and material dispatches synced from OneDrive (HR-PB.xlsx)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
          >
            <PlusCircle size={15} />
            + New Order
          </Link>
          <Link
            to="/debtors"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <Users size={15} className="text-emerald-600" />
            Debtor Master
          </Link>
          <Link
            to="/daybook"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <ShoppingBag size={15} className="text-purple-600" />
            Day Book
          </Link>
          <button
            type="button"
            onClick={handle1ClickSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin text-blue-600' : 'text-blue-600'} />
            {syncing ? 'Syncing HR-PB…' : '1-Click Sync HR-PB'}
          </button>
        </div>
      </div>

      {/* Hybrid KPI Metric Grid (Matching Cockpit & Mobile APK) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Sales Target"
          value={`${totalTarget.toFixed(1)} MT`}
          hint="Total monthly quota"
          gradient="from-blue-600 to-indigo-600"
          icon={<Flag size={20} />}
        />
        <KpiCard
          label="Dispatched"
          value={`${totalDispatched.toFixed(1)} MT`}
          hint="Achieved on ground"
          gradient="from-emerald-600 to-teal-600"
          icon={<Truck size={20} />}
        />
        <KpiCard
          label="Pending Dispatch"
          value={`${totalPending.toFixed(1)} MT`}
          hint="In pipeline / production"
          gradient="from-amber-600 to-orange-600"
          icon={<ClipboardList size={20} />}
        />
        <KpiCard
          label="Achievement"
          value={`${overallAchievement.toFixed(1)}%`}
          hint="Progress to target"
          gradient="from-purple-600 to-pink-600"
          icon={<TrendingUp size={20} />}
        />
        <KpiCard
          label="Active Dealers"
          value="137"
          hint="Across Punjab & Haryana"
          gradient="from-cyan-600 to-blue-600"
          icon={<Users size={20} />}
          to="/debtors"
        />
        <KpiCard
          label="Sales Team"
          value={String(summary.length || 13)}
          hint="Field representatives"
          gradient="from-rose-600 to-red-600"
          icon={<Award size={20} />}
        />
      </div>

      {/* Target vs Achievement Progress Banner */}
      <Card className="border border-slate-200 bg-white shadow-sm p-5 rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">Target vs Achievement Progress</h3>
            <p className="text-xs text-slate-500 font-medium">
              {totalDispatched.toFixed(3)} MT dispatched of {totalTarget.toFixed(3)} MT assigned target
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-black text-emerald-800">
              {overallAchievement.toFixed(1)}% Achieved
            </span>
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-black text-amber-800">
              {totalPending.toFixed(1)} MT Remaining
            </span>
          </div>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 transition-all duration-700"
            style={{ width: `${Math.min(100, Math.max(0, overallAchievement))}%` }}
          />
        </div>
      </Card>

      {/* Sales Team Performance Leaderboard Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">Sales Team Quota & Achievement</h2>
          <span className="text-xs text-slate-500 font-medium">Synced from HR-PB Target Book</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summary.slice(0, 8).map((sp) => {
            const ach = parseFloat(sp.achievement_percent) || 0;
            return (
              <div
                key={sp.salesperson}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-slate-900">{sp.salesperson}</h4>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {sp.territory} • {sp.parties_count} parties
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                      ach >= 50
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : ach >= 30
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {sp.achievement_percent}%
                  </span>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-500">Dispatched / Target:</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {sp.total_dispatched_mt} / {sp.total_target_mt} MT
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${
                        ach >= 50 ? 'bg-emerald-500' : ach >= 30 ? 'bg-blue-600' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, ach))}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dealer Sales Targets Register (Synced from OneDrive) */}
      <HrPbTargetsCard />
    </div>
  );
}
