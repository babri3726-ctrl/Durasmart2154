import { useCallback, useState } from 'react';
import { Card, PageHeader, StatusBadge, Tabs } from '../components/ui/Card';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Pager } from '../components/ui/Pager';
import StockDashboard from '../components/stock/StockDashboard';
import StockKpiStrip from '../components/stock/StockKpiStrip';
import StockMaterialList from '../components/stock/StockMaterialList';
import StockUpvc from '../components/stock/StockUpvc';
import StockGapView from '../components/stock/StockGapView';
import StockCheck from '../components/stock/StockCheck';
import StockSyncView from '../components/stock/StockSyncView';
import { isNegativeQuantity } from '../lib/liveDisplay';
import type { LiveSync } from '../lib/liveSync';
import { STOCK_TABS, type StockView } from '../lib/stockView';
import { useLiveList } from '../lib/useLiveList';
import {
  listProducts,
  listStockBalances,
  listStockMovements,
  serverHost,
} from '../lib/serverApi';

const PAGE_SIZE = 20;

/** Shared honest chrome for the three ledger lists: when the rows last arrived, loading says loading,
 *  a failure shows the backend's own message with a retry, and an empty page says it is empty — no
 *  invented rows. The sync line is above all three states, so a failed refresh over a list that is
 *  already on screen is reported rather than left to look current. */
function ListStates({
  state,
  error,
  retry,
  loadingLabel,
  sync,
}: {
  state: 'loading' | 'ready' | 'error';
  error: string;
  retry: () => void;
  loadingLabel: string;
  sync: LiveSync;
}) {
  return (
    <>
      <div className="mb-3">
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>
      {state === 'loading' && <p className="text-xs text-faint">{loadingLabel}</p>}
      {state === 'error' && (
        <p className="text-xs font-semibold text-brand-red">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
    </>
  );
}

function SearchBox({ term, onTerm }: { term: string; onTerm: (t: string) => void }) {
  return (
    <input
      className="input !w-auto !py-2"
      value={term}
      onChange={(e) => onTerm(e.target.value)}
      placeholder="Search SKU, product or spec…"
    />
  );
}

function Quantities({ value, unit, red }: { value: string; unit: string; red?: boolean }) {
  return (
    <span className={red || isNegativeQuantity(value) ? 'font-bold text-brand-red' : 'font-semibold'}>
      {value} <span className="font-normal text-muted">{unit}</span>
    </span>
  );
}

function BalancesTab() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listStockBalances({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[11px] text-muted">
          Balances are a SUM over recorded movements — nothing here is a typed-in stock figure.
        </p>
        <SearchBox
          term={term}
          onTerm={(t) => {
            setTerm(t);
            setPage(1);
          }}
        />
      </div>
      <ListStates state={state} error={error} retry={retry} loadingLabel="Loading stock balances…" sync={sync} />
      {state === 'ready' && rows.length === 0 && (
        <p className="text-xs text-muted">
          {term ? 'No product matches that search.' : 'No stock balances yet — movements recorded on the backend appear here.'}
        </p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-field border border-line">
            {rows.map((b) => (
              <div key={b.productId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink">
                    {b.sku} <span className="font-semibold text-muted">• {b.productName}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    {[b.spec, b.thickness].filter(Boolean).join(' • ') || '—'}
                    {b.isLowStock && <StatusBadge status="high" label="low stock" />}
                    {b.mismatchedUnitMovements > 0 && (
                      <span
                        title={`Movements held in another unit are not added: ${b.mismatchedUnitQuantity} ${b.unit}-shaped quantity sits outside the SUM.`}
                      >
                        <StatusBadge status="pending" label={`unit mismatch (${b.mismatchedUnitMovements})`} />
                      </span>
                    )}
                    {b.lastMovementDate && <span>last movement {b.lastMovementDate}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px]">
                  <span title="On hand excludes reservations.">
                    <span className="text-muted">on hand </span>
                    <Quantities value={b.onHandQuantity} unit={b.unit} />
                  </span>
                  <span title="Reserved against orders.">
                    <span className="text-muted">reserved </span>
                    <Quantities value={b.reservedQuantity} unit={b.unit} />
                  </span>
                  <span title="What may still be promised.">
                    <span className="text-muted">available </span>
                    <Quantities value={b.availableQuantity} unit={b.unit} />
                  </span>
                </div>
              </div>
            ))}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </>
  );
}

const MOVEMENT_KINDS = ['', 'in', 'out', 'adjust', 'reserved', 'released'];

function MovementsTab() {
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) =>
      listStockMovements({ q: folded || undefined, kind: kind || undefined, page: p, pageSize: PAGE_SIZE }),
    [kind],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
            Kind
            <select
              className="input mt-1 block !w-32 !py-1.5 normal-case font-semibold text-ink"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              {MOVEMENT_KINDS.map((k) => (
                <option key={k || 'all'} value={k}>
                  {k || 'all'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="input !w-auto !py-2"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          placeholder="Search SKU, product, batch or reference…"
        />
      </div>
      <ListStates state={state} error={error} retry={retry} loadingLabel="Loading stock movements…" sync={sync} />
      {state === 'ready' && rows.length === 0 && (
        <p className="text-xs text-muted">
          {term || kind ? 'No movement matches that search or kind.' : 'No stock movements recorded yet.'}
        </p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-field border border-line">
            {rows.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink">
                    {m.sku} <span className="font-semibold text-muted">• {m.productName}</span>{' '}
                    <StatusBadge status={m.kind} />
                  </p>
                  <p className="text-[10px] text-muted">
                    {m.movementDate}
                    {m.batchNo ? ` • batch ${m.batchNo}` : ''}
                    {m.warehouse ? ` • ${m.warehouse}` : ''}
                    {m.reference ? ` • ref ${m.reference}` : ''}
                    {m.reason ? ` • ${m.reason}` : ''}
                  </p>
                </div>
                <Quantities value={m.deltaQuantity} unit={m.unit} red={isNegativeQuantity(m.deltaQuantity)} />
              </div>
            ))}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function ProductsTab() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    (folded: string, p: number) => listProducts({ q: folded || undefined, page: p, pageSize: PAGE_SIZE }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[11px] text-muted">The product master as the backend holds it; the unit travels with each row.</p>
        <SearchBox
          term={term}
          onTerm={(t) => {
            setTerm(t);
            setPage(1);
          }}
        />
      </div>
      <ListStates state={state} error={error} retry={retry} loadingLabel="Loading products…" sync={sync} />
      {state === 'ready' && rows.length === 0 && (
        <p className="text-xs text-muted">
          {term ? 'No product matches that search.' : 'No products in the master yet.'}
        </p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-field border border-line">
            {rows.map((pr) => (
              <div key={pr.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink">
                    {pr.sku} <span className="font-semibold text-muted">• {pr.name}</span>
                  </p>
                  <p className="text-[10px] text-muted">
                    {[pr.category, pr.spec, pr.thickness].filter(Boolean).join(' • ') || '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px]">
                  <span title="Minimum stock the low-stock rule compares against.">
                    <span className="text-muted">min </span>
                    <Quantities value={pr.minStockQty} unit={pr.unit} />
                  </span>
                  <StatusBadge status={pr.active ? 'active' : 'draft'} label={pr.active ? 'active' : 'inactive'} />
                  <span className="chip bg-canvas text-muted">source: {pr.source}</span>
                </div>
              </div>
            ))}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </>
  );
}

/** The movement ledger and product master, kept exactly as the read screens were. They answer a
 *  different question from the approved snapshot: a balance is a SUM over posted movements, while
 *  the snapshot is a level the owner confirmed in a workbook. */
function LedgerView() {
  const [tab, setTab] = useState('balances');
  return (
    <div>
      <div className="mb-3">
        <p className="text-[12px] font-black text-ink">Movement ledger and product master</p>
        <p className="mt-0.5 max-w-3xl text-[11px] text-muted">
          These reads are the server’s movement SUM, not the approved workbook level. No screen here
          moves stock: the posting routes are not built, and an imported snapshot posts no movement.
        </p>
      </div>
      <Tabs
        tabs={[
          { key: 'balances', label: 'Balances' },
          { key: 'movements', label: 'Movements' },
          { key: 'products', label: 'Products' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'balances' && <BalancesTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'products' && <ProductsTab />}
    </div>
  );
}

/** Stock, read from the shared dashboard reads and the movement ledger.
 *
 *  The section follows the mockup's order: a dashboard, the whole stock list and one tab per source
 *  group. Three views are deliberately honest gaps rather than tables: UPVC Item and Production
 *  are not in the approved apply plan, and Stock Check states what the snapshot can and cannot
 *  prove. Excel Import / Sync keeps the one apply control in the panel behind an owner’s explicit
 *  confirmation; no other tab writes anything.
 */
export default function Stock() {
  const [view, setView] = useState<StockView>('dashboard');
  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle={`Workbook stock on ${serverHost()} — one approved snapshot read by the panel and the phone, plus the separate movement ledger.`}
      />
      <StockKpiStrip onOpen={setView} />
      <Tabs tabs={STOCK_TABS} active={view} onChange={(key) => setView(key as StockView)} />
      <Card>
        {view === 'dashboard' && <StockDashboard key="dashboard" onOpen={setView} />}
        {view === 'total' && (
          <StockMaterialList
            key="total"
            heading="Total Stock"
            description="Every material row in the approved snapshot, resolved or withheld, with its source coordinates. Search and filters narrow this list; no quantity is re-totalled here."
          />
        )}
        {view === 'steel' && (
          <StockMaterialList
            key="steel"
            categoryKey="steel-coil"
            heading="Steel Coil (Slit)"
            description="The TOTAL STOCK slit-coil section as applied. Each row keeps the unit the sheet stated; none is converted to kilograms or tons."
          />
        )}
        {view === 'profile' && (
          <StockMaterialList
            key="profile"
            categoryKey="profile-kanda"
            heading="Profile / Kanda"
            description="The profile section as applied, with the rows the apply plan withheld still visible and labelled."
          />
        )}
        {view === 'gp' && (
          <StockMaterialList
            key="gp"
            categoryKey="gp-sheet"
            heading="GP Sheet"
            description="The GP sheet section. If every source row was withheld, the category shows the withheld amount and no stock figure rather than zero."
          />
        )}
        {view === 'upvc-new' && (
          <StockUpvc
            key="upvc-new"
            mode="new"
            heading="UPVC New"
            description="New UPVC by colour and length. Pieces and derived footage are separate answers; negatives are kept."
          />
        )}
        {view === 'upvc-old' && (
          <StockUpvc
            key="upvc-old"
            mode="old"
            heading="UPVC Old"
            description="Old UPVC by colour and length, filtered on the server over the approved snapshot."
          />
        )}
        {view === 'upvc-waste' && (
          <StockUpvc
            key="upvc-waste"
            mode="waste"
            heading="UPVC Waste"
            description="Waste UPVC by colour and length. A negative waste balance is shown in red exactly as the sheet wrote it."
          />
        )}
        {view === 'upvc-total' && (
          <StockUpvc
            key="upvc-total"
            mode={null}
            heading="UPVC Total Stock"
            description="New, old and waste together, filterable by type, colour, length and text. Pieces and footage are totalled separately by the server."
          />
        )}
        {view === 'upvc-item' && (
          <StockMaterialList
            key="upvc-item"
            categoryKey="upvc-item"
            heading="UPVC Item"
            description="Accessories (Ridge, Jhallar, Caps, Hira Ridge) synchronized by colour and group from the approved UPVC ITEM sheet."
          />
        )}
        {view === 'production' && (
          <StockGapView
            key="production"
            kind="production"
            heading="Production"
            description="The PRODUCTION worksheet's sections are named here, with no figure: the approved plan neither reads nor stores the sheet."
          />
        )}
        {view === 'check' && <StockCheck key="check" />}
        {view === 'sync' && <StockSyncView key="sync" />}
        {view === 'ledger' && <LedgerView key="ledger" />}
      </Card>
    </div>
  );
}
