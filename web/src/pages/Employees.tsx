import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Copy, Check, Trash2, Key, Sparkles, X } from 'lucide-react';
import { Card, PageHeader, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { useLiveList } from '../lib/useLiveList';
import {
  listEmployees,
  serverHost,
  createInvitation,
  listInvitations,
  revokeInvitation,
  InvitationRecord,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

const PAGE_SIZE = 20;

export default function Employees() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listEmployees({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  // Invitation Modal & List State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  // Form fields for new invitation
  const [role, setRole] = useState('employee');
  const [department, setDepartment] = useState('Sales');
  const [salesTerritory, setSalesTerritory] = useState('Punjab');
  const [monthlyTargetQty, setMonthlyTargetQty] = useState(100);
  const [mayDispatch, setMayDispatch] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadInvites = async () => {
    setLoadingInvites(true);
    try {
      const data = await listInvitations();
      setInvitations(data);
    } catch {
      // Ignored if non-owner
    } finally {
      setLoadingInvites(false);
    }
  };

  useEffect(() => {
    void loadInvites();
  }, []);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const newInv = await createInvitation({
        role,
        department,
        salesTerritory: department === 'Sales' ? salesTerritory : undefined,
        monthlyTargetQty: department === 'Sales' ? Number(monthlyTargetQty) : 0,
        mayDispatch: department === 'Dispatch' || mayDispatch,
        expiresInDays: Number(expiresInDays),
        maxUses: 1,
      });
      toast.success(`Generated invite code: ${newInv.code}`);
      setShowInviteModal(false);
      void loadInvites();
    } catch {
      toast.error('Failed to create invitation code');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (code: string) => {
    if (!window.confirm(`Revoke invitation code ${code}?`)) return;
    try {
      await revokeInvitation(code);
      toast.success(`Revoked code ${code}`);
      void loadInvites();
    } catch {
      toast.error('Failed to revoke code');
    }
  };

  const copyInviteLink = (code: string) => {
    const origin = window.location.origin;
    const link = `${origin}/signup?code=${encodeURIComponent(code)}`;
    void navigator.clipboard.writeText(link);
    setCopiedCode(code);
    toast.success(`Copied signup link for ${code}`);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Employees"
          subtitle={`Staff directory on ${serverHost()} — owner-only; invite new staff with secure one-time codes.`}
        />
        <button
          type="button"
          className="btn-grad flex items-center gap-2 py-2 px-4 shadow-sm"
          onClick={() => setShowInviteModal(true)}
        >
          <UserPlus size={16} />
          <span>Invite New Staff</span>
        </button>
      </div>

      {/* Staff Directory Card */}
      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <p className="text-[11px] text-muted">
            Open a row for the staff member&apos;s own customers and orders, and for his dispatch capability.
          </p>
          <input
            className="input !w-auto !py-2"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, role or department…"
          />
        </div>
        <div className="mb-3">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
        </div>
        {state === 'loading' && <p className="text-xs text-faint">Loading staff…</p>}
        {state === 'error' && (
          <p className="text-xs font-semibold text-brand-red">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={retry}>
              Try again
            </button>
          </p>
        )}
        {state === 'ready' && rows.length === 0 && (
          <p className="text-xs text-muted">
            {term ? 'No staff member matches that search.' : 'No staff records on the backend yet.'}
          </p>
        )}
        {state === 'ready' && rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-field border border-line">
              {rows.map((e) => (
                <Link
                  key={e.id}
                  to={`/employees/${e.id}`}
                  className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0 hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-ink">{e.name}</p>
                    <p className="text-[10px] text-muted">
                      {e.role || '—'}
                      {e.department ? ` • ${e.department}` : ''}
                      {e.city ? ` • ${e.city}` : ''}
                      {e.phone ? ` • ${e.phone}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px]">
                    {e.mayDispatch && (
                      <span className="text-muted">
                        dispatch <span className="font-semibold text-ink">granted</span>
                      </span>
                    )}
                    {e.targetUnit && (
                      <span className="text-muted">
                        target <span className="font-semibold text-ink">{e.monthlyTargetQty}</span> {e.targetUnit}
                      </span>
                    )}
                    <StatusBadge status={e.active ? 'active' : 'draft'} label={e.active ? 'active' : 'inactive'} />
                  </div>
                </Link>
              ))}
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
        <p className="mt-2 text-[10px] text-faint">New logins are created via Owner Invitation Codes.</p>
      </Card>

      {/* Active Invitation Codes List */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-ink flex items-center gap-2">
              <Key size={16} className="text-brand-blue" />
              <span>Staff Invitation Codes</span>
            </h2>
            <p className="text-[11px] text-muted">
              Share code or signup link with prospective employees to register on Web or Mobile APK.
            </p>
          </div>
          <button
            type="button"
            className="text-xs font-bold text-brand-blue hover:underline"
            onClick={loadInvites}
            disabled={loadingInvites}
          >
            {loadingInvites ? 'Refreshing…' : 'Refresh Codes'}
          </button>
        </div>

        {invitations.length === 0 ? (
          <p className="text-xs text-faint py-3">No active or historical invitation codes found.</p>
        ) : (
          <div className="overflow-hidden rounded-field border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-canvas border-b border-line text-muted">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Code</th>
                  <th className="py-2.5 px-3 font-semibold">Department & Role</th>
                  <th className="py-2.5 px-3 font-semibold">Territory & Quota</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Expires</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-canvas/40">
                    <td className="py-2.5 px-3 font-mono font-bold text-ink">
                      {inv.code}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-ink">{inv.department}</span>
                      <span className="text-[10px] text-muted block capitalize">{inv.role}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted">
                      {inv.sales_territory || 'All regions'}
                      {inv.monthly_target_qty > 0 && (
                        <span className="text-[10px] block font-semibold text-ink">
                          {inv.monthly_target_qty} {inv.target_unit}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          inv.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-700'
                            : inv.status === 'used'
                            ? 'bg-indigo-500/10 text-indigo-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-muted text-[11px]">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-2">
                      {inv.status === 'active' && (
                        <>
                          <button
                            type="button"
                            className="btn-outline !py-1 !px-2.5 text-[11px] inline-flex items-center gap-1"
                            onClick={() => copyInviteLink(inv.code)}
                            title="Copy Signup Link"
                          >
                            {copiedCode === inv.code ? (
                              <>
                                <Check size={12} className="text-emerald-600" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            className="text-brand-red hover:underline font-bold text-[11px] inline-flex items-center gap-0.5"
                            onClick={() => handleRevoke(inv.code)}
                          >
                            <Trash2 size={12} />
                            <span>Revoke</span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Generate Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h3 className="text-base font-black text-ink flex items-center gap-2">
                <Sparkles size={18} className="text-brand-blue" />
                <span>Generate Invitation Code</span>
              </h3>
              <button
                type="button"
                className="text-faint hover:text-ink"
                onClick={() => setShowInviteModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateInvite} className="mt-4 space-y-4">
              <div>
                <label className="label">Department</label>
                <select
                  className="input"
                  value={department}
                  onChange={(e) => {
                    const d = e.target.value;
                    setDepartment(d);
                    if (d === 'Dispatch') setRole('dispatch');
                    else setRole('employee');
                  }}
                >
                  <option value="Sales">Sales</option>
                  <option value="Dispatch">Dispatch (Yard)</option>
                  <option value="Accounts">Accounts</option>
                  <option value="Stores">Stores</option>
                  <option value="Marketing">Marketing</option>
                </select>
              </div>

              <div>
                <label className="label">Designation / Role</label>
                <input
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Area Sales Officer"
                  required
                />
              </div>

              {department === 'Sales' && (
                <>
                  <div>
                    <label className="label">Sales Territory</label>
                    <input
                      className="input"
                      value={salesTerritory}
                      onChange={(e) => setSalesTerritory(e.target.value)}
                      placeholder="e.g. Punjab, Haryana, Ludhiana"
                    />
                  </div>
                  <div>
                    <label className="label">Monthly Target Quota (MT)</label>
                    <input
                      type="number"
                      step="1"
                      className="input"
                      value={monthlyTargetQty}
                      onChange={(e) => setMonthlyTargetQty(Number(e.target.value))}
                      required
                    />
                  </div>
                </>
              )}

              {department !== 'Dispatch' && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="mayDispatch"
                    checked={mayDispatch}
                    onChange={(e) => setMayDispatch(e.target.checked)}
                    className="h-4 w-4 rounded border-line text-brand-blue"
                  />
                  <label htmlFor="mayDispatch" className="text-xs font-semibold text-ink cursor-pointer">
                    Grant Dispatch Authority (Record dispatches & adjust weights)
                  </label>
                </div>
              )}

              <div>
                <label className="label">Code Validity (Days)</label>
                <select
                  className="input"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  <option value={3}>3 Days</option>
                  <option value={7}>7 Days</option>
                  <option value={14}>14 Days</option>
                  <option value={30}>30 Days</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-grad" disabled={generating}>
                  {generating ? 'Generating…' : 'Generate & Save Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
