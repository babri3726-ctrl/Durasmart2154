import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, Clock, Edit, Filter, Plus, Trash2, Truck } from 'lucide-react';
import { Card, PageHeader, StatusBadge } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Modal } from '../components/ui/Overlays';
import { Pager } from '../components/ui/Pager';
import { exactRupees } from '../lib/entryRules';
import { syncKeys, useSyncPrefix } from '../lib/syncStore';
import { useLiveSession } from '../lib/liveSession';
import { useLiveList } from '../lib/useLiveList';
import { useResource } from '../lib/useResource';
import { toast } from '../lib/toast';
import {
  deleteOrder,
  listEmployees,
  listOrders,
  serverHost,
  ServerError,
  type DispatchStatusFilter,
  type ServerOrder,
} from '../lib/serverApi';

const PAGE_SIZE = 20;

export default function Orders() {
  const user = useLiveSession((s) => s.user);
  const isSalesperson = user?.role === 'employee' && user?.department === 'Sales';

  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [salespersonFilter, setSalespersonFilter] = useState('');
  const [dispatchFilter, setDispatchFilter] = useState<'' | DispatchStatusFilter>('');
  const [slipModalImage, setSlipModalImage] = useState<{ url: string; title: string } | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<ServerOrder | null>(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveSalespersonId = isSalesperson ? (user?.employeeId ?? '') : salespersonFilter;

  async function handleDelete() {
    if (!orderToDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteOrder(orderToDelete.id);
      toast.success(`Order ${orderToDelete.number ?? orderToDelete.id} deleted successfully`);
      sync.refresh();
      setOrderToDelete(null);
    } catch (cause) {
      toast.error(cause instanceof ServerError ? cause.message : 'Failed to delete order');
    } finally {
      setDeleting(false);
    }
  }

  const employees = useResource(useCallback(() => listEmployees({ activeOnly: true, pageSize: 200 }), []));

  const load = useCallback(
    (folded: string, p: number) =>
      listOrders({
        q: folded || undefined,
        salespersonId: effectiveSalespersonId || undefined,
        dispatchStatus: dispatchFilter || undefined,
        page: p,
        pageSize: PAGE_SIZE,
      }),
    [effectiveSalespersonId, dispatchFilter],
  );

  const listToken = useSyncPrefix(syncKeys.orderList(''));
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page, listToken);

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`Live order book on ${serverHost()} — track booking status and yard dispatch completion`}
        actions={
          <Link to="/orders/new" className="btn-primary">
            <Plus size={15} /> New Order
          </Link>
        }
      />

      <Card>
        {/* Filters bar: Search, Salesperson & Dispatch Progress */}
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              className="input !w-auto !py-2 sm:min-w-[280px]"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Search order number or party name…"
            />

            {isSalesperson ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-brand-blue/30 bg-brand-blue/10 px-3 py-1.5 text-xs font-bold text-brand-blue">
                <span>👤</span>
                <span>Your Assigned Orders ({user?.name || user?.employeeId || 'Sales Officer'})</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-muted flex items-center gap-1">
                  <Filter size={13} /> Officer:
                </span>
                <select
                  className="input !w-auto !py-1.5 text-xs font-semibold"
                  value={salespersonFilter}
                  onChange={(e) => {
                    setSalespersonFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Area Officers</option>
                  {employees.data?.items.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.salesTerritory?.toLowerCase().includes('punjab') ? '🌾' : '🏢'} {e.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quick Dispatch Progress Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2.5">
            <span className="text-[11px] font-bold text-muted mr-1">Dispatch State:</span>
            <button
              type="button"
              onClick={() => {
                setDispatchFilter('');
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                dispatchFilter === ''
                  ? 'bg-ink text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              All Orders
            </button>
            <button
              type="button"
              onClick={() => {
                setDispatchFilter('pending');
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition inline-flex items-center gap-1 ${
                dispatchFilter === 'pending'
                  ? 'bg-brand-orange text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              <Clock size={12} /> ⏳ Pending Dispatch
            </button>
            <button
              type="button"
              onClick={() => {
                setDispatchFilter('dispatched');
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition inline-flex items-center gap-1 ${
                dispatchFilter === 'dispatched'
                  ? 'bg-brand-green text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              <CheckCircle2 size={12} /> ✅ Dispatched / Done
            </button>
            <button
              type="button"
              onClick={() => {
                setDispatchFilter('partial');
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition inline-flex items-center gap-1 ${
                dispatchFilter === 'partial'
                  ? 'bg-brand-blue text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              <Truck size={12} /> 🚚 Partly Sent
            </button>
          </div>
        </div>

        <div className="mb-3 space-y-1.5">
          <LiveSyncBar sync={sync} busy={state === 'loading'} />
          {employees.state === 'loading' && <LiveSyncBar sync={employees.sync} busy />}
        </div>
        {state === 'loading' && <p className="text-xs text-faint">Loading orders…</p>}
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
            {term || salespersonFilter || dispatchFilter
              ? 'No orders match those filters.'
              : 'No orders yet — orders booked on the backend appear here.'}
          </p>
        )}
        {state === 'ready' && rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-field border border-line">
              {rows.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3.5 py-2.5 last:border-b-0 hover:bg-canvas transition"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/orders/${o.id}`} className="truncate text-[13px] font-bold text-ink hover:underline">
                        {o.number ?? 'Draft — number on submit'}
                      </Link>
                      <span className="font-semibold text-muted text-xs">• {o.customerName}</span>
                      {o.state && (
                        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-bold text-muted border border-line">
                          {o.state.toLowerCase() === 'punjab' ? '🌾 Punjab' : '🏢 Haryana'}
                        </span>
                      )}
                      {o.slipImageData && (
                        <button
                          type="button"
                          onClick={() =>
                            setSlipModalImage({
                              url: o.slipImageData!,
                              title: `Handwritten Slip • ${o.customerName}`,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded bg-brand-blue/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-blue hover:bg-brand-blue/20"
                          title="View attached handwritten slip"
                        >
                          <Camera size={11} /> 📸 Slip
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted mt-0.5">
                      {o.orderDate} • {o.lineCount} line(s) • Qty: <strong>{o.orderedQuantity} MT</strong>
                      {o.dueDate ? ` • due ${o.dueDate}` : ''}
                      {(o.salespersonName || o.salespersonId) && (
                        <span className="ml-2 font-bold text-brand-blue">
                          • 👤 Booked by: {o.salespersonName || o.salespersonId}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[11px] font-semibold">{exactRupees(o.valuePaise)}</span>
                    {o.cancelledAt ? <StatusBadge status="cancelled" /> : <StatusBadge status={o.status} />}

                    {/* Unambiguous Dispatch State Badges */}
                    {o.dispatchStatus === 'dispatched' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-brand-green/15 px-2.5 py-1 text-[11px] font-black text-brand-green border border-brand-green/30">
                        <CheckCircle2 size={13} /> Done / Dispatched
                      </span>
                    ) : o.dispatchStatus === 'partial' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-brand-blue/15 px-2.5 py-1 text-[11px] font-black text-brand-blue border border-brand-blue/30">
                        <Truck size={13} /> Partly Sent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-brand-orange/15 px-2.5 py-1 text-[11px] font-black text-[#B45309] border border-brand-orange/30">
                        <Clock size={13} /> ⏳ Pending Dispatch
                      </span>
                    )}

                    <Link to={`/orders/${o.id}`} className="btn-ghost btn-sm !py-1 text-xs font-bold">
                      View
                    </Link>
                    {o.dispatchStatus !== 'dispatched' && (
                      <Link
                        to={`/orders/${o.id}/edit`}
                        className="btn-ghost btn-sm !py-1 text-xs text-brand-blue font-bold inline-flex items-center gap-1 hover:bg-brand-blue/10"
                        title="Edit order"
                      >
                        <Edit size={12} /> Edit
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setOrderToDelete(o)}
                      className="btn-ghost btn-sm !py-1 text-xs text-brand-red font-bold hover:bg-brand-red/10 inline-flex items-center gap-1"
                      title="Delete order"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>

      {/* Modal: View Handwritten Slip */}
      <Modal
        open={slipModalImage !== null}
        onClose={() => setSlipModalImage(null)}
        title={slipModalImage?.title ?? 'Handwritten Order Slip'}
        wide
      >
        {slipModalImage && (
          <div className="flex flex-col items-center">
            <img
              src={slipModalImage.url}
              alt="Handwritten order slip"
              className="max-h-[75vh] w-auto rounded-lg object-contain shadow-md border border-line"
            />
            <p className="mt-3 text-xs text-muted font-bold">{slipModalImage.title}</p>
          </div>
        )}
      </Modal>

      {/* Modal: Delete Order Confirmation */}
      <Modal
        open={orderToDelete !== null}
        onClose={() => setOrderToDelete(null)}
        title="Delete order permanently"
      >
        {orderToDelete && (
          <div>
            <p className="text-sm font-semibold text-ink">
              Are you sure you want to delete {orderToDelete.number ? `Order ${orderToDelete.number}` : 'this draft'} for {orderToDelete.customerName}?
            </p>
            <p className="mt-2 text-xs text-muted">
              This will permanently remove the order, its items, and references from the system. If this order has active dispatches,
              void them first.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOrderToDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger !bg-red-700 hover:!bg-red-800"
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
