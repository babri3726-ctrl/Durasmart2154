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
  GitMerge,
  ArrowRightLeft,
  Edit2,
} from 'lucide-react';
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
  syncAccountingBooks,
  listVouchers,
  updateVoucher,
  deleteVoucher,
  transferVoucher,
  addJournalEntry,
  mergeDebtors,
  updateOpeningBalance,
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

  const totalSalesDebit = vouchers
    .filter((v) => {
      const t = v.voucher_type.toLowerCase();
      return t === 'sales' || t.includes('debit note');
    })
    .reduce((sum, v) => sum + (v.debit_paise || 0), 0);

  const totalReceipts = vouchers
    .filter((v) => {
      const t = v.voucher_type.toLowerCase();
      return t === 'receipt' || t.includes('credit note');
    })
    .reduce((sum, v) => sum + (v.credit_paise || v.debit_paise || 0), 0);

  const totalJournalCredit = vouchers
    .filter((v) => v.voucher_type.toLowerCase() === 'journal')
    .reduce((sum, v) => sum + (v.credit_paise || 0), 0);

  const totalJournalDebit = vouchers
    .filter((v) => v.voucher_type.toLowerCase() === 'journal')
    .reduce((sum, v) => sum + (v.debit_paise || 0), 0);

  const currentOutstandingPaise = vouchers.length > 0
    ? Math.max(0, currentOpeningPaise + totalSalesDebit + totalJournalDebit - totalReceipts - totalJournalCredit)
    : (debtor.balance !== undefined ? Math.round(Number(debtor.balance) * 100) : (debtor.debitPaise || 0));

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

    // Credits pool: receipts, credit notes, and credit journal entries
    let remainingCredits = vouchers
      .filter((v) => {
        const t = v.voucher_type.toLowerCase();
        return t === 'receipt' || t.includes('credit note') || (t === 'journal' && v.credit_paise > 0);
      })
      .reduce((sum, v) => sum + (v.credit_paise || v.debit_paise || 0), 0);

    // 1. Opening balance is the oldest debit
    if (currentOpeningPaise > 0) {
      if (remainingCredits >= currentOpeningPaise) {
        remainingCredits -= currentOpeningPaise;
      } else {
        buckets.bucket90Plus += (currentOpeningPaise - remainingCredits);
        remainingCredits = 0;
      }
    }

    // 2. Debit vouchers sorted chronologically oldest first
    const debitVouchers = vouchers
      .filter((v) => {
        const t = v.voucher_type.toLowerCase();
        return t === 'sales' || t.includes('debit note') || (t === 'journal' && v.debit_paise > 0);
      })
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
  }, [vouchers, debtor, currentOpeningPaise, currentOutstandingPaise]);

  const filteredVouchers = vouchers.filter((v) => {
    if (filterType === 'SALES') return v.voucher_type.toLowerCase() === 'sales';
    if (filterType === 'RECEIPT') return v.voucher_type.toLowerCase() === 'receipt';
    return true;
  });

  const handleShareWhatsApp = () => {
    const partyName = debtor.name || debtor.customerName || 'Customer';
    const currentBal = rupees(currentOutstandingPaise);

    const phone = (debtor.mobile || '').replace(/[^0-9]/g, '');
    const cleanPhone = phone.length === 10 ? `91${phone}` : phone;

    const lines = [
      `*DURASMART - Statement of Account*`,
      `--------------------------------`,
      `*Party:* ${partyName}`,
      `*City:* ${debtor.city || debtor.state || 'Punjab'}`,
      `*Opening Balance:* ${rupees(currentOpeningPaise)}`,
      `*Total Billed Sales:* ${rupees(totalSalesDebit)}`,
      `*Total Bank Receipts:* ${rupees(totalReceipts)}`,
      `*Current Outstanding:* ${currentBal}`,
      ``,
      `*Aging Breakdown:*`,
      `• 0-30 Days: ${rupees(aging.bucket0_30)}`,
      `• 31-60 Days: ${rupees(aging.bucket31_60)}`,
      `• 61-90 Days: ${rupees(aging.bucket61_90)}`,
      `• 90+ Days: ${rupees(aging.bucket90Plus)}`,
      ``,
      `*Recent Vouchers:*`,
      ...vouchers.slice(0, 5).map((v) => `• ${v.voucher_date} | ${v.voucher_type} (${v.voucher_no || '—'}): ${v.debit_paise > 0 ? '+' + rupees(v.debit_paise) : '-' + rupees(v.credit_paise)}`),
      ``,
      `Please clear any overdue balance at your earliest convenience.`,
      `Thank you,`,
      `*Dura Smart Doors & Windows*`
    ];

    const text = encodeURIComponent(lines.join('\n'));
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
    window.open(url, '_blank');
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
    } catch (err) {
      alert('Failed to delete voucher');
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
            <p className="text-xs text-slate-500 font-medium">
              Ledger Statement · ID: <span className="font-mono text-slate-700 font-semibold">{debtor.id || debtor.customerId}</span> · {debtor.city || debtor.state || 'Punjab'}
              {debtor.mobile ? ` · Mobile: ${debtor.mobile}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
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
            <p className="font-mono text-base font-extrabold text-slate-800">{rupees(currentOpeningPaise)}</p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Billed Sales</span>
            <p className="font-mono text-base font-extrabold text-blue-700">{rupees(totalSalesDebit)}</p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Bank Receipts</span>
            <p className="font-mono text-base font-extrabold text-emerald-700">{rupees(totalReceipts)}</p>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Current Outstanding</span>
            <p className="font-mono text-base font-extrabold text-slate-900">
              {rupees(currentOutstandingPaise)}
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

        {/* Filter Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/60 px-6 py-2.5 text-xs no-print">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-700 mr-2">Filter:</span>
            {(['ALL', 'SALES', 'RECEIPT'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`rounded-md px-3 py-1 text-[11px] font-bold transition ${
                  filterType === t ? 'bg-slate-900 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t === 'ALL' ? 'All Vouchers' : t === 'SALES' ? 'Sales Bills' : 'Bank Receipts'}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-medium text-slate-500">
            {filteredVouchers.length} {filteredVouchers.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {/* Voucher Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-white">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="py-10 text-center text-xs font-medium text-slate-500">
              No matching vouchers found for this filter.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b-2 border-slate-200 bg-slate-50 text-[11px] font-black uppercase text-slate-700">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Vch No</th>
                  <th className="py-2.5 px-3">Particulars (Account)</th>
                  <th className="py-2.5 px-3 text-right">Debit (+)</th>
                  <th className="py-2.5 px-3 text-right">Credit (-)</th>
                  <th className="py-2.5 px-3 text-center no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
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
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition"
              title="Share Statement on WhatsApp"
            >
              <MessageCircle size={14} />
              Share on WhatsApp
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100 transition"
              title="Print or Save PDF"
            >
              <Printer size={14} />
              Print / PDF
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
    </div>
  );
}

function DebtorListCard() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(false);
  const [syncingHrPb, setSyncingHrPb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedDebtorLedger, setSelectedDebtorLedger] = useState<ServerDebtor | null>(null);
  const [syncingBooks, setSyncingBooks] = useState(false);
  const [booksMessage, setBooksMessage] = useState<string | null>(null);

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

  // Merge Debtors State
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);
  const [allDebtorsDirectory, setAllDebtorsDirectory] = useState<ServerDebtor[]>([]);

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
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [activeOnly],
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
            htmlFor="debtor-workbook-file-input"
            className="btn-primary !py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white"
            title="Upload and import sales.xlsx, individual customer ledgers (e.g. S S Kalra Zira.xlsx), or HR-PB.xlsx"
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
            {syncingHrPb ? 'Syncing...' : '1-Click Sync HR-PB'}
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

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black text-ink">Debtor Master</h2>
          <p className="text-[11px] text-muted">
            Dealers and parties with balance, station, salesperson, and live Edit / Delete controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-line bg-canvas/40 p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveOnly(false);
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${!activeOnly ? 'bg-brand-blue text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              All Debtors
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveOnly(true);
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${activeOnly ? 'bg-brand-blue text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              With Balance Only
            </button>
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
                  const balPaise = Math.round((row.balance !== undefined ? parseFloat(String(row.balance)) : (row.debitPaise || 0) / 100) * 100);
                  const isPos = balPaise > 0;
                  return (
                    <tr key={row.id || row.customerId} className="border-b border-line/60 last:border-b-0 hover:bg-canvas/50">
                      <td className="px-3 py-2 align-middle">
                        <span className="font-bold text-ink">{partyTitle}</span>
                        <span className="ml-2 text-[10px] text-faint">{row.id || row.customerId}</span>
                      </td>
                      <td className="px-3 py-2 align-middle text-muted">{cityStation}</td>
                      <td className="px-3 py-2 align-middle font-medium text-ink">{sp}</td>
                      <td className="px-3 py-2 text-right align-middle font-semibold tabular-nums text-ink">
                        <span className={`rounded px-2 py-0.5 border font-mono text-[11px] font-bold ${
                          isPos
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : 'bg-canvas border-line text-slate-400'
                        }`}>
                          {rupees(balPaise)}
                        </span>
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SectionErrorBoundary caught:', error, errorInfo);
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
