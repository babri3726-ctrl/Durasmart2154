import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { Card, PageHeader } from '../components/ui/Card';
import LeafletVacantAreaMap from '../components/map/LeafletVacantAreaMap';
import {
  getVacantAreas,
  assignTerritory,
  ServerVacantAreasResponse,
  ServerVacantDistrict,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

const STATUS_FILTERS = [
  { id: 'all', label: 'All Districts' },
  { id: 'vacant', label: '🔴 Vacant Areas' },
  { id: 'partial', label: '🟡 Partly Covered' },
  { id: 'assigned', label: '🟢 Fully Assigned' },
];

const SALESPERSONS = [
  { id: 'EMP-SP-01', name: 'AJAY JI' },
  { id: 'EMP-SP-02', name: 'Aksit' },
  { id: 'EMP-SP-03', name: 'GAURAV JI' },
  { id: 'EMP-SP-04', name: 'JAGDEEP 2/ Aakash Kumar' },
  { id: 'EMP-SP-05', name: 'JAGDEEP 3/ Dalip Kumar' },
  { id: 'EMP-SP-06', name: 'Jagdeep Singh' },
  { id: 'EMP-SP-07', name: 'Mozi Ram' },
  { id: 'EMP-SP-08', name: 'PANKAJ JI' },
  { id: 'EMP-SP-09', name: 'Pankaj Goyal' },
  { id: 'EMP-SP-10', name: 'SANDEEP2/Mozi Ram' },
  { id: 'EMP-SP-11', name: 'Sandeep Mahajan' },
  { id: 'EMP-SP-12', name: 'Suresh Jindal' },
  { id: 'EMP-SP-13', name: 'VIJAY JI' },
];

export default function VaccantArea() {
  const [data, setData] = useState<ServerVacantAreasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [selectedDistrict, setSelectedDistrict] = useState<ServerVacantDistrict | null>(null);

  // Assign Territory Modal
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [targetDistrict, setTargetDistrict] = useState<ServerVacantDistrict | null>(null);
  const [selectedSpId, setSelectedSpId] = useState('EMP-SP-01');
  const [selectedSpName, setSelectedSpName] = useState('AJAY JI');
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getVacantAreas();
      setData(res);
      if (res.districts.length > 0 && !selectedDistrict) {
        setSelectedDistrict(res.districts[0]);
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to load territory data';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedDistrict]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Assign Modal
  const openAssignModal = (dist: ServerVacantDistrict) => {
    setTargetDistrict(dist);
    setIsAssignModalOpen(true);
  };

  // Submit Assignment
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDistrict) return;

    setAssigning(true);
    try {
      await assignTerritory({
        district: targetDistrict.district,
        salesperson: selectedSpName,
        salespersonId: selectedSpId,
      });
      toast.success(`Assigned ${targetDistrict.district} to ${selectedSpName}!`);
      setIsAssignModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Failed to assign territory');
    } finally {
      setAssigning(false);
    }
  };

  const districts = data?.districts || [];

  // Filter districts
  const filteredDistricts = districts.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (stateFilter !== 'all' && d.state.toLowerCase() !== stateFilter.toLowerCase()) return false;
    if (
      search &&
      !d.district.toLowerCase().includes(search.toLowerCase()) &&
      !d.state.toLowerCase().includes(search.toLowerCase()) &&
      !d.cities.some((c) => c.toLowerCase().includes(search.toLowerCase())) &&
      !(d.assignedSalesperson || '').toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const summary = data?.summary || {
    totalDistricts: 52,
    vacantDistricts: 0,
    assignedDistricts: 0,
    partialDistricts: 0,
    totalShops: 0,
    coveragePercent: 0,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vaccant Area & Territory Coverage"
        subtitle="OpenStreetMap district & city coverage tracker: Pinpoint neglected territories, vacant shop clusters & reassign sales beats."
      />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Metric KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="!p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Total Territories</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold text-ink">{summary.totalDistricts} Districts</span>
            <span className="text-xs text-muted">{summary.totalShops} shops</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-emerald-500/30 bg-emerald-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Covered Districts
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {summary.assignedDistricts}
            </span>
            <span className="text-xs font-semibold text-emerald-600">{summary.coveragePercent}% coverage</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-amber-500/30 bg-amber-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Partly Covered
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold text-amber-700 dark:text-amber-400">
              {summary.partialDistricts}
            </span>
            <span className="text-xs text-muted">multi-officer</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-red-500/30 bg-red-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-red">
            Vacant (Unserved)
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold text-brand-red">{summary.vacantDistricts}</span>
            <span className="text-xs font-semibold text-brand-red">Needs beat</span>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === f.id
                    ? 'bg-brand-red text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="input !py-1 text-xs font-semibold"
            >
              <option value="all">All States</option>
              <option value="haryana">Haryana</option>
              <option value="punjab">Punjab</option>
              <option value="rajasthan">Rajasthan</option>
              <option value="himachal pradesh">Himachal Pradesh</option>
            </select>

            <div className="relative">
              <input
                type="text"
                placeholder="Search district, city or salesperson…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input !py-1 text-xs !pl-7"
              />
              <Search size={13} className="absolute left-2 top-2 text-muted" />
            </div>
          </div>
        </div>
      </Card>

      {/* Main Split Layout: Map (60%) | District Table & Details (40%) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Map View */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-[500px]">
          <LeafletVacantAreaMap
            districts={filteredDistricts}
            selectedDistrict={selectedDistrict}
            onSelectDistrict={(dist) => setSelectedDistrict(dist)}
            onAssignDistrict={(dist) => openAssignModal(dist)}
          />
        </div>

        {/* Right District Table & Assignment Panel */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col space-y-3">
          <Card>
            <div className="border-b border-line pb-2 mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                Districts ({filteredDistricts.length})
              </span>
              {selectedDistrict && (
                <button
                  type="button"
                  onClick={() => openAssignModal(selectedDistrict)}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-blue-700"
                >
                  <UserPlus size={12} /> Assign Officer
                </button>
              )}
            </div>

            {loading ? (
              <p className="p-4 text-xs text-faint">Loading territory map…</p>
            ) : filteredDistricts.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted">No district matches that filter.</p>
            ) : (
              <div className="max-h-[460px] overflow-y-auto space-y-1.5 pr-1">
                {filteredDistricts.map((d) => {
                  const isSelected = selectedDistrict?.district === d.district;
                  const isVacant = d.status === 'vacant';

                  return (
                    <div
                      key={d.district}
                      onClick={() => setSelectedDistrict(d)}
                      className={`cursor-pointer rounded-lg border p-2.5 transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-line/70 bg-canvas/40 hover:border-line'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                isVacant
                                  ? 'bg-red-500'
                                  : d.status === 'partial'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                            />
                            <h4 className="text-xs font-bold text-ink truncate">{d.district}</h4>
                            <span className="text-[10px] text-muted">({d.state})</span>
                          </div>

                          <p className="text-[10px] text-muted mt-0.5 pl-4">
                            Officer: <strong>{d.assignedSalesperson || 'None (Vacant)'}</strong> •{' '}
                            {d.totalShops} shops
                          </p>
                        </div>

                        {isVacant ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignModal(d);
                            }}
                            className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-[10px] font-bold text-brand-red hover:bg-brand-red hover:text-white"
                          >
                            Assign Beat
                          </button>
                        ) : (
                          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Covered
                          </span>
                        )}
                      </div>

                      {d.cities && d.cities.length > 0 && (
                        <p className="text-[10px] text-faint mt-1 pl-4 truncate">
                          Cities: {d.cities.join(', ')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Assign Sales Officer Modal */}
      {isAssignModalOpen && targetDistrict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">
                  Assign Territory: {targetDistrict.district}
                </h2>
                <p className="text-xs text-muted">
                  Assign all {targetDistrict.totalShops} shops in {targetDistrict.district} ({targetDistrict.state})
                </p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setIsAssignModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Select Area Sales Officer *</label>
                <select
                  value={selectedSpId}
                  onChange={(e) => {
                    setSelectedSpId(e.target.value);
                    const sp = SALESPERSONS.find((s) => s.id === e.target.value);
                    if (sp) setSelectedSpName(sp.name);
                  }}
                  className="input !py-1.5 text-xs font-semibold"
                >
                  {SALESPERSONS.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-line bg-canvas/30 p-3 text-xs space-y-1">
                <p className="text-ink font-semibold">Territory Summary:</p>
                <p className="text-muted">• District: <strong>{targetDistrict.district}</strong></p>
                <p className="text-muted">• State: <strong>{targetDistrict.state}</strong></p>
                <p className="text-muted">• Total Registered Shops: <strong>{targetDistrict.totalShops}</strong></p>
                {targetDistrict.cities.length > 0 && (
                  <p className="text-muted">• Covered Cities: {targetDistrict.cities.join(', ')}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setIsAssignModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigning}
                  className="btn btn-primary text-xs"
                >
                  {assigning ? 'Assigning…' : `Confirm Assignment to ${selectedSpName}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
