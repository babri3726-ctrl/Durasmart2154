import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target, TrendingUp, Users, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, KpiCard } from '../ui/Card';
import { listSalesTargets } from '../../lib/serverApi';

interface TargetItem {
  salesperson: string;
  territory: string;
  parties_count: number;
  total_target_mt: string;
  total_dispatched_mt: string;
  total_pending_mt: string;
  achievement_percent: string;
}

export default function SalesTargetKpis() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    summary: {
      total_target: number;
      total_dispatched: number;
      total_pending: number;
      overall_achievement: number;
      parties_count: number;
    };
    territories: {
      punjab: { target: number; dispatched: number; percent: number; dealers: number };
      haryana: { target: number; dispatched: number; percent: number; dealers: number };
    };
    officers: TargetItem[];
  } | null>(null);

  useEffect(() => {
    listSalesTargets()
      .then((json) => {
        const officers: TargetItem[] = json.salesperson_summary || [];
        const pbOfficers = officers.filter((o) => o.territory === 'Punjab');
        const hrOfficers = officers.filter((o) => o.territory === 'Haryana');

        const pbTarget = pbOfficers.reduce((sum, o) => sum + parseFloat(o.total_target_mt || '0'), 0);
        const pbDisp = pbOfficers.reduce((sum, o) => sum + parseFloat(o.total_dispatched_mt || '0'), 0);
        const pbDealers = pbOfficers.reduce((sum, o) => sum + o.parties_count, 0);

        const hrTarget = hrOfficers.reduce((sum, o) => sum + parseFloat(o.total_target_mt || '0'), 0);
        const hrDisp = hrOfficers.reduce((sum, o) => sum + parseFloat(o.total_dispatched_mt || '0'), 0);
        const hrDealers = hrOfficers.reduce((sum, o) => sum + o.parties_count, 0);

        const totalTarget = pbTarget + hrTarget;
        const totalDisp = pbDisp + hrDisp;

        setData({
          summary: {
            total_target: totalTarget,
            total_dispatched: totalDisp,
            total_pending: totalTarget - totalDisp,
            overall_achievement: totalTarget > 0 ? (totalDisp / totalTarget) * 100 : 0,
            parties_count: json.total || 137,
          },
          territories: {
            punjab: {
              target: pbTarget,
              dispatched: pbDisp,
              percent: pbTarget > 0 ? (pbDisp / pbTarget) * 100 : 0,
              dealers: pbDealers || 100,
            },
            haryana: {
              target: hrTarget,
              dispatched: hrDisp,
              percent: hrTarget > 0 ? (hrDisp / hrTarget) * 100 : 0,
              dealers: hrDealers || 37,
            },
          },
          officers,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-xs text-faint">Loading sales targets and quotas…</p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <p className="text-xs text-muted">Unable to read live HR-PB sales targets.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Banner Progress */}
      <Card className="bg-gradient-to-r from-brand-blue/10 via-brand-purple/10 to-transparent border-brand-blue/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center rounded-full bg-brand-blue/20 px-2.5 text-[11px] font-extrabold text-brand-blue">
                Live HR-PB Quota
              </span>
              <span className="text-xs text-muted">October 2026 Target vs Dispatch</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-black text-ink">
                {data.summary.total_dispatched.toFixed(1)} MT{' '}
                <span className="text-sm font-semibold text-muted">
                  / {data.summary.total_target.toFixed(1)} MT fulfilled
                </span>
              </p>
              <span className="text-sm font-extrabold text-brand-blue">
                ({data.summary.overall_achievement.toFixed(1)}%)
              </span>
            </div>
          </div>
          <Link
            to="/sales"
            className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white transition hover:bg-ink/80"
          >
            Open Dealer Matrix <ArrowUpRight size={14} />
          </Link>
        </div>

        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-blue to-brand-purple transition-all duration-500"
            style={{ width: `${Math.min(data.summary.overall_achievement, 100)}%` }}
          />
        </div>
      </Card>

      {/* 4 KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Monthly Quota"
          value={`${data.summary.total_target.toFixed(0)} MT`}
          hint="Total volume commitment across 137 parties"
          gradient="from-brand-blue to-brand-purple"
          icon={<Target size={20} />}
          to="/sales"
        />
        <KpiCard
          label="Material Dispatched"
          value={`${data.summary.total_dispatched.toFixed(1)} MT`}
          hint={`${data.summary.overall_achievement.toFixed(1)}% of company-wide target`}
          gradient="from-brand-green to-brand-teal"
          icon={<CheckCircle2 size={20} />}
          to="/sales"
        />
        <KpiCard
          label="Pending Dispatch"
          value={`${data.summary.total_pending.toFixed(1)} MT`}
          hint="Remaining balance to deliver this month"
          gradient="from-brand-orange to-brand-red"
          icon={<TrendingUp size={20} />}
          to="/sales"
        />
        <KpiCard
          label="Active Dealer Network"
          value={`${data.summary.parties_count}`}
          hint="100 Punjab dealers • 37 Haryana dealers"
          gradient="from-brand-teal to-brand-blue"
          icon={<Users size={20} />}
          to="/debtors"
        />
      </div>

      {/* Territory Comparison & Area Officer Breakdown */}
      {(() => {
        const pbOfficers = data.officers.filter((o) => o.territory?.toLowerCase() === 'punjab');
        const hrOfficers = data.officers.filter((o) => o.territory?.toLowerCase() === 'haryana');

        return (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Punjab Territory & Officers */}
            <Card className="border-t-4 border-t-brand-blue">
              <CardHeader
                title="🌾 Punjab Territory & Area Officers"
                subtitle={`${data.territories.punjab.dealers} active dealer accounts • ${pbOfficers.length} Area Officers`}
                actions={
                  <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-bold text-brand-blue">
                    {data.territories.punjab.percent.toFixed(1)}% Achievement
                  </span>
                }
              />
              <div className="space-y-3.5">
                {/* Punjab Aggregate Progress */}
                <div className="rounded-lg border border-brand-blue/20 bg-brand-blue/5 p-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Target Quota</p>
                      <p className="text-xs font-black text-ink">{data.territories.punjab.target.toFixed(1)} MT</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Dispatched</p>
                      <p className="text-xs font-black text-brand-green">{data.territories.punjab.dispatched.toFixed(1)} MT</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Pending</p>
                      <p className="text-xs font-black text-brand-orange">
                        {(data.territories.punjab.target - data.territories.punjab.dispatched).toFixed(1)} MT
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-brand-blue transition-all duration-500"
                      style={{ width: `${Math.min(data.territories.punjab.percent, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Punjab Officers Grid */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                      Punjab Sales Officers ({pbOfficers.length})
                    </p>
                    <Link to="/sales" className="text-[11px] font-bold text-brand-blue hover:underline">
                      Filter in Sales Matrix →
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {pbOfficers.map((sp) => {
                      const pct = parseFloat(sp.achievement_percent || '0');
                      return (
                        <div
                          key={sp.salesperson}
                          className="rounded-lg border border-line bg-white/90 p-2.5 transition hover:border-brand-blue/50 hover:shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="truncate text-xs font-black text-ink">{sp.salesperson}</p>
                            <span className="text-[10px] font-extrabold text-brand-blue shrink-0">
                              {sp.achievement_percent}%
                            </span>
                          </div>
                          <p className="text-[10px] text-muted mt-0.5">{sp.parties_count} assigned dealers</p>
                          <div className="mt-1 flex items-center justify-between text-[10px]">
                            <span className="text-muted">Target: {sp.total_target_mt} MT</span>
                            <span className="font-bold text-brand-green">{sp.total_dispatched_mt} MT</span>
                          </div>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-brand-blue"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>

            {/* Haryana Territory & Officers */}
            <Card className="border-t-4 border-t-brand-purple">
              <CardHeader
                title="🏢 Haryana Territory & Area Officers"
                subtitle={`${data.territories.haryana.dealers} active dealer accounts • ${hrOfficers.length} Area Officers`}
                actions={
                  <span className="rounded-full bg-brand-purple/10 px-2 py-0.5 text-xs font-bold text-brand-purple">
                    {data.territories.haryana.percent.toFixed(1)}% Achievement
                  </span>
                }
              />
              <div className="space-y-3.5">
                {/* Haryana Aggregate Progress */}
                <div className="rounded-lg border border-brand-purple/20 bg-brand-purple/5 p-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Target Quota</p>
                      <p className="text-xs font-black text-ink">{data.territories.haryana.target.toFixed(1)} MT</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Dispatched</p>
                      <p className="text-xs font-black text-brand-green">{data.territories.haryana.dispatched.toFixed(1)} MT</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted">Pending</p>
                      <p className="text-xs font-black text-brand-orange">
                        {(data.territories.haryana.target - data.territories.haryana.dispatched).toFixed(1)} MT
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-brand-purple transition-all duration-500"
                      style={{ width: `${Math.min(data.territories.haryana.percent, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Haryana Officers Grid */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                      Haryana Sales Officers ({hrOfficers.length})
                    </p>
                    <Link to="/sales" className="text-[11px] font-bold text-brand-purple hover:underline">
                      Filter in Sales Matrix →
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {hrOfficers.map((sp) => {
                      const pct = parseFloat(sp.achievement_percent || '0');
                      return (
                        <div
                          key={sp.salesperson}
                          className="rounded-lg border border-line bg-white/90 p-2.5 transition hover:border-brand-purple/50 hover:shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="truncate text-xs font-black text-ink">{sp.salesperson}</p>
                            <span className="text-[10px] font-extrabold text-brand-purple shrink-0">
                              {sp.achievement_percent}%
                            </span>
                          </div>
                          <p className="text-[10px] text-muted mt-0.5">{sp.parties_count} assigned dealers</p>
                          <div className="mt-1 flex items-center justify-between text-[10px]">
                            <span className="text-muted">Target: {sp.total_target_mt} MT</span>
                            <span className="font-bold text-brand-green">{sp.total_dispatched_mt} MT</span>
                          </div>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-brand-purple"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
