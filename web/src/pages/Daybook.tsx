import { useCallback, useEffect, useId, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Percent,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { Card, KpiCard, PageHeader } from '../components/ui/Card';
import { Pager } from '../components/ui/Pager';
import { rupees } from '../lib/format';
import { invalidate, syncKeys } from '../lib/syncStore';
import { toast } from '../lib/toast';
import {
  applyMultiExcel,
  BankLedgerResponse,
  CashLedgerResponse,
  deleteVoucher,
  DiscountLedgerResponse,
  getBankLedger,
  getCashLedger,
  getDiscountLedger,
  getRoundoffLedger,
  listVouchers,
  MultiExcelFileInfo,
  MultiExcelPreviewResponse,
  previewMultiExcel,
  resetAccountingBalances,
  RoundoffLedgerResponse,
  ServerVoucher,
} from '../lib/serverApi';

const PAGE_SIZE = 25;

type LedgerTab =
  | 'all'
  | 'cash'
  | 'bank'
  | 'roundoff'
  | 'discount'
  | 'sales'
  | 'payment'
  | 'receipt'
  | 'contra'
  | 'journal'
  | 'credit note'
  | 'debit note';

interface MultiUploadSlot {
  key: 'daybook' | 'roundoff' | 'discount' | 'journal' | 'trialbalance' | 'hdfc' | 'yesbank' | 'cash' | 'khancash' | 'cashgbd';
  title: string;
  description: string;
  hint: string;
  expectedName: string;
  file?: File;
  preview?: MultiExcelFileInfo;
}

export default function Daybook() {
  const [vouchers, setVouchers] = useState<ServerVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<LedgerTab>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  // Dedicated Ledger Metadata
  const [cashMeta, setCashMeta] = useState<CashLedgerResponse | null>(null);
  const [bankMeta, setBankMeta] = useState<BankLedgerResponse | null>(null);
  const [roundoffMeta, setRoundoffMeta] = useState<RoundoffLedgerResponse | null>(null);
  const [discountMeta, setDiscountMeta] = useState<DiscountLedgerResponse | null>(null);

  // 8-Excel Unified Upload Hub Modal State
  const [uploadOpen, setUploadOpen] = useState(false);
  const [slots, setSlots] = useState<Record<string, MultiUploadSlot>>({
    daybook: {
      key: 'daybook',
      title: 'Day Book (Commercial)',
      description: 'Master commercial registers (Sales, Purchases, Contra, Credit/Debit Notes)',
      hint: 'Liquid payments, receipts & contra auto-deduplicated against dedicated Bank & Cash Books',
      expectedName: 'DAYBOOK.xlsx',
    },
    hdfc: {
      key: 'hdfc',
      title: 'HDFC Bank Book',
      description: 'Authoritative HDFC Bank entries (Receipts & Payments with compound splits)',
      hint: 'Reconciles all HDFC bank receipts and payments with split legs',
      expectedName: 'hdfc.xlsx',
    },
    yesbank: {
      key: 'yesbank',
      title: 'Yes Bank Book',
      description: 'Authoritative Yes Bank entries (Receipts & Payments with compound splits)',
      hint: 'Reconciles all Yes Bank receipts and payments with split legs',
      expectedName: 'yesbank.xlsx',
    },
    cash: {
      key: 'cash',
      title: 'Cash Book',
      description: 'Authoritative Main Cash in Hand entries (Receipts & Payments)',
      hint: 'Reconciles physical Cash in Hand receipts and payments',
      expectedName: 'cash.xlsx',
    },
    khancash: {
      key: 'khancash',
      title: 'Khan Cash Book',
      description: 'Authoritative Khan Cash account entries with split details',
      hint: 'Reconciles Khan Cash collection receipts and payments',
      expectedName: 'khancash.xlsx',
    },
    cashgbd: {
      key: 'cashgbd',
      title: 'Cash GBD Book',
      description: 'Authoritative Gobindgarh Cash entries with split details',
      hint: 'Reconciles Cash Gbd receipts and payments',
      expectedName: 'cashgbd.xlsx',
    },
    journal: {
      key: 'journal',
      title: 'Journal Register',
      description: 'Master Double-Entry Journal Book (Discounts, TDS, Transfers)',
      hint: 'Replaces 1-sided Daybook journals with complete double entries for all parties',
      expectedName: 'JOURNAL.xlsx',
    },
    roundoff: {
      key: 'roundoff',
      title: 'Round Off Ledger',
      description: 'Dedicated rounding adjustments (P&L register)',
      hint: 'Separated from customer trade debtor balances',
      expectedName: 'ROUNDOFF.xlsx',
    },
    discount: {
      key: 'discount',
      title: 'Discount Ledger',
      description: 'Customer discounts (Cash/Trade/Scheme)',
      hint: 'Reconciles debtor credits while tracking discount totals',
      expectedName: 'DISCOUNT.xlsx',
    },
    trialbalance: {
      key: 'trialbalance',
      title: 'Trial Balance / Opening',
      description: 'Master ledger baseline opening balances',
      hint: 'Auto-maps baseline opening for debtors, creditors, cash & bank',
      expectedName: 'OP.xlsx / TRIALBALANCE.xlsx',
    },
  });

  const [multiPreview, setMultiPreview] = useState<MultiExcelPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cleanExistingBeforeApply, setCleanExistingBeforeApply] = useState(true);
  const [resettingBalances, setResettingBalances] = useState(false);

  const fileInputId = useId();

  // Load vouchers according to selected view/tab
  const loadData = useCallback(() => {
    setLoading(true);

    let effectiveSource: string | undefined = selectedSource === 'all' ? undefined : selectedSource;
    let effectiveType: string | undefined = undefined;

    if (selectedTab === 'cash') {
      effectiveSource = 'Cash Book';
    } else if (selectedTab === 'bank') {
      effectiveSource = 'bank';
    } else if (selectedTab === 'roundoff') {
      effectiveSource = 'Round Off Ledger';
    } else if (selectedTab === 'discount') {
      effectiveSource = 'Discount Ledger';
    } else if (selectedTab !== 'all') {
      effectiveType = selectedTab;
    }

    listVouchers({
      bookSource: effectiveSource,
      voucherType: effectiveType,
      q: searchQuery.trim() || undefined,
      limit: 20000,
    })
      .then((items) => {
        setVouchers(items || []);
        setLoading(false);
      })
      .catch((err) => {
        toast.error(`Failed to load Day Book: ${err.message || 'Error'}`);
        setLoading(false);
      });
  }, [selectedSource, selectedTab, searchQuery]);

  // Load dedicated ledger summaries
  const loadLedgerSummaries = useCallback(() => {
    getCashLedger().then(setCashMeta).catch(() => {});
    getBankLedger().then(setBankMeta).catch(() => {});
    getRoundoffLedger().then(setRoundoffMeta).catch(() => {});
    getDiscountLedger().then(setDiscountMeta).catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
    loadLedgerSummaries();
  }, [loadData, loadLedgerSummaries]);

  // File Drop / Selection for 4-Slot Hub
  const handleFilesDropped = (droppedFiles: FileList | File[]) => {
    const nextSlots = { ...slots };
    const filesArr = Array.from(droppedFiles);

    for (const f of filesArr) {
      const fn = f.name.toLowerCase();
      if (fn.includes('hdfc')) {
        nextSlots.hdfc = { ...nextSlots.hdfc, file: f };
      } else if (fn.includes('yesbank') || fn.includes('yes_bank') || fn.includes('yes bank') || fn === 'yes.xlsx') {
        nextSlots.yesbank = { ...nextSlots.yesbank, file: f };
      } else if (fn.includes('round') || fn.includes('roun')) {
        nextSlots.roundoff = { ...nextSlots.roundoff, file: f };
      } else if (fn.includes('disc')) {
        nextSlots.discount = { ...nextSlots.discount, file: f };
      } else if (fn.includes('journal') && !fn.includes('stock')) {
        nextSlots.journal = { ...nextSlots.journal, file: f };
      } else if (
        fn.includes('trial') ||
        fn.includes('open') ||
        fn.includes('tb') ||
        fn.startsWith('op.') ||
        fn.startsWith('op_') ||
        fn === 'op.xlsx' ||
        fn === 'op.xlsm'
      ) {
        nextSlots.trialbalance = { ...nextSlots.trialbalance, file: f };
      } else if (fn.includes('day') || fn.includes('book')) {
        nextSlots.daybook = { ...nextSlots.daybook, file: f };
      } else {
        // Fallback default: if daybook is empty assign to daybook, otherwise trialbalance
        if (!nextSlots.daybook.file) {
          nextSlots.daybook = { ...nextSlots.daybook, file: f };
        } else {
          nextSlots.trialbalance = { ...nextSlots.trialbalance, file: f };
        }
      }
    }
    setSlots(nextSlots);
    setMultiPreview(null);
  };

  const handlePreviewMulti = async () => {
    const selectedFiles = Object.values(slots)
      .map((s) => s.file)
      .filter((f): f is File => Boolean(f));

    if (selectedFiles.length === 0) {
      toast.info('Please select or drop at least one Excel workbook.');
      return;
    }

    setPreviewing(true);
    try {
      const res = await previewMultiExcel(selectedFiles);
      setMultiPreview(res);
      toast.success(`Parsed ${res.filesCount} workbooks successfully. Review summary below.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      toast.error(`Multi-Excel preview failed: ${msg}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApplyMulti = async () => {
    const selectedFiles = Object.values(slots)
      .map((s) => s.file)
      .filter((f): f is File => Boolean(f));

    if (selectedFiles.length === 0) return;

    setApplying(true);
    try {
      const res = await applyMultiExcel(selectedFiles, cleanExistingBeforeApply);
      toast.success(res.message || 'Multi-Excel upload successfully applied!');
      setUploadOpen(false);
      setMultiPreview(null);
      // Reset files in slots
      const clearedSlots = { ...slots };
      Object.keys(clearedSlots).forEach((k) => {
        clearedSlots[k] = { ...clearedSlots[k], file: undefined, preview: undefined };
      });
      setSlots(clearedSlots);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.vouchers);
      loadData();
      loadLedgerSummaries();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      toast.error(`Failed to apply Excel data: ${msg}`);
    } finally {
      setApplying(false);
    }
  };

  const handleResetBalances = async () => {
    if (!confirm('Are you sure you want to clean up all existing balances and vouchers?\n\nThis will purge all previous vouchers and opening balances, setting all customer and debtor balances to ₹0 so you can upload fresh Excel files cleanly.')) {
      return;
    }
    setResettingBalances(true);
    try {
      const res = await resetAccountingBalances();
      toast.success(res.message || 'Existing balances successfully cleaned!');
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.vouchers);
      loadData();
      loadLedgerSummaries();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reset failed';
      toast.error(`Failed to clean balances: ${msg}`);
    } finally {
      setResettingBalances(false);
    }
  };

  const handleDelete = async (vchId: string) => {
    if (!confirm('Are you sure you want to delete this voucher? Party balances will be adjusted.')) return;
    setDeleteBusyId(vchId);
    try {
      await deleteVoucher(vchId);
      toast.success('Voucher deleted successfully');
      invalidate(syncKeys.debtors, syncKeys.customers);
      loadData();
      loadLedgerSummaries();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      toast.error(`Failed to delete voucher: ${msg}`);
    } finally {
      setDeleteBusyId(null);
    }
  };

  // Metrics calculation
  const totalDebits = vouchers.reduce((acc, v) => acc + (v.debit_paise || 0), 0);
  const totalCredits = vouchers.reduce((acc, v) => acc + (v.credit_paise || 0), 0);
  const netMovement = totalDebits - totalCredits;

  // Pagination
  const pagedVouchers = vouchers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getVchBadge = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t === 'sales') return 'bg-blue-100 text-blue-800 border-blue-200';
    if (t === 'receipt') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (t === 'payment') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (t === 'contra') return 'bg-purple-100 text-purple-800 border-purple-200';
    if (t === 'journal') return 'bg-slate-100 text-slate-800 border-slate-300';
    if (t === 'credit note') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (t === 'debit note') return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Upload Button */}
      <PageHeader
        title="Day Book & Accounting Ledgers"
        subtitle="Unified financial ledger sync: Sales, Receipts, Payments, Contras, Cashbooks, Bank Accounts, and Dedicated Nominal Ledgers."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetBalances}
              disabled={resettingBalances}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
              title="Clean all existing vouchers and reset balances to zero before uploading fresh Excel files"
            >
              {resettingBalances ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span>{resettingBalances ? 'Cleaning...' : 'Clean Balances'}</span>
            </button>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
            >
              <Upload size={14} />
              <span>Master Excel Sync Hub</span>
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Vouchers"
          value={vouchers.length.toLocaleString('en-IN')}
          hint="Active financial vouchers in database"
          gradient="from-slate-700 to-slate-900"
          icon={<FileText size={20} />}
        />
        <KpiCard
          label="Total Debits (+)"
          value={rupees(totalDebits)}
          hint="Sales, payments, money applied"
          gradient="from-blue-600 to-indigo-600"
          icon={<TrendingUp size={20} />}
        />
        <KpiCard
          label="Total Credits (-)"
          value={rupees(totalCredits)}
          hint="Receipts, customer credits"
          gradient="from-emerald-600 to-teal-600"
          icon={<TrendingDown size={20} />}
        />
        <KpiCard
          label="Net Movement"
          value={`${rupees(Math.abs(netMovement))} ${netMovement >= 0 ? 'Dr' : 'Cr'}`}
          hint="Debit / Credit net difference"
          gradient="from-purple-600 to-pink-600"
          icon={<Filter size={20} />}
        />
      </div>

      {/* Dedicated Ledger Overview Banners */}
      {selectedTab === 'cash' && cashMeta && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                <Wallet size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black text-amber-950">Cash in Hand Ledgers (Liquid Accounts)</h4>
                <p className="text-xs text-amber-800">
                  Physical liquid cash treated strictly as Cash in Hand. Excluded from customer debtors.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
              {cashMeta.accounts.map((acc) => (
                <div key={acc.id} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 shadow-xs">
                  <span className="text-slate-500 mr-1.5">{acc.name}:</span>
                  <span className="font-mono text-amber-900 font-extrabold">{rupees(acc.balance_paise)}</span>
                </div>
              ))}
              <div className="rounded-lg bg-amber-600 px-3 py-1.5 text-white shadow-xs">
                <span>Total Cash: {rupees(cashMeta.totalBalancePaise)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedTab === 'bank' && bankMeta && (
        <Card className="border-l-4 border-l-blue-500 bg-blue-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-100 p-2 text-blue-700">
                <Building2 size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black text-blue-950">Bank Ledgers (Yes Bank & HDFC Bank)</h4>
                <p className="text-xs text-blue-800">
                  Live bank statements recorded in Payments & Contras. Classified as Bank accounts.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
              {bankMeta.accounts.map((acc) => (
                <div key={acc.id} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 shadow-xs">
                  <span className="text-slate-500 mr-1.5">{acc.name}:</span>
                  <span className="font-mono text-blue-900 font-extrabold">{rupees(acc.balance_paise)}</span>
                </div>
              ))}
              <div className="rounded-lg bg-blue-600 px-3 py-1.5 text-white shadow-xs">
                <span>Total Bank: {rupees(bankMeta.totalBalancePaise)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedTab === 'roundoff' && roundoffMeta && (
        <Card className="border-l-4 border-l-purple-500 bg-purple-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-100 p-2 text-purple-700">
                <Layers size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black text-purple-950">Round Off Ledger (Dedicated P&L)</h4>
                <p className="text-xs text-purple-800">
                  Separated from trade debtors into dedicated P&L nominal account. Total entries: {roundoffMeta.voucherCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <div className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 shadow-xs">
                <span className="text-slate-500 mr-1.5">Total Debits:</span>
                <span className="font-mono text-purple-900 font-extrabold">₹{roundoffMeta.totalDebit.toFixed(2)}</span>
              </div>
              <div className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 shadow-xs">
                <span className="text-slate-500 mr-1.5">Total Credits:</span>
                <span className="font-mono text-purple-900 font-extrabold">₹{roundoffMeta.totalCredit.toFixed(2)}</span>
              </div>
              <div className="rounded-lg bg-purple-600 px-3 py-1.5 text-white shadow-xs">
                <span>Net Round Off: ₹{roundoffMeta.netAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedTab === 'discount' && discountMeta && (
        <Card className="border-l-4 border-l-teal-500 bg-teal-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-teal-100 p-2 text-teal-700">
                <Percent size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black text-teal-950">Discount Ledger (Customer Deductions)</h4>
                <p className="text-xs text-teal-800">
                  Credits trade debtors while tracking total business discount expenses. Total entries: {discountMeta.voucherCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <div className="rounded-lg bg-teal-600 px-3 py-1.5 text-white shadow-xs">
                <span>Total Discounts Given: ₹{discountMeta.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[280px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by party name, voucher no, or narration..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Filter size={13} /> Source:
            </span>
            <select
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Books</option>
              <option value="Day Book">📖 Day Book Only</option>
              <option value="Sales Register">📑 Sales Register</option>
              <option value="HDFC Bank Book">🏦 HDFC Bank Book</option>
              <option value="Yes Bank Book">🏦 Yes Bank Book</option>
              <option value="Cash Book">💵 Cash Book (All)</option>
              <option value="Khan Cash Book">💵 Khan Cash Book</option>
              <option value="Cash GBD Book">💵 Cash GBD Book</option>
              <option value="Round Off Ledger">⚖️ Round Off Ledger</option>
              <option value="Discount Ledger">🏷️ Discount Ledger</option>
            </select>
          </div>
        </div>

        {/* View / Tab Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Views & Types:</span>
          {[
            { id: 'all', label: 'All Vouchers', color: 'blue' },
            { id: 'cash', label: '💵 Cash in Hand', color: 'amber' },
            { id: 'bank', label: '🏦 Bank Accounts', color: 'indigo' },
            { id: 'roundoff', label: '⚖️ Round Off Ledger', color: 'purple' },
            { id: 'discount', label: '🏷️ Discount Ledger', color: 'teal' },
            { id: 'sales', label: 'Sales', color: 'blue' },
            { id: 'receipt', label: 'Receipt', color: 'emerald' },
            { id: 'payment', label: 'Payment', color: 'amber' },
            { id: 'contra', label: 'Contra', color: 'purple' },
            { id: 'journal', label: 'Journal', color: 'slate' },
            { id: 'credit note', label: 'Credit Note', color: 'rose' },
            { id: 'debit note', label: 'Debit Note', color: 'indigo' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedTab(tab.id as LedgerTab);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                selectedTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Vouchers Table */}
      <Card className="overflow-hidden border border-slate-200 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Vch No</th>
                <th className="py-3 px-4">Particulars (Party / Account)</th>
                <th className="py-3 px-4">Narration / Notes</th>
                <th className="py-3 px-4 text-right">Debit (+)</th>
                <th className="py-3 px-4 text-right">Credit (-)</th>
                <th className="py-3 px-3">Source</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-blue-500" />
                    <span>Loading Day Book vouchers...</span>
                  </td>
                </tr>
              ) : pagedVouchers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-slate-600">No vouchers found</p>
                    <p className="text-xs text-slate-400">Try adjusting your filters or upload Excels using the 4-Excel Sync Hub.</p>
                  </td>
                </tr>
              ) : (
                pagedVouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">
                      {v.voucher_date}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${getVchBadge(v.voucher_type)}`}>
                        {v.voucher_type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-600 whitespace-nowrap">
                      {v.voucher_no || '—'}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-900 max-w-xs truncate" title={v.party_name}>
                      {v.party_name}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate" title={v.narration || ''}>
                      {v.narration || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-blue-700 whitespace-nowrap">
                      {v.debit_paise > 0 ? rupees(v.debit_paise) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                      {v.credit_paise > 0 ? rupees(v.credit_paise) : '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {v.book_source || 'Day Book'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleDelete(v.id)}
                        disabled={deleteBusyId === v.id}
                        title="Delete voucher"
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition disabled:opacity-30"
                      >
                        {deleteBusyId === v.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {vouchers.length > PAGE_SIZE && (
          <div className="border-t border-slate-200 bg-slate-50/60 p-3">
            <Pager
              page={page}
              total={vouchers.length}
              pageSize={PAGE_SIZE}
              onPage={(p: number) => setPage(p)}
            />
          </div>
        )}
      </Card>

      {/* 4-Excel Unified Upload Hub Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-blue-100 p-2 text-blue-600">
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">7-Excel Master Accounting Hub</h3>
                  <p className="text-xs text-slate-500">
                    Upload DAYBOOK (Commercial), HDFC, YESBANK, JOURNAL, ROUNDOFF, DISCOUNT & TRIAL BALANCE with automated sync.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadOpen(false);
                  setMultiPreview(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Drag & Drop Multi-file Target */}
            <div
              onClick={() => document.getElementById(fileInputId)?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) {
                  handleFilesDropped(e.dataTransfer.files);
                }
              }}
              className="cursor-pointer rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 p-5 text-center hover:border-blue-500 hover:bg-blue-50/70 transition"
            >
              <Upload size={28} className="mx-auto mb-2 text-blue-600" />
              <p className="text-xs font-bold text-slate-900">
                Drag & Drop 1 to 7 Excel files here, or click to browse
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Supports DAYBOOK (Commercial), HDFC, YESBANK, JOURNAL, ROUNDOFF, DISCOUNT, and OP.xlsx
              </p>
              <input
                id={fileInputId}
                type="file"
                multiple
                accept=".xlsx,.xls,.xlsm"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFilesDropped(e.target.files);
                }}
              />
            </div>

            {/* 4 Slots Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.values(slots).map((slot) => {
                const isLoaded = Boolean(slot.file);
                return (
                  <div
                    key={slot.key}
                    className={`rounded-xl border p-3.5 space-y-2 transition ${
                      isLoaded
                        ? 'border-emerald-300 bg-emerald-50/30'
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`rounded-lg p-1.5 ${
                            isLoaded ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          <FileSpreadsheet size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900">{slot.title}</p>
                          <p className="text-[10px] text-slate-500">{slot.expectedName}</p>
                        </div>
                      </div>
                      {isLoaded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          <CheckCircle2 size={11} /> Ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          Optional
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-tight">{slot.description}</p>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[10px]">
                      <span className="font-semibold text-slate-400 truncate max-w-[170px]" title={slot.file?.name}>
                        {slot.file ? slot.file.name : slot.hint}
                      </span>
                      {slot.file && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSlots({
                              ...slots,
                              [slot.key]: { ...slot, file: undefined, preview: undefined },
                            });
                            setMultiPreview(null);
                          }}
                          className="text-rose-500 hover:text-rose-700 font-bold"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pre-flight Preview Results */}
            {previewing && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs font-bold text-blue-600">
                <RefreshCw size={16} className="animate-spin" />
                <span>Auto-detecting Excel formats and verifying ledger rules...</span>
              </div>
            )}

            {multiPreview && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-blue-950">Pre-Flight Audit Validation</span>
                  <span className="rounded-full bg-blue-200 px-2.5 py-0.5 text-[11px] font-black text-blue-900">
                    {multiPreview.filesCount} Workbooks Verified
                  </span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {multiPreview.files.map((f, i) => (
                    <div key={i} className="rounded-lg border border-blue-100 bg-white p-2.5 text-xs">
                      <div className="flex items-center justify-between font-bold">
                        <span className="text-slate-900">{f.filename}</span>
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] uppercase font-black text-blue-800">
                          {f.detectedType}
                        </span>
                      </div>
                      {f.details && (
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-600 font-medium">
                          {f.details.voucherCount !== undefined && (
                            <span>Vouchers: <strong>{f.details.voucherCount}</strong></span>
                          )}
                          {f.details.count !== undefined && (
                            <span>Ledgers: <strong>{f.details.count}</strong></span>
                          )}
                          {f.details.totalDebitPaise !== undefined && (
                            <span>Dr: <strong>{rupees(f.details.totalDebitPaise)}</strong></span>
                          )}
                          {f.details.totalCreditPaise !== undefined && (
                            <span>Cr: <strong>{rupees(f.details.totalCreditPaise)}</strong></span>
                          )}
                          <span className="text-emerald-700 font-bold">Stock Entries Disabled: 0</span>
                        </div>
                      )}
                      {f.error && <p className="mt-1 text-[11px] text-rose-600 font-bold">{f.error}</p>}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-emerald-100/80 p-2 text-center text-xs font-bold text-emerald-900 border border-emerald-200">
                  ✓ Ready to apply. Click <strong>"Apply All to Database"</strong> to atomically ingest into SQLite.
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition">
                <input
                  type="checkbox"
                  checked={cleanExistingBeforeApply}
                  onChange={(e) => setCleanExistingBeforeApply(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <span>Clean existing balances before importing</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUploadOpen(false);
                    setMultiPreview(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                {!multiPreview ? (
                  <button
                    type="button"
                    onClick={handlePreviewMulti}
                    disabled={previewing || Object.values(slots).every((s) => !s.file)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {previewing ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                    <span>{previewing ? 'Auditing Files...' : 'Preview Files'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApplyMulti}
                    disabled={applying}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {applying ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    <span>{applying ? 'Applying Pipeline...' : 'Apply All to Database'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
