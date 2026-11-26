import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSearch,
  IndianRupee,
  Plus,
  RefreshCw,
  Share2,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
  X,
  ReceiptText,
  ArrowRightLeft,
} from 'lucide-react';
import { Card, PageHeader, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { exactRupees, paiseFromRupees } from '../lib/entryRules';
import { fmtDateTime, rupees, rupeesDrCr } from '../lib/format';
import { invalidate, syncKeys } from '../lib/syncStore';
import { toast } from '../lib/toast';
import { useLiveList } from '../lib/useLiveList';
import {
  applyPaymentWorkbook,
  deletePayment,
  deleteVoucher,
  getMonthlyPaymentSummary,
  listBankTransactions,
  listCustomers,
  listDebtors,
  listEmployees,
  listPayments,
  previewPaymentWorkbook,
  purgeTestPayments,
  recordPayment,
  serverHost,
  transferVoucher,
  BankSummary,
  ServerCustomer,
  ServerDebtor,
  ServerDebtorPreview,
  ServerEmployee,
  ServerMonthlyPaymentSummary,
  ServerPayment,
  ServerVoucher,
  voidPayment,
} from '../lib/serverApi';

const PAGE_SIZE = 20;

function formatShortCr(amountRupees: number): string {
  const n = Math.abs(amountRupees);
  const sign = amountRupees < 0 ? '-' : '';
  if (n >= 10000000) return `${sign}₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `${sign}₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `${sign}₹${(n / 1000).toFixed(1)}k`;
  return `${sign}₹${Math.round(n)}`;
}

export default function Payment() {
  const [activeTab, setActiveTab] = useState<'overview' | 'bank' | 'manual'>('overview');

  // ── Payment Control Tower (Mobile UI Parity) State ──────────────────────────
  const [scopeMonth, setScopeMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [scopeSalesperson, setScopeSalesperson] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState('');
  const [monthlySummary, setMonthlySummary] = useState<ServerMonthlyPaymentSummary | null>(null);
  const [employees, setEmployees] = useState<ServerEmployee[]>([]);
  const [debtors, setDebtors] = useState<ServerDebtor[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // ── Manual Payment Collection State ─────────────────────────────────────────
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listPayments({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customers, setCustomers] = useState<ServerCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [dealerSearch, setDealerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('NEFT');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<ServerPayment | null>(null);
  const modalId = useId();

  // ── Bank Statement & Date-Wise Transactions State ───────────────────────────
  const [bankVouchers, setBankVouchers] = useState<ServerVoucher[]>([]);
  const [bankSummary, setBankSummary] = useState<BankSummary>({
    totalVouchers: 0,
    totalReceiptsPaise: 0,
    totalPaymentsPaise: 0,
    netPaise: 0,
  });
  const [loadingBank, setLoadingBank] = useState(false);
  const [bankFilter, setBankFilter] = useState<'all' | 'day' | 'hdfc' | 'yes' | 'cash' | 'khan' | 'gbd'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'receipt' | 'payment'>('all');
  const [bankSearch, setBankSearch] = useState('');
  const [intervalType, setIntervalType] = useState<'all' | 'monthly' | 'quarterly' | 'custom'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const setMonthPeriod = () => {
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setIntervalType('monthly');
    setFromDate(start);
    setToDate(end);
  };

  const setQuarterPeriod = () => {
    const now = new Date();
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`;
    const endQMonth = qMonth + 3;
    const lastDay = new Date(now.getFullYear(), endQMonth, 0).getDate();
    const end = `${now.getFullYear()}-${String(endQMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setIntervalType('quarterly');
    setFromDate(start);
    setToDate(end);
  };

  const setAllTimePeriod = () => {
    setIntervalType('all');
    setFromDate('');
    setToDate('');
  };

  // Bank file upload & preview state
  const [bankPhase, setBankPhase] = useState<
    | { kind: 'idle' }
    | { kind: 'reading' }
    | { kind: 'done'; preview: ServerDebtorPreview; bytes: Uint8Array; label: string }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const [bankApplyBusy, setBankApplyBusy] = useState(false);
  const [bankApplySuccess, setBankApplySuccess] = useState<string | null>(null);

  // Transfer Voucher Modal State
  const [transferringVoucher, setTransferringVoucher] = useState<ServerVoucher | null>(null);
  const [targetPartyId, setTargetPartyId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  // Load customer directory for modals
  const loadCustomers = useCallback(() => {
    setLoadingCustomers(true);
    listCustomers({ pageSize: 500 })
      .then((res) => setCustomers(res.items))
      .catch((err) => toast.error(`Failed to load dealers: ${err.message || 'Network error'}`))
      .finally(() => setLoadingCustomers(false));
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const loadOverviewData = useCallback(() => {
    setLoadingOverview(true);
    const spObj = employees.find((e) => e.id === scopeSalesperson);
    Promise.all([
      getMonthlyPaymentSummary({
        year: scopeMonth.year,
        month: scopeMonth.month,
        salespersonId: scopeSalesperson || undefined,
        salesperson: spObj?.name || undefined,
      }),
      listDebtors({ pageSize: 2000, partyType: 'customer' }),
      employees.length === 0 ? listEmployees({ pageSize: 200 }) : Promise.resolve(null),
    ])
      .then(([summaryRes, debtorsRes, empRes]) => {
        setMonthlySummary(summaryRes);
        setDebtors(debtorsRes.items || []);
        if (empRes) {
          setEmployees((empRes.items || []).filter((e) => (e.department || '').toLowerCase() === 'sales'));
        }
      })
      .catch((err) => toast.error(`Failed to load payment summary: ${err.message || 'Network error'}`))
      .finally(() => setLoadingOverview(false));
  }, [scopeMonth.year, scopeMonth.month, scopeSalesperson, employees]);

  useEffect(() => {
    if (activeTab === 'overview') {
      loadOverviewData();
    }
  }, [activeTab, loadOverviewData]);

  const shiftScopeMonth = (delta: number) => {
    setScopeMonth((prev) => {
      const d = new Date(prev.year, prev.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  const scopeMonthLabel = useMemo(() => {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[(scopeMonth.month - 1 + 12) % 12]} ${scopeMonth.year}`;
  }, [scopeMonth]);

  const scopedDebtors = useMemo(() => {
    const spObj = employees.find((e) => e.id === scopeSalesperson);
    const spNameLower = (spObj?.name || '').trim().toLowerCase();
    return debtors
      .filter((d) => {
        const bal = Number(d.balance || 0);
        if (bal <= 0) return false;
        if (scopeSalesperson) {
          const dSp = (d.salesperson || '').trim().toLowerCase();
          if (dSp !== spNameLower && dSp !== scopeSalesperson.toLowerCase()) return false;
        }
        if (overviewSearch.trim()) {
          const q = overviewSearch.trim().toLowerCase();
          if (
            !(d.name || '').toLowerCase().includes(q) &&
            !(d.city || '').toLowerCase().includes(q) &&
            !(d.salesperson || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
  }, [debtors, employees, scopeSalesperson, overviewSearch]);

  const overviewStats = useMemo(() => {
    const totalOutstanding = monthlySummary?.outstanding ?? scopedDebtors.reduce((s, d) => s + Number(d.balance || 0), 0);
    const totalOverdue = monthlySummary?.overdue ?? totalOutstanding;
    const monthCollected = monthlySummary?.monthCollected ?? 0;
    const dealersWithBalance = monthlySummary?.dealersWithBalance ?? scopedDebtors.length;
    const totalDealers = monthlySummary?.totalDealers ?? debtors.length;
    const spObj = employees.find((e) => e.id === scopeSalesperson);
    const scopeName = spObj?.name || 'Full team';
    return {
      totalOutstanding,
      totalOverdue,
      monthCollected,
      dealersWithBalance,
      totalDealers,
      scopeName,
    };
  }, [monthlySummary, scopedDebtors, debtors.length, employees, scopeSalesperson]);

  const teamSummaryText = useMemo(() => {
    const lines: string[] = [
      'Dura Smart — payment summary',
      `Scope: ${overviewStats.scopeName}`,
      `Month: ${scopeMonthLabel}`,
    ];
    if (overdueOnly) lines.push('Filter: overdue balances only');
    lines.push(`Customers with a balance: ${overviewStats.dealersWithBalance}`);
    lines.push(`Total outstanding: ${rupeesDrCr(Math.round(overviewStats.totalOutstanding * 100))}`);
    lines.push(`Of which overdue: ${rupeesDrCr(Math.round(overviewStats.totalOverdue * 100))}`);
    lines.push(`Collected in ${scopeMonthLabel}: ${rupees(Math.round(overviewStats.monthCollected * 100))}`);
    lines.push('');
    lines.push('Largest balances:');
    const top = scopedDebtors.slice(0, 6);
    if (top.length === 0) {
      lines.push('• No customer balance in this scope.');
    } else {
      for (const d of top) {
        lines.push(`• ${d.name} (${d.city || d.state || 'Punjab'}) — ${rupeesDrCr(Math.round(Number(d.balance || 0) * 100))}`);
      }
    }
    return lines.join('\n');
  }, [overviewStats, scopeMonthLabel, overdueOnly, scopedDebtors]);

  // Load date-wise bank transactions
  const reloadBankTransactions = useCallback(() => {
    setLoadingBank(true);
    listBankTransactions({
      bank: bankFilter === 'all' ? undefined : bankFilter,
      voucherType: typeFilter === 'all' ? undefined : typeFilter,
      q: bankSearch.trim() || undefined,
      limit: 300,
      from: fromDate || undefined,
      to: toDate || undefined,
      interval: intervalType,
    })
      .then((res) => {
        setBankVouchers(res.items);
        setBankSummary(res.summary);
        setLoadingBank(false);
      })
      .catch((err) => {
        toast.error(`Failed to load bank statement: ${err.message || 'Network error'}`);
        setLoadingBank(false);
      });
  }, [bankFilter, typeFilter, bankSearch, fromDate, toDate, intervalType]);

  useEffect(() => {
    if (activeTab === 'bank') {
      reloadBankTransactions();
    }
  }, [activeTab, reloadBankTransactions]);

  // Handle Bank Upload File
  const handleBankUpload = async (file: File) => {
    setBankPhase({ kind: 'reading' });
    setBankApplySuccess(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = await previewPaymentWorkbook(bytes, file.name);
      setBankPhase({ kind: 'done', preview, bytes, label: file.name });
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setBankPhase({
        kind: 'failed',
        message: errObj?.message || 'The uploaded file could not be read as a valid Bank or Cash statement.',
      });
    }
  };

  const handleApplyBankBook = async () => {
    if (bankPhase.kind !== 'done') return;
    setBankApplyBusy(true);
    try {
      const outcome = await applyPaymentWorkbook(bankPhase.bytes, {
        fileName: bankPhase.label,
        fileSha256: bankPhase.preview.fileSha256,
        previewDigest: bankPhase.preview.applyPreviewDigest,
        allowReplacement: false,
      });
      setBankApplySuccess(
        `Applied ${outcome.snapshotRowCount} transactions from ${outcome.sheetName}. Party ledgers & bank book updated.`,
      );
      setBankPhase({ kind: 'idle' });
      reloadBankTransactions();
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.dashboard, syncKeys.vouchers);
      toast.success('Bank book applied successfully!');
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to apply bank book');
    } finally {
      setBankApplyBusy(false);
    }
  };

  const handleDeleteBankVoucher = async (v: ServerVoucher) => {
    if (
      !window.confirm(
        `Permanently delete ${v.voucher_type} (${v.voucher_no || v.id}) for ₹${(
          (v.credit_paise || v.debit_paise) / 100
        ).toFixed(2)}?\n\nThis will reverse the balance entry in the customer's ledger.`,
      )
    )
      return;
    try {
      await deleteVoucher(v.id);
      toast.success('Voucher deleted');
      reloadBankTransactions();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to delete voucher');
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferringVoucher || !targetPartyId) return;
    setTransferBusy(true);
    try {
      await transferVoucher(transferringVoucher.id, targetPartyId, transferNotes);
      toast.success('Voucher successfully shifted to target customer ledger');
      setTransferringVoucher(null);
      setTargetPartyId('');
      setTransferNotes('');
      reloadBankTransactions();
      invalidate(syncKeys.debtors, syncKeys.customers);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to shift voucher');
    } finally {
      setTransferBusy(false);
    }
  };

  // ── Manual Payment Actions ──────────────────────────────────────────────────
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || !selectedCustomer) {
      toast.error('Please select a customer / dealer');
      return;
    }

    const trimmed = amountInput.trim();
    if (!trimmed) {
      toast.error('Please enter payment amount in rupees');
      return;
    }

    const res = paiseFromRupees(trimmed);
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    const paise = res.paise;

    setSubmitting(true);
    try {
      const idempotencyKey = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const saved = await recordPayment(
        {
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          amountPaise: paise,
          paymentDate,
          method,
          reference: reference.trim(),
          notes: notes.trim(),
        },
        idempotencyKey,
      );

      setLastSaved(saved);
      toast.success(`Payment of ${exactRupees(paise)} recorded successfully!`);
      setIsModalOpen(false);
      setAmountInput('');
      setReference('');
      setNotes('');
      setSelectedCustomerId('');
      setDealerSearch('');

      sync.refresh();
      invalidate(
        syncKeys.payments,
        syncKeys.debtors,
        syncKeys.customers,
        syncKeys.dashboard,
        syncKeys.orderList(),
      );
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (payment: ServerPayment) => {
    const ok = window.confirm(
      `Void payment receipt for ${payment.customerName} (${exactRupees(payment.amountPaise)})?\n\nThis will reverse the balance deduction and re-add this amount to the customer's balance.`,
    );
    if (!ok) return;

    try {
      await voidPayment(payment.id);
      toast.success(`Payment voucher voided. Balance restored.`);
      sync.refresh();
      invalidate(
        syncKeys.payments,
        syncKeys.debtors,
        syncKeys.customers,
        syncKeys.dashboard,
        syncKeys.orderList(),
      );
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to void payment');
    }
  };

  const handleDelete = async (payment: ServerPayment) => {
    const ok = window.confirm(
      `Delete payment receipt for ${payment.customerName} (${exactRupees(payment.amountPaise)}) permanently?\n\n` +
        (!payment.voidedAt
          ? 'This payment is active. Deleting it will restore the customer balance and permanently erase this record.'
          : 'This will permanently remove this voided voucher.'),
    );
    if (!ok) return;

    try {
      await deletePayment(payment.id);
      toast.success('Payment voucher permanently deleted.');
      sync.refresh();
      invalidate(
        syncKeys.payments,
        syncKeys.debtors,
        syncKeys.customers,
        syncKeys.dashboard,
        syncKeys.orderList(),
      );
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to delete payment');
    }
  };

  const handlePurgeTests = async () => {
    const ok = window.confirm(
      'Clean all test and duplicate entries?\n\nThis will purge any test vouchers (TEST-*) and restore party balances.',
    );
    if (!ok) return;

    try {
      const res = await purgeTestPayments();
      toast.success(`Purged ${res.purgedCount} test/duplicate payments.`);
      sync.refresh();
      invalidate(
        syncKeys.payments,
        syncKeys.debtors,
        syncKeys.customers,
        syncKeys.dashboard,
        syncKeys.orderList(),
      );
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      toast.error(errObj?.message || 'Failed to purge test payments');
    }
  };

  const formatWhatsAppMessage = (p: ServerPayment) => {
    return encodeURIComponent(
      `*DURA SMART - PAYMENT RECEIPT*\n` +
        `--------------------------------\n` +
        `Customer: ${p.customerName}\n` +
        `Amount: ${exactRupees(p.amountPaise)}\n` +
        `Date: ${p.paymentDate}\n` +
        `Method: ${p.method}\n` +
        (p.reference ? `Reference: ${p.reference}\n` : '') +
        (p.notes ? `Notes: ${p.notes}\n` : '') +
        `--------------------------------\n` +
        `Status: Received & Verified\n` +
        `Thank you for your business!`,
    );
  };

  const filteredCustomers = customers.filter(
    (c) =>
      !dealerSearch ||
      c.name.toLowerCase().includes(dealerSearch.toLowerCase()) ||
      c.city.toLowerCase().includes(dealerSearch.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Payment & Register"
        subtitle={`Chronological bank & cash books and collection register on ${serverHost()} — date-wise transactions with auto customer reconciliation.`}
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-1.5"
            onClick={() => {
              setActiveTab('manual');
              setIsModalOpen(true);
            }}
          >
            <Plus size={16} /> Record Manual Receipt
          </button>
        }
      />

      {/* Primary Tab Switcher */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
            activeTab === 'overview'
              ? 'border-brand-blue text-brand-blue'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <Wallet size={16} /> Payments Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bank')}
          className={`flex items-center gap-2 border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
            activeTab === 'bank'
              ? 'border-brand-blue text-brand-blue'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <Building2 size={16} /> Bank &amp; Cash Statement Ledger (HDFC, Yes, Cash, Khan &amp; GBD)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={`flex items-center gap-2 border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
            activeTab === 'manual'
              ? 'border-brand-blue text-brand-blue'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <ReceiptText size={16} /> Manual Receipt Entry &amp; Counter Collection
        </button>
      </div>

      {/* ── TAB 0: PAYMENTS OVERVIEW (MOBILE APK UI PARITY) ───────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Scope Card */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">Scope</h2>
              <button
                type="button"
                onClick={loadOverviewData}
                disabled={loadingOverview}
                className="btn btn-secondary !py-1 !px-2.5 text-xs inline-flex items-center gap-1"
              >
                <RefreshCw size={13} className={loadingOverview ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-center">
              {/* Month Selector */}
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas/50 px-3 py-2">
                <button
                  type="button"
                  onClick={() => shiftScopeMonth(-1)}
                  className="rounded-lg p-1 hover:bg-surface"
                  title="Previous month"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-extrabold text-ink">{scopeMonthLabel}</span>
                <button
                  type="button"
                  onClick={() => shiftScopeMonth(1)}
                  className="rounded-lg p-1 hover:bg-surface"
                  title="Next month"
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Salesperson Scope Dropdown */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">Salesperson Scope</label>
                <select
                  value={scopeSalesperson}
                  onChange={(e) => setScopeSalesperson(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink focus:border-brand-blue focus:outline-none"
                >
                  <option value="">All Debtors (Full team)</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Overdue Balances Only Toggle */}
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-canvas/30 px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-ink">Overdue balances only</p>
                  <p className="text-[11px] text-muted">Hides customers within credit days.</p>
                </div>
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => setOverdueOnly(e.target.checked)}
                  className="h-4 w-4 accent-brand-blue"
                />
              </label>
            </div>
          </Card>

          {/* 4 KPI Metric Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted">Total outstanding</p>
                  <p className="mt-1 text-2xl font-black text-ink">
                    {formatShortCr(overviewStats.totalOutstanding)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {overviewStats.scopeName} • {rupeesDrCr(Math.round(overviewStats.totalOutstanding * 100))}
                  </p>
                </div>
                <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-sm">
                  <Wallet size={18} />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted">Overdue</p>
                  <p className="mt-1 text-2xl font-black text-ink">
                    {formatShortCr(overviewStats.totalOverdue)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {overviewStats.dealersWithBalance} customer(s) past due date
                  </p>
                </div>
                <div className="rounded-xl bg-rose-500 p-2.5 text-white shadow-sm">
                  <AlertTriangle size={18} />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted">Collected • {scopeMonthLabel}</p>
                  <p className="mt-1 text-2xl font-black text-emerald-700">
                    {formatShortCr(overviewStats.monthCollected)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    Payments booked this month in scope
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-600 p-2.5 text-white shadow-sm">
                  <IndianRupee size={18} />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted">Customers with balance</p>
                  <p className="mt-1 text-2xl font-black text-ink">
                    {overviewStats.dealersWithBalance}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    of {overviewStats.totalDealers} customers on record
                  </p>
                </div>
                <div className="rounded-xl bg-sky-600 p-2.5 text-white shadow-sm">
                  <Users size={18} />
                </div>
              </div>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold text-ink">Quick actions</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('manual');
                  setIsModalOpen(true);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas/50 px-4 py-2.5 text-xs font-bold text-ink hover:bg-brand-blue/10 hover:text-brand-blue transition"
              >
                <Plus size={15} /> Record payment
              </button>
              <Link
                to="/debtors"
                className="flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas/50 px-4 py-2.5 text-xs font-bold text-ink hover:bg-brand-blue/10 hover:text-brand-blue transition"
              >
                <Users size={15} /> Debtor List &amp; Ledgers
              </Link>
              <button
                type="button"
                onClick={() => setActiveTab('bank')}
                className="flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas/50 px-4 py-2.5 text-xs font-bold text-ink hover:bg-brand-blue/10 hover:text-brand-blue transition"
              >
                <Building2 size={15} /> Bank &amp; Cash Statements
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                className="flex items-center justify-center gap-2 rounded-xl border border-line bg-canvas/50 px-4 py-2.5 text-xs font-bold text-ink hover:bg-brand-blue/10 hover:text-brand-blue transition"
              >
                <ReceiptText size={15} /> Manual Receipt Register
              </button>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Balances in Scope */}
            <Card className="p-4 lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-ink">Balances in scope</h2>
                  <p className="text-[11px] text-muted">
                    {scopedDebtors.length} debtor(s) with receivable balance — sorted largest first
                  </p>
                </div>
                <input
                  type="search"
                  value={overviewSearch}
                  onChange={(e) => setOverviewSearch(e.target.value)}
                  placeholder="Search dealer, city, salesperson..."
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs focus:border-brand-blue focus:outline-none"
                />
              </div>
              <div className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {scopedDebtors.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted">
                    No customer in this scope has an open balance.
                  </p>
                ) : (
                  scopedDebtors.slice(0, 60).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 py-2.5 hover:bg-canvas/40 px-2 rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">{d.name}</p>
                        <p className="truncate text-[11px] text-muted">
                          {d.city || d.district || d.state || 'Punjab'} • Rep: {d.salesperson || 'Unassigned'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-rose-700">
                          {rupeesDrCr(Math.round(Number(d.balance || 0) * 100))}
                        </span>
                        <Link
                          to={`/debtors?q=${encodeURIComponent(d.name || '')}`}
                          className="rounded-md bg-brand-blue/10 px-2 py-1 text-[10px] font-bold text-brand-blue hover:bg-brand-blue/20"
                        >
                          Ledger →
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Share Team Summary */}
            <Card className="p-4">
              <h2 className="text-sm font-bold text-ink">Share team summary</h2>
              <p className="mb-3 text-[11px] text-muted">
                Readable WhatsApp summary of the current scope.
              </p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas/50 p-3 font-sans text-[11px] leading-relaxed text-ink">
                {teamSummaryText}
              </pre>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(teamSummaryText);
                    toast.success('Team summary copied!');
                  }}
                  className="btn btn-secondary flex-1 inline-flex items-center justify-center gap-1.5 text-xs"
                >
                  <Copy size={14} /> Copy
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(teamSummaryText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary flex-1 inline-flex items-center justify-center gap-1.5 text-xs"
                >
                  <Share2 size={14} /> WhatsApp
                </a>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB 1: BANK & CASH STATEMENT LEDGER ────────────────────────────────────── */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          {/* Period Filter & Balance Controller */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-muted mr-1">Period:</span>
              <button
                type="button"
                onClick={setAllTimePeriod}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  intervalType === 'all'
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={setMonthPeriod}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  intervalType === 'monthly'
                    ? 'bg-brand-blue text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={setQuarterPeriod}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  intervalType === 'quarterly'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                This Quarter
              </button>
              <button
                type="button"
                onClick={() => setIntervalType('custom')}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  intervalType === 'custom'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-canvas text-muted hover:bg-line/40 hover:text-ink'
                }`}
              >
                Custom Range
              </button>
            </div>

            {intervalType === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink"
                />
                <span className="text-xs text-muted">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink"
                />
              </div>
            )}

            <div className="text-xs font-semibold text-muted">
              Active: <span className="font-bold text-ink">{bankSummary.ledgerTitle || 'All Accounts'}</span>
              {bankSummary.periodStart && bankSummary.periodStart !== 'All Time' && (
                <span className="ml-1 text-[11px] text-faint">
                  ({bankSummary.periodStart} to {bankSummary.periodEnd})
                </span>
              )}
            </div>
          </div>

          {/* Dedicated 5-Card Financial Ledger Summary Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Opening Balance</span>
              <p className="mt-1 font-mono text-base font-black text-ink">
                {bankSummary.openingBalancePaise !== undefined ? rupeesDrCr(bankSummary.openingBalancePaise) : '—'}
              </p>
              <span className="text-[10px] text-faint">Baseline start of period</span>
            </div>

            <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
              <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-muted">
                <ArrowDownLeft size={14} className="text-emerald-600" /> Total Receipts (Cr)
              </span>
              <p className="mt-1 font-mono text-base font-black text-emerald-600">
                {rupees(bankSummary.totalReceiptsPaise)}
              </p>
              <span className="text-[10px] text-faint">Deposits / collections in window</span>
            </div>

            <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
              <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-muted">
                <ArrowUpRight size={14} className="text-rose-600" /> Total Payments (Dr)
              </span>
              <p className="mt-1 font-mono text-base font-black text-rose-600">
                {rupees(bankSummary.totalPaymentsPaise)}
              </p>
              <span className="text-[10px] text-faint">Withdrawals &amp; payouts</span>
            </div>

            <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Net Movement</span>
              <p
                className={`mt-1 font-mono text-base font-black ${
                  bankSummary.netPaise >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'
                }`}
              >
                {bankSummary.netPaise >= 0 ? '+' : ''}
                {rupees(bankSummary.netPaise)}
              </p>
              <span className="text-[10px] text-faint">Receipts minus payments</span>
            </div>

            <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-50/20 p-3.5 shadow-sm">
              <span className="text-[11px] font-black uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                Closing Balance
              </span>
              <p className="mt-1 font-mono text-lg font-black text-emerald-800 dark:text-emerald-300">
                {bankSummary.closingBalancePaise !== undefined ? rupeesDrCr(bankSummary.closingBalancePaise) : '—'}
              </p>
              <span className="text-[10px] font-medium text-emerald-700/80">Live calculated position</span>
            </div>
          </div>

          {/* Success Banner */}
          {bankApplySuccess && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              <span className="font-semibold">✓ {bankApplySuccess}</span>
              <button
                type="button"
                onClick={() => setBankApplySuccess(null)}
                className="text-muted hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* Bank & Cash Book Excel Upload Card */}
          <Card className="border-2 border-brand-blue/20">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-black text-ink">Upload Bank &amp; Cash Books (HDFC, Yes, Cash, Khan Cash &amp; Cash GBD)</h2>
                <p className="text-[11px] text-muted">
                  Upload <strong>hdfc.xlsx</strong>, <strong>yes.xlsx</strong>, <strong>cash.xlsx</strong>, <strong>khan cash.xlsx</strong>, or <strong>cash gbd.xlsx</strong>. The backend verifies the book title and auto-updates customer ledgers.
                  <em> (Note: Sales registers and target sheets must be uploaded in the Debtor section).</em>
                </p>
              </div>
              <input
                id="bank-workbook-input"
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleBankUpload(file);
                }}
              />
              <label
                htmlFor="bank-workbook-input"
                className="btn-primary !py-1.5 px-3 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <FileSearch size={15} /> Choose Statement Workbook
              </label>
            </div>

            {bankPhase.kind === 'idle' && (
              <label
                htmlFor="bank-workbook-input"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleBankUpload(file);
                }}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line hover:border-brand-blue bg-canvas/40 hover:bg-brand-blue/5 p-6 text-center cursor-pointer transition group"
              >
                <div className="rounded-full bg-brand-blue/10 p-2.5 text-brand-blue mb-2 group-hover:scale-110 transition">
                  <Building2 size={24} />
                </div>
                <p className="text-xs font-bold text-ink">Drag &amp; Drop or Browse HDFC / Yes Bank / Cash / Khan / GBD Excel Workbook</p>
                <p className="mt-0.5 text-[11px] text-muted max-w-sm">
                  Supports Tally HDFC Bank Book, Yes Bank Book, Cash Book, Khan Cash Book &amp; Cash GBD Book exports.
                </p>
              </label>
            )}

            {bankPhase.kind === 'reading' && (
              <p className="p-4 text-center text-xs font-bold text-muted">Reading and validating workbook…</p>
            )}

            {bankPhase.kind === 'failed' && (
              <div className="rounded-xl border border-brand-red/30 bg-brand-red/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-brand-red">
                  <ShieldAlert size={16} /> Upload Refused
                </p>
                <p className="mt-1 text-xs text-ink">{bankPhase.message}</p>
                <button
                  type="button"
                  className="btn-outline btn-sm mt-2"
                  onClick={() => setBankPhase({ kind: 'idle' })}
                >
                  Try another file
                </button>
              </div>
            )}

            {bankPhase.kind === 'done' && (
              <div className="rounded-xl border border-brand-blue/30 bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink text-xs flex items-center gap-1.5">
                    <CheckCircle2 size={16} className="text-brand-green" /> {bankPhase.label} —{' '}
                    <span className="font-bold text-brand-blue">{bankPhase.preview.sheetName}</span>
                  </span>
                  <span className="chip bg-brand-green/10 text-brand-green text-[11px] font-bold">
                    {bankPhase.preview.resolvedRowCount} transactions verified
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted sm:grid-cols-4">
                  <div className="rounded border border-line p-2">
                    <span className="block text-[10px] text-faint">Bank Source</span>
                    <span className="font-bold text-ink">{bankPhase.preview.sheetName}</span>
                  </div>
                  <div className="rounded border border-line p-2">
                    <span className="block text-[10px] text-faint">Transactions Count</span>
                    <span className="font-bold text-ink">{bankPhase.preview.resolvedRowCount} rows</span>
                  </div>
                  <div className="rounded border border-line p-2">
                    <span className="block text-[10px] text-faint">Date Detected</span>
                    <span className="font-bold text-ink">{bankPhase.preview.asOf || 'Present'}</span>
                  </div>
                  <div className="rounded border border-line p-2">
                    <span className="block text-[10px] text-faint">Status</span>
                    <span className="font-bold text-emerald-600">Eligible to Apply</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                  <button
                    type="button"
                    className="btn btn-secondary !py-1 text-xs"
                    onClick={() => setBankPhase({ kind: 'idle' })}
                    disabled={bankApplyBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary !py-1 text-xs font-bold"
                    onClick={handleApplyBankBook}
                    disabled={bankApplyBusy}
                  >
                    {bankApplyBusy
                      ? 'Applying Bank Transactions…'
                      : `Apply ${bankPhase.preview.resolvedRowCount} Bank Transactions`}
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* Date-Wise Bank & Cash Ledger Card */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="section-title">Date-Wise Bank &amp; Cash Statement Transactions</h3>
                <p className="text-[11px] text-muted">
                  Real-time chronological view of all bank &amp; cash receipts, payments and transfers.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bankFilter}
                  onChange={(e) => setBankFilter(e.target.value as 'all' | 'day' | 'hdfc' | 'yes' | 'cash' | 'khan' | 'gbd')}
                  className="input !w-auto !py-1.5 text-xs font-semibold"
                >
                  <option value="all">🏦 All Accounts (Bank, Cash &amp; Day Book)</option>
                  <option value="day">📖 Day Book Vouchers</option>
                  <option value="hdfc">🏦 HDFC Bank Book</option>
                  <option value="yes">🏦 Yes Bank Book</option>
                  <option value="cash">💵 Cash Book</option>
                  <option value="khan">💵 Khan Cash Book</option>
                  <option value="gbd">💵 Cash GBD Book</option>
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'all' | 'receipt' | 'payment')}
                  className="input !w-auto !py-1.5 text-xs"
                >
                  <option value="all">All Vouchers</option>
                  <option value="receipt">Receipts (Credit) Only</option>
                  <option value="payment">Payments (Debit) Only</option>
                </select>

                <input
                  type="text"
                  placeholder="Search party, voucher no…"
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  className="input !w-48 !py-1.5 text-xs"
                />

                <button
                  type="button"
                  onClick={reloadBankTransactions}
                  className="btn btn-secondary !py-1.5 px-2.5 text-xs"
                  title="Refresh statement transactions"
                >
                  <RefreshCw size={13} className={loadingBank ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {loadingBank ? (
              <p className="py-8 text-center text-xs text-muted">Loading statement ledger…</p>
            ) : bankVouchers.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">
                No transactions found. Upload <strong>hdfc.xlsx</strong>, <strong>yes.xlsx</strong>, <strong>cash.xlsx</strong>, <strong>khan cash.xlsx</strong>, or <strong>cash gbd.xlsx</strong> above to populate the ledger.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="border-b border-line bg-canvas/70 font-semibold text-muted">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Head / Account</th>
                      <th className="px-3 py-2">Vch Type</th>
                      <th className="px-3 py-2">Voucher #</th>
                      <th className="px-3 py-2">Particulars / Customer</th>
                      <th className="px-3 py-2 text-right">Receipt (Cr)</th>
                      <th className="px-3 py-2 text-right">Payment (Dr)</th>
                      <th className="px-3 py-2 text-center no-print">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {bankVouchers.map((v) => {
                      const vType = (v.voucher_type || '').toLowerCase();
                      const isReceipt = vType === 'receipt' || v.credit_paise > 0;
                      const isContra = vType === 'contra';

                      const bs = (v.book_source || '').toLowerCase();
                      let headBadge = 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300';
                      if (bs.includes('hdfc')) headBadge = 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
                      else if (bs.includes('yes')) headBadge = 'bg-purple-500/10 text-purple-700 dark:text-purple-300';
                      else if (bs.includes('khan')) headBadge = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
                      else if (bs.includes('gbd')) headBadge = 'bg-teal-500/10 text-teal-700 dark:text-teal-300';
                      else if (bs.includes('cash')) headBadge = 'bg-amber-500/10 text-amber-700 dark:text-amber-300';

                      let typeBadge = isReceipt ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700';
                      if (isContra) typeBadge = 'bg-sky-500/10 text-sky-700 dark:text-sky-300';

                      return (
                        <tr key={v.id} className="hover:bg-canvas/40 transition">
                          <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap text-ink">
                            {v.voucher_date}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`chip font-semibold text-[10px] ${headBadge}`}>
                              {v.book_source || 'Account'}
                            </span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap font-medium">
                            <span className={`chip font-bold text-[10px] ${typeBadge}`}>
                              {v.voucher_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted">
                            {v.voucher_no || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-ink block">{v.party_name}</span>
                            {v.narration && <span className="text-[10px] text-faint block">{v.narration}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                            {v.credit_paise > 0 ? rupees(v.credit_paise) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-rose-600">
                            {v.debit_paise > 0 ? rupees(v.debit_paise) : '—'}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap no-print">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setTransferringVoucher(v)}
                                className="rounded p-1 text-muted hover:bg-canvas hover:text-brand-blue"
                                title="Shift / Transfer entry to another customer"
                              >
                                <ArrowRightLeft size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBankVoucher(v)}
                                className="rounded p-1 text-muted hover:bg-rose-50 hover:text-rose-600"
                                title="Delete entry"
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
            )}
          </Card>
        </div>
      )}

      {/* ── TAB 2: MANUAL RECEIPT COLLECTION ───────────────────────────────── */}
      {activeTab === 'manual' && (
        <>
          {lastSaved && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <div className="min-w-0">
                <span className="font-bold text-emerald-800 dark:text-emerald-300">
                  ✓ Receipt recorded: {lastSaved.customerName} — {exactRupees(lastSaved.amountPaise)} ({lastSaved.method})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`https://wa.me/?text=${formatWhatsAppMessage(lastSaved)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-white font-semibold shadow hover:bg-emerald-700"
                >
                  <Share2 size={13} /> Share WhatsApp Receipt
                </a>
                <button
                  type="button"
                  className="text-muted hover:text-ink"
                  onClick={() => setLastSaved(null)}
                  title="Dismiss"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          <Card>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-muted">
                  Manual counter collection receipts. Voided vouchers or duplicates can be permanently deleted.
                </p>
                <button
                  type="button"
                  onClick={handlePurgeTests}
                  className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-canvas hover:text-ink"
                  title="Purge any residual test/duplicate payments"
                >
                  <Trash2 size={12} /> Clean Test Data
                </button>
              </div>
              <input
                className="input !w-auto !py-2"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setPage(1);
                }}
                placeholder="Search reference, invoice or customer…"
              />
            </div>
            <div className="mb-3">
              <LiveSyncBar sync={sync} busy={state === 'loading'} />
            </div>
            {state === 'loading' && <p className="text-xs text-faint">Loading receipts…</p>}
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
                {term ? 'No receipt matches that search.' : 'No manual payments on the backend yet.'}
              </p>
            )}
            {state === 'ready' && rows.length > 0 && (
              <>
                <div className="overflow-hidden rounded-field border border-line">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0 ${
                        r.voidedAt ? 'opacity-60 bg-canvas/30' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-ink">
                          {r.customerName}{' '}
                          <span className="font-semibold text-muted">
                            {r.reference ? `• ${r.reference}` : ''}
                            {r.orderNumber ? ` • order ${r.orderNumber}` : r.invoiceNumber ? ` • invoice ${r.invoiceNumber}` : ''}
                          </span>
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                          {r.paymentDate}
                          <StatusBadge status={r.method || 'unknown'} label={r.method || 'method not recorded'} />
                          {r.duplicateSuspected && (
                            <span title="The same money arrived from the other source; both rows count until a human voids one.">
                              <StatusBadge status="pending" label="possible duplicate" />
                            </span>
                          )}
                          {r.voidedAt && <StatusBadge status="rejected" label={`voided ${fmtDateTime(r.voidedAt)}`} />}
                          <span className="chip bg-canvas text-muted">source: {r.source}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`text-[12px] font-semibold ${
                            r.voidedAt
                              ? 'text-faint line-through'
                              : 'text-emerald-700 dark:text-emerald-400 font-bold'
                          }`}
                          title={r.voidedAt ? 'Voided — excluded from every balance' : undefined}
                        >
                          {exactRupees(r.amountPaise)}
                        </span>
                        {!r.voidedAt && (
                          <button
                            type="button"
                            onClick={() => handleVoid(r)}
                            className="rounded border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-500 hover:text-white dark:border-amber-800 dark:text-amber-400"
                            title="Void payment & restore balance"
                          >
                            Void
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(r)}
                          className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-brand-red transition hover:bg-brand-red hover:text-white dark:border-red-900"
                          title="Permanently delete payment voucher"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
              </>
            )}
          </Card>
        </>
      )}

      {/* ── Record Payment Modal ────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Record Payment Voucher</h2>
                <p className="text-xs text-muted">Instantly credits party ledger and persists to zero-loss database</p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setIsModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRecordSubmit} className="space-y-4">
              <div>
                <label htmlFor={`${modalId}-customer`} className="mb-1 block text-xs font-bold text-ink">
                  Select Customer / Dealer *
                </label>
                {loadingCustomers ? (
                  <p className="text-xs text-muted">Loading dealer registry…</p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="input mb-1.5 !py-1.5 text-xs"
                      placeholder="Type to filter dealers by name or city…"
                      value={dealerSearch}
                      onChange={(e) => setDealerSearch(e.target.value)}
                    />
                    <select
                      id={`${modalId}-customer`}
                      className="input !py-2 text-xs"
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      required
                    >
                      <option value="">-- Choose Dealer ({filteredCustomers.length} available) --</option>
                      {filteredCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.city || c.state}) — Bal: {exactRupees(c.outstandingPaise)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {selectedCustomer && (
                  <div className="mt-2 flex items-center justify-between rounded bg-canvas p-2 text-xs">
                    <div>
                      <span className="font-semibold text-ink">{selectedCustomer.name}</span>
                      <span className="text-muted"> • Outstanding: </span>
                      <span className="font-bold text-brand-red">{exactRupees(selectedCustomer.outstandingPaise)}</span>
                    </div>
                    {selectedCustomer.outstandingPaise > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const inRupees = (selectedCustomer.outstandingPaise / 100).toFixed(2);
                          setAmountInput(inRupees.endsWith('.00') ? inRupees.slice(0, -3) : inRupees);
                        }}
                        className="rounded bg-brand-navy/10 px-2 py-0.5 text-[11px] font-bold text-brand-navy hover:bg-brand-navy/20"
                      >
                        Pay Full
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${modalId}-amount`} className="mb-1 block text-xs font-bold text-ink">
                    Amount (₹) *
                  </label>
                  <input
                    id={`${modalId}-amount`}
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input !py-2 text-xs font-bold"
                    placeholder="e.g. 50000"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor={`${modalId}-date`} className="mb-1 block text-xs font-bold text-ink">
                    Payment Date *
                  </label>
                  <input
                    id={`${modalId}-date`}
                    type="date"
                    className="input !py-2 text-xs"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${modalId}-method`} className="mb-1 block text-xs font-bold text-ink">
                    Payment Method
                  </label>
                  <select
                    id={`${modalId}-method`}
                    className="input !py-2 text-xs"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="NEFT">NEFT / RTGS</option>
                    <option value="UPI">UPI</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Cash">Cash</option>
                    <option value="IMPS">IMPS</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`${modalId}-reference`} className="mb-1 block text-xs font-bold text-ink">
                    Reference / UTR / Cheque #
                  </label>
                  <input
                    id={`${modalId}-reference`}
                    type="text"
                    className="input !py-2 text-xs"
                    placeholder="e.g. UTR-98214"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={`${modalId}-notes`} className="mb-1 block text-xs font-bold text-ink">
                  Notes
                </label>
                <input
                  id={`${modalId}-notes`}
                  type="text"
                  className="input !py-2 text-xs"
                  placeholder="Optional remarks (e.g. Part payment for order)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  className="btn btn-secondary !py-1.5 text-xs"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary !py-1.5 text-xs"
                  disabled={submitting || !selectedCustomerId || !amountInput}
                >
                  {submitting ? 'Recording…' : 'Record & Post Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Transfer Voucher Modal ──────────────────────────────────────────── */}
      {transferringVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <ArrowRightLeft size={16} className="text-brand-blue" /> Transfer Entry
                </h2>
                <p className="text-[11px] text-muted">
                  Shift transaction from {transferringVoucher.party_name} to another customer ledger
                </p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setTransferringVoucher(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleTransferSubmit} className="space-y-3 text-xs">
              <div className="rounded bg-canvas p-2.5 text-ink">
                <span className="font-semibold block">{transferringVoucher.voucher_type} #{transferringVoucher.voucher_no || transferringVoucher.id}</span>
                <span className="text-muted">Amount: </span>
                <span className="font-bold text-brand-blue">
                  {rupees(transferringVoucher.credit_paise || transferringVoucher.debit_paise)}
                </span>
                <span className="text-muted"> • Date: {transferringVoucher.voucher_date}</span>
              </div>

              <div>
                <label className="block text-muted mb-1 font-semibold">Select Destination Customer *</label>
                <select
                  required
                  value={targetPartyId}
                  onChange={(e) => setTargetPartyId(e.target.value)}
                  className="input !py-1.5 text-xs"
                >
                  <option value="">-- Choose target customer --</option>
                  {customers
                    .filter((c) => c.name !== transferringVoucher.party_name)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.city || c.state})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-muted mb-1 font-semibold">Transfer Reason / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Mistakenly entered under sister firm"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  className="input !py-1.5 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  className="btn btn-secondary !py-1 text-xs"
                  onClick={() => setTransferringVoucher(null)}
                  disabled={transferBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary !py-1 text-xs font-bold"
                  disabled={transferBusy || !targetPartyId}
                >
                  {transferBusy ? 'Shifting…' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
