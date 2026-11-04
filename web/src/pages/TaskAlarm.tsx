import { useCallback, useEffect, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  Calendar,
  Plus,
  Search,
  Trash2,
  User,
  X,
  Camera,
} from 'lucide-react';
import { Card, PageHeader } from '../components/ui/Card';
import {
  listTasks,
  createTask,
  deleteTask,
  ServerTask,
  TaskSummary,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

const STATUS_TABS = [
  { id: 'all', label: 'All Assignments' },
  { id: 'today', label: '🔵 Due Today' },
  { id: 'pending', label: '🟡 Pending' },
  { id: 'overdue', label: '🔴 Overdue' },
  { id: 'completed', label: '🟢 Completed' },
];

const SALESPERSONS = [
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

export default function TaskAlarm() {
  const [tasks, setTasks] = useState<ServerTask[]>([]);
  const [summary, setSummary] = useState<TaskSummary>({
    today: 0,
    pending: 0,
    overdue: 0,
    completed: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Create Task Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form states
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEmpId, setNewEmpId] = useState('EMP-SP-01');
  const [newEmpName, setNewEmpName] = useState('AJAY JI');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newTime, setNewTime] = useState('18:00');
  const [newPriority, setNewPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [newRequiresPhoto, setNewRequiresPhoto] = useState(false);

  // Load tasks from backend
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTasks({
        employeeId: selectedEmployee !== 'all' ? selectedEmployee : undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        priority: selectedPriority !== 'all' ? selectedPriority : undefined,
      });
      setTasks(res.items);
      setSummary(res.summary);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to load task board';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedEmployee, selectedStatus, selectedPriority]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Create Task Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error('Task title is required');
      return;
    }

    setCreating(true);
    try {
      await createTask({
        title: newTitle.trim(),
        description: newDesc.trim(),
        assignedEmployeeId: newEmpId,
        assignedEmployeeName: newEmpName,
        dueDate: newDate,
        dueTime: newTime,
        priority: newPriority,
        requiresPhoto: newRequiresPhoto,
      });

      toast.success(`Task created & dispatched to ${newEmpName}'s phone!`);
      setIsCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      setNewRequiresPhoto(false);
      await loadData();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  // Handle Delete Task
  const handleDeleteTask = async (taskId: string, title: string) => {
    if (!window.confirm(`Delete task assignment: "${title}"?`)) return;
    try {
      await deleteTask(taskId);
      toast.success('Task assignment deleted');
      await loadData();
    } catch {
      toast.error('Failed to delete task');
    }
  };

  // Filter tasks locally by search text
  const filteredTasks = tasks.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assignedEmployeeName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Task Alarm & Work Assignments"
        subtitle="Operations Panel task creation: Assign tasks to Area Sales Officers with auto-triggering phone alarms when time is up."
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-1.5 shadow-sm"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={16} /> Create Task Assignment
          </button>
        }
      />

      {/* Metric KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="!p-3.5 border-blue-500/30 bg-blue-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
            Due Today
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-blue-700 dark:text-blue-400">
              {summary.today}
            </span>
            <span className="text-xs font-semibold text-blue-600">Active Beats</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-amber-500/30 bg-amber-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Pending Tasks
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {summary.pending}
            </span>
            <span className="text-xs text-muted">Awaiting Action</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-red-500/30 bg-red-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-red">
            Overdue Tasks
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-brand-red">{summary.overdue}</span>
            <span className="text-xs font-semibold text-brand-red">Alarm Triggered</span>
          </div>
        </Card>

        <Card className="!p-3.5 border-emerald-500/30 bg-emerald-50/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Completed Tasks
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {summary.completed}
            </span>
            <span className="text-xs text-emerald-600 font-semibold">Closed</span>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedStatus(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  selectedStatus === tab.id
                    ? 'bg-brand-red text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Secondary Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Salesperson Filter */}
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="input !py-1 text-xs font-semibold"
            >
              {SALESPERSONS.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="input !py-1 text-xs font-semibold"
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="normal">Normal Priority</option>
              <option value="low">Low Priority</option>
            </select>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search tasks or assignees…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input !py-1 text-xs !pl-7"
              />
              <Search size={13} className="absolute left-2 top-2 text-muted" />
            </div>
          </div>
        </div>
      </Card>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Task List Table */}
      <Card>
        {loading ? (
          <p className="p-4 text-xs text-faint">Loading task assignments…</p>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 text-center text-muted space-y-2">
            <AlarmClock className="mx-auto text-faint" size={38} />
            <p className="text-xs font-semibold">No tasks match the selected view.</p>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => setIsCreateOpen(true)}
            >
              + Create New Task
            </button>
          </div>
        ) : (
          <div className="divide-y divide-line/60">
            {filteredTasks.map((task) => {
              const isCompleted = task.status === 'completed';
              const isOverdue = task.isOverdue;

              let priorityColor = 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/30';
              if (task.priority === 'high') {
                priorityColor = 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30';
              } else if (task.priority === 'low') {
                priorityColor = 'text-muted bg-canvas border-line';
              }

              return (
                <div
                  key={task.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 transition ${
                    isOverdue
                      ? 'bg-red-50/20'
                      : isCompleted
                      ? 'bg-emerald-50/10 opacity-75'
                      : 'hover:bg-canvas/30'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${priorityColor}`}>
                        {task.priority}
                      </span>

                      {isOverdue && (
                        <span className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                          <AlertTriangle size={10} /> OVERDUE ALARM
                        </span>
                      )}

                      {task.isToday && !isCompleted && !isOverdue && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                          Due Today
                        </span>
                      )}

                      <h4 className={`text-xs font-bold ${isCompleted ? 'line-through text-muted' : 'text-ink'}`}>
                        {task.title}
                      </h4>
                    </div>

                    {task.description && (
                      <p className="text-[11px] text-muted line-clamp-2">{task.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted pt-0.5">
                      <span className="flex items-center gap-1 font-semibold text-ink">
                        <User size={11} className="text-muted" /> {task.assignedEmployeeName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {task.dueDate} at {task.dueTime}
                      </span>
                      {task.requiresPhoto && (
                        <span className="flex items-center gap-1 text-purple-600 font-semibold">
                          <Camera size={11} /> Proof Photo Required
                        </span>
                      )}
                      {task.completionNotes && (
                        <span className="italic text-emerald-700 dark:text-emerald-400">
                          Closed: "{task.completionNotes}"
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:self-center">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        isCompleted
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : task.status === 'acknowledged'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                      }`}
                    >
                      {task.status}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id, task.title)}
                      className="rounded p-1 text-muted hover:bg-red-50 hover:text-brand-red transition"
                      title="Delete Task Assignment"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Create Task Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Create Task Assignment</h2>
                <p className="text-xs text-muted">
                  Dispatches assignment to employee phone; triggers alarm chime when time is up
                </p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setIsCreateOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Payment collection from Kalra Traders"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="input !py-1.5 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Assign to Sales Officer *</label>
                <select
                  value={newEmpId}
                  onChange={(e) => {
                    setNewEmpId(e.target.value);
                    const sp = SALESPERSONS.find((s) => s.id === e.target.value);
                    if (sp) setNewEmpName(sp.name);
                  }}
                  className="input !py-1.5 text-xs font-semibold"
                >
                  {SALESPERSONS.filter((s) => s.id !== 'all').map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-ink">Due Date *</label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="input !py-1.5 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-ink">Alarm Time *</label>
                  <input
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="input !py-1.5 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-ink">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as 'low' | 'normal' | 'high')}
                    className="input !py-1.5 text-xs font-semibold"
                  >
                    <option value="high">High Priority</option>
                    <option value="normal">Normal Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-ink">
                    <input
                      type="checkbox"
                      checked={newRequiresPhoto}
                      onChange={(e) => setNewRequiresPhoto(e.target.checked)}
                      className="rounded border-line text-brand-red focus:ring-brand-red"
                    />
                    Requires Photo Proof
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Instructions & Notes</label>
                <textarea
                  rows={3}
                  placeholder="Provide specific dealer details, payment voucher amount, or stock inspection instructions…"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="input !py-1.5 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn btn-primary text-xs"
                >
                  {creating ? 'Assigning…' : 'Create & Dispatch Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
