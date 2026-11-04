import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Edit,
  MapPin,
  Plus,
  Route,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Card, PageHeader } from '../components/ui/Card';
import LeafletTourMap from '../components/map/LeafletTourMap';
import {
  listTourPlans,
  createTourPlan,
  updateTourPlan,
  deleteTourPlan,
  updateTourVisitStatus,
  listCustomers,
  ServerCustomer,
  ServerTourPlan,
  ServerTourVisit,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

const STATUS_TABS = [
  { id: 'all', label: 'All Beats' },
  { id: 'daily', label: "Daily (Today's Route)" },
  { id: 'upcoming', label: 'Upcoming Plans' },
  { id: 'completed', label: 'Completed' },
  { id: 'missed', label: 'Missed / Pending' },
];

export default function TourPlan() {
  const [plans, setPlans] = useState<ServerTourPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSalesperson, setSelectedSalesperson] = useState<string>('all');
  const [selectedTab, setSelectedTab] = useState<string>('daily');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  // Modal states
  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ServerTourPlan | null>(null);

  // Customer options for adding stops
  const [customers, setCustomers] = useState<ServerCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');

  // Form states for New Tour Plan
  const [newSpId, setNewSpId] = useState('EMP-SP-01');
  const [newSpName, setNewSpName] = useState('AJAY JI');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newArea, setNewArea] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newStops, setNewStops] = useState<Partial<ServerTourVisit>[]>([]);

  // Fetch all tour plans
  const loadTourPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTourPlans();
      setPlans(data);
      if (data.length > 0 && !selectedPlanId) {
        setSelectedPlanId(data[0].id);
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to load tour plans';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => {
    loadTourPlans();
    listCustomers().then((res) => setCustomers(res.items)).catch(() => {});
  }, [loadTourPlans]);

  // Unique salespersons present in plans & real officers
  const salespersonsList = [
    { id: 'all', name: 'All Sales Officers' },
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

  const todayStr = new Date().toISOString().slice(0, 10);

  // Filter plans based on salesperson & status tab
  const filteredPlans = plans.filter((plan) => {
    if (selectedSalesperson !== 'all' && plan.salespersonId !== selectedSalesperson) {
      return false;
    }
    if (selectedTab === 'daily') {
      return plan.date === todayStr;
    }
    if (selectedTab === 'upcoming') {
      return plan.date > todayStr;
    }
    if (selectedTab === 'completed') {
      return plan.status === 'completed';
    }
    if (selectedTab === 'missed') {
      return plan.visits.some((v) => v.status === 'missed');
    }
    return true;
  });

  const activePlan = filteredPlans.find((p) => p.id === selectedPlanId) || filteredPlans[0] || null;

  // Toggle Visit Status
  const handleToggleVisitStatus = async (
    tourId: string,
    visitId: string,
    currentStatus: 'planned' | 'in_progress' | 'completed' | 'missed',
  ) => {
    const nextStatus = currentStatus === 'completed' ? 'planned' : 'completed';
    try {
      await updateTourVisitStatus(tourId, visitId, nextStatus);
      toast.success(`Visit marked ${nextStatus}`);
      await loadTourPlans();
    } catch {
      toast.error('Failed to update visit status');
    }
  };

  // Delete Tour Plan
  const handleDeletePlan = async (tourId: string) => {
    if (!window.confirm('Delete this tour plan and itinerary?')) return;
    try {
      await deleteTourPlan(tourId);
      toast.success('Tour plan deleted');
      setSelectedPlanId(null);
      await loadTourPlans();
    } catch {
      toast.error('Failed to delete tour plan');
    }
  };

  // Create New Tour Plan
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newStops.length === 0) {
      toast.error('Please add at least 1 shop to this tour beat');
      return;
    }

    try {
      const created = await createTourPlan({
        salespersonId: newSpId,
        salespersonName: newSpName,
        date: newDate,
        areaName: newArea || `${newSpName} Tour Beat`,
        notes: newNotes,
        visits: newStops,
      });
      toast.success('New daily tour beat scheduled!');
      setIsNewPlanOpen(false);
      setNewStops([]);
      setNewArea('');
      setNewNotes('');
      setSelectedPlanId(created.id);
      await loadTourPlans();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Failed to create tour plan');
    }
  };

  // Add shop to new stops
  const handleAddStopToNewPlan = (cust: ServerCustomer) => {
    const nextSeq = newStops.length + 1;
    const exists = newStops.some((s) => s.customerId === cust.id);
    if (exists) {
      toast.error('Dealer shop already in this tour beat');
      return;
    }
    setNewStops([
      ...newStops,
      {
        customerId: cust.id,
        customerName: cust.name,
        city: cust.city,
        district: cust.district,
        sequence: nextSeq,
        purpose: 'Payment collection & order booking',
        status: 'planned',
      },
    ]);
  };

  // Remove stop
  const handleRemoveNewStop = (index: number) => {
    const updated = newStops.filter((_, idx) => idx !== index).map((s, idx) => ({ ...s, sequence: idx + 1 }));
    setNewStops(updated);
  };

  // Open Edit Modal
  const openEditModal = (plan: ServerTourPlan) => {
    setEditingPlan({ ...plan, visits: [...plan.visits] });
    setIsEditModalOpen(true);
  };

  // Save Edit Tour Plan
  const handleSaveEditPlan = async () => {
    if (!editingPlan) return;
    try {
      await updateTourPlan(editingPlan.id, {
        areaName: editingPlan.areaName,
        notes: editingPlan.notes,
        date: editingPlan.date,
        visits: editingPlan.visits,
      });
      toast.success('Tour beat updated successfully');
      setIsEditModalOpen(false);
      await loadTourPlans();
    } catch {
      toast.error('Failed to update tour beat');
    }
  };

  // Move stop up/down
  const moveEditStop = (fromIdx: number, toIdx: number) => {
    if (!editingPlan) return;
    const items = [...editingPlan.visits];
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    const resequenced = items.map((it, idx) => ({ ...it, sequence: idx + 1 }));
    setEditingPlan({ ...editingPlan, visits: resequenced });
  };

  // Filtered customer search
  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch ||
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.city.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.district.toLowerCase().includes(customerSearch.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tour Plan & Route Optimizer"
        subtitle="Free OpenStreetMap routing: Track daily beats, sequential city/shop routes, visit approvals & vacant coverage."
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-1.5 shadow-sm"
            onClick={() => setIsNewPlanOpen(true)}
          >
            <Plus size={16} /> Schedule Tour Beat
          </button>
        }
      />

      {/* Top Filter & Tab Bar */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap gap-1.5 border-b border-line pb-2 sm:border-b-0 sm:pb-0">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  selectedTab === tab.id
                    ? 'bg-brand-red text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sales Officer Filter */}
          <div className="flex items-center gap-2">
            <Users size={15} className="text-muted" />
            <select
              value={selectedSalesperson}
              onChange={(e) => setSelectedSalesperson(e.target.value)}
              className="input !py-1 text-xs font-semibold"
            >
              {salespersonsList.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Main Split Layout: Left Map (60%) | Right Itinerary (40%) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column: Interactive Leaflet Tour Map */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-[500px]">
          <LeafletTourMap
            visits={activePlan?.visits || []}
            selectedVisitId={selectedVisitId}
            onSelectVisit={(v) => setSelectedVisitId(v.id)}
            onUpdateStatus={(visitId, status) => {
              if (activePlan) handleToggleVisitStatus(activePlan.id, visitId, status);
            }}
          />
        </div>

        {/* Right Column: Tour Plan Itinerary & Controls */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col space-y-3">
          <Card>
            {loading ? (
              <p className="p-4 text-xs text-faint">Loading tour beats…</p>
            ) : filteredPlans.length === 0 ? (
              <div className="p-6 text-center text-muted space-y-2">
                <Route className="mx-auto text-faint" size={36} />
                <p className="text-xs font-medium">No tour beats match the selected filter.</p>
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setIsNewPlanOpen(true)}
                >
                  Create Today's Beat
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Tour Plan Selector Header */}
                <div className="border-b border-line pb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                      Active Tour Beat ({filteredPlans.length})
                    </span>
                    <div className="flex items-center gap-1">
                      {activePlan && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(activePlan)}
                            className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"
                            title="Edit Route"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePlan(activePlan.id)}
                            className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"
                            title="Delete Beat"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {filteredPlans.length > 1 && (
                    <select
                      value={activePlan?.id || ''}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className="input mt-1.5 !py-1 text-xs font-bold"
                    >
                      {filteredPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.salespersonName} • {p.date} • {p.areaName || 'Beat'}
                        </option>
                      ))}
                    </select>
                  )}

                  {activePlan && (
                    <div className="mt-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-ink">{activePlan.salespersonName}</span>
                        <span className="flex items-center gap-1 font-semibold text-muted">
                          <Calendar size={12} /> {activePlan.date}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted">{activePlan.areaName}</p>
                      {activePlan.notes && (
                        <p className="mt-1 text-[11px] italic text-faint">"{activePlan.notes}"</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Ordered Stop List */}
                <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                  {activePlan?.visits.map((visit) => {
                    const isSelected = visit.id === selectedVisitId;
                    const isCompleted = visit.status === 'completed';

                    return (
                      <div
                        key={visit.id}
                        onClick={() => setSelectedVisitId(visit.id)}
                        className={`cursor-pointer rounded-lg border p-2.5 transition ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                            : 'border-line/70 bg-canvas/40 hover:border-line'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                                isCompleted
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-blue-600 text-white'
                              }`}
                            >
                              {visit.sequence}
                            </span>
                            <div className="min-w-0">
                              <h4
                                className={`text-xs font-bold truncate ${
                                  isCompleted ? 'text-muted line-through' : 'text-ink'
                                }`}
                              >
                                {visit.customerName}
                              </h4>
                              <p className="text-[10px] text-muted flex items-center gap-1">
                                <MapPin size={10} /> {visit.city}, {visit.district}
                              </p>
                            </div>
                          </div>

                          {/* Quick Toggle Status */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleVisitStatus(activePlan.id, visit.id, visit.status);
                            }}
                            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold transition ${
                              isCompleted
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-canvas border border-line text-muted hover:border-emerald-500 hover:text-emerald-700'
                            }`}
                          >
                            {isCompleted ? '✓ Visited' : 'Mark Visited'}
                          </button>
                        </div>

                        <div className="mt-1 text-[11px] text-muted pl-7">
                          <span>{visit.purpose}</span>
                          {visit.notes && <p className="italic text-faint">Note: {visit.notes}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* New Tour Beat Modal */}
      {isNewPlanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-line bg-panel p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Schedule Employee Tour Beat</h2>
                <p className="text-xs text-muted">
                  Assign sequential city shop visits on OpenStreetMap route
                </p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setIsNewPlanOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-ink">Area Sales Officer *</label>
                  <select
                    className="input !py-1.5 text-xs font-semibold"
                    value={newSpId}
                    onChange={(e) => {
                      setNewSpId(e.target.value);
                      const sp = salespersonsList.find((s) => s.id === e.target.value);
                      if (sp) setNewSpName(sp.name);
                    }}
                  >
                    {salespersonsList
                      .filter((s) => s.id !== 'all')
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-ink">Tour Date *</label>
                  <input
                    type="date"
                    className="input !py-1.5 text-xs font-semibold"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Area / Route Beat Title</label>
                <input
                  type="text"
                  className="input !py-1.5 text-xs"
                  placeholder="e.g. Sirsa - Dabwali Daily Beat"
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Daily Objective / Notes</label>
                <textarea
                  className="input !py-1.5 text-xs"
                  rows={2}
                  placeholder="e.g. Overdue payment collection, stock order review, new catalogue delivery"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              </div>

              {/* Add Stops from Dealer Directory */}
              <div className="rounded-lg border border-line bg-canvas/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-ink">
                    Ordered Route Stops ({newStops.length})
                  </h3>
                  <span className="text-[10px] text-muted">Sequential order 1, 2, 3...</span>
                </div>

                {newStops.length > 0 ? (
                  <div className="space-y-1.5 mb-3">
                    {newStops.map((stop, idx) => (
                      <div
                        key={stop.customerId}
                        className="flex items-center justify-between gap-2 rounded bg-panel border border-line/70 px-2.5 py-1.5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="font-bold text-ink">{stop.customerName}</span>
                            <span className="text-muted text-[10px]">
                              {' '}
                              • {stop.city}, {stop.district}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveNewStop(idx)}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted italic mb-3">
                    No shops added yet. Select dealer shops below to build the itinerary.
                  </p>
                )}

                {/* Dealer Search & Picker */}
                <div>
                  <input
                    type="text"
                    className="input mb-2 !py-1 text-xs"
                    placeholder="Search dealers by shop name, city, or district…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {filteredCustomers.slice(0, 10).map((cust) => {
                      const alreadyAdded = newStops.some((s) => s.customerId === cust.id);
                      return (
                        <div
                          key={cust.id}
                          className="flex items-center justify-between rounded border border-line/60 bg-panel px-2 py-1 text-xs hover:border-line"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-ink truncate">{cust.name}</p>
                            <p className="text-[10px] text-muted">
                              {cust.city}, {cust.district} • {cust.salesperson}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => handleAddStopToNewPlan(cust)}
                            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                              alreadyAdded
                                ? 'bg-line/40 text-muted cursor-not-allowed'
                                : 'bg-brand-red text-white hover:bg-brand-red/90'
                            }`}
                          >
                            {alreadyAdded ? 'Added' : '+ Add'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setIsNewPlanOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-xs">
                  Save & Publish Tour Beat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Route Modal */}
      {isEditModalOpen && editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Edit Route Itinerary</h2>
                <p className="text-xs text-muted">
                  Re-sequence stops or change details for {editingPlan.salespersonName}
                </p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setIsEditModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Route Title</label>
                <input
                  type="text"
                  className="input !py-1 text-xs"
                  value={editingPlan.areaName}
                  onChange={(e) => setEditingPlan({ ...editingPlan, areaName: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Notes</label>
                <input
                  type="text"
                  className="input !py-1 text-xs"
                  value={editingPlan.notes}
                  onChange={(e) => setEditingPlan({ ...editingPlan, notes: e.target.value })}
                />
              </div>

              <div>
                <h4 className="text-xs font-bold text-ink mb-1.5">
                  Ordered Stops (use arrows to re-order sequence)
                </h4>
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {editingPlan.visits.map((stop, idx) => (
                    <div
                      key={stop.id}
                      className="flex items-center justify-between rounded border border-line bg-canvas/40 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-bold text-ink">{stop.customerName}</p>
                          <p className="text-[10px] text-muted">
                            {stop.city}, {stop.district}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveEditStop(idx, idx - 1)}
                          className="rounded border border-line px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={idx === editingPlan.visits.length - 1}
                          onClick={() => moveEditStop(idx, idx + 1)}
                          className="rounded border border-line px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  onClick={handleSaveEditPlan}
                >
                  Save Route Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
