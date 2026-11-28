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

import { useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { toast } from '../lib/toast';
import {
  CheckCircle2,
  FileSearch,
  ShieldAlert,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  FileText,
  X,
  Printer,
  MessageCircle,
  Download,
  Phone,
  GitMerge,
  ArrowRightLeft,
  Edit2,
  Upload,
  AlertTriangle,
  Users,
  Store,
  Calendar,
  ArrowUpDown,
  ChevronRight,
} from 'lucide-react';
import { Card, EmptyState, KpiCard, PageHeader, Spinner } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { rupees, rupeesDrCr, formatRupeesDrCr } from '../lib/format';
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
  syncAccountingBooks,
  listVouchers,
  updateVoucher,
  deleteVoucher,
  transferVoucher,
  addJournalEntry,
  mergeDebtors,
  updateOpeningBalance,
  uploadOpeningBalances,
  resetAccountingBalances,
  syncDebtorBenchmarks,
  uploadDebtorBenchmarks,
  cleanupDuplicateVouchers,
  previewDuplicateVouchers,
  type DuplicatePreviewResponse,
  uploadPartyLedger,
  listEmployees,
  serverHost,
  ServerError,
  type ServerDebtor,
  type ServerDebtorApply,
  type ServerDebtorPreview,
  type ServerDebtorPreviewFinding,
  type ServerDebtorPreviewRow,
  type ServerVoucher,
} from '../lib/serverApi';
import { generateStatementPdf, type StatementPdfData } from '../lib/statementPdf';
import {
  debtorApplyFailureDetail,
  debtorApplyFailureHeadline,
  debtorApplyOutcomeText,
  debtorEligibility,
  formatFailureFields,
  offersReplacementApproval,
} from '../lib/debtorImport';

const PAGE_SIZE = 20;

function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || isNaN(paise)) return '—';
  return rupees(paise);
}

function parseVoucherDate(str: string): Date {
  if (!str) return new Date();
  const clean = str.trim().replace(/[./]/g, '-');
  const parts = clean.split('-');
  if (parts.length === 3) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    // ISO YYYY-MM-DD
    if (parts[0].length === 4) {
      const year = parseInt(parts[0], 10);
      const m = parts[1].toLowerCase();
      const month = months[m] !== undefined ? months[m] : (parseInt(parts[1], 10) - 1 || 0);
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
    // DD-MM-YYYY or DD-Mon-YY
    const day = parseInt(parts[0], 10);
    const m = parts[1].toLowerCase();
    const month = months[m] !== undefined ? months[m] : (parseInt(parts[1], 10) - 1 || 0);
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? new Date() : d;
}

function DuplicateReviewModal({
  partyId,
  partyName,
  onClose,
  onSuccess,
}: {
  partyId?: string;
  partyName?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DuplicatePreviewResponse | null>(null);
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    previewDuplicateVouchers(partyId)
      .then((res) => {
        if (!active) return;
        setPreview(res);
        const allDupeIds = new Set<string>();
        res.groups.forEach((g) => {
          g.duplicates.forEach((d) => allDupeIds.add(d.id));
        });
        setSelectedVoucherIds(allDupeIds);
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err.message || 'Failed to preview duplicate vouchers');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [partyId]);

  const toggleVoucher = (id: string) => {
    setSelectedVoucherIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!preview) return;
    const allDupeIds = new Set<string>();
    preview.groups.forEach((g) => {
      g.duplicates.forEach((d) => allDupeIds.add(d.id));
    });
    setSelectedVoucherIds(allDupeIds);
  };

  const handleDeselectAll = () => {
    setSelectedVoucherIds(new Set());
  };

  const handleApproveDelete = async () => {
    if (selectedVoucherIds.size === 0) {
      alert('Please select at least one duplicate voucher to delete.');
      return;
    }
    const confirmMsg = `Are you sure you want to delete ${selectedVoucherIds.size} approved duplicate voucher(s)?\n\nThis will keep the original vouchers intact and safely recompute party balances.`;
    if (!window.confirm(confirmMsg)) return;

    setDeleting(true);
    try {
      const res = await cleanupDuplicateVouchers(Array.from(selectedVoucherIds), partyId);
      alert(res.message || `Cleaned up ${res.deletedCount} duplicate vouchers safely!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to delete duplicate vouchers');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex flex-col w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-line overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-slate-50/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                <Trash2 size={18} />
              </span>
              <h3 className="text-base font-bold text-ink">
                Duplicate Voucher Review & Safe Approval
              </h3>
            </div>
            <p className="text-xs text-muted mt-0.5">
              {partyName ? `Reviewing duplicates for ${partyName}` : 'Database-wide scan across all debtors'}
              {' · '}
              <span className="text-slate-600 font-medium">
                Tally Guardrail: Legitimate repeated entries verified by Tally closing balance are strictly protected.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:text-ink hover:bg-slate-200 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted">
              <RefreshCw size={24} className="animate-spin text-amber-600" />
              <p className="text-xs font-medium">Scanning for duplicate vouchers with identical date, number & amount...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
              <div className="flex items-center gap-2 font-bold mb-1">
                <AlertTriangle size={16} /> Error scanning duplicates
              </div>
              <p>{error}</p>
            </div>
          ) : !preview || preview.totalCandidateDuplicates === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="text-sm font-bold text-ink mb-1">No Duplicate Vouchers Found</h4>
              <p className="text-xs text-muted max-w-md">
                Every transaction in the database is verified. Multiple vouchers sharing the same voucher reference have distinct amounts (e.g. split journal entries) and are strictly preserved.
              </p>
            </div>
          ) : (
            <>
              {/* Alert notice */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    Found {preview.totalCandidateDuplicates} candidate duplicate(s) across {preview.totalGroups} group(s).
                  </div>
                  <p className="mt-1 text-amber-800">
                    Candidate duplicate entries have <strong>identical Date, Voucher Type, Voucher No, AND Amount</strong>.
                    Original entries are safely preserved (marked in green). Review and approve the duplicate copies below before deletion.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="rounded bg-amber-100 hover:bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-900 transition"
                    >
                      Select All Duplicates
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="rounded bg-amber-100 hover:bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-900 transition"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
              </div>

              {/* Group cards */}
              <div className="space-y-4">
                {preview.groups.map((group, gIdx) => {
                  const amtPaise = group.debitPaise || group.creditPaise || 0;
                  const amtFormatted = money(amtPaise);
                  const isDebit = group.debitPaise > 0;
                  return (
                    <div
                      key={`${group.partyId}-${group.voucherDate}-${group.voucherNo}-${gIdx}`}
                      className="rounded-xl border border-line bg-white shadow-sm overflow-hidden"
                    >
                      {/* Group Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 border-b border-line text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-ink">{group.partyName}</span>
                          <span className="text-muted">·</span>
                          <span className="font-mono text-slate-600">{group.voucherDate}</span>
                          <span className="text-muted">·</span>
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            {group.voucherType} #{group.voucherNo || '-'}
                          </span>
                          {(group as any).verifiedByClosingBalance && (
                            <span className="rounded bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              ✓ Confirmed by Tally Closing Balance
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-ink">
                          Amount: <span className={isDebit ? 'text-blue-700' : 'text-emerald-700'}>₹{amtFormatted} {isDebit ? 'Dr' : 'Cr'}</span>
                        </div>
                      </div>

                      {/* Entries inside group */}
                      <div className="p-3 space-y-2 text-xs">
                        {/* Original Voucher */}
                        <div className="flex items-center justify-between rounded-lg bg-emerald-50/60 border border-emerald-200/60 p-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="rounded bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider">
                              Keep Original
                            </span>
                            <span className="font-mono text-[11px] text-emerald-950 font-semibold">
                              ID: {group.original.id.slice(0, 14)}...
                            </span>
                            {group.original.bookSource && (
                              <span className="rounded bg-white/80 border border-emerald-300 px-1.5 py-0.5 text-[10px] text-emerald-800">
                                {group.original.bookSource}
                              </span>
                            )}
                            <span className="text-slate-600 italic text-[11px]">
                              {group.original.narration || '(No narration)'}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-emerald-800">
                            ₹{amtFormatted}
                          </span>
                        </div>

                        {/* Duplicates to review / delete */}
                        {group.duplicates.map((dupe) => {
                          const isSelected = selectedVoucherIds.has(dupe.id);
                          return (
                            <label
                              key={dupe.id}
                              className={`flex items-center justify-between rounded-lg border p-2.5 cursor-pointer transition ${
                                isSelected
                                  ? 'bg-rose-50/70 border-rose-300'
                                  : 'bg-white border-line hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleVoucher(dupe.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                />
                                <span className={`rounded text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider ${
                                  isSelected ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-700'
                                }`}>
                                  Duplicate Copy
                                </span>
                                <span className="font-mono text-[11px] text-slate-700">
                                  ID: {dupe.id.slice(0, 14)}...
                                </span>
                                {dupe.bookSource && (
                                  <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                                    {dupe.bookSource}
                                  </span>
                                )}
                                <span className="text-slate-600 italic text-[11px]">
                                  {dupe.narration || '(No narration)'}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className={`text-[11px] font-bold ${isSelected ? 'text-rose-700' : 'text-slate-600'}`}>
                                  ₹{amtFormatted}
                                </span>
                                <div className="text-[10px] text-rose-600 font-semibold">
                                  {isSelected ? '✓ Marked for deletion' : 'Unticked (Keep)'}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-6 py-3.5 bg-slate-50">
          <div className="text-xs text-muted">
            {preview && preview.totalCandidateDuplicates > 0 ? (
              <span>
                <strong>{selectedVoucherIds.size}</strong> of {preview.totalCandidateDuplicates} duplicate voucher(s) selected for deletion
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded-lg border border-line bg-white hover:bg-slate-100 px-4 py-2 text-xs font-semibold text-ink transition"
            >
              Cancel / Keep All
            </button>
            {preview && preview.totalCandidateDuplicates > 0 && (
              <button
                type="button"
                onClick={handleApproveDelete}
                disabled={deleting || selectedVoucherIds.size === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" /> Deleting Selected...
                  </>
                ) : (
                  <>
                    <Trash2 size={13} /> Approve & Delete Selected ({selectedVoucherIds.size})
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DebtorLedgerModal({ debtor, onClose }: { debtor: ServerDebtor; onClose: () => void }) {
  const [vouchers, setVouchers] = useState<ServerVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | 'SALES' | 'RECEIPT'>('ALL');

  // Debtor directory for transfer dropdown
  const [debtorDirectory, setDebtorDirectory] = useState<ServerDebtor[]>([]);

  // Journal Entry modal
  const [showJvModal, setShowJvModal] = useState(false);
  const [jvType, setJvType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [jvAmount, setJvAmount] = useState('');
  const [jvRef, setJvRef] = useState('');
  const [jvNotes, setJvNotes] = useState('');
  const [jvBusy, setJvBusy] = useState(false);

  // Edit voucher modal
  const [editingVoucher, setEditingVoucher] = useState<ServerVoucher[] | ServerVoucher | null>(null);
  const curEdit = editingVoucher && !Array.isArray(editingVoucher) ? editingVoucher : null;
  const [editVoucherNo, setEditVoucherNo] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Transfer voucher modal
  const [transferringVoucher, setTransferringVoucher] = useState<ServerVoucher | null>(null);
  const [targetPartyId, setTargetPartyId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  // Edit opening balance
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingBusy, setOpeningBusy] = useState(false);

  // Authoritative party ledger upload state
  const [uploadingLedger, setUploadingLedger] = useState(false);
  const [ledgerUploadMsg, setLedgerUploadMsg] = useState<string | null>(null);

  const debtorId = debtor.id || debtor.customerId;
  const initialOpeningPaise = debtor.openingPaise !== undefined && debtor.openingPaise !== null
    ? debtor.openingPaise
    : (debtor.openingBalance !== undefined ? Math.round(Number(debtor.openingBalance) * 100) : 0);
  const [currentOpeningPaise, setCurrentOpeningPaise] = useState<number>(initialOpeningPaise);

  useEffect(() => {
    const ob = debtor.openingPaise !== undefined && debtor.openingPaise !== null
      ? debtor.openingPaise
      : (debtor.openingBalance !== undefined ? Math.round(Number(debtor.openingBalance) * 100) : 0);
    setCurrentOpeningPaise(ob);
  }, [debtor]);

  // Mobile / WhatsApp number state
  const [currentMobile, setCurrentMobile] = useState<string>(debtor.mobile || '');
  const [editingMobile, setEditingMobile] = useState(false);
  const [mobileInput, setMobileInput] = useState(debtor.mobile || '');
  const [mobileBusy, setMobileBusy] = useState(false);
  const [showPhonePromptForWhatsApp, setShowPhonePromptForWhatsApp] = useState(false);
  const [promptPhoneInput, setPromptPhoneInput] = useState('');
  const [promptPhoneBusy, setPromptPhoneBusy] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    setCurrentMobile(debtor.mobile || '');
    setMobileInput(debtor.mobile || '');
  }, [debtor.mobile]);

  const reloadVouchers = useCallback(() => {
    setLoading(true);
    listVouchers(debtorId)
      .then((items) => {
        setVouchers(items);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [debtorId]);

  useEffect(() => {
    reloadVouchers();
  }, [reloadVouchers]);

  // Client-side deduplication filter: prevents identical or duplicate voucher imports from inflating ledger
  const cleanVnoStr = (vno?: string) => (vno || '').replace(/\(optional\)/gi, '').trim().toLowerCase();
  const isInvoiceVno = (vno?: string) => {
    const c = cleanVnoStr(vno);
    if (!c || c.startsWith('db-') || c.startsWith('hdfc-') || c.startsWith('yes-') || c.startsWith('cash-')) return false;
    if (c.includes('@') || /^(aug|spt|oct|nov|dec|jan|feb|mar|apr|may|jun|jul)\s/i.test(c)) return false;
    return true;
  };

  const uniqueVouchers = useMemo(() => {
    // Sort so specialized vouchers come first, generic Day Book comes last
    const sorted = [...vouchers].sort((a, b) => {
      const aIsGeneric = (a.book_source === 'Day Book') && (!a.voucher_no || a.voucher_no.toLowerCase().startsWith('db-'));
      const bIsGeneric = (b.book_source === 'Day Book') && (!b.voucher_no || b.voucher_no.toLowerCase().startsWith('db-'));
      if (aIsGeneric && !bIsGeneric) return 1;
      if (!aIsGeneric && bIsGeneric) return -1;
      return 0;
    });

    const seenInvoices = new Set<string>();
    const seenGenericMatch = new Set<string>();
    const seenContent = new Set<string>();
    const result: ServerVoucher[] = [];

    for (const v of sorted) {
      const vno = cleanVnoStr(v.voucher_no);
      const vt = (v.voucher_type || '').toLowerCase();

      // Real invoice number: deduplicate exact invoice duplicates
      if (isInvoiceVno(v.voucher_no)) {
        const invKey = `${v.voucher_date}:${vt}:${vno}:${v.debit_paise}:${v.credit_paise}`;
        if (seenInvoices.has(invKey)) continue;
        seenInvoices.add(invKey);
      }

      // Cross-book generic match: if specialized entry exists for same date/type/amount, skip generic Day Book
      const genericKey = `${v.voucher_date}:${vt}:${v.debit_paise}:${v.credit_paise}`;
      const isGenericDb = (v.book_source === 'Day Book') && (!v.voucher_no || v.voucher_no.toLowerCase().startsWith('db-'));
      if (isGenericDb && seenGenericMatch.has(genericKey)) {
        continue;
      }

      // Exact full content match
      const contentKey = `${v.voucher_date}:${vt}:${vno}:${v.debit_paise}:${v.credit_paise}:${v.book_source || ''}:${(v.narration || '').trim().toLowerCase()}`;
      if (seenContent.has(contentKey)) continue;
      seenContent.add(contentKey);

      seenGenericMatch.add(genericKey);
      result.push(v);
    }
    return result;
  }, [vouchers]);

  // Sort chronologically (Oldest first from 1-April-2026 as per Tally standard) and compute running balance
  const chronologicalVouchers = useMemo(() => {
    const list = [...uniqueVouchers].sort((a, b) => {
      const diff = parseVoucherDate(a.voucher_date).getTime() - parseVoucherDate(b.voucher_date).getTime();
      if (diff !== 0) return diff;
      return (a.id || '').localeCompare(b.id || '');
    });

    let running = currentOpeningPaise;
    return list.map((v) => {
      running += (v.debit_paise || 0) - (v.credit_paise || 0);
      return {
        ...v,
        runningBalancePaise: running,
      };
    });
  }, [uniqueVouchers, currentOpeningPaise]);

  const [viewMode, setViewMode] = useState<'detailed' | 'monthly'>('detailed');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // Default 'asc' (Tally 1-Apr-26 chronological start)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Monthly breakdown for Tally-style summary
  const monthlySummary = useMemo(() => {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthBuckets: Record<string, { label: string; yearMonth: string; debits: number; credits: number; count: number }> = {};

    for (const v of chronologicalVouchers) {
      const d = parseVoucherDate(v.voucher_date);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const mName = monthNames[d.getMonth()] || `Month ${d.getMonth() + 1}`;
      if (!monthBuckets[ym]) {
        monthBuckets[ym] = {
          label: `${mName} ${d.getFullYear()}`,
          yearMonth: ym,
          debits: 0,
          credits: 0,
          count: 0,
        };
      }
      monthBuckets[ym].debits += v.debit_paise || 0;
      monthBuckets[ym].credits += v.credit_paise || 0;
      monthBuckets[ym].count += 1;
    }

    const defaultMonths = [
      { ym: '2026-04', label: 'April 2026' },
      { ym: '2026-05', label: 'May 2026' },
      { ym: '2026-06', label: 'June 2026' },
      { ym: '2026-07', label: 'July 2026' },
      { ym: '2026-08', label: 'August 2026' },
      { ym: '2026-09', label: 'September 2026' },
      { ym: '2026-10', label: 'October 2026' },
      { ym: '2026-11', label: 'November 2026' },
    ];

    for (const dm of defaultMonths) {
      if (!monthBuckets[dm.ym]) {
        monthBuckets[dm.ym] = {
          label: dm.label,
          yearMonth: dm.ym,
          debits: 0,
          credits: 0,
          count: 0,
        };
      }
    }

    const sortedYms = Object.keys(monthBuckets).sort();
    let running = currentOpeningPaise;
    return sortedYms.map((ym) => {
      const b = monthBuckets[ym];
      const opening = running;
      running += b.debits - b.credits;
      const closing = running;
      return {
        ...b,
        openingPaise: opening,
        closingPaise: closing,
        netMovementPaise: b.debits - b.credits,
      };
    });
  }, [chronologicalVouchers, currentOpeningPaise]);

  const [showDuplicateReviewModal, setShowDuplicateReviewModal] = useState(false);

  const totalDebits = uniqueVouchers.reduce((sum, v) => sum + (v.debit_paise || 0), 0);
  const totalCredits = uniqueVouchers.reduce((sum, v) => sum + (v.credit_paise || 0), 0);

  const calculatedOutstandingPaise = currentOpeningPaise + totalDebits - totalCredits;
  const currentOutstandingPaise = uniqueVouchers.length > 0 || currentOpeningPaise !== 0
    ? calculatedOutstandingPaise
    : (debtor.balance !== undefined ? Math.round(Number(debtor.balance) * 100) : 0);

  // FIFO Aging Calculation
  const aging = useMemo(() => {
    const buckets = {
      bucket0_30: 0,
      bucket31_60: 0,
      bucket61_90: 0,
      bucket90Plus: 0,
    };

    if (currentOutstandingPaise <= 0) {
      return buckets;
    }

    // Credits pool: all credit vouchers
    let remainingCredits = uniqueVouchers.reduce((sum, v) => sum + (v.credit_paise || 0), 0);

    // 1. Opening balance: debit increases oldest obligation, credit increases remaining credits buffer
    if (currentOpeningPaise > 0) {
      if (remainingCredits >= currentOpeningPaise) {
        remainingCredits -= currentOpeningPaise;
      } else {
        buckets.bucket90Plus += (currentOpeningPaise - remainingCredits);
        remainingCredits = 0;
      }
    } else if (currentOpeningPaise < 0) {
      remainingCredits += Math.abs(currentOpeningPaise);
    }

    // 2. Debit vouchers sorted chronologically oldest first
    const debitVouchers = uniqueVouchers
      .filter((v) => (v.debit_paise || 0) > 0)
      .slice()
      .sort((a, b) => parseVoucherDate(a.voucher_date).getTime() - parseVoucherDate(b.voucher_date).getTime());

    if (debitVouchers.length === 0 && currentOpeningPaise === 0) {
      const balPaise = Math.round(
        (debtor.balance !== undefined ? parseFloat(String(debtor.balance)) : (debtor.debitPaise || 0) / 100) * 100
      );
      if (balPaise > 0) {
        if (debtor.isOverdue) {
          buckets.bucket31_60 = balPaise;
        } else {
          buckets.bucket0_30 = balPaise;
        }
      }
      return buckets;
    }

    const now = Date.now();
    for (const v of debitVouchers) {
      const billAmount = v.debit_paise;
      let unpaid = 0;
      if (remainingCredits >= billAmount) {
        remainingCredits -= billAmount;
      } else {
        unpaid = billAmount - remainingCredits;
        remainingCredits = 0;
      }

      if (unpaid > 0) {
        const vDate = parseVoucherDate(v.voucher_date);
        const days = Math.max(0, Math.floor((now - vDate.getTime()) / (1000 * 60 * 60 * 24)));
        if (days <= 30) {
          buckets.bucket0_30 += unpaid;
        } else if (days <= 60) {
          buckets.bucket31_60 += unpaid;
        } else if (days <= 90) {
          buckets.bucket61_90 += unpaid;
        } else {
          buckets.bucket90Plus += unpaid;
        }
      }
    }

    return buckets;
  }, [uniqueVouchers, debtor, currentOpeningPaise, currentOutstandingPaise]);

  const filteredVouchers = useMemo(() => {
    let list = chronologicalVouchers;
    if (selectedMonth) {
      list = list.filter((v) => {
        const d = parseVoucherDate(v.voucher_date);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return ym === selectedMonth;
      });
    }
    if (filterType === 'SALES') {
      list = list.filter((v) => (v.debit_paise || 0) > 0);
    } else if (filterType === 'RECEIPT') {
      list = list.filter((v) => (v.credit_paise || 0) > 0);
    }
    if (sortOrder === 'desc') {
      return [...list].reverse();
    }
    return list;
  }, [chronologicalVouchers, selectedMonth, filterType, sortOrder]);

  const handleSaveMobile = async (newPhone: string) => {
    const cleaned = newPhone.trim();
    setMobileBusy(true);
    try {
      await updateDebtor(debtorId, { mobile: cleaned });
      setCurrentMobile(cleaned);
      setMobileInput(cleaned);
      setEditingMobile(false);
      invalidate(syncKeys.debtors, syncKeys.customers);
      return true;
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      alert(errObj?.message || 'Failed to update phone number');
      return false;
    } finally {
      setMobileBusy(false);
    }
  };

  const executeShare = async (targetPhone: string) => {
    setPdfGenerating(true);
    try {
      const partyName = debtor.name || debtor.customerName || 'Customer';
      const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
      const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

      // Prepare PDF data
      const pdfData: StatementPdfData = {
        partyName,
        partyId: debtorId,
        city: debtor.city,
        state: debtor.state,
        mobile: targetPhone,
        openingPaise: currentOpeningPaise,
        totalDebitsPaise: totalDebits,
        totalCreditsPaise: totalCredits,
        closingPaise: currentOutstandingPaise,
        aging: {
          bucket0_30: aging.bucket0_30,
          bucket31_60: aging.bucket31_60,
          bucket61_90: aging.bucket61_90,
          bucket90Plus: aging.bucket90Plus,
        },
        vouchers: filteredVouchers.map((v) => ({
          date: v.voucher_date,
          type: v.voucher_type,
          vchNo: v.voucher_no || '',
          particulars: v.narration || v.book_source || 'Tally Entry',
          debitPaise: v.debit_paise || 0,
          creditPaise: v.credit_paise || 0,
          balancePaise: v.runningBalancePaise ?? 0,
        })),
      };

      const doc = generateStatementPdf(pdfData);
      const safeName = partyName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Statement_${safeName}.pdf`;

      // Formatted WhatsApp message lines
      const currentBal = currentOutstandingPaise < 0
        ? `${rupees(Math.abs(currentOutstandingPaise))} Cr`
        : `${rupees(currentOutstandingPaise)} Dr`;

      const msgLines = [
        `📄 *DURASMART - Statement of Account*`,
        `--------------------------------`,
        `*Party:* ${partyName}`,
        `*City:* ${debtor.city || debtor.state || 'Punjab'}`,
        `*Opening Balance:* ${currentOpeningPaise < 0 ? `${rupees(Math.abs(currentOpeningPaise))} Cr` : `${rupees(currentOpeningPaise)} Dr`}`,
        `*Total Debits / Billed:* ${rupees(totalDebits)}`,
        `*Total Credits / Receipts:* ${rupees(totalCredits)}`,
        `*Current Outstanding:* ${currentBal}`,
        ``,
        `*Aging Breakdown:*`,
        `• 0-30 Days: ${rupees(aging.bucket0_30)}`,
        `• 31-60 Days: ${rupees(aging.bucket31_60)}`,
        `• 61-90 Days: ${rupees(aging.bucket61_90)}`,
        `• 90+ Days: ${rupees(aging.bucket90Plus)}`,
        ``,
        `*Statement PDF:* Attached below for your records.`,
        `Please clear any overdue balance at your earliest convenience.`,
        `Thank you,`,
        `*Dura Smart Doors & Windows*`
      ];
      const shareText = msgLines.join('\n');

      // Check if browser supports Web Share with files (Native mobile / Android / iOS / supported Web)
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Statement - ${partyName}`,
            text: shareText,
          });
          return;
        } catch (shareErr) {
          console.warn('Native share cancelled or failed, falling back to download:', shareErr);
        }
      }

      // Fallback for Desktop Web / browsers without file Web Share:
      // 1. Download PDF to device
      doc.save(filename);
      // 2. Open WhatsApp Web / App with message
      const textParam = encodeURIComponent(shareText);
      const waUrl = fullPhone ? `https://wa.me/${fullPhone}?text=${textParam}` : `https://api.whatsapp.com/send?text=${textParam}`;
      window.open(waUrl, '_blank');
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleShareWhatsApp = () => {
    const phone = currentMobile.trim();
    if (!phone) {
      // Prompt user to enter the party's number
      setPromptPhoneInput('');
      setShowPhonePromptForWhatsApp(true);
      return;
    }
    executeShare(phone);
  };

  const handleConfirmPromptPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = promptPhoneInput.trim();
    if (!phone) return;
    setPromptPhoneBusy(true);
    try {
      const ok = await handleSaveMobile(phone);
      if (ok) {
        setShowPhonePromptForWhatsApp(false);
        executeShare(phone);
      }
    } finally {
      setPromptPhoneBusy(false);
    }
  };

  const handleDownloadPdf = () => {
    const partyName = debtor.name || debtor.customerName || 'Customer';
    const pdfData: StatementPdfData = {
      partyName,
      partyId: debtorId,
      city: debtor.city,
      state: debtor.state,
      mobile: currentMobile,
      openingPaise: currentOpeningPaise,
      totalDebitsPaise: totalDebits,
      totalCreditsPaise: totalCredits,
      closingPaise: currentOutstandingPaise,
      aging: {
        bucket0_30: aging.bucket0_30,
        bucket31_60: aging.bucket31_60,
        bucket61_90: aging.bucket61_90,
        bucket90Plus: aging.bucket90Plus,
      },
      vouchers: filteredVouchers.map((v) => ({
        date: v.voucher_date,
        type: v.voucher_type,
        vchNo: v.voucher_no || '',
        particulars: v.narration || v.book_source || 'Tally Entry',
        debitPaise: v.debit_paise || 0,
        creditPaise: v.credit_paise || 0,
        balancePaise: v.runningBalancePaise ?? 0,
      })),
    };
    const doc = generateStatementPdf(pdfData);
    const safeName = partyName.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Statement_${safeName}.pdf`);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleAddJv = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(jvAmount);
    if (isNaN(val) || val <= 0) return;
    setJvBusy(true);
    try {
      await addJournalEntry(debtorId, {
        type: jvType,
        amount: val,
        reference: jvRef,
        notes: jvNotes,
      });
      setShowJvModal(false);
      setJvAmount('');
      setJvRef('');
      setJvNotes('');
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } finally {
      setJvBusy(false);
    }
  };

  const handleSaveVoucherEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!curEdit) return;
    const val = parseFloat(editAmount);
    if (isNaN(val) || val < 0) return;
    setEditBusy(true);
    try {
      const isSales = curEdit.voucher_type.toLowerCase() === 'sales';
      await updateVoucher(curEdit.id, {
        voucherNo: editVoucherNo,
        voucherDate: editDate,
        debitAmount: isSales ? val : 0,
        creditAmount: !isSales ? val : 0,
      });
      setEditingVoucher(null);
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } finally {
      setEditBusy(false);
    }
  };

  const handleTransferVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferringVoucher || !targetPartyId) return;
    setTransferBusy(true);
    try {
      await transferVoucher(transferringVoucher.id, targetPartyId, transferNotes);
      setTransferringVoucher(null);
      setTargetPartyId('');
      setTransferNotes('');
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } finally {
      setTransferBusy(false);
    }
  };

  const handleUpdateOpening = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(openingAmount);
    if (isNaN(val) || val < 0) return;
    setOpeningBusy(true);
    try {
      const res = await updateOpeningBalance(debtorId, val);
      setCurrentOpeningPaise(res.openingBalancePaise ?? Math.round(val * 100));
      setEditingOpening(false);
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } finally {
      setOpeningBusy(false);
    }
  };

  const handleDeleteVoucher = async (v: ServerVoucher) => {
    if (!window.confirm(`Permanently delete ${v.voucher_type} voucher ${v.voucher_no || v.id} (${rupees(v.debit_paise || v.credit_paise)})?`)) return;
    try {
      await deleteVoucher(v.id);
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } catch {
      alert('Failed to delete voucher');
    }
  };

  const handleUploadPartyLedger = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLedger(true);
    setLedgerUploadMsg(null);
    try {
      const res = await uploadPartyLedger(debtorId, file);
      setLedgerUploadMsg(`✅ Authoritative ledger applied (${res.vouchersApplied || 0} vouchers). Tally mismatch cleared!`);
      debtor.tallyStatus = 'verified';
      debtor.hasAuthoritativeLedger = true;
      debtor.tallyDiff = 0;
      debtor.tallyDiffPaise = 0;
      if (res.openingBalancePaise !== undefined && res.openingBalancePaise !== null) {
        setCurrentOpeningPaise(res.openingBalancePaise);
        debtor.openingPaise = res.openingBalancePaise;
        debtor.openingBalance = res.openingBalancePaise / 100;
      }
      if (res.newBalancePaise !== undefined && res.newBalancePaise !== null) {
        debtor.balance = res.newBalancePaise / 100.0;
      }
      reloadVouchers();
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: any) {
      alert(err.message || 'Failed to upload party ledger');
    } finally {
      setUploadingLedger(false);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-debtor-ledger, #printable-debtor-ledger * { visibility: visible; }
          #printable-debtor-ledger {
            position: fixed;
            left: 0;
            top: 0;
            width: 100%;
            height: auto;
            max-height: none;
            border: none;
            box-shadow: none;
            background: white !important;
            color: black !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
      <div id="printable-debtor-ledger" className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-300 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{debtor.name || debtor.customerName}</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mt-0.5">
              <span>Ledger Statement · ID: <span className="font-mono text-slate-700 font-semibold">{debtor.id || debtor.customerId}</span> · {debtor.city || debtor.state || 'Punjab'}</span>
              <span>·</span>
              {editingMobile ? (
                <div className="inline-flex items-center gap-1.5 bg-white px-2 py-0.5 rounded-lg border border-slate-300 shadow-sm">
                  <Phone size={12} className="text-emerald-600 shrink-0" />
                  <input
                    type="text"
                    value={mobileInput}
                    onChange={(e) => setMobileInput(e.target.value)}
                    placeholder="Enter WhatsApp / Mobile"
                    className="w-36 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={mobileBusy}
                    onClick={() => handleSaveMobile(mobileInput)}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {mobileBusy ? '...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingMobile(false); setMobileInput(currentMobile); }}
                    className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5">
                  <Phone size={12} className={currentMobile ? "text-emerald-600" : "text-amber-500"} />
                  {currentMobile ? (
                    <span className="font-semibold text-slate-700">{currentMobile}</span>
                  ) : (
                    <span className="text-amber-600 font-semibold italic">No WhatsApp number</span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMobileInput(currentMobile); setEditingMobile(true); }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline ml-1"
                    title="Add or update party mobile number"
                  >
                    <Pencil size={11} /> {currentMobile ? 'Edit' : 'Add Number'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={() => setShowDuplicateReviewModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
              title="Review candidate duplicates before approval"
            >
              <RefreshCw size={13} />
              Clean Duplicates
            </button>
            <button
              type="button"
              onClick={() => setShowJvModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
              title="Add Journal Entry (Credit Note / Debit Note / Discount)"
            >
              <Plus size={14} /> Add JV / Note
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 transition">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tally Ground Truth Benchmark Status Banner */}
        {debtor.tallyStatus === 'mismatch' ? (
          <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 no-print">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="text-amber-600 shrink-0" size={16} />
                  <span className="text-xs font-bold text-amber-900">
                    Tally Ground Truth Mismatch: Current {rupeesDrCr(currentOutstandingPaise)} vs Tally {debtor.tallyClosing !== null && debtor.tallyClosing !== undefined ? formatRupeesDrCr(debtor.tallyClosing) : '—'}
                  </span>
                  {debtor.tallyDiff !== undefined && (
                    <span className="font-mono text-xs font-bold text-amber-800">
                      (Diff: {debtor.tallyDiff > 0 ? '+' : ''}{formatRupeesDrCr(debtor.tallyDiff)})
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  Upload this party's individual Tally Excel ledger to verify transactions and automatically clear this mismatch warning.
                </p>
                {ledgerUploadMsg && (
                  <p className="mt-1 text-[11px] font-bold text-emerald-700">{ledgerUploadMsg}</p>
                )}
              </div>
              <label className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-amber-700 transition">
                <Upload size={13} />
                {uploadingLedger ? 'Applying Ledger...' : 'Upload Party Ledger (.xlsx)'}
                <input type="file" accept=".xlsx,.xlsm" className="hidden" disabled={uploadingLedger} onChange={handleUploadPartyLedger} />
              </label>
            </div>
          </div>
        ) : debtor.tallyStatus === 'verified' ? (
          <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-2.5 no-print flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-800 text-xs font-semibold">
              <CheckCircle2 className="text-emerald-600 shrink-0" size={15} />
              <span>
                {debtor.hasAuthoritativeLedger
                  ? '✅ Verified with Authoritative Individual Party Ledger'
                  : `✅ 100% Matches Tally Prime Sundry Debtors Benchmark (Closing: ${formatRupeesDrCr(debtor.tallyClosing)})`}
              </span>
            </div>
            <label className="cursor-pointer text-[11px] font-bold text-emerald-700 hover:underline inline-flex items-center gap-1">
              <Upload size={12} />
              {uploadingLedger ? 'Uploading...' : 'Re-upload Ledger'}
              <input type="file" accept=".xlsx,.xlsm" className="hidden" disabled={uploadingLedger} onChange={handleUploadPartyLedger} />
            </label>
          </div>
        ) : null}

        {/* Balance Tiles */}
        <div className="grid grid-cols-4 gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Opening Balance</span>
              <button
                type="button"
                onClick={() => {
                  setOpeningAmount(String(currentOpeningPaise / 100));
                  setEditingOpening(true);
                }}
                className="text-[10px] text-blue-600 hover:underline no-print font-bold"
                title="Edit Opening Balance"
              >
                ✏️ Edit
              </button>
            </div>
            <p className="font-mono text-base font-extrabold text-slate-800">
              {rupeesDrCr(currentOpeningPaise)}
            </p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Debits / Billed</span>
            <p className="font-mono text-base font-extrabold text-blue-700">{rupees(totalDebits)}</p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Credits / Receipts</span>
            <p className="font-mono text-base font-extrabold text-emerald-700">{rupees(totalCredits)}</p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Current Outstanding</span>
            <p className={`font-mono text-base font-extrabold ${currentOutstandingPaise < 0 ? 'text-purple-700' : 'text-slate-900'}`}>
              {rupeesDrCr(currentOutstandingPaise)}
            </p>
          </div>
        </div>

        {/* Aging Breakdown (FIFO) */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Bill Aging Analysis (FIFO)</span>
            <span className="text-[10px] font-medium text-slate-500">Allocated against bank receipts</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-slate-500">0 - 30 Days</span>
              <span className="font-mono text-xs font-black text-slate-900">{rupees(aging.bucket0_30)}</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-slate-500">31 - 60 Days</span>
              <span className={`font-mono text-xs font-black ${aging.bucket31_60 > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                {rupees(aging.bucket31_60)}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-slate-500">61 - 90 Days</span>
              <span className={`font-mono text-xs font-black ${aging.bucket61_90 > 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                {rupees(aging.bucket61_90)}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-slate-500">90+ Days</span>
              <span className={`font-mono text-xs font-black ${aging.bucket90Plus > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {rupees(aging.bucket90Plus)}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode & Filter Controls Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-2.5 gap-2 no-print">
          <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => { setViewMode('detailed'); setSelectedMonth(null); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                viewMode === 'detailed'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText size={13} />
              Detailed Ledger
            </button>
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                viewMode === 'monthly'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar size={13} />
              Monthly Summary (Tally View)
            </button>
          </div>

          {viewMode === 'detailed' ? (
            <div className="flex flex-wrap items-center gap-2">
              {selectedMonth && (
                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs font-bold text-indigo-700">
                  Month: {selectedMonth}
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(null)}
                    className="hover:text-rose-600 ml-1 font-black"
                    title="Clear month filter"
                  >
                    ×
                  </button>
                </span>
              )}
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-bold text-slate-500 mr-1">Filter:</span>
                {(['ALL', 'SALES', 'RECEIPT'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                      filterType === t
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {t === 'ALL' ? 'All' : t === 'SALES' ? 'Debits' : 'Credits'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition"
                title="Toggle Sorting Order (Default starts 1-April-2026 like Tally)"
              >
                <ArrowUpDown size={12} />
                {sortOrder === 'asc' ? '1-Apr-26 First (Tally)' : 'Latest First'}
              </button>
              <span className="text-[11px] font-medium text-slate-500 ml-1">
                {filteredVouchers.length} {filteredVouchers.length === 1 ? 'record' : 'records'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1 rounded bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                1-Apr-2026 to 30-Nov-2026
              </span>
              <span>Click any month to view vouchers</span>
            </div>
          )}
        </div>

        {/* Ledger Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-white">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : viewMode === 'monthly' ? (
            /* Tally-Style Monthly Summary Table */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                <div>
                  <span className="font-bold text-slate-900">Ledger Voucher Monthly Summary</span> · FY 2026-27
                </div>
                <div className="text-[11px] text-slate-500">
                  Opening Balance: <span className="font-mono font-bold text-slate-800">{rupeesDrCr(currentOpeningPaise)}</span>
                </div>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b-2 border-slate-200 bg-slate-50 text-[11px] font-black uppercase text-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">Particulars (Month)</th>
                    <th className="py-2.5 px-3 text-right">Debit (+)</th>
                    <th className="py-2.5 px-3 text-right">Credit (-)</th>
                    <th className="py-2.5 px-3 text-right">Net Movement</th>
                    <th className="py-2.5 px-3 text-right">Closing Balance</th>
                    <th className="py-2.5 px-3 text-center no-print w-32">Movement Visual</th>
                    <th className="py-2.5 px-3 text-center no-print">Drilldown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {/* Opening Balance Row */}
                  <tr className="bg-amber-50/60 font-bold border-b border-amber-200">
                    <td className="py-2 px-3 text-amber-950 font-sans font-bold">
                      Opening Balance (as of 1-Apr-2026)
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {currentOpeningPaise > 0 ? rupees(currentOpeningPaise) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-emerald-800">
                      {currentOpeningPaise < 0 ? rupees(Math.abs(currentOpeningPaise)) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">—</td>
                    <td className="py-2 px-3 text-right font-black text-amber-950">
                      {rupeesDrCr(currentOpeningPaise)}
                    </td>
                    <td className="py-2 px-3 text-center no-print text-[10px] text-slate-400">Baseline</td>
                    <td className="py-2 px-3 text-center no-print">
                      <button
                        type="button"
                        onClick={() => {
                          setOpeningAmount(String(currentOpeningPaise / 100));
                          setEditingOpening(true);
                        }}
                        className="text-[10px] text-blue-600 hover:underline font-bold"
                      >
                        ✏️ Edit
                      </button>
                    </td>
                  </tr>

                  {/* Monthly Rows */}
                  {monthlySummary.map((m) => {
                    const maxVol = Math.max(
                      ...monthlySummary.map((x) => Math.max(x.debits, x.credits)),
                      1
                    );
                    const debitPct = Math.min(100, Math.round((m.debits / maxVol) * 100));
                    const creditPct = Math.min(100, Math.round((m.credits / maxVol) * 100));

                    return (
                      <tr
                        key={m.yearMonth}
                        onClick={() => {
                          setSelectedMonth(m.yearMonth);
                          setViewMode('detailed');
                        }}
                        className="hover:bg-blue-50/60 cursor-pointer transition group"
                        title={`Click to view ${m.label} transactions`}
                      >
                        <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 group-hover:text-blue-700 flex items-center gap-1.5">
                          <ChevronRight size={13} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-transform" />
                          <span>{m.label}</span>
                          {m.count > 0 && (
                            <span className="text-[10px] text-slate-400 font-mono font-normal">
                              ({m.count} vchs)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-blue-700">
                          {m.debits > 0 ? rupees(m.debits) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                          {m.credits > 0 ? rupees(m.credits) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                          {m.netMovementPaise > 0
                            ? `+${rupees(m.netMovementPaise)}`
                            : m.netMovementPaise < 0
                            ? `-${rupees(Math.abs(m.netMovementPaise))}`
                            : '—'}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-black ${m.closingPaise < 0 ? 'text-purple-700' : 'text-slate-900'}`}>
                          {rupeesDrCr(m.closingPaise)}
                        </td>
                        <td className="py-2.5 px-3 no-print">
                          <div className="flex flex-col gap-0.5 w-full">
                            {m.debits > 0 && (
                              <div
                                className="h-1.5 rounded-full bg-blue-500"
                                style={{ width: `${Math.max(6, debitPct)}%` }}
                                title={`Debits: ${rupees(m.debits)}`}
                              />
                            )}
                            {m.credits > 0 && (
                              <div
                                className="h-1.5 rounded-full bg-emerald-500"
                                style={{ width: `${Math.max(6, creditPct)}%` }}
                                title={`Credits: ${rupees(m.credits)}`}
                              />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center no-print">
                          <span className="inline-flex items-center text-[10px] font-bold text-indigo-600 group-hover:underline">
                            View →
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Grand Total Row */}
                  <tr className="bg-slate-100 font-black border-t-2 border-slate-300">
                    <td className="py-3 px-3 font-sans uppercase tracking-wider text-slate-900">
                      Grand Total
                    </td>
                    <td className="py-3 px-3 text-right text-blue-800 text-sm">
                      {rupees(totalDebits)}
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-800 text-sm">
                      {rupees(totalCredits)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-800">
                      {totalDebits >= totalCredits
                        ? `+${rupees(totalDebits - totalCredits)}`
                        : `-${rupees(totalCredits - totalDebits)}`}
                    </td>
                    <td className={`py-3 px-3 text-right text-sm font-black ${currentOutstandingPaise < 0 ? 'text-purple-700' : 'text-slate-900'}`}>
                      {rupeesDrCr(currentOutstandingPaise)}
                    </td>
                    <td colSpan={2} className="py-3 px-3 text-center no-print text-[11px] text-slate-500 font-sans">
                      Closing Balance
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="py-10 text-center text-xs font-medium text-slate-500">
              No matching vouchers found for this filter.
            </div>
          ) : (
            /* Detailed Transactions Table */
            <table className="w-full text-left text-xs">
              <thead className="border-b-2 border-slate-200 bg-slate-50 text-[11px] font-black uppercase text-slate-700">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Vch No</th>
                  <th className="py-2.5 px-3">Particulars (Account)</th>
                  <th className="py-2.5 px-3 text-right">Debit (+)</th>
                  <th className="py-2.5 px-3 text-right">Credit (-)</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                  <th className="py-2.5 px-3 text-center no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {/* When sorting ascending (1-Apr-2026 first), show Opening Balance row at top */}
                {sortOrder === 'asc' && !selectedMonth && (
                  <tr className="bg-amber-50/70 font-bold border-b border-amber-200">
                    <td className="py-2.5 px-3 text-amber-900">01-04-2026</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-block rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide bg-amber-100 border border-amber-300 text-amber-900">
                        OPENING
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono">—</td>
                    <td className="py-2.5 px-3 text-amber-950 font-sans font-semibold">
                      Opening Balance (as of 1-Apr-2026)
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-800">
                      {currentOpeningPaise > 0 ? rupees(currentOpeningPaise) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-800">
                      {currentOpeningPaise < 0 ? rupees(Math.abs(currentOpeningPaise)) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-amber-950">
                      {rupeesDrCr(currentOpeningPaise)}
                    </td>
                    <td className="py-2.5 px-3 text-center no-print">
                      <button
                        type="button"
                        onClick={() => {
                          setOpeningAmount(String(currentOpeningPaise / 100));
                          setEditingOpening(true);
                        }}
                        className="text-[10px] text-blue-600 hover:underline font-bold"
                        title="Edit Opening Balance"
                      >
                        ✏️ Edit
                      </button>
                    </td>
                  </tr>
                )}

                {filteredVouchers.map((v) => {
                  const isSales = v.voucher_type.toLowerCase() === 'sales';
                  const isReceipt = v.voucher_type.toLowerCase() === 'receipt';
                  const isJv = v.voucher_type.toLowerCase() === 'journal';
                  return (
                    <tr key={v.id} className="hover:bg-blue-50/40 transition">
                      <td className="py-2.5 px-3 text-slate-700 font-semibold">{v.voucher_date}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide border ${
                            isSales
                              ? 'bg-blue-100 border-blue-200 text-blue-800'
                              : isReceipt
                              ? 'bg-emerald-100 border-emerald-200 text-emerald-800'
                              : isJv
                              ? 'bg-purple-100 border-purple-200 text-purple-800'
                              : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}
                        >
                          {v.voucher_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 font-medium">{v.voucher_no || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-700 text-[11px] font-sans font-medium">{v.narration || v.book_source || 'Tally Book'}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {v.debit_paise > 0 ? rupees(v.debit_paise) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                        {v.credit_paise > 0 ? rupees(v.credit_paise) : '—'}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-black ${v.runningBalancePaise !== undefined && v.runningBalancePaise < 0 ? 'text-purple-700' : 'text-slate-900'}`}>
                        {v.runningBalancePaise !== undefined ? rupeesDrCr(v.runningBalancePaise) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center no-print whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingVoucher(v);
                              setEditVoucherNo(v.voucher_no || '');
                              setEditAmount(String((v.debit_paise || v.credit_paise) / 100));
                              setEditDate(v.voucher_date || '');
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition"
                            title="Edit voucher amount or number"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTransferringVoucher(v);
                              if (debtorDirectory.length === 0) {
                                listDebtors({ pageSize: 500 }).then((res) => setDebtorDirectory(res.items));
                              }
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-700 transition"
                            title="Transfer / Shift this entry to another party ledger"
                          >
                            <ArrowRightLeft size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteVoucher(v)}
                            className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
                            title="Delete voucher"
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
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5 no-print">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pdfGenerating}
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
              title="Share Official Statement PDF on WhatsApp"
            >
              <MessageCircle size={14} />
              {pdfGenerating ? 'Preparing Statement PDF...' : 'Share on WhatsApp'}
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100 transition"
              title="Download Formatted PDF Statement"
            >
              <Download size={14} />
              Download PDF
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-100 transition"
              title="Print browser view"
            >
              <Printer size={14} />
              Print
            </button>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition">
            Close
          </button>
        </div>
      </div>

      {/* Journal Entry Modal */}
      {showJvModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h4 className="text-base font-black text-slate-900">Add Journal Entry (JV)</h4>
              <button type="button" onClick={() => setShowJvModal(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddJv} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Entry Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setJvType('CREDIT')}
                    className={`rounded-lg p-2.5 text-center font-bold border transition ${
                      jvType === 'CREDIT' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Credit Note / Discount (-)
                  </button>
                  <button
                    type="button"
                    onClick={() => setJvType('DEBIT')}
                    className={`rounded-lg p-2.5 text-center font-bold border transition ${
                      jvType === 'DEBIT' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Debit Note / Charge (+)
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 5000"
                  value={jvAmount}
                  onChange={(e) => setJvAmount(e.target.value)}
                  className="input w-full font-mono font-bold text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Reference / Voucher No</label>
                <input
                  type="text"
                  placeholder="e.g. JV-101 / Cash Discount"
                  value={jvRef}
                  onChange={(e) => setJvRef(e.target.value)}
                  className="input w-full text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Particulars / Notes</label>
                <input
                  type="text"
                  placeholder="Reason for adjustment..."
                  value={jvNotes}
                  onChange={(e) => setJvNotes(e.target.value)}
                  className="input w-full text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowJvModal(false)} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition">
                  Cancel
                </button>
                <button type="submit" disabled={jvBusy} className="btn-primary !py-2 text-xs font-bold">
                  {jvBusy ? 'Saving...' : 'Post Journal Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Voucher Modal */}
      {curEdit && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h4 className="text-base font-black text-slate-900">Edit {curEdit.voucher_type} Voucher</h4>
              <button type="button" onClick={() => setEditingVoucher(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveVoucherEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Voucher / Bill No</label>
                <input
                  type="text"
                  value={editVoucherNo}
                  onChange={(e) => setEditVoucherNo(e.target.value)}
                  className="input w-full font-mono text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="input w-full text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="input w-full font-mono font-black text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setEditingVoucher(null)} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition">
                  Cancel
                </button>
                <button type="submit" disabled={editBusy} className="btn-primary !py-2 text-xs font-bold">
                  {editBusy ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Voucher Modal */}
      {transferringVoucher && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h4 className="text-base font-black text-slate-900">Shift Entry to Another Ledger</h4>
              <button type="button" onClick={() => setTransferringVoucher(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleTransferVoucher} className="space-y-4 text-xs">
              <p className="text-slate-600 font-medium">
                Shift <span className="font-extrabold text-slate-900">{transferringVoucher.voucher_type} #{transferringVoucher.voucher_no || transferringVoucher.id}</span> ({rupees(transferringVoucher.debit_paise || transferringVoucher.credit_paise)}) from {debtor.name} to another customer ledger.
              </p>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Select Destination Customer</label>
                <select
                  required
                  value={targetPartyId}
                  onChange={(e) => setTargetPartyId(e.target.value)}
                  className="input w-full text-slate-900 border-slate-300 bg-white font-medium"
                >
                  <option value="">-- Choose Party --</option>
                  {debtorDirectory
                    .filter((d) => (d.id || d.customerId) !== debtorId)
                    .map((d) => (
                      <option key={d.id || d.customerId} value={d.id || d.customerId}>
                        {d.name || d.customerName} ({d.city || d.state || 'Punjab'})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Transfer Reason / Note</label>
                <input
                  type="text"
                  placeholder="e.g. Invoiced to wrong account by mistake"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  className="input w-full text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setTransferringVoucher(null)} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition">
                  Cancel
                </button>
                <button type="submit" disabled={transferBusy} className="btn-primary !py-2 text-xs font-bold">
                  {transferBusy ? 'Shifting...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Opening Balance Modal */}
      {editingOpening && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h4 className="text-base font-black text-slate-900">Edit Opening Balance</h4>
              <button type="button" onClick={() => setEditingOpening(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateOpening} className="space-y-4 text-xs">
              <p className="text-slate-600 font-medium">
                Set opening balance for <span className="font-extrabold text-slate-900">{debtor.name}</span>. Net outstanding will be recalculated immediately.
              </p>
              <div>
                <label className="block text-slate-700 mb-1 font-bold">Opening Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  className="input w-full font-mono font-black text-slate-900 border-slate-300 bg-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setEditingOpening(false)} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition">
                  Cancel
                </button>
                <button type="submit" disabled={openingBusy} className="btn-primary !py-2 text-xs font-bold">
                  {openingBusy ? 'Saving...' : 'Update Opening'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Phone Prompt Modal */}
      {showPhonePromptForWhatsApp && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-slate-300 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <Phone size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900">Add WhatsApp Number</h4>
                  <p className="text-[11px] text-slate-500 font-semibold">{debtor.name || debtor.customerName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPhonePromptForWhatsApp(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 transition"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmPromptPhone} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  10-Digit Mobile / WhatsApp Number *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={promptPhoneInput}
                  onChange={(e) => setPromptPhoneInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  This number will be saved to the party record for future statements and invoice shares.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPhonePromptForWhatsApp(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={promptPhoneBusy || !promptPhoneInput.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {promptPhoneBusy ? 'Saving...' : 'Save & Share Statement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate Review & Approval Modal */}
      {showDuplicateReviewModal && (
        <DuplicateReviewModal
          partyId={debtor.id}
          partyName={debtor.name || debtor.customerName}
          onClose={() => setShowDuplicateReviewModal(false)}
          onSuccess={() => {
            reloadVouchers();
            invalidate(syncKeys.debtors, syncKeys.customers);
          }}
        />
      )}
    </div>
  );
}

function DebtorListCard() {
  const [ledgerType, setLedgerType] = useState<'debtors' | 'creditors'>('debtors');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'mismatch' | 'verified' | 'unbenchmarked'>('all');
  const [syncingBenchmarks, setSyncingBenchmarks] = useState(false);
  const [benchmarksMessage, setBenchmarksMessage] = useState<string | null>(null);
  const [syncingHrPb, setSyncingHrPb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedDebtorLedger, setSelectedDebtorLedger] = useState<ServerDebtor | null>(null);
  const [syncingBooks, setSyncingBooks] = useState(false);
  const [booksMessage, setBooksMessage] = useState<string | null>(null);
  const [uploadingOpening, setUploadingOpening] = useState(false);
  const [openingMessage, setOpeningMessage] = useState<string | null>(null);
  const [showAllDuplicateReviewModal, setShowAllDuplicateReviewModal] = useState(false);

  // Salespeople for dropdown selection
  const [salespeople, setSalespeople] = useState<string[]>([]);

  // Add Debtor Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCity, setAddCity] = useState('');
  const [addDistrict, setAddDistrict] = useState('');
  const [addSalesperson, setAddSalesperson] = useState('');
  const [addBalance, setAddBalance] = useState('0.00');
  const [addMobile, setAddMobile] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Edit Debtor Modal State
  const [editingDebtor, setEditingDebtor] = useState<ServerDebtor | null>(null);
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editDistrict, setEditDistrict] = useState('');
  const [editSalesperson, setEditSalesperson] = useState('');
  const [editBalance, setEditBalance] = useState('0.00');
  const [editMobile, setEditMobile] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Delete Debtor State
  const [deletingDebtor, setDeletingDebtor] = useState<ServerDebtor | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Merge Debtors State
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);
  const [allDebtorsDirectory, setAllDebtorsDirectory] = useState<ServerDebtor[]>([]);
  const [isResetting, setIsResetting] = useState(false);

  const handleZeroBalances = async () => {
    if (!window.confirm("Are you sure you want to clean up existing balances and set all to ₹0.00? This clears existing vouchers/opening balances so you can upload your fresh Excel file.")) {
      return;
    }
    setIsResetting(true);
    try {
      await resetAccountingBalances();
      invalidate(syncKeys.debtors);
      invalidate(syncKeys.dashboard);
      retry();
      alert("All existing balances successfully zeroed out! Ready for fresh Excel upload.");
    } catch (e: any) {
      alert(e.message || "Failed to zero balances");
    } finally {
      setIsResetting(false);
    }
  };

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
        activeOnly: activeOnly ? true : undefined,
        statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
        ledgerType: ledgerType,
        partyType: ledgerType === 'creditors' ? 'supplier' : 'customer',
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [activeOnly, statusFilter, ledgerType],
  );

  const handleSyncBenchmarks = async () => {
    setSyncingBenchmarks(true);
    setBenchmarksMessage(null);
    try {
      const res = await syncDebtorBenchmarks();
      setBenchmarksMessage(res.message);
      toast.success(res.message);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
      retry();
    } catch (e: any) {
      const msg = e.message || 'Failed to reconcile Tally benchmarks';
      setBenchmarksMessage(msg);
      toast.error(msg);
    } finally {
      setSyncingBenchmarks(false);
    }
  };

  const [uploadingDebtorBalance, setUploadingDebtorBalance] = useState(false);
  const handleUploadDebtorBalance = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDebtorBalance(true);
    setBenchmarksMessage(null);
    try {
      const res = await uploadDebtorBenchmarks(file);
      setBenchmarksMessage(res.message);
      toast.success(res.message);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
      retry();
    } catch (err: any) {
      const msg = err?.message || 'Failed to upload debtor balance.xlsx';
      setBenchmarksMessage(msg);
      toast.error(msg);
    } finally {
      setUploadingDebtorBalance(false);
      e.target.value = '';
    }
  };

  const refreshToken = useSyncToken(syncKeys.debtors);
  const { state, rows, total, error, retry, sync, summary } = useLiveList(load, term, page, refreshToken);

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

  const handleSyncBooks = async () => {
    setSyncingBooks(true);
    setBooksMessage(null);
    try {
      const res = await syncAccountingBooks();
      setBooksMessage(res.message || 'Sales and bank books synced successfully!');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setBooksMessage(errObj?.message || 'Failed to sync accounting books');
    } finally {
      setSyncingBooks(false);
    }
  };

  const handleOpeningFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingOpening(true);
    setOpeningMessage(null);
    try {
      const bytes = await file.arrayBuffer();
      const res = await uploadOpeningBalances(bytes, file.name);
      setOpeningMessage(res.message || 'Opening balances imported successfully!');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
      sync.refresh();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setOpeningMessage(errObj?.message || 'Failed to import opening balances');
    } finally {
      setUploadingOpening(false);
      e.target.value = '';
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
        mobile: addMobile.trim(),
      });
      setShowAddModal(false);
      setAddName('');
      setAddCity('');
      setAddDistrict('');
      setAddSalesperson('');
      setAddBalance('0.00');
      setAddMobile('');
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
    setEditMobile(debtor.mobile || '');
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
        mobile: editMobile.trim(),
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

  const handleConfirmMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeSourceId || !mergeTargetId) {
      alert('Please select both a source account to merge and a target account to keep.');
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      alert('Source and target cannot be the same account.');
      return;
    }
    setMerging(true);
    try {
      const res = await mergeDebtors(mergeSourceId, mergeTargetId);
      alert(`Merged successfully! Moved ${res.vouchersMoved} vouchers and consolidated balances under ${res.targetPartyName}.`);
      setShowMergeModal(false);
      setMergeSourceId('');
      setMergeTargetId('');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
      sync.refresh();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      alert(`Merge failed: ${errObj?.message || 'Error merging parties'}`);
    } finally {
      setMerging(false);
    }
  };

  return (
    <Card>
      {/* 1-Click Sync Banner */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-blue/30 bg-brand-blue/5 p-3">
        <div>
          <p className="text-[12px] font-bold text-ink">Auto-Sync Accounting & Target Books</p>
          <p className="text-[11px] text-muted">
            Sync sales.xlsx, hdfc.xlsx, and yes.xlsx directly to recalculate debtor balances, or pull targets from HR-PB.xlsx.
          </p>
          {syncMessage && (
            <p className="mt-1 text-[11px] font-bold text-brand-green">{syncMessage}</p>
          )}
          {booksMessage && (
            <p className="mt-1 text-[11px] font-bold text-brand-blue">{booksMessage}</p>
          )}
          {openingMessage && (
            <p className="mt-1 text-[11px] font-bold text-emerald-600">{openingMessage}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSyncBooks}
            disabled={syncingBooks}
            className="btn-primary !py-1.5 text-xs font-bold"
            title="Sync sales.xlsx, hdfc.xlsx, and yes.xlsx from local folder"
          >
            <RefreshCw size={13} className={syncingBooks ? 'animate-spin' : ''} />
            {syncingBooks ? 'Syncing Books...' : '⚡ 1-Click Sync Sales & Bank'}
          </button>
          <label
            htmlFor="opening-balance-file-input"
            className="btn-primary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            title="Upload opening.xlsx or Trial Balance Excel to update opening balances for all parties"
          >
            <Upload size={13} className={uploadingOpening ? 'animate-spin' : ''} />
            {uploadingOpening ? 'Importing Opening...' : '📥 Import Opening (.xlsx)'}
          </label>
          <input
            id="opening-balance-file-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={uploadingOpening}
            onChange={handleOpeningFileUpload}
          />
          <label
            htmlFor="debtor-balance-benchmark-input"
            className="btn-primary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm bg-amber-600 hover:bg-amber-700 text-white"
            title="Upload fresh debtor balance.xlsx exported from Tally to reconcile all customer debtor accounts"
          >
            <Upload size={13} className={uploadingDebtorBalance ? 'animate-spin' : ''} />
            {uploadingDebtorBalance ? 'Reconciling...' : '📊 Upload debtor balance (.xlsx)'}
          </label>
          <input
            id="debtor-balance-benchmark-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={uploadingDebtorBalance}
            onChange={handleUploadDebtorBalance}
          />
          <label
            htmlFor="debtor-workbook-file-input"
            className="btn-primary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white"
            title="Upload and import sales.xlsx, individual customer ledgers (e.g. S S Kalra Zira.xlsx), or Book1.xlsx"
          >
            <FileSearch size={13} /> 📁 Upload Excel File
          </label>
          <button
            type="button"
            onClick={handle1ClickSync}
            disabled={syncingHrPb}
            className="btn-secondary !py-1.5 text-xs font-bold"
          >
            <RefreshCw size={13} className={syncingHrPb ? 'animate-spin' : ''} />
            {syncingHrPb ? 'Syncing...' : '📁 Sync Book1.xlsx'}
          </button>
          <button
            type="button"
            onClick={() => setShowAllDuplicateReviewModal(true)}
            className="btn-secondary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
            title="Scan database, review candidate duplicates and approve deletion"
          >
            <RefreshCw size={13} />
            🧹 Clean Duplicates
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMergeModal(true);
              if (allDebtorsDirectory.length === 0) {
                listDebtors({ pageSize: 500 }).then((res) => setAllDebtorsDirectory(res.items));
              }
            }}
            className="btn-secondary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5"
            title="Consolidate duplicate accounts (e.g. combine Haryana and Punjab duplicates)"
          >
            <GitMerge size={13} className="text-amber-600" /> Merge Accounts
          </button>
          <button
            type="button"
            onClick={() => {
              if (!addSalesperson && spOptions.length > 0) {
                setAddSalesperson(spOptions[0]);
              }
              setShowAddModal(true);
            }}
            className="btn-secondary !py-1.5 text-xs font-bold"
          >
            <Plus size={13} /> Add Debtor
          </button>
        </div>
      </div>

      {/* Ledger Book Category Switcher: Sundry Debtors vs Sundry Creditors */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => {
            setLedgerType('debtors');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
            ledgerType === 'debtors'
              ? 'bg-blue-600 text-white shadow-blue-500/20'
              : 'bg-canvas border border-line text-muted hover:text-ink hover:bg-line/30'
          }`}
        >
          <Users size={15} />
          <span>👥 Sundry Debtors (Customers)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setLedgerType('creditors');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
            ledgerType === 'creditors'
              ? 'bg-purple-600 text-white shadow-purple-500/20'
              : 'bg-canvas border border-line text-muted hover:text-ink hover:bg-line/30'
          }`}
        >
          <Store size={15} />
          <span>🏭 Sundry Creditors (Suppliers / Vendors)</span>
          <span className="rounded-full bg-purple-200/40 px-1.5 py-0.5 text-[10px] text-purple-900 dark:text-purple-200 font-semibold">
            32 Ledgers
          </span>
        </button>
      </div>

      {/* Debtor / Creditor Master Hybrid KPI Summary Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-5">
        <KpiCard
          label={ledgerType === 'creditors' ? "Total Creditors Balance (Payables)" : "Total Receivables"}
          value={rupees(rows.reduce((acc, r) => acc + Math.round((parseFloat(String(r.balance || 0)) || 0) * 100), 0))}
          hint={ledgerType === 'creditors' ? "Suppliers, mills & vendors (Tally)" : "Across verified dealers"}
          gradient={ledgerType === 'creditors' ? "from-purple-600 to-indigo-600" : "from-amber-600 to-orange-600"}
          icon={<AlertTriangle size={20} />}
        />
        <KpiCard
          label={ledgerType === 'creditors' ? "Active Creditors" : "Active Debtors"}
          value={`${total} Accounts`}
          hint={ledgerType === 'creditors' ? "Sundry Creditors master directory" : "Master directory size"}
          gradient="from-emerald-600 to-teal-600"
          icon={<Users size={20} />}
        />
        <KpiCard
          label={ledgerType === 'creditors' ? "Parties with Balance" : "With Outstanding"}
          value={`${rows.filter((r) => Math.abs(parseFloat(String(r.balance || 0)) || 0) > 0).length} Parties`}
          hint={ledgerType === 'creditors' ? "Suppliers with closing dues" : "Dues pending recovery"}
          gradient={ledgerType === 'creditors' ? "from-indigo-600 to-blue-600" : "from-red-600 to-rose-600"}
          icon={<ShieldAlert size={20} />}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black text-ink">
            {ledgerType === 'creditors' ? 'Sundry Creditors Master (Suppliers / Vendors)' : 'Sundry Debtors Master (Customers)'}
          </h2>
          <p className="text-[11px] text-muted">
            {ledgerType === 'creditors'
              ? 'Suppliers, mills, transports & vendors separated from customer debtor ledgers per Tally.'
              : 'Dealers and customers with balance, station, salesperson, and live Edit / Delete controls.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Tally Ground-Truth Benchmark Filter Segment */}
          <div className="flex items-center rounded-lg border border-line bg-canvas/40 p-0.5">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition flex items-center gap-1.5 ${statusFilter === 'all' ? 'bg-brand-blue text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <span>All</span>
              {summary?.totalCount !== undefined && summary.totalCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${statusFilter === 'all' ? 'bg-white/20 text-white' : 'bg-canvas text-muted'}`}>
                  {summary.totalCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('mismatch');
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition flex items-center gap-1.5 ${statusFilter === 'mismatch' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 hover:text-amber-900'}`}
              title="Filter debtors whose panel balance does not match Tally Ground Truth"
            >
              <AlertTriangle size={11} />
              <span>Mismatches</span>
              {summary?.mismatchCount !== undefined && summary.mismatchCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${statusFilter === 'mismatch' ? 'bg-amber-800 text-amber-100' : 'bg-amber-200 text-amber-900'}`}>
                  {summary.mismatchCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('verified');
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition flex items-center gap-1.5 ${statusFilter === 'verified' ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-700 hover:text-emerald-900'}`}
              title="Filter debtors 100% verified with Tally Ground Truth or authoritative ledger"
            >
              <CheckCircle2 size={11} />
              <span>Verified</span>
              {summary?.verifiedCount !== undefined && summary.verifiedCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${statusFilter === 'verified' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-200 text-emerald-900'}`}>
                  {summary.verifiedCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('unbenchmarked');
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition flex items-center gap-1.5 ${statusFilter === 'unbenchmarked' ? 'bg-slate-700 text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <span>Unbenchmarked</span>
              {summary?.unbenchmarkedCount !== undefined && summary.unbenchmarkedCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${statusFilter === 'unbenchmarked' ? 'bg-slate-900 text-slate-100' : 'bg-slate-200 text-slate-700'}`}>
                  {summary.unbenchmarkedCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center rounded-lg border border-line bg-canvas/40 p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveOnly(!activeOnly);
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${activeOnly ? 'bg-indigo-600 text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {activeOnly ? '✓ Dues Only' : 'Dues Only'}
            </button>
          </div>

          <input
            id="toolbar-debtor-balance-upload"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={uploadingDebtorBalance || syncingBenchmarks}
            onChange={handleUploadDebtorBalance}
          />
          <div className="flex items-center rounded-lg border border-amber-300 bg-amber-50 overflow-hidden shadow-sm">
            <label
              htmlFor="toolbar-debtor-balance-upload"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 transition cursor-pointer"
              title="Upload fresh debtor balance.xlsx exported from Tally to reconcile closing balances"
            >
              <Upload size={12} className={uploadingDebtorBalance ? "animate-spin" : ""} />
              {uploadingDebtorBalance ? "Reconciling..." : "📊 Reconcile with Tally (.xlsx)"}
            </label>
            <button
              type="button"
              disabled={syncingBenchmarks}
              onClick={handleSyncBenchmarks}
              className="px-1.5 py-1.5 text-amber-700 hover:bg-amber-100 border-l border-amber-200 transition"
              title="Quick re-sync from server debtor balance.xlsx"
            >
              <RefreshCw size={11} className={syncingBenchmarks ? "animate-spin" : ""} />
            </button>
          </div>

          <button
            type="button"
            disabled={isResetting}
            onClick={handleZeroBalances}
            className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shadow-sm"
            title="Clean up existing balances to ₹0.00 so you can upload a fresh Excel file"
          >
            <RefreshCw size={12} className={isResetting ? "animate-spin" : ""} />
            {isResetting ? "Zeroing..." : "Zero Balances"}
          </button>

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
      </div>

      {benchmarksMessage && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 flex items-center justify-between">
          <span>{benchmarksMessage}</span>
          <button type="button" onClick={() => setBenchmarksMessage(null)} className="text-amber-700 hover:text-amber-950">
            <X size={14} />
          </button>
        </div>
      )}
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
          hint="Import sales targets from Book1.xlsx or upload individual party ledgers."
        />
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-field border border-line">
            <table className="w-full min-w-[700px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-line bg-canvas/40">
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                    {ledgerType === 'creditors' ? 'Creditor / Supplier Name' : 'Party Name'}
                  </th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">Station / City</th>
                  <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                    {ledgerType === 'creditors' ? 'Account Type' : 'Salesperson'}
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">
                    {ledgerType === 'creditors' ? 'Tally Closing Balance' : 'Balance'}
                  </th>
                  <th className="px-3 py-2 text-center text-[10px] font-extrabold uppercase tracking-wide text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const partyTitle = row.name || row.customerName || '—';
                  const cityStation = row.city || row.district || row.state || '—';
                  const sp = row.salesperson || 'Unassigned';
                  const balPaise = Math.round((row.balance !== undefined ? parseFloat(String(row.balance)) : (row.debitPaise || 0) / 100) * 100);
                  const isPos = balPaise > 0;
                  const isMismatch = row.tallyStatus === 'mismatch';
                  return (
                    <tr
                      key={row.id || row.customerId}
                      className={`border-b border-line/60 last:border-b-0 hover:bg-canvas/50 ${
                        isMismatch ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink">{partyTitle}</span>
                            <span className="text-[10px] text-faint">{row.id || row.customerId}</span>
                          </div>
                          {ledgerType === 'creditors' ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="inline-flex items-center gap-1 rounded bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-950/30 dark:text-purple-300">
                                🏭 Sundry Creditor · Tally Verified
                              </span>
                            </div>
                          ) : isMismatch ? (
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                                <AlertTriangle size={10} className="text-amber-600 shrink-0" />
                                Tally Mismatch · Tally: {formatRupeesDrCr(row.tallyClosing)}
                                <span className="font-mono">
                                  ({row.tallyDiff! > 0 ? '+' : ''}{formatRupeesDrCr(row.tallyDiff)})
                                </span>
                              </span>
                            </div>
                          ) : row.tallyStatus === 'verified' ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-400">
                                <CheckCircle2 size={10} className="text-emerald-600 shrink-0" />
                                {row.hasAuthoritativeLedger ? 'Verified (Party Ledger)' : 'Verified with Tally'}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle text-muted">{cityStation}</td>
                      <td className="px-3 py-2 align-middle font-medium text-ink">
                        {ledgerType === 'creditors' ? (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Supplier / Creditor
                          </span>
                        ) : (
                          sp
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-middle font-semibold tabular-nums text-ink">
                        <div className="flex flex-col items-end">
                          <span className={`rounded px-2 py-0.5 border font-mono text-[11px] font-bold ${
                            isMismatch
                              ? 'bg-amber-100 border-amber-300 text-amber-900 font-black'
                              : isPos
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                : balPaise < 0
                                  ? 'bg-purple-50 border-purple-300 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300'
                                  : 'bg-canvas border-line text-slate-400'
                          }`}>
                            {rupeesDrCr(balPaise)}
                          </span>
                          {isMismatch && row.tallyClosing !== null && row.tallyClosing !== undefined && (
                            <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                              Tally: {formatRupeesDrCr(row.tallyClosing)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedDebtorLedger(row)}
                            className="rounded p-1 text-muted hover:bg-brand-blue/10 hover:text-brand-blue"
                            title="View Statement / Vouchers"
                          >
                            <FileText size={13} />
                          </button>
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
              <div>
                <label className="text-[11px] font-bold text-muted">WhatsApp / Mobile Number</label>
                <input
                  type="tel"
                  className="input mt-1 w-full"
                  value={addMobile}
                  onChange={(e) => setAddMobile(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
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
              <div>
                <label className="text-[11px] font-bold text-muted">WhatsApp / Mobile Number</label>
                <input
                  type="tel"
                  className="input mt-1 w-full"
                  value={editMobile}
                  onChange={(e) => setEditMobile(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
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

      {/* Merge Duplicate Accounts Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl border border-line">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div className="flex items-center gap-2">
                <GitMerge size={18} className="text-amber-600" />
                <h3 className="text-sm font-bold text-ink">Merge Duplicate Customer Accounts</h3>
              </div>
              <button type="button" onClick={() => setShowMergeModal(false)} className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmMerge} className="space-y-4 text-xs">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-amber-900 dark:text-amber-300">
                <p className="font-semibold mb-1">Account Consolidation Warning</p>
                <p className="text-[11px] leading-relaxed">
                  All sales bills, bank receipts, orders, and ledger vouchers from the <strong>Source Account</strong> will be transferred into the <strong>Target Account</strong>. The source duplicate account will then be permanently merged.
                </p>
              </div>

              <div>
                <label className="block text-muted mb-1 font-semibold">1. Select Duplicate Account to Merge (Source - will be removed)</label>
                <select
                  required
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">-- Choose Account to Merge --</option>
                  {allDebtorsDirectory.map((d) => (
                    <option key={d.id || d.customerId} value={d.id || d.customerId}>
                      {d.name || d.customerName} ({d.city || d.state || 'Punjab'}) · Outstanding: ₹{d.balance || 0}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted mb-1 font-semibold">2. Select Primary Account to Keep (Target - receives all entries)</label>
                <select
                  required
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">-- Choose Primary Target Account --</option>
                  {allDebtorsDirectory
                    .filter((d) => (d.id || d.customerId) !== mergeSourceId)
                    .map((d) => (
                      <option key={d.id || d.customerId} value={d.id || d.customerId}>
                        {d.name || d.customerName} ({d.city || d.state || 'Punjab'}) · Outstanding: ₹{d.balance || 0}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowMergeModal(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={merging}
                  className="rounded-field bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-sm"
                >
                  {merging ? 'Consolidating Accounts...' : 'Confirm & Merge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ledger Statement Modal */}
      {selectedDebtorLedger && (
        <DebtorLedgerModal
          debtor={selectedDebtorLedger}
          onClose={() => setSelectedDebtorLedger(null)}
        />
      )}

      {/* Database-Wide Duplicate Review & Approval Modal */}
      {showAllDuplicateReviewModal && (
        <DuplicateReviewModal
          onClose={() => setShowAllDuplicateReviewModal(false)}
          onSuccess={() => {
            invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard);
            retry();
          }}
        />
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

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SectionErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Error trapped by section boundary
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-brand-red/30 bg-white p-4 my-3 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-black text-brand-red">
            <ShieldAlert size={18} /> {this.props.fallbackTitle || 'Display error in debtor preview'}
          </p>
          <p className="mt-1 text-xs text-ink font-mono bg-canvas p-2 rounded">
            {this.state.error?.message || 'Unknown render error'}
          </p>
          <button
            type="button"
            className="btn-outline btn-sm mt-3"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
          >
            Reset view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const shortDigest = (value?: string | null): string =>
  !value ? '—' : value.length <= 16 ? value : `${value.slice(0, 16)}…`;

const VERDICT_TONE: Record<string, string> = {
  resolved: 'bg-brand-green/12 text-brand-green',
  missing: 'bg-brand-orange/15 text-[#C96B15]',
  ambiguous: 'bg-brand-purple/12 text-brand-purple',
  invalid: 'bg-brand-red/10 text-brand-red',
};

function Verdict({ value }: { value?: string }) {
  const val = value || 'resolved';
  return <span className={`chip ${VERDICT_TONE[val] ?? 'bg-line text-muted'}`}>{val}</span>;
}

function FindingList({
  title,
  findings,
  empty,
}: {
  title: string;
  findings?: ServerDebtorPreviewFinding[];
  empty: string;
}) {
  const list = Array.isArray(findings) ? findings : [];
  return (
    <div className="mt-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
        {title} ({list.length})
      </p>
      {list.length === 0 ? (
        <p className="mt-1 text-[11px] text-faint">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/50 rounded-field border border-line bg-white">
          {list.map((finding, index) => (
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

function CountTile({ label, value, tone = 'text-ink' }: { label: string; value?: number; tone?: string }) {
  return (
    <div className="rounded-field border border-line bg-white px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-[18px] font-black tabular-nums ${tone}`}>{typeof value === 'number' ? value : 0}</p>
    </div>
  );
}

function ColumnLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <span>
      <span className="text-muted">{label} </span>
      <span className={!value ? 'font-bold text-brand-red' : 'font-bold text-ink'}>
        {value ?? 'not found'}
      </span>
    </span>
  );
}

function PreviewRowLine({ row }: { row: ServerDebtorPreviewRow }) {
  const candidateIds = Array.isArray(row.candidateIds) ? row.candidateIds : [];
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const debitPaise = typeof row.debitPaise === 'number' ? row.debitPaise : 0;
  const creditPaise = typeof row.creditPaise === 'number' ? row.creditPaise : 0;
  const partyName = row.partyName || (row as unknown as { rawPartyName?: string }).rawPartyName || '';
  const verdict = row.verdict || (row as unknown as { resolution?: string }).resolution || 'resolved';
  const customerName = row.customerName || (row as unknown as { resolvedCustomerName?: string }).resolvedCustomerName || null;

  return (
    <tr className="border-b border-line/60 last:border-b-0">
      <td className="px-3 py-2 align-top text-[10px] tabular-nums text-faint">{row.rowNumber}</td>
      <td className="px-3 py-2 align-top">
        <span className="font-bold text-ink">{partyName || <span className="italic text-faint">no party name</span>}</span>
        <span className="ml-2 font-mono text-[10px] text-faint">{row.sourceRef ?? 'no stable reference'}</span>
      </td>
      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{money(debitPaise)}</td>
      <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{money(creditPaise)}</td>
      <td className="px-3 py-2 align-top">
        <Verdict value={verdict} />
        {row.reason && <span className="ml-1.5 text-[10px] text-muted">{row.reason}</span>}
        {customerName && (
          <span className="mt-0.5 block text-[10px] text-muted">matched {customerName}</span>
        )}
        {candidateIds.length > 0 && (
          <span className="mt-0.5 block text-[10px] text-brand-purple">
            candidates: {candidateIds.join(', ')}
          </span>
        )}
        {issues.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {issues.map((issue) => (
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
  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  const sheetNames = Array.isArray(preview.sheetNames) ? preview.sheetNames : [preview.sheetName || 'Sheet1'];
  const unresolved = rows.filter((row) => (row.verdict || (row as unknown as { resolution?: string }).resolution) !== 'resolved');
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
            SHA-256 <span className="break-all font-mono text-ink">{shortDigest(preview.fileSha256)}</span>
          </span>
          <span>{preview.sizeBytes ?? 0} bytes</span>
          <span>
            sheet <span className="font-bold text-ink">{preview.sheetName ?? 'Sheet1'}</span> of{' '}
            {sheetNames.length}
          </span>
          <span>source {preview.source ?? 'workbook'}</span>
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
          <span className={`font-black ${!preview.asOf ? 'text-brand-red' : 'text-ink'}`}>
            {preview.asOf ?? 'not stated'}
          </span>
          <span className={`chip ${preview.asOfVerified ? 'bg-brand-green/12 text-brand-green' : 'bg-brand-red/10 text-brand-red'}`}>
            {preview.asOfVerified ? 'explicitly verified' : 'not verified'}
          </span>
          {preview.asOfSource && <span className="text-faint">{preview.asOfSource}</span>}
        </p>
        {preview.periodText && (
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
        <CountTile label="Data rows" value={preview.dataRowCount ?? rows.length} />
        <CountTile label="Resolved" value={preview.resolvedRowCount ?? rows.length} tone="text-brand-green" />
        <CountTile label="Missing" value={preview.missingRowCount ?? 0} tone="text-[#C96B15]" />
        <CountTile label="Ambiguous" value={preview.ambiguousRowCount ?? 0} tone="text-brand-purple" />
        <CountTile label="Invalid" value={preview.invalidRowCount ?? 0} tone="text-brand-red" />
        <CountTile label="Unresolved" value={preview.unresolvedRowCount ?? unresolved.length} tone="text-brand-red" />
        <CountTile label="Zero-balance rows" value={preview.zeroBalanceRowCount ?? 0} />
        <CountTile label="Totals excluded" value={preview.totalRowCount ?? rows.length} />
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
                <span className="font-bold text-ink">{row.partyName || (row as unknown as { rawPartyName?: string }).rawPartyName || 'no party name'}</span>
                <span className="font-mono text-[10px] text-faint">{row.sourceRef ?? 'no reference'}</span>
                <Verdict value={row.verdict || (row as unknown as { resolution?: string }).resolution} />
                {row.reason && <span className="text-muted">{row.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-muted">
            Rows read ({preview.rowsListed ?? rows.length} listed
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
                {rows.slice(0, 100).map((row) => (
                  <PreviewRowLine key={row.rowNumber} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <p className="mt-1 text-[10px] text-muted italic">Showing first 100 rows of {rows.length} total rows.</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <span>
              blank rows {preview.blankRowCount ?? 0} · total rows excluded {preview.totalRowCount ?? 0} · rows
              listed {preview.rowsListed ?? rows.length}
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
        invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.vouchers);
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
    <Card className="mb-4 border-2 border-brand-blue/20">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-black text-ink">Debtor Workbook Import & Preview</h2>
          <p className="text-[11px] text-muted">
            Owner only. Upload Sales Register (sales.xlsx) or HR-PB Target workbooks. <em>Note: Upload HDFC &amp; Yes Bank statements in the Payment section.</em>
          </p>
        </div>
        <input
          id="debtor-workbook-file-input"
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setFileName(file.name);
            void run(file);
          }}
        />
        <label
          htmlFor="debtor-workbook-file-input"
          className="btn-primary !py-1.5 px-3 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <FileSearch size={15} /> Choose workbook
        </label>
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
        <label
          htmlFor="debtor-workbook-file-input"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) {
              setFileName(file.name);
              void run(file);
            }
          }}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line hover:border-brand-blue bg-canvas/40 hover:bg-brand-blue/5 p-8 text-center cursor-pointer transition group"
        >
          <div className="rounded-full bg-brand-blue/10 p-3 text-brand-blue mb-2 group-hover:scale-110 transition">
            <FileSearch size={28} />
          </div>
          <p className="text-sm font-bold text-ink">Click to Choose or Drag & Drop Excel File</p>
          <p className="mt-1 text-xs text-muted max-w-md">
            Upload <strong>daybook.xlsx</strong> (Day Book), <strong>sales.xlsx</strong> (Sales Register), individual debtor ledgers (e.g. <strong>S S Kalra Zira.xlsx</strong>), or <strong>HR-PB.xlsx</strong> (Dealer Targets). <em>Bank &amp; Cash Books can also be uploaded in the Payment section.</em>
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm group-hover:bg-brand-blue/90">
            Browse Excel File
          </span>
        </label>
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
        <SectionErrorBoundary
          fallbackTitle="Workbook Preview Display Issue"
          onReset={() => setPhase({ kind: 'idle' })}
        >
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
        </SectionErrorBoundary>
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

      {user?.role === 'owner' && (
        <SectionErrorBoundary fallbackTitle="Debtor Workbook Preview Unavailable">
          <DebtorWorkbookPreview />
        </SectionErrorBoundary>
      )}
      <DebtorListCard />
    </div>
  );
}
