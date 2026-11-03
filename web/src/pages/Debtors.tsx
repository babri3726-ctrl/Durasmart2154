/** The debtor book: one dated, imported closing balance per party, debit and credit apart.
 *
 *  Two routes share this screen and the difference between them is the point:
 *
 *  - `GET /debtors` is what the backend has *stored*. A row is a snapshot with an `asOf` date and
 *    an `importedAt` timestamp, and the two sides are printed as two figures. Nothing here
 *    subtracts credit from debit: no net total has been approved, and a screen that invented one
 *    would be showing a number the backend does not hold.
 *  - `POST /debtors/imports/preview` is a diagnosis of one uploaded workbook and stores nothing.
 *    The owner sees the file, its hash, whose identities resolved and which did not, and the
 *    server's own readiness verdict (`applyAvailable`) plus its reason if not ready.
 *  - `POST /debtors/imports/apply` is the only debtor route that writes, and it is owner-only and
 *    confirmation-gated. The panel offers it **only** when the preview's own `applyAvailable` is
 *    `true`, behind an explicit checkbox that starts unticked on every reading, and re-sends the
 *    same bytes with their SHA-256 and the `applyPreviewDigest` the server issued. The backend
 *    remains the authority: it re-reads, re-resolves identity against the current mappings, and
 *    refuses a whole file whose plan no longer matches — a preview is never treated as a confirmation.
 *
 *  The apply is all-or-nothing and this screen reflects that: an unresolved row, a blocker or a
 *  missing verified balance date refuses the *entire* file, and there is no partial import and no
 *  per-row approve to click. Overwriting a stored figure is a *second*, separate approval
 *  (`allowReplacement`) the owner takes only after seeing that specific refusal, never inferred.
 *
 *  The list read is open to employees too, scoped by the server to their own parties. The preview
 *  and apply are owner-only, so their card is rendered for an owner session and not for anyone
 *  else — and the server refuses both before reading a byte, so hiding the control is not what
 *  enforces it.
 *
 *  Since Round 10 an owner also sees `ProvisionalDebtorSync`, a separate card on a separate pair
 *  of routes. It uploads the original workbook, keeps every record labelled PROVISIONAL — NOT
 *  VERIFIED TALLY IDENTITIES, and syncs only the isolated `debtor_provisional_*` tables. It shares
 *  no control with the verified preview/apply above it: a temporary `TMP-DL-…` identity cannot
 *  reach the verified apply, and nothing on this page imports the workbook as a verified ledger.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileSearch, ShieldAlert, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { rupees } from '../lib/format';
import { useLiveList } from '../lib/useLiveList';
import { useLiveSession } from '../lib/liveSession';
import { invalidate, syncKeys, useSyncToken } from '../lib/syncStore';
import {
  applyDebtorWorkbook,
  listDebtors,
  previewDebtorWorkbook,
  createDebtor,
  updateDebtor,
  deleteDebtor,
  syncHrPbTargets,
  listEmployees,
  serverHost,
  ServerError,
  type ServerDebtor,
  type ServerDebtorApply,
  type ServerDebtorPreview,
  type ServerDebtorPreviewFinding,
  type ServerDebtorPreviewRow,
} from '../lib/serverApi';
import {
  debtorApplyFailureDetail,
  debtorApplyFailureHeadline,
  debtorApplyOutcomeText,
  debtorEligibility,
  formatFailureFields,
  offersReplacementApproval,
} from '../lib/debtorImport';

const PAGE_SIZE = 20;

function money(paise: number | null): string {
  return paise === null ? '—' : rupees(paise);
}

function DebtorListCard() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [syncingHrPb, setSyncingHrPb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Salespeople for dropdown selection
  const [salespeople, setSalespeople] = useState<string[]>([]);

  // Add Debtor Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCity, setAddCity] = useState('');
  const [addDistrict, setAddDistrict] = useState('');
  const [addSalesperson, setAddSalesperson] = useState('');
  const [addBalance, setAddBalance] = useState('0.00');
  const [addBusy, setAddBusy] = useState(false);

  // Edit Debtor Modal State
  const [editingDebtor, setEditingDebtor] = useState<ServerDebtor | null>(null);
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editDistrict, setEditDistrict] = useState('');
  const [editSalesperson, setEditSalesperson] = useState('');
  const [editBalance, setEditBalance] = useState('0.00');
  const [editBusy, setEditBusy] = useState(false);

  // Delete Debtor State
  const [deletingDebtor, setDeletingDebtor] = useState<ServerDebtor | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listEmployees({ activeOnly: true })
      .then((page) => {
        if (!alive) return;
        const spNames = page.items
          .filter(
            (e) =>
              e.role.toLowerCase().includes('sales') ||
              e.role.toLowerCase().includes('officer') ||
              e.id.includes('SP') ||
              e.department?.toLowerCase() === 'sales',
          )
          .map((e) => e.name);
        setSalespeople(spNames.length > 0 ? spNames : page.items.map((e) => e.name));
      })
      .catch(() => {
        if (!alive) return;
        setSalespeople(['Pankaj Goyal', 'Harpreet Singh', 'Jagdeep Singh', 'Sandeep Mahajan', 'Suresh Jindal']);
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    (folded: string, p: number) =>
      listDebtors({
        q: folded || undefined,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [],
  );

  const refreshToken = useSyncToken(syncKeys.debtors);
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page, refreshToken);

  const spOptions = useMemo(() => {
    const set = new Set<string>(salespeople);
    for (const r of rows) {
      if (r.salesperson && r.salesperson !== 'Unassigned') {
        set.add(r.salesperson);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [salespeople, rows]);

  const handle1ClickSync = async () => {
    setSyncingHrPb(true);
    setSyncMessage(null);
    try {
      const res = await syncHrPbTargets();
      setSyncMessage(res.message || 'HR-PB targets synced successfully!');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setSyncMessage(errObj?.message || 'Failed to sync HR-PB');
    } finally {
      setSyncingHrPb(false);
    }
  };

  const handleCreateDebtor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    setAddBusy(true);
    try {
      await createDebtor({
        name: addName.trim(),
        city: addCity.trim(),
        district: addDistrict.trim(),
        salesperson: addSalesperson.trim() || 'Unassigned',
        balance: parseFloat(addBalance) || 0.0,
      });
      setShowAddModal(false);
      setAddName('');
      setAddCity('');
      setAddDistrict('');
      setAddSalesperson('');
      setAddBalance('0.00');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      alert(errObj?.message || 'Failed to create debtor');
    } finally {
      setAddBusy(false);
    }
  };

  const handleOpenEdit = (debtor: ServerDebtor) => {
    setEditingDebtor(debtor);
    setEditName(debtor.name || debtor.customerName || '');
    setEditCity(debtor.city || '');
    setEditDistrict(debtor.district || '');
    setEditSalesperson(debtor.salesperson || '');
    setEditBalance(debtor.balance !== undefined ? String(debtor.balance) : '0.00');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDebtor) return;
    const debtorId = editingDebtor.id || editingDebtor.customerId;
    setEditBusy(true);
    try {
      await updateDebtor(debtorId, {
        name: editName.trim(),
        city: editCity.trim(),
        district: editDistrict.trim(),
        salesperson: editSalesperson.trim(),
        balance: parseFloat(editBalance) || 0.0,
      });
      setEditingDebtor(null);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      alert(errObj?.message || 'Failed to update debtor');
    } finally {
      setEditBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingDebtor) return;
    const debtorId = deletingDebtor.id || deletingDebtor.customerId;
    setDeleteBusy(true);
    try {
      await deleteDebtor(debtorId);
      setDeletingDebtor(null);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      alert(errObj?.message || 'Failed to delete debtor');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Card>
      {/* 1-Click Sync Banner */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-blue/30 bg-brand-blue/5 p-3">
        <div>
          <p className="text-[12px] font-bold text-ink">OneDrive 1-Click Sync: HR-PB.xlsx</p>
          <p className="text-[11px] text-muted">
            Pull all 137+ Punjab & Haryana dealer names from HR-PB into Debtors Master with initial ₹0 balance.
          </p>
          {syncMessage && (
            <p className="mt-1 text-[11px] font-bold text-brand-green">{syncMessage}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handle1ClickSync}
            disabled={syncingHrPb}
            className="btn-secondary !py-1.5 text-xs font-bold"
          >
            <RefreshCw size={13} className={syncingHrPb ? 'animate-spin' : ''} />
            {syncingHrPb ? 'Syncing...' : '1-Click Sync HR-PB'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!addSalesperson && spOptions.length > 0) {
                setAddSalesperson(spOptions[0]);
              }
              setShowAddModal(true);
            }}
            className="btn-primary !py-1.5 text-xs font-bold"
          >
            <Plus size={13} /> Add Debtor
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black text-ink">Debtor Master</h2>
          <p className="text-[11px] text-muted">
            Dealers and parties with balance, station, salesperson, and live Edit / Delete controls.
          </p>
        </div>
        <input
          className="input !w-auto !py-2"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setPage(1);
          }}
          placeholder="Search by party or station…"
        />
      </div>
      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      {state === 'loading' && <p className="text-xs text-faint">Loading debtor balances…</p>}
      {state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && rows.length === 0 && (
        <EmptyState
          title={term ? 'No party matches that search' : 'No debtors found'}
          hint="Click 1-Click Sync HR-PB above to import all dealers from HR-PB.xlsx automatically."
        />
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-field border border-line">
            <table className="w-full min-w-[700px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-line bg-canvas/40">
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Party Name</th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Station / City</th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Salesperson</th>
                  <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">Balance</th>
                  <th className="px-3 py-2 text-center text-[10px] font-extrabold uppercase tracking-wide text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const partyTitle = row.name || row.customerName || '—';
                  const cityStation = row.city || row.district || row.state || '—';
                  const sp = row.salesperson || 'Unassigned';
                  const bal = row.balance !== undefined ? `₹${parseFloat(String(row.balance)).toFixed(2)}` : money(row.debitPaise);
                  return (
                    <tr key={row.id || row.customerId} className="border-b border-line/60 last:border-b-0 hover:bg-canvas/50">
                      <td className="px-3 py-2 align-middle">
                        <span className="font-bold text-ink">{partyTitle}</span>
                        <span className="ml-2 text-[10px] text-faint">{row.id || row.customerId}</span>
                      </td>
                      <td className="px-3 py-2 align-middle text-muted">{cityStation}</td>
                      <td className="px-3 py-2 align-middle font-medium text-ink">{sp}</td>
                      <td className="px-3 py-2 text-right align-middle font-semibold tabular-nums text-ink">
                        <span className="rounded bg-canvas px-2 py-0.5 border border-line font-mono text-[11px]">
                          {bal}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(row)}
                            className="rounded p-1 text-muted hover:bg-line hover:text-ink"
                            title="Edit Debtor"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingDebtor(row)}
                            className="rounded p-1 text-muted hover:bg-brand-red/10 hover:text-brand-red"
                            title="Delete Debtor"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      {/* Add Debtor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-line">
            <h3 className="text-sm font-bold text-ink">Add New Debtor</h3>
            <form onSubmit={handleCreateDebtor} className="mt-3 space-y-3">
              <div>
                <label className="text-[11px] font-bold text-muted">Party Name *</label>
                <input
                  required
                  className="input mt-1 w-full"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Guru Kirpa Industry"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-muted">Station / City</label>
                  <input
                    className="input mt-1 w-full"
                    value={addCity}
                    onChange={(e) => setAddCity(e.target.value)}
                    placeholder="e.g. Barnala"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted">District</label>
                  <input
                    className="input mt-1 w-full"
                    value={addDistrict}
                    onChange={(e) => setAddDistrict(e.target.value)}
                    placeholder="e.g. Barnala"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-muted">Salesperson *</label>
                  <select
                    required
                    className="input mt-1 w-full font-semibold text-ink"
                    value={addSalesperson}
                    onChange={(e) => setAddSalesperson(e.target.value)}
                  >
                    <option value="">Select Salesperson…</option>
                    {spOptions.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted">Initial Balance (₹)</label>
                  <input
                    className="input mt-1 w-full"
                    value={addBalance}
                    onChange={(e) => setAddBalance(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateDebtor}
                  disabled={addBusy}
                  className="btn-primary text-xs font-bold"
                >
                  {addBusy ? 'Saving...' : 'Create Debtor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Debtor Modal */}
      {editingDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-line">
            <h3 className="text-sm font-bold text-ink">Edit Debtor: {editingDebtor.name || editingDebtor.customerName}</h3>
            <form onSubmit={handleSaveEdit} className="mt-3 space-y-3">
              <div>
                <label className="text-[11px] font-bold text-muted">Party Name *</label>
                <input
                  required
                  className="input mt-1 w-full"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-muted">Station / City</label>
                  <input
                    className="input mt-1 w-full"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted">District</label>
                  <input
                    className="input mt-1 w-full"
                    value={editDistrict}
                    onChange={(e) => setEditDistrict(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-muted">Salesperson *</label>
                  <select
                    required
                    className="input mt-1 w-full font-semibold text-ink"
                    value={editSalesperson}
                    onChange={(e) => setEditSalesperson(e.target.value)}
                  >
                    <option value="">Select Salesperson…</option>
                    {spOptions.map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted">Balance (₹)</label>
                  <input
                    className="input mt-1 w-full"
                    value={editBalance}
                    onChange={(e) => setEditBalance(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingDebtor(null)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={editBusy}
                  className="btn-primary text-xs font-bold"
                >
                  {editBusy ? 'Saving...' : 'Update Debtor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl border border-line">
            <h3 className="text-sm font-bold text-ink">Delete Debtor?</h3>
            <p className="mt-1 text-xs text-muted">
              Are you sure you want to delete <span className="font-bold text-ink">{deletingDebtor.name || deletingDebtor.customerName}</span>? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingDebtor(null)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteBusy}
                className="rounded-field bg-brand-red px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-red/90"
              >
                {deleteBusy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── owner-only, read-only workbook preview ───────────────────────────────

type PreviewPhase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'uploading'; label: string; bytes: number }
  | { kind: 'done'; preview: ServerDebtorPreview; bytes: Uint8Array; label: string }
  | { kind: 'failed'; code: string; message: string; details: string[] };

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'applied'; outcome: ServerDebtorApply }
  | { kind: 'failed'; code: string; message: string; details: string[] };

const shortDigest = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 16)}…`);

const VERDICT_TONE: Record<string, string> = {
  resolved: 'bg-brand-green/12 text-brand-green',
  missing: 'bg-brand-orange/15 text-[#C96B15]',
  ambiguous: 'bg-brand-purple/12 text-brand-purple',
  invalid: 'bg-brand-red/10 text-brand-red',
};

function Verdict({ value }: { value: string }) {
  return <span className={`chip ${VERDICT_TONE[value] ?? 'bg-line text-muted'}`}>{value}</span>;
}

function FindingList({
  title,
  findings,
  empty,
}: {
  title: string;
  findings: ServerDebtorPreviewFinding[];
  empty: string;
}) {
  return (
    <div className="mt-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
        {title} ({findings.length})
      </p>
      {findings.length === 0 ? (
        <p className="mt-1 text-[11px] text-faint">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/50 rounded-field border border-line bg-white">
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${index}`} className="flex flex-wrap items-baseline gap-2 px-3 py-1.5 text-[11px]">
              <span className="chip bg-brand-orange/15 text-[#C96B15]">{finding.code}</span>
              <span className="text-ink">{finding.message}</span>
              {finding.rowNumber !== null && <span className="text-faint">row {finding.rowNumber}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CountTile({ label, value, tone = 'text-ink' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-field border border-line bg-white px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-[18px] font-black tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function ColumnLine({ label, value }: { label: string; value: string | null }) {
  return (
    <span>
      <span className="text-muted">{label} </span>
      <span className={value === null ? 'font-bold text-brand-red' : 'font-bold text-ink'}>
        {value ?? 'not found'}
      </span>
    </span>
  );
}

function PreviewRowLine({ row }: { row: ServerDebtorPreviewRow }) {
  return (
    <tr className="border-b border-line/60 last:border-b-0">
      <td className="px-3 py-2 align-top text-[10px] tabular-nums text-faint">{row.rowNumber}</td>
      <td className="px-3 py-2 align-top">
        <span className="font-bold text-ink">{row.partyName || <span className="italic text-faint">no party name</span>}</span>
        <span className="ml-2 font-mono text-[10px] text-faint">{row.sourceRef ?? 'no stable reference'}</span>
      </td>
      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{money(row.debitPaise)}</td>
      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{money(row.creditPaise)}</td>
      <td className="px-3 py-2 align-top">
        <Verdict value={row.verdict} />
        {row.reason !== null && <span className="ml-1.5 text-[10px] text-muted">{row.reason}</span>}
        {row.customerName !== null && (
          <span className="mt-0.5 block text-[10px] text-muted">matched {row.customerName}</span>
        )}
        {row.candidateIds.length > 0 && (
          <span className="mt-0.5 block text-[10px] text-brand-purple">
            candidates: {row.candidateIds.join(', ')}
          </span>
        )}
        {row.issues.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {row.issues.map((issue) => (
              <span key={issue} className="chip bg-brand-red/10 text-brand-red">
                {issue}
              </span>
            ))}
          </span>
        )}
      </td>
    </tr>
  );
}

function PreviewReceipt({ preview }: { preview: ServerDebtorPreview }) {
  const unresolved = preview.rows.filter((row) => row.verdict !== 'resolved');
  const eligibility = debtorEligibility(preview);
  return (
    <div>
      <div className="mb-3 rounded-field border border-line bg-white p-3">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-black text-ink">
          <FileSearch size={16} /> {preview.filename}
          <span className="chip bg-brand-orange/15 text-[#C96B15]">read-only preview</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
          <span>
            SHA-256 <span className="break-all font-mono text-ink">{preview.fileSha256}</span>
          </span>
          <span>{preview.sizeBytes} bytes</span>
          <span>
            sheet <span className="font-bold text-ink">{preview.sheetName}</span> of{' '}
            {preview.sheetNames.length}
          </span>
          <span>source {preview.source}</span>
          <span title="Which namespace's mapping resolved the references: tally, durasmart (a mint), or none — no single answer.">
            reference issuer {preview.refSource ?? 'no single namespace'}
          </span>
          <span>
            import timestamp <span className="font-bold text-brand-orange">none</span> — this reading
            stored no rows, so no import exists to be timed
          </span>
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
          <span>header row {preview.headerRowNumber ?? 'not found'}</span>
          <ColumnLine label="party column" value={preview.partyColumnLabel} />
          <ColumnLine label="ledger id column" value={preview.ledgerIdColumnLabel} />
          <ColumnLine label="debit column" value={preview.debitColumnLabel} />
          <ColumnLine label="credit column" value={preview.creditColumnLabel} />
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="font-extrabold uppercase tracking-wide text-muted">Balance as on</span>
          <span className={`font-black ${preview.asOf === null ? 'text-brand-red' : 'text-ink'}`}>
            {preview.asOf ?? 'not stated'}
          </span>
          <span className={`chip ${preview.asOfVerified ? 'bg-brand-green/12 text-brand-green' : 'bg-brand-red/10 text-brand-red'}`}>
            {preview.asOfVerified ? 'explicitly verified' : 'not verified'}
          </span>
          {preview.asOfSource !== null && <span className="text-faint">{preview.asOfSource}</span>}
        </p>
        {preview.periodText !== null && (
          <p className="mt-1 text-[10px] text-muted">
            Reporting period on the sheet: “{preview.periodText}”. A period end is not a balance date,
            and this reading never treats it as one.
          </p>
        )}
        <p
          className={`mt-2 rounded-field border px-3 py-2 text-[10px] font-bold ${
            eligibility.eligible
              ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
              : 'border-brand-orange/40 bg-brand-orange/10 text-[#8A4A0B]'
          }`}
        >
          The backend marks this file {eligibility.eligible ? 'eligible to apply' : 'not eligible to apply'}
          {' '}— applyAvailable {String(preview.applyAvailable)}; it also wrote nothing itself
          (businessRecordsCreated {String(preview.businessRecordsCreated)}, databaseRowsWritten{' '}
          {String(preview.databaseRowsWritten)}).
          {!eligibility.eligible && eligibility.blockedReason !== '' && (
            <> Reason: {eligibility.blockedReason}</>
          )}
        </p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CountTile label="Data rows" value={preview.dataRowCount} />
        <CountTile label="Resolved" value={preview.resolvedRowCount} tone="text-brand-green" />
        <CountTile label="Missing" value={preview.missingRowCount} tone="text-[#C96B15]" />
        <CountTile label="Ambiguous" value={preview.ambiguousRowCount} tone="text-brand-purple" />
        <CountTile label="Invalid" value={preview.invalidRowCount} tone="text-brand-red" />
        <CountTile label="Unresolved" value={preview.unresolvedRowCount} tone="text-brand-red" />
        <CountTile label="Zero-balance rows" value={preview.zeroBalanceRowCount} />
        <CountTile label="Totals excluded" value={preview.totalRowCount} />
      </div>

      <FindingList title="Blockers" findings={preview.blockers} empty="No blockers were reported." />
      <FindingList title="Warnings" findings={preview.warnings} empty="No warnings were reported." />

      <div className="mt-3">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
          Unresolved identities in the listed rows ({unresolved.length})
        </p>
        <p className="mt-0.5 text-[10px] text-muted">
          A row with no stable reference, an unmapped reference or more than one match is listed here
          and would be quarantined, not guessed from its name. Nothing on this screen merges parties.
        </p>
        {unresolved.length === 0 ? (
          <p className="mt-1 text-[11px] text-faint">Every listed row resolved through its own reference.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {unresolved.map((row) => (
              <li key={row.rowNumber} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-faint">row {row.rowNumber}</span>
                <span className="font-bold text-ink">{row.partyName || 'no party name'}</span>
                <span className="font-mono text-[10px] text-faint">{row.sourceRef ?? 'no reference'}</span>
                <Verdict value={row.verdict} />
                {row.reason !== null && <span className="text-muted">{row.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview.rows.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-muted">
            Rows read ({preview.rowsListed} listed
            {preview.rowsTruncated ? ` of ${preview.dataRowCount} — the list is capped, the counts are not` : ''})
          </p>
          <div className="overflow-x-auto rounded-field border border-line bg-white">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-line bg-canvas/40">
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Row</th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Party on the sheet</th>
                  <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">Debit</th>
                  <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">Credit</th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Identity</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <PreviewRowLine key={row.rowNumber} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <span>
              blank rows {preview.blankRowCount} · total rows excluded {preview.totalRowCount} · rows
              listed {preview.rowsListed}
            </span>
            <span className="font-bold text-brand-blue">
              {eligibility.eligible
                ? 'The backend marks this whole file eligible — the apply control below imports it entire, never row by row.'
                : `An apply would refuse this entire file (${eligibility.reviewCount} row(s) need review); there is no partial import and no per-row approve to click.`}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

/** The one control in this panel that writes a debtor balance.
 *
 *  It renders only after a reading whose eligibility the *server* decided (`applyAvailable`), and
 *  even then the Apply button stays disabled until the owner ticks an explicit confirmation that
 *  starts unticked on every reading. Overwriting a stored figure is not part of that first yes: a
 *  replacement refusal surfaces a *second*, separate checkbox, ticked only after the owner has read
 *  this file's specific refusal — never pre-checked and never inferred from the first. */
function DebtorApplyBlock({
  preview,
  confirmed,
  onConfirmed,
  applyState,
  replacementApproved,
  onReplacementApproved,
  onApply,
}: {
  preview: ServerDebtorPreview;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  applyState: ApplyState;
  replacementApproved: boolean;
  onReplacementApproved: (value: boolean) => void;
  onApply: (withReplacement: boolean) => void;
}) {
  const eligibility = debtorEligibility(preview);
  const ready = eligibility.eligible;
  const applied = applyState.kind === 'applied';

  return (
    <div
      className={`mt-3 rounded-field border-2 p-3 ${
        ready ? 'border-brand-green/40 bg-brand-green/5' : 'border-brand-orange/40 bg-brand-orange/5'
      }`}
    >
      <p className="flex flex-wrap items-center gap-2 text-[12px] font-black text-ink">
        Apply plan{' '}
        <span className={`chip ${ready ? 'bg-brand-green/12 text-brand-green' : 'bg-brand-orange/15 text-[#C96B15]'}`}>
          {ready ? 'the backend says this file can be applied' : 'blocked by the backend'}
        </span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
        <span>
          this file <span className="font-mono text-ink">{shortDigest(preview.fileSha256)}</span>
        </span>
        <span>
          plan digest <span className="font-mono text-ink">{shortDigest(preview.applyPreviewDigest)}</span>
        </span>
        <span>{preview.resolvedRowCount} resolved balance row(s) would be stored</span>
        <span>{preview.unresolvedRowCount} unresolved</span>
      </p>

      {!ready && (
        <p className="mt-2 text-[10px] font-bold text-[#C96B15]">
          No apply is offered for this reading — the entire file is refused, not part of it. Clear the
          blockers and unresolved rows, then preview again.
          {eligibility.blockedReason !== '' && <> The backend's reason: {eligibility.blockedReason}</>}
        </p>
      )}

      {ready && !applied && (
        <div className="mt-3 rounded-field border border-line bg-white p-3">
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={confirmed}
              disabled={applyState.kind === 'applying'}
              onChange={(event) => onConfirmed(event.target.checked)}
            />
            <span>
              I have read this preview and confirm applying{' '}
              <span className="font-black">{preview.resolvedRowCount} balance row(s)</span> from{' '}
              <span className="font-bold">{preview.filename}</span> (SHA-256{' '}
              <span className="font-mono">{shortDigest(preview.fileSha256)}</span>) as of{' '}
              <span className="font-bold">{preview.asOf}</span>. I understand this stores dated balance
              snapshots only — it creates no customer, ledger mapping, order or stock movement, and
              debit and credit stay separate rows.
            </span>
          </label>
          <button
            type="button"
            className="btn-primary btn-sm mt-2"
            disabled={!confirmed || applyState.kind === 'applying'}
            onClick={() => onApply(false)}
          >
            {applyState.kind === 'applying' ? 'Applying…' : `Apply ${preview.resolvedRowCount} balance rows`}
          </button>
        </div>
      )}

      {applyState.kind === 'applying' && (
        <div className="mt-2">
          <Spinner label="The backend is re-reading the workbook, re-resolving every identity against the current mappings and writing the snapshots in one transaction…" />
        </div>
      )}

      {applyState.kind === 'failed' && (
        <div className="mt-3 rounded-field border border-brand-red/30 bg-white p-3">
          <p className="flex items-center gap-2 text-[11px] font-black text-brand-red">
            <ShieldAlert size={14} /> {debtorApplyFailureHeadline(applyState.code)}
          </p>
          <p className="mt-1 text-[11px] text-ink">{applyState.message}</p>
          <p className="mt-1 text-[10px] text-muted">{debtorApplyFailureDetail(applyState.code)}</p>
          {applyState.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10px] text-muted">
              {applyState.details.map((detail) => (
                <li key={detail}>· {detail}</li>
              ))}
            </ul>
          )}

          {offersReplacementApproval(applyState.code) && !applied && (
            <div className="mt-3 rounded-field border border-brand-orange/40 bg-brand-orange/5 p-3">
              <label className="flex cursor-pointer items-start gap-2 text-[11px] text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={replacementApproved}
                  onChange={(event) => onReplacementApproved(event.target.checked)}
                />
                <span>
                  I approve replacing the stored figure(s) named above with the different values in
                  this file. This is a second, separate decision from importing the file and it
                  overwrites balances that already exist.
                </span>
              </label>
              <button
                type="button"
                className="btn-primary btn-sm mt-2"
                disabled={!replacementApproved}
                onClick={() => onApply(true)}
              >
                Approve replacement &amp; apply
              </button>
            </div>
          )}
        </div>
      )}

      {applied && (
        <div className="mt-3 rounded-field border border-brand-green/30 bg-white p-3">
          <p className="flex items-center gap-2 text-[11px] font-black text-brand-green">
            <CheckCircle2 size={14} /> {debtorApplyOutcomeText(applyState.outcome).title}
          </p>
          <p className="mt-1 text-[11px] text-ink">{debtorApplyOutcomeText(applyState.outcome).detail}</p>
          <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted">
            <span>{applyState.outcome.snapshotRowCount} planned</span>
            <span>{applyState.outcome.createdRowCount} stored</span>
            <span>{applyState.outcome.unchangedRowCount} unchanged</span>
            <span>{applyState.outcome.replacedRowCount} replaced</span>
            <span>database rows written {String(applyState.outcome.databaseRowsWritten)}</span>
            <span>business records created {String(applyState.outcome.businessRecordsCreated)}</span>
          </p>
          <p className="mt-1 text-[10px] text-muted">{applyState.outcome.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function DebtorWorkbookPreview() {
  const [phase, setPhase] = useState<PreviewPhase>({ kind: 'idle' });
  const [fileName, setFileName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [replacementApproved, setReplacementApproved] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (file: File) => {
    // Every new reading resets the two yeses: the apply confirmation and the replacement approval
    // start unticked, and a stale confirmation can never be carried onto a different file.
    setConfirmed(false);
    setReplacementApproved(false);
    setApplyState({ kind: 'idle' });
    setPhase({ kind: 'reading' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setPhase({ kind: 'uploading', label: file.name, bytes: bytes.byteLength });
      const preview = await previewDebtorWorkbook(bytes, file.name);
      setPhase({ kind: 'done', preview, bytes, label: file.name });
    } catch (error) {
      if (error instanceof ServerError) {
        setPhase({
          kind: 'failed',
          code: error.code,
          message: error.status === 0 ? error.message : `${error.status} · ${error.code} — ${error.message}`,
          details: Object.entries(error.fields ?? {}).map(([field, reason]) => `${field}: ${reason}`),
        });
      } else {
        setPhase({
          kind: 'failed',
          code: 'upload_interrupted',
          message:
            'The workbook never reached the backend: this browser could not read the file, or the upload was interrupted.',
          details: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }, []);

  const apply = useCallback(
    async (withReplacement: boolean) => {
      // The apply re-checks every gate the button already reflects, so a stray call cannot slip past
      // an ineligible preview, an unticked confirmation, or an unticked replacement approval.
      if (phase.kind !== 'done') return;
      if (!debtorEligibility(phase.preview).eligible) return;
      if (!confirmed) return;
      if (withReplacement && !replacementApproved) return;
      setApplyState({ kind: 'applying' });
      try {
        const outcome = await applyDebtorWorkbook(phase.bytes, {
          fileName: phase.label,
          fileSha256: phase.preview.fileSha256,
          previewDigest: phase.preview.applyPreviewDigest,
          allowReplacement: withReplacement,
        });
        setApplyState({ kind: 'applied', outcome });
        // The apply is the one debtor write. Bumping the key re-reads the stored list so a freshly
        // applied balance shows without the owner turning the page. A replay bumps it too — the read
        // is still the server's current answer, not a row the panel assumes.
        invalidate(syncKeys.debtors);
      } catch (error) {
        if (error instanceof ServerError) {
          setApplyState({
            kind: 'failed',
            code: error.code,
            message:
              error.status === 0 ? error.message : `${error.status} · ${error.code} — ${error.message}`,
            details: formatFailureFields(error.fields),
          });
        } else {
          setApplyState({
            kind: 'failed',
            code: 'network',
            message: 'The apply request did not reach the backend or never completed.',
            details: [error instanceof Error ? error.message : String(error)],
          });
        }
      }
    },
    [phase, confirmed, replacementApproved],
  );

  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-black text-ink">Debtor workbook preview</h2>
          <p className="text-[11px] text-muted">
            Owner only. Reads one uploaded workbook and reports what an import would need; the reading
            itself never writes. An apply is the separate, confirmed action below, offered only when the
            backend marks the whole file eligible.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setFileName(file.name);
            void run(file);
          }}
        />
        <button type="button" className="btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
          <FileSearch size={15} /> Choose workbook
        </button>
      </div>

      {fileName !== '' && (
        <p className="mb-3 text-[11px] font-bold text-ink">
          {fileName}
          {phase.kind === 'uploading' && (
            <span className="font-normal text-muted"> · {(phase.bytes / 1024).toFixed(1)} kB read in this browser</span>
          )}
          {phase.kind === 'done' && (
            <span className="font-normal text-muted"> · {phase.preview.sizeBytes} bytes the backend counted</span>
          )}
        </p>
      )}

      {phase.kind === 'idle' && (
        <EmptyState
          title="No debtor workbook read yet"
          hint="Choose an .xlsx. The backend looks for stable ledger identifiers and an explicitly stated balance date, resolves each reference against the saved customer mapping, and reports unresolved rows. Reading imports nothing and changes nothing — an apply is a separate confirmed step, and only appears if the backend marks the whole file eligible."
        />
      )}
      {phase.kind === 'reading' && <Spinner label="Reading the file in this browser…" />}
      {phase.kind === 'uploading' && (
        <Spinner label={`Reading ${phase.label} on the backend — the upload limits and parse budget are the stock import's own.`} />
      )}
      {phase.kind === 'failed' && (
        <div className="rounded-field border border-brand-red/30 bg-white p-3">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-black text-brand-red">
            <ShieldAlert size={16} /> This reading did not happen
          </p>
          <p className="mt-1 text-[11px] text-ink">{phase.message}</p>
          <p className="mt-1 text-[10px] text-muted">
            Code <span className="font-bold">{phase.code}</span>. No rows, counts or balances appear
            below it, because the backend produced none. Nothing was written either way.
          </p>
          {phase.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-muted">
              {phase.details.map((detail) => (
                <li key={detail}>· {detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {phase.kind === 'done' && (
        <>
          <PreviewReceipt preview={phase.preview} />
          <DebtorApplyBlock
            preview={phase.preview}
            confirmed={confirmed}
            onConfirmed={setConfirmed}
            applyState={applyState}
            replacementApproved={replacementApproved}
            onReplacementApproved={setReplacementApproved}
            onApply={(withReplacement) => void apply(withReplacement)}
          />
        </>
      )}
    </Card>
  );
}

export default function Debtors() {
  const user = useLiveSession((state) => state.user);
  return (
    <div>
      <PageHeader
        title="Debtor List"
        subtitle={`Imported closing balances on ${serverHost()} — dated snapshots, debit and credit separate`}
      />

      <DebtorListCard />
      {user?.role === 'owner' && <DebtorWorkbookPreview />}
    </div>
  );
}
