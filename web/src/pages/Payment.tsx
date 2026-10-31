import { useCallback, useEffect, useId, useState } from 'react';
import { Plus, Share2, X } from 'lucide-react';
import { Card, PageHeader, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import { exactRupees, paiseFromRupees } from '../lib/entryRules';
import { fmtDateTime } from '../lib/format';
import { invalidate, syncKeys } from '../lib/syncStore';
import { toast } from '../lib/toast';
import { useLiveList } from '../lib/useLiveList';
import {
  listCustomers,
  listPayments,
  recordPayment,
  serverHost,
  ServerCustomer,
  ServerPayment,
  voidPayment,
} from '../lib/serverApi';

const PAGE_SIZE = 20;

/** Receipt history and live payment collection.
 *  - Records receipts with automatic SQLite persistence & balance clearance.
 *  - Supports audit-trailed voiding that re-credits the customer ledger.
 *  - Generates instant WhatsApp-formatted receipt text.
 */
export default function Payment() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listPayments({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  // Modal & Form State
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

  // Load customer directory when modal opens
  useEffect(() => {
    if (!isModalOpen) return;
    let active = true;
    setLoadingCustomers(true);
    listCustomers({ pageSize: 500 })
      .then((res) => {
        if (active) setCustomers(res.items);
      })
      .catch((err) => {
        toast.error(`Failed to load dealers: ${err.message || 'Network error'}`);
      })
      .finally(() => {
        if (active) setLoadingCustomers(false);
      });
    return () => {
      active = false;
    };
  }, [isModalOpen]);

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
      // Reset form
      setAmountInput('');
      setReference('');
      setNotes('');
      setSelectedCustomerId('');
      setDealerSearch('');

      // Refresh list & sync stores
      sync.refresh();
      invalidate(
        syncKeys.payments,
        syncKeys.debtors,
        syncKeys.customers,
        syncKeys.dashboard,
        syncKeys.orderList(),
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment');
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to void payment');
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
        title="Payment"
        subtitle={`Receipt history and live payment collection on ${serverHost()} — auto-deducts balances with full audit trail.`}
        actions={
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-1.5"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} /> Record Payment
          </button>
        }
      />

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
          <p className="text-[11px] text-muted">
            Every receipt the backend holds, voided rows included. Balances elsewhere never count a voided one.
          </p>
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
            {term ? 'No receipt matches that search.' : 'No payments on the backend yet.'}
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
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`text-[12px] font-semibold ${r.voidedAt ? 'text-faint line-through' : 'text-emerald-700 dark:text-emerald-400 font-bold'}`}
                      title={r.voidedAt ? 'Voided — excluded from every balance' : undefined}
                    >
                      {exactRupees(r.amountPaise)}
                    </span>
                    {!r.voidedAt && (
                      <button
                        type="button"
                        onClick={() => handleVoid(r)}
                        className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-brand-red transition hover:bg-brand-red hover:text-white dark:border-red-900"
                        title="Void payment & restore balance"
                      >
                        Void
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>

      {/* Record Payment Modal */}
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
              {/* Customer Selector */}
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

              {/* Amount & Date */}
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

              {/* Method & Reference */}
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

              {/* Notes */}
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

              {/* Action Buttons */}
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
    </div>
  );
}
