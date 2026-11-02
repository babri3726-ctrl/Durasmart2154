import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Target, UploadCloud } from 'lucide-react';
import { Card } from './ui/Card';
import { listSalesTargets, syncHrPbTargets, uploadExcelWorkbook } from '../lib/serverApi';

interface SalesTargetRow {
  id: string;
  state: string;
  party_name: string;
  station: string;
  district: string;
  salesperson: string;
  target_mt: string;
  order_received_mt: string;
  dispatched_mt: string;
  pending_mt: string;
}

interface SalespersonSummary {
  salesperson: string;
  territory: string;
  parties_count: number;
  total_target_mt: string;
  total_dispatched_mt: string;
  total_pending_mt: string;
  achievement_percent: string;
}

export default function HrPbTargetsCard() {
  const [syncing, setSyncing] = useState(false);
  const [uploadingHrPb, setUploadingHrPb] = useState(false);
  const hrPbFileRef = useRef<HTMLInputElement>(null);

  const handleHrPbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHrPb(true);
    setMessage(null);
    try {
      await uploadExcelWorkbook(file);
      setMessage('HR-PB.xlsx uploaded and synced successfully!');
      fetchTargets();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setMessage(errObj?.message || 'Upload failed');
    } finally {
      setUploadingHrPb(false);
      e.target.value = '';
    }
  };
  const [targets, setTargets] = useState<SalesTargetRow[]>([]);
  const [summary, setSummary] = useState<SalespersonSummary[]>([]);
  const [territory, setTerritory] = useState<'All' | 'Punjab' | 'Haryana'>('All');
  const [selectedSp, setSelectedSp] = useState<string>('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const fetchTargets = async () => {
    try {
      const res = await listSalesTargets();
      setTargets((res.items as unknown as SalesTargetRow[]) || []);
      setSummary((res.salesperson_summary as unknown as SalespersonSummary[]) || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchTargets();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await syncHrPbTargets();
      setMessage(res.message || 'HR-PB targets synced!');
      fetchTargets();
    } catch (e: unknown) {
      const errObj = e as { message?: string };
      setMessage(errObj?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const filtered = targets.filter((t) => {
    if (territory !== 'All' && t.state.toLowerCase() !== territory.toLowerCase()) return false;
    if (selectedSp && t.salesperson.toLowerCase() !== selectedSp.toLowerCase()) return false;
    if (search && !t.party_name.toLowerCase().includes(search.toLowerCase()) && !t.station.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="text-[15px] font-black text-ink flex items-center gap-2">
            <Target size={18} className="text-brand-blue" />
            Dealer Sales Targets (OneDrive: HR-PB.xlsx)
          </h2>
          <p className="text-[11px] text-muted">
            Party-wise target allocation and salesperson check for Punjab & Haryana dealers.
          </p>
          {message && <p className="mt-1 text-xs font-bold text-brand-green">{message}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={hrPbFileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleHrPbUpload}
          />
          <button
            type="button"
            onClick={() => hrPbFileRef.current?.click()}
            disabled={uploadingHrPb}
            className="btn-secondary !py-1.5 text-xs font-bold flex items-center gap-1.5"
          >
            <UploadCloud size={13} />
            {uploadingHrPb ? 'Uploading...' : 'Upload HR-PB.xlsx'}
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary !py-1.5 text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : '1-Click Sync HR-PB'}
          </button>
        </div>
      </div>

      {/* Salesperson / Area Officer Summary Split by Territory */}
      {(() => {
        const pbOfficers = summary.filter((s) => s.territory?.toLowerCase() === 'punjab');
        const hrOfficers = summary.filter((s) => s.territory?.toLowerCase() === 'haryana');

        const pbTarget = pbOfficers.reduce((sum, o) => sum + parseFloat(o.total_target_mt || '0'), 0);
        const pbDisp = pbOfficers.reduce((sum, o) => sum + parseFloat(o.total_dispatched_mt || '0'), 0);
        const pbPercent = pbTarget > 0 ? ((pbDisp / pbTarget) * 100).toFixed(1) : '0.0';

        const hrTarget = hrOfficers.reduce((sum, o) => sum + parseFloat(o.total_target_mt || '0'), 0);
        const hrDisp = hrOfficers.reduce((sum, o) => sum + parseFloat(o.total_dispatched_mt || '0'), 0);
        const hrPercent = hrTarget > 0 ? ((hrDisp / hrTarget) * 100).toFixed(1) : '0.0';

        return (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Salesperson / Area Officer Summary
              </p>
              {selectedSp && (
                <button
                  type="button"
                  onClick={() => setSelectedSp('')}
                  className="text-[11px] font-bold text-brand-blue hover:underline"
                >
                  Clear Filter ({selectedSp})
                </button>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Punjab Column */}
              <div className="rounded-xl border border-brand-blue/30 bg-brand-blue/5 p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-blue/20 pb-2">
                  <div>
                    <span className="font-black text-ink text-sm flex items-center gap-1.5">
                      🌾 Punjab Sales Team
                    </span>
                    <p className="text-[10px] text-muted">
                      {pbOfficers.length} Officers • 100 Dealers • {pbTarget.toFixed(1)} MT Target
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-brand-blue">{pbDisp.toFixed(1)} MT Dispatched</span>
                    <span className="ml-1.5 rounded bg-brand-blue/20 px-1.5 py-0.5 text-[10px] font-black text-brand-blue">
                      {pbPercent}%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {pbOfficers.map((sp) => {
                    const isSelected = selectedSp.toLowerCase() === sp.salesperson.toLowerCase();
                    const pct = parseFloat(sp.achievement_percent || '0');
                    return (
                      <button
                        type="button"
                        key={sp.salesperson}
                        onClick={() => setSelectedSp(isSelected ? '' : sp.salesperson)}
                        className={`rounded-lg border p-2.5 text-left transition ${
                          isSelected
                            ? 'border-brand-blue bg-white shadow-sm ring-2 ring-brand-blue/30'
                            : 'border-line bg-white/80 hover:bg-white hover:border-brand-blue/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="truncate text-xs font-black text-ink">{sp.salesperson}</p>
                          <span className="text-[10px] font-extrabold text-brand-blue shrink-0">
                            {sp.achievement_percent}%
                          </span>
                        </div>
                        <p className="text-[10px] text-muted mt-0.5">{sp.parties_count} dealers</p>
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
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Haryana Column */}
              <div className="rounded-xl border border-brand-purple/30 bg-brand-purple/5 p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-purple/20 pb-2">
                  <div>
                    <span className="font-black text-ink text-sm flex items-center gap-1.5">
                      🏢 Haryana Sales Team
                    </span>
                    <p className="text-[10px] text-muted">
                      {hrOfficers.length} Officers • 37 Dealers • {hrTarget.toFixed(1)} MT Target
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-brand-purple">{hrDisp.toFixed(1)} MT Dispatched</span>
                    <span className="ml-1.5 rounded bg-brand-purple/20 px-1.5 py-0.5 text-[10px] font-black text-brand-purple">
                      {hrPercent}%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {hrOfficers.map((sp) => {
                    const isSelected = selectedSp.toLowerCase() === sp.salesperson.toLowerCase();
                    const pct = parseFloat(sp.achievement_percent || '0');
                    return (
                      <button
                        type="button"
                        key={sp.salesperson}
                        onClick={() => setSelectedSp(isSelected ? '' : sp.salesperson)}
                        className={`rounded-lg border p-2.5 text-left transition ${
                          isSelected
                            ? 'border-brand-purple bg-white shadow-sm ring-2 ring-brand-purple/30'
                            : 'border-line bg-white/80 hover:bg-white hover:border-brand-purple/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="truncate text-xs font-black text-ink">{sp.salesperson}</p>
                          <span className="text-[10px] font-extrabold text-brand-purple shrink-0">
                            {sp.achievement_percent}%
                          </span>
                        </div>
                        <p className="text-[10px] text-muted mt-0.5">{sp.parties_count} dealers</p>
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
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['All', 'Punjab', 'Haryana'] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTerritory(t)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                territory === t ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
          {selectedSp && (
            <button
              type="button"
              onClick={() => setSelectedSp('')}
              className="ml-2 rounded-full border border-brand-blue bg-brand-blue/10 px-2.5 py-1 text-xs font-bold text-brand-blue hover:bg-brand-blue/20"
            >
              Clear Rep: {selectedSp} ×
            </button>
          )}
        </div>
        <input
          className="input !w-auto !py-1 text-xs"
          placeholder="Filter party or station…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="mt-3 overflow-x-auto rounded-field border border-line">
        <table className="w-full min-w-[650px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-canvas/40">
              <th className="px-3 py-2 text-[10px] font-extrabold uppercase text-muted">Party Name</th>
              <th className="px-3 py-2 text-[10px] font-extrabold uppercase text-muted">Station / Distt</th>
              <th className="px-3 py-2 text-[10px] font-extrabold uppercase text-muted">Officer / Rep</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase text-muted">Target (MT)</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase text-muted">Dispatched</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase text-muted">Pending</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 30).map((row) => (
              <tr key={row.id} className="border-b border-line/60 last:border-b-0 hover:bg-canvas/50">
                <td className="px-3 py-2 font-bold text-ink">{row.party_name}</td>
                <td className="px-3 py-2 text-muted">{row.station} ({row.district})</td>
                <td className="px-3 py-2 font-medium text-ink">{row.salesperson}</td>
                <td className="px-3 py-2 text-right font-semibold text-ink">{row.target_mt}</td>
                <td className="px-3 py-2 text-right font-semibold text-brand-green">{row.dispatched_mt}</td>
                <td className="px-3 py-2 text-right font-semibold text-brand-orange">{row.pending_mt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        Showing {filtered.length} parties matching filters. Source: HR-PB.xlsx (Sheet1 & Sheet2).
      </p>
    </Card>
  );
}
