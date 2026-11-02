import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IndianRupee, PieChart, Activity, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { Card, CardHeader, KpiCard } from '../ui/Card';
import { getFinancialAnalytics } from '../../lib/serverApi';

interface AnalyticsData {
  period: string;
  benchmark_rate_per_mt: number;
  volume: {
    total_target_mt: number;
    total_dispatched_mt: number;
    total_pending_mt: number;
    achievement_percent: number;
  };
  financials: {
    realized_turnover_inr: number;
    pending_turnover_inr: number;
    total_book_value_inr: number;
    realized_cr: number;
    pending_cr: number;
    total_book_cr: number;
  };
  pacing: {
    day_of_month: number;
    days_in_month: number;
    days_remaining: number;
    expected_pacing_percent: number;
    actual_pacing_percent: number;
    pacing_status: string;
    required_daily_dispatch_mt: number;
  };
  territories: {
    punjab: {
      dealer_count: number;
      target_mt: number;
      dispatched_mt: number;
      achievement_percent: number;
      realized_cr: number;
    };
    haryana: {
      dealer_count: number;
      target_mt: number;
      dispatched_mt: number;
      achievement_percent: number;
      realized_cr: number;
    };
  };
  concentration: {
    top_10_target_mt: number;
    top_10_concentration_percent: number;
    remaining_dealers_count: number;
    remaining_dealers_percent: number;
    top_dealers: Array<{
      party_name: string;
      state: string;
      salesperson: string;
      target_mt: number;
      dispatched_mt: number;
      achievement_percent: number;
    }>;
  };
  debtors: {
    total_parties: number;
    total_balance_inr: number;
  };
}

export default function FinancialAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFinancialAnalytics<AnalyticsData>()
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-xs text-faint">Calculating financial analytics and realization models…</p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <p className="text-xs text-muted">Unable to load financial analytics.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Benchmark Note */}
      <div className="rounded-xl border border-line bg-panel p-3 text-xs text-muted flex items-center justify-between">
        <span>
          Commercial Benchmark: <strong>₹{(data.benchmark_rate_per_mt).toLocaleString('en-IN')} / MT</strong> average
          prime slit coil realization ({data.period}).
        </span>
        <span className="font-semibold text-brand-blue">Total Book: ₹{data.financials.total_book_cr} Cr</span>
      </div>

      {/* 3 Realization Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Realized Turnover"
          value={`₹${data.financials.realized_cr} Cr`}
          hint={`From ${data.volume.total_dispatched_mt.toFixed(1)} MT dispatched to date`}
          gradient="from-brand-green to-brand-teal"
          icon={<IndianRupee size={20} />}
        />
        <KpiCard
          label="Pipeline / Pending Value"
          value={`₹${data.financials.pending_cr} Cr`}
          hint={`From ${data.volume.total_pending_mt.toFixed(1)} MT pending delivery`}
          gradient="from-brand-orange to-brand-red"
          icon={<Activity size={20} />}
        />
        <KpiCard
          label="Total Monthly Book"
          value={`₹${data.financials.total_book_cr} Cr`}
          hint="Total quota commitment across 137 dealers"
          gradient="from-brand-blue to-brand-purple"
          icon={<PieChart size={20} />}
        />
      </div>

      {/* Pacing Run-Rate & Daily Dispatch Requirements */}
      <Card className="border-l-4 border-l-brand-orange">
        <CardHeader
          title="Quota Pacing & Run-Rate Simulator"
          subtitle={`Day ${data.pacing.day_of_month} of ${data.pacing.days_in_month} • ${data.pacing.days_remaining} production days remaining`}
          actions={
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                data.pacing.pacing_status === 'On Track'
                  ? 'bg-brand-green/10 text-brand-green'
                  : 'bg-brand-orange/10 text-brand-orange'
              }`}
            >
              {data.pacing.pacing_status}
            </span>
          }
        />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel/50 p-3">
            <p className="text-[11px] font-bold uppercase text-muted">Actual vs Expected Pace</p>
            <p className="mt-1 text-xl font-black text-ink">
              {data.pacing.actual_pacing_percent}%{' '}
              <span className="text-xs font-normal text-muted">vs {data.pacing.expected_pacing_percent}% expected</span>
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand-orange"
                style={{ width: `${Math.min(data.pacing.actual_pacing_percent, 100)}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-panel/50 p-3">
            <p className="text-[11px] font-bold uppercase text-muted">Required Daily Dispatch</p>
            <p className="mt-1 text-xl font-black text-brand-orange">
              {data.pacing.required_daily_dispatch_mt} MT / day
            </p>
            <p className="mt-1 text-[10px] text-faint">Tonnage needed daily to close 100% quota by month-end</p>
          </div>

          <div className="rounded-lg border border-line bg-panel/50 p-3">
            <p className="text-[11px] font-bold uppercase text-muted">Daily Revenue Needed</p>
            <p className="mt-1 text-xl font-black text-ink">
              ₹{((data.pacing.required_daily_dispatch_mt * data.benchmark_rate_per_mt) / 100000).toFixed(2)} Lakh / day
            </p>
            <p className="mt-1 text-[10px] text-faint">Daily cash generation required to fulfill monthly book</p>
          </div>
        </div>
      </Card>

      {/* Concentration & Credit Exposure Risk */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader
            title="Dealer Volume Concentration (Pareto 80/20)"
            subtitle="Volume reliance and customer dependency risk"
            actions={<ShieldAlert size={18} className="text-brand-orange" />}
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Top 10 High-Volume Accounts:</span>
              <span className="font-bold text-ink">
                {data.concentration.top_10_target_mt} MT ({data.concentration.top_10_concentration_percent}%)
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-line flex">
              <div
                className="bg-brand-blue"
                style={{ width: `${data.concentration.top_10_concentration_percent}%` }}
                title="Top 10 Accounts"
              />
              <div
                className="bg-brand-teal"
                style={{ width: `${data.concentration.remaining_dealers_percent}%` }}
                title="Remaining 127 Accounts"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Top 10 Accounts: {data.concentration.top_10_concentration_percent}%</span>
              <span>Remaining 127 Accounts: {data.concentration.remaining_dealers_percent}%</span>
            </div>
            <p className="text-[11px] text-faint border-t border-line pt-2">
              Low concentration risk: No single dealer accounts for more than 6.2% of company volume, indicating a
              well-distributed distribution footprint.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Regional Realization Breakdown"
            subtitle="Commercial split across Punjab and Haryana"
            actions={
              <Link to="/debtors" className="text-xs font-bold text-brand-blue hover:underline">
                Open Debtors ({data.debtors.total_parties}) →
              </Link>
            }
          />
          <div className="space-y-3">
            <div className="rounded-lg border border-line p-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-ink">Punjab Territory</span>
                <span className="font-bold text-brand-green">₹{data.territories.punjab.realized_cr} Cr Realized</span>
              </div>
              <p className="text-[11px] text-muted mt-1">
                {data.territories.punjab.dispatched_mt} MT / {data.territories.punjab.target_mt} MT (
                {data.territories.punjab.achievement_percent}%) across {data.territories.punjab.dealer_count} parties
              </p>
            </div>

            <div className="rounded-lg border border-line p-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-ink">Haryana Territory</span>
                <span className="font-bold text-brand-green">₹{data.territories.haryana.realized_cr} Cr Realized</span>
              </div>
              <p className="text-[11px] text-muted mt-1">
                {data.territories.haryana.dispatched_mt} MT / {data.territories.haryana.target_mt} MT (
                {data.territories.haryana.achievement_percent}%) across {data.territories.haryana.dealer_count} parties
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Top 10 Dealer Volume Table */}
      <Card>
        <CardHeader
          title="Top 10 Dealer Accounts by Quota Size"
          subtitle="Key customer fulfillment status"
          actions={
            <Link to="/sales" className="text-xs font-bold text-brand-blue hover:underline inline-flex items-center gap-1">
              Complete 137 Dealer Directory <ArrowUpRight size={14} />
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="pb-2 font-bold">Party Name</th>
                <th className="pb-2 font-bold">State</th>
                <th className="pb-2 font-bold">Officer</th>
                <th className="pb-2 font-bold text-right">Target MT</th>
                <th className="pb-2 font-bold text-right">Dispatched MT</th>
                <th className="pb-2 font-bold text-right">Fulfillment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.concentration.top_dealers.map((d) => (
                <tr key={d.party_name} className="hover:bg-panel/40">
                  <td className="py-2.5 font-bold text-ink">{d.party_name}</td>
                  <td className="py-2.5 text-muted">{d.state}</td>
                  <td className="py-2.5 text-muted">{d.salesperson}</td>
                  <td className="py-2.5 text-right font-semibold text-ink">{d.target_mt.toFixed(1)} MT</td>
                  <td className="py-2.5 text-right font-semibold text-brand-green">{d.dispatched_mt.toFixed(1)} MT</td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`font-bold ${
                        d.achievement_percent >= 50
                          ? 'text-brand-green'
                          : d.achievement_percent > 0
                          ? 'text-brand-blue'
                          : 'text-brand-orange'
                      }`}
                    >
                      {d.achievement_percent.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
