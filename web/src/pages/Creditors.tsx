import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Upload,
  CheckCircle2,
  RefreshCw,
  X,
  FileText,
  Search,
  ExternalLink,
  Store,
} from 'lucide-react';
import { Card, EmptyState, KpiCard, PageHeader } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { rupees } from '../lib/format';
import { useLiveList } from '../lib/useLiveList';
import { syncKeys, useSyncToken, invalidate } from '../lib/syncStore';
import {
  listCreditors,
  uploadCreditorsWorkbook,
  listVouchers,
  type ServerDebtor,
  type ServerVoucher,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

const PAGE_SIZE = 50;

function CreditorLedgerModal({
  creditor,
  onClose,
}: {
  creditor: ServerDebtor;
  onClose: () => void;
}) {
  const [vouchers, setVouchers] = useState<ServerVoucher[]>([]);
  const [loading, setLoading] = useState(true);

  const creditorId = creditor.id || creditor.customerId || '';
  const partyName = creditor.name || creditor.customerName || 'Creditor';

  useEffect(() => {
    let active = true;
    setLoading(true);
    listVouchers(creditorId)
      .then((data) => {
        if (active) setVouchers(data || []);
      })
      .catch(() => {
        if (active) setVouchers([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [creditorId]);

  const totalDrPaise = vouchers.reduce((acc, v) => acc + (v.debit_paise || 0), 0);
  const totalCrPaise = vouchers.reduce((acc, v) => acc + (v.credit_paise || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 size={20} className="text-purple-600" />
              <h3 className="text-base font-bold text-ink">{partyName}</h3>
              <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                Sundry Creditor
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Station: <strong>{creditor.city || creditor.district || '—'}</strong> • Tally Status:{' '}
              <strong className="text-emerald-600">Verified</strong> • Balance:{' '}
              <strong className="font-mono text-ink">
                ₹{((creditor.balance || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Voucher List */}
        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={24} className="animate-spin text-muted" />
            </div>
          ) : vouchers.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">
              <FileText size={28} className="mx-auto mb-2 text-faint" />
              <p>No individual transaction vouchers recorded for this creditor yet.</p>
              <p className="mt-1 text-[11px] text-faint">
                Tally Verified Closing Balance is active from <strong>sundry creditor.xlsx</strong>.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                  <th className="py-2">Date</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Voucher #</th>
                  <th className="py-2">Particulars / Narration</th>
                  <th className="py-2 text-right">Debit (+)</th>
                  <th className="py-2 text-right">Credit (-)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {vouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-canvas/40">
                    <td className="py-2 font-mono text-[11px] text-muted">{v.voucher_date}</td>
                    <td className="py-2 font-semibold capitalize text-ink">{v.voucher_type}</td>
                    <td className="py-2 font-mono text-[11px] text-faint">{v.voucher_no || '—'}</td>
                    <td className="py-2 text-muted truncate max-w-[200px]">{v.narration || '—'}</td>
                    <td className="py-2 text-right font-mono font-semibold text-emerald-700">
                      {v.debit_paise > 0 ? rupees(v.debit_paise) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono font-semibold text-rose-700">
                      {v.credit_paise > 0 ? rupees(v.credit_paise) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td colSpan={4} className="py-2 text-right">
                    Total Movement:
                  </td>
                  <td className="py-2 text-right font-mono text-emerald-700">{rupees(totalDrPaise)}</td>
                  <td className="py-2 text-right font-mono text-rose-700">{rupees(totalCrPaise)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${partyName} ${creditor.city || ''} Punjab Haryana`
            )}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline"
          >
            <span>🗺️ Search on Google Maps</span>
            <ExternalLink size={12} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-canvas px-4 py-2 text-xs font-bold text-ink border border-line hover:bg-line/40 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Creditors() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'mismatch'>('all');
  const [selectedCreditor, setSelectedCreditor] = useState<ServerDebtor | null>(null);

  // Upload Excel State
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const load = useCallback(
    (folded: string, p: number) =>
      listCreditors({
        q: folded || undefined,
        statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [statusFilter]
  );

  const refreshToken = useSyncToken(syncKeys.debtors);
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page, refreshToken);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadMessage(null);
    try {
      const res = await uploadCreditorsWorkbook(file);
      setUploadMessage(res.message);
      toast.success(res.message);
      invalidate(syncKeys.debtors, syncKeys.dashboard);
      retry();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to upload sundry creditor workbook';
      setUploadMessage(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const totalBalancePaise = rows.reduce(
    (acc, r) => acc + Math.round((parseFloat(String(r.balance || 0)) || 0) * 100),
    0
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sundry Creditors Master"
        subtitle="Dedicated ledger for steel mills, raw material suppliers, packaging vendors, and transporters separated from customer debtors."
      />

      {/* Upload Sundry Creditors Excel File Card */}
      <Card className="border-purple-500/20 bg-gradient-to-r from-purple-50/20 via-transparent to-indigo-50/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="text-purple-600" size={20} />
              <h3 className="text-sm font-bold text-ink">Sundry Creditor Workbook Import</h3>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                Tally Excel Sync
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Upload <strong>sundry creditor.xlsx</strong> to update closing balances, suppliers, and purchase ledgers without affecting debtor customers.
            </p>
            {uploadMessage && (
              <p className="mt-1 text-xs font-semibold text-purple-700 dark:text-purple-300">
                {uploadMessage}
              </p>
            )}
          </div>

          <label
            htmlFor="creditor-excel-file"
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-purple-700 transition"
          >
            <Upload size={14} className={uploading ? 'animate-spin' : ''} />
            <span>{uploading ? 'Processing Creditors...' : '📥 Upload Sundry Creditor (.xlsx)'}</span>
          </label>
          <input
            id="creditor-excel-file"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={uploading}
            onChange={handleFileUpload}
          />
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total Creditors Balance"
          value={rupees(totalBalancePaise)}
          hint="Suppliers, mills & vendors (Tally)"
          gradient="from-purple-600 to-indigo-600"
          icon={<Building2 size={20} />}
        />
        <KpiCard
          label="Active Creditors"
          value={`${total} Suppliers`}
          hint="Separated from Debtor accounts"
          gradient="from-indigo-600 to-blue-600"
          icon={<Store size={20} />}
        />
        <KpiCard
          label="With Outstanding"
          value={`${rows.filter((r) => Math.abs(parseFloat(String(r.balance || 0)) || 0) > 0).length} Parties`}
          hint="Ledgers with active balances"
          gradient="from-emerald-600 to-teal-600"
          icon={<CheckCircle2 size={20} />}
        />
      </div>

      {/* Table Card */}
      <Card>
        {/* Filter & Search Bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                statusFilter === 'all'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-canvas text-muted hover:text-ink hover:bg-line/40'
              }`}
            >
              All Creditors
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('verified');
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1 ${
                statusFilter === 'verified'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-canvas text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
              }`}
            >
              <CheckCircle2 size={12} />
              <span>Verified ({total})</span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search creditor name, mill or city…"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setPage(1);
              }}
              className="input !py-1.5 text-xs !pl-7 w-full"
            />
            <Search size={13} className="absolute left-2 top-2.5 text-muted" />
          </div>
        </div>

        <div className="mb-3">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
        </div>

        {/* Directory Table */}
        {state === 'loading' && <p className="p-4 text-xs text-faint">Loading sundry creditors…</p>}
        {state === 'error' && (
          <p className="p-4 text-xs font-semibold text-brand-red">
            {error}{' '}
            <button type="button" className="underline font-bold" onClick={retry}>
              Retry
            </button>
          </p>
        )}
        {state === 'ready' && rows.length === 0 && (
          <EmptyState
            title={term ? 'No creditor matches that search' : 'No sundry creditors found'}
            hint="Upload sundry creditor.xlsx above to sync your Tally supplier ledgers."
          />
        )}
        {state === 'ready' && rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-canvas/40 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <th className="px-3 py-2.5">Creditor / Supplier Name</th>
                    <th className="px-3 py-2.5">Station / City</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5 text-right">Tally Closing Balance</th>
                    <th className="px-3 py-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {rows.map((row) => {
                    const name = row.name || row.customerName || '—';
                    const city = row.city || row.district || row.state || '—';
                    const bal = parseFloat(String(row.balance || 0)) || 0;
                    const balPaise = Math.round(bal * 100);

                    return (
                      <tr key={row.id || row.customerId} className="hover:bg-canvas/40 transition">
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className="font-bold text-ink">{name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.2 text-[9px] font-bold text-purple-700 dark:bg-purple-950/30 dark:text-purple-300">
                                🏭 Sundry Creditor
                              </span>
                              <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600">
                                <CheckCircle2 size={9} /> Tally Verified
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted">{city}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Supplier / Vendor
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold">
                          <span
                            className={`rounded px-2 py-0.5 border ${
                              bal > 0
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                                : bal < 0
                                ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                                : 'bg-canvas border-line text-muted'
                            }`}
                          >
                            {rupees(balPaise)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCreditor(row)}
                              className="rounded bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 transition"
                            >
                              Ledger
                            </button>
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                `${name} ${city} Punjab Haryana`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink hover:bg-line/30 transition"
                              title="Search supplier on Google Maps"
                            >
                              Maps ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
              <span>
                Showing {rows.length} of {total} Creditor Accounts
              </span>
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPage={(p) => setPage(p)}
              />
            </div>
          </>
        )}
      </Card>

      {/* Ledger Modal */}
      {selectedCreditor && (
        <CreditorLedgerModal
          creditor={selectedCreditor}
          onClose={() => setSelectedCreditor(null)}
        />
      )}
    </div>
  );
}
