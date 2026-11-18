import { useCallback, useEffect, useId, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Card, KpiCard, PageHeader } from '../components/ui/Card';
import { Pager } from '../components/ui/Pager';
import { rupees } from '../lib/format';
import { invalidate, syncKeys } from '../lib/syncStore';
import { toast } from '../lib/toast';
import {
  applyPaymentWorkbook,
  deleteVoucher,
  listVouchers,
  previewPaymentWorkbook,
  ServerDebtorPreview,
  ServerVoucher,
} from '../lib/serverApi';

const PAGE_SIZE = 25;

export default function Daybook() {
  const [vouchers, setVouchers] = useState<ServerVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ServerDebtorPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const fileInputId = useId();

  const loadData = useCallback(() => {
    setLoading(true);
    listVouchers({
      bookSource: selectedSource === 'all' ? undefined : selectedSource,
      voucherType: selectedType === 'all' ? undefined : selectedType,
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
  }, [selectedSource, selectedType, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // File selection & preview
  const handleFileChange = async (file: File) => {
    setSelectedFile(file);
    setPreviewing(true);
    setPreview(null);
    try {
      const buffer = await file.arrayBuffer();
      const prev = await previewPaymentWorkbook(new Uint8Array(buffer), file.name);
      setPreview(prev);
    } catch (err: any) {
      toast.error(`Preview failed: ${err.message || 'Invalid Day Book file'}`);
      setSelectedFile(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!selectedFile || !preview) return;
    setApplying(true);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const res = await applyPaymentWorkbook(new Uint8Array(buffer), {
        fileSha256: preview.fileSha256,
        previewDigest: preview.applyPreviewDigest,
        fileName: selectedFile.name,
      });

      if (res.createdRowCount === 0 && res.unchangedRowCount > 0) {
        toast.info(
          `Day Book up to date: all ${res.unchangedRowCount} vouchers are already in the database (0 new records).`
        );
      } else {
        toast.success(
          `Applied Day Book: ${res.createdRowCount} new vouchers, ${res.unchangedRowCount} existing vouchers.`
        );
      }
      setUploadOpen(false);
      setSelectedFile(null);
      setPreview(null);
      invalidate(syncKeys.debtors, syncKeys.customers, syncKeys.vouchers);
      loadData();
    } catch (err: any) {
      toast.error(`Failed to apply Day Book: ${err.message || 'Error'}`);
    } finally {
      setApplying(false);
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
    } catch (err: any) {
      toast.error(`Failed to delete voucher: ${err.message || 'Error'}`);
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
    if (t.includes('credit note')) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    if (t.includes('stock')) return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Day Book"
        subtitle="Complete daily transaction register across Sales, Receipts, Payments, Journals, and Contras"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition"
            >
              <Upload size={14} />
              <span>Upload Day Book (.xlsx)</span>
            </button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Entries"
          value={String(vouchers.length)}
          hint="Recorded vouchers"
          gradient="from-blue-600 to-indigo-600"
          icon={<FileText size={20} />}
        />
        <KpiCard
          label="Total Debits (+)"
          value={rupees(totalDebits)}
          hint="Sales, vendor debits, outward"
          gradient="from-blue-600 to-cyan-600"
          icon={<FileSpreadsheet size={20} />}
        />
        <KpiCard
          label="Total Credits (-)"
          value={rupees(totalCredits)}
          hint="Receipts, customer credits"
          gradient="from-emerald-600 to-teal-600"
          icon={<CheckCircle2 size={20} />}
        />
        <KpiCard
          label="Net Movement"
          value={`${rupees(Math.abs(netMovement))} ${netMovement >= 0 ? 'Dr' : 'Cr'}`}
          hint="Debit / Credit net difference"
          gradient="from-purple-600 to-pink-600"
          icon={<Filter size={20} />}
        />
      </div>

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
              <option value="Cash Book">💵 Cash Book</option>
              <option value="Khan Cash Book">💵 Khan Cash Book</option>
              <option value="Cash GBD Book">💵 Cash GBD Book</option>
            </select>
          </div>
        </div>

        {/* Voucher Type Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Vch Type:</span>
          {[
            { id: 'all', label: 'All Vouchers' },
            { id: 'sales', label: 'Sales' },
            { id: 'receipt', label: 'Receipt' },
            { id: 'payment', label: 'Payment' },
            { id: 'contra', label: 'Contra' },
            { id: 'journal', label: 'Journal' },
            { id: 'credit note', label: 'Credit Note' },
            { id: 'stock journal', label: 'Stock Journal' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedType(tab.id);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                selectedType === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Vouchers Table */}
      <Card className="overflow-hidden border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Vch No</th>
                <th className="py-3 px-4">Particulars (Party)</th>
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
                    <p className="text-xs text-slate-400">Try adjusting your search filters or upload daybook.xlsx.</p>
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
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition disabled:opacity-50"
                        title="Delete voucher"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {vouchers.length > PAGE_SIZE && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
            <Pager page={page} pageSize={PAGE_SIZE} total={vouchers.length} onPage={setPage} />
          </div>
        )}
      </Card>

      {/* Upload Day Book Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-2 text-blue-600">
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Upload Day Book Workbook</h3>
                  <p className="text-[11px] text-slate-500">Supports Tally Day Book Excel exports (.xlsx)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadOpen(false);
                  setSelectedFile(null);
                  setPreview(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Dropzone */}
            <div
              onClick={() => document.getElementById(fileInputId)?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-6 text-center hover:border-blue-500 hover:bg-blue-50/30 transition"
            >
              <Upload size={28} className="mx-auto mb-2 text-slate-400" />
              <p className="text-xs font-bold text-slate-800">
                {selectedFile ? selectedFile.name : 'Click to select daybook.xlsx'}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Excel workbooks with Date, Particulars, Vch Type, Debit Amount, Credit Amount
              </p>
              <input
                id={fileInputId}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChange(f);
                }}
              />
            </div>

            {previewing && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs font-bold text-blue-600">
                <RefreshCw size={16} className="animate-spin" />
                <span>Parsing Day Book vouchers and detecting ledger entries...</span>
              </div>
            )}

            {preview && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Workbook Source:</span>
                  <span className="font-extrabold text-blue-800">{preview.sheetName || 'Day Book'}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Total Vouchers Parsed:</span>
                  <span className="font-mono font-extrabold text-slate-900">{preview.rows?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>File SHA256:</span>
                  <span className="font-mono text-[10px] text-slate-500">{preview.fileSha256?.substring(0, 16)}...</span>
                </div>
                <div className="rounded-lg bg-blue-100/80 p-2 text-center text-xs font-bold text-blue-900 border border-blue-200">
                  ⚡ Preview ready. Click <strong>"Import into Day Book"</strong> below to save to database.
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  setUploadOpen(false);
                  setSelectedFile(null);
                  setPreview(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!preview || applying}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition disabled:opacity-50"
              >
                {applying ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>{applying ? 'Applying Vouchers...' : 'Import into Day Book'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
