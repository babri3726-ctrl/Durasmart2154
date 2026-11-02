/** Order entry — `POST /orders`, and `PATCH /orders/{id}` for a draft that already exists.
 *
 *  Two shapes of one screen: `/orders/new` books a fresh order, `/orders/:id/edit` opens a saved
 *  draft and re-saves it. The edit path is what keeps a draft editable instead of a one-shot
 *  write: the `version` read with the row goes out as `If-Match`, and the answer's own `version`
 *  replaces it, so saving twice in one visit is two correct writes rather than the second
 *  overwriting a row the server has since moved. A non-draft on the edit route is refused here and
 *  by the server (a PATCH to a submitted order is 422), and the refusal says which.
 *
 *  What leaves the browser is what was typed: a quantity is the decimal string as written, never
 *  floated; a rate is rupees in the box and integer paise on the wire through
 *  `entryRules.paiseFromRupees`; a line's unit comes from the product row it was picked from, and
 *  for a material that is not a mapped SKU the operator chooses it — the panel infers no unit from
 *  a name. GST is a decimal string or `null`, where blank means "this line carries no GST figure",
 *  which is a different statement from `"0"`.
 *
 *  Only an **active** party can be picked: the picker asks for `?status=active`, so a salesperson's
 *  `pendingApproval` entry (`D-11`) is not on the list at all, and the server's
 *  `party_not_active` stays the enforcement rather than a decoration on it.
 *
 *  One `Idempotency-Key` per submission intent, held across a retry of the identical body and
 *  replaced when the body changes — `entryRules.idempotencyKeyFor`. A failed write never produces a
 *  success toast: the only `toast.success` calls sit after a response arrived.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type Path,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Camera, Upload, Eye } from 'lucide-react';
import { Card, CardHeader, PageHeader, Spinner, StatusBadge } from '../components/ui/Card';
import { DateField, SelectField, TextField, TextareaField } from '../components/ui/Field';
import { LiveSyncBar } from '../components/ui/LiveSync';
import { Modal } from '../components/ui/Overlays';
import { useLiveList } from '../lib/useLiveList';
import { invalidate, syncKeys } from '../lib/syncStore';
import { useResource } from '../lib/useResource';
import { useLiveSession } from '../lib/liveSession';
import { toast } from '../lib/toast';
import { exactRupees, idempotencyKeyFor, paiseFromRupees, type KeyedSubmission } from '../lib/entryRules';
import { buildOrderLines, type OrderLineDraft, type OrderLinePayload } from '../lib/orderEntry';
import {
  createOrder,
  getOrder,
  listCustomers,
  listEmployees,
  listProducts,
  newIdempotencyKey,
  patchOrder,
  serverHost,
  setOrderStatus,
  ServerError,
  type OrderCreateBody,
  type OrderPatchBody,
  type ServerCustomer,
  type ServerEmployee,
  type ServerOrderDetail,
  type ServerProduct,
} from '../lib/serverApi';

/** The picker's "this material is not on the product master" marker. Never sent: it only decides
 *  whether the line carries `productId` or the typed `productName`. */
const CUSTOM = '__custom__';

const lineSchema = z.object({
  productId: z.string().default(''),
  productName: z.string().default(''),
  unit: z.string().default('MT'),
  quantity: z.string().default(''),
  rateRupees: z.string().default('0'),
  gstPercent: z.string().default(''),
});

const formSchema = z.object({
  customerId: z.string().min(1, 'Choose the customer this order belongs to.'),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the order date as YYYY-MM-DD.'),
  dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Enter the due date as YYYY-MM-DD, or leave it blank.'),
  expectedDispatchDate: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Enter the expected dispatch date as YYYY-MM-DD, or leave it blank.'),
  paymentTerms: z.string().max(120),
  notes: z.string().max(2000),
  salespersonId: z.string(),
  lines: z.array(lineSchema),
});

type OrderForm = z.infer<typeof formSchema>;

/** Local calendar day. `toISOString()` is UTC, and an order booked at 11pm in India would arrive
 *  dated tomorrow. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function blankLine(): OrderLineDraft {
  return { productId: '', productName: '', unit: 'MT', quantity: '', rateRupees: '0', gstPercent: '' };
}

function emptyForm(): OrderForm {
  return {
    customerId: '',
    orderDate: today(),
    dueDate: '',
    expectedDispatchDate: '',
    paymentTerms: '',
    notes: '',
    salespersonId: '',
    lines: [blankLine()],
  };
}

/** A saved draft back into the form it was written from. The rate is the server's paise shown by
 *  `exactRupees`, which `paiseFromRupees` reads back exactly — two formatters and no arithmetic
 *  between them, so the figure in the box is the figure in the column. */
function formFromDraft(o: ServerOrderDetail): OrderForm {
  return {
    customerId: o.customerId,
    orderDate: o.orderDate,
    dueDate: o.dueDate ?? '',
    expectedDispatchDate: o.expectedDispatchDate ?? '',
    paymentTerms: o.paymentTerms ?? '',
    notes: o.notes ?? '',
    salespersonId: o.salespersonId ?? '',
    lines: o.lines.length
      ? o.lines.map((l) => ({
          productId: l.productId ?? '',
          productName: l.productId ? '' : l.productName,
          unit: l.unit,
          quantity: l.orderedQuantity,
          rateRupees: exactRupees(l.ratePaise),
          gstPercent: l.gstRatePercent ?? '',
        }))
      : [blankLine()],
  };
}

/** The active-party picker. `status: 'active'` is the whole guard against booking an order onto a
 *  party nobody has approved; the search term is the server's `q=`, folded and debounced by
 *  `useLiveList`, so "nothing found" is the backend's answer rather than the browser's. A row shows
 *  name, city and the ledger identity (`CUS-…`) the balance is kept on, because the person choosing
 *  has to be able to tell two similar firms apart. */
function CustomerPicker({
  control,
  setValue,
  value,
  label,
  locked,
  onSelectCustomer,
}: {
  control: Control<OrderForm>;
  setValue: UseFormSetValue<OrderForm>;
  value: string;
  label: string;
  locked: boolean;
  onSelectCustomer?: (customer: ServerCustomer) => void;
}) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [territory, setTerritory] = useState<'all' | 'Punjab' | 'Haryana'>('all');
  const load = useCallback(
    (folded: string, p: number) => listCustomers({ q: folded || undefined, status: 'active', page: p, pageSize: 50 }),
    [],
  );
  const { state, rows, total, error, retry, sync } = useLiveList(load, term, page);
  const cachedChosenRef = useRef<ServerCustomer | null>(null);
  const found = rows.find((r) => r.id === value);
  if (found) {
    cachedChosenRef.current = found;
  }
  const chosen = found || (cachedChosenRef.current?.id === value ? cachedChosenRef.current : null);
  const lastChosenIdRef = useRef<string>('');

  useEffect(() => {
    if (chosen && chosen.id !== lastChosenIdRef.current) {
      lastChosenIdRef.current = chosen.id;
      onSelectCustomer?.(chosen);
    }
  }, [chosen, onSelectCustomer]);

  const displayRows = territory === 'all'
    ? rows
    : rows.filter((r) => r.state?.toLowerCase() === territory.toLowerCase());

  return (
    <div className="sm:col-span-2">
      <Controller
        control={control}
        name="customerId"
        render={({ fieldState }) => (
          <>
            <label className="label">
              Customer / Dealer (Punjab &amp; Haryana)<span className="text-brand-red"> *</span>
            </label>
            {fieldState.error?.message && (
              <p className="mb-2 rounded-field bg-brand-red/10 px-3 py-2 text-[11px] font-bold text-brand-red">
                {fieldState.error.message}
              </p>
            )}
            {value !== '' && (
              <div className="mb-3 rounded-lg border border-brand-blue/30 bg-brand-blue/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black text-ink flex items-center gap-1.5">
                    {chosen?.state?.toLowerCase() === 'punjab' ? '🌾 Punjab' : '🏢 Haryana'} Dealer: {chosen?.name || label || value}
                  </span>
                  {chosen?.salesperson && (
                    <span className="rounded bg-brand-blue/20 px-2 py-0.5 text-[10px] font-black text-brand-blue">
                      👤 Assigned Officer: {chosen.salesperson}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {chosen?.city ? `Station: ${chosen.city} • ` : ''}Ledger {value}
                  {locked ? ' — the party of a saved draft is not rewritten here' : ''}
                </p>
              </div>
            )}
          </>
        )}
      />
      {!locked && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-muted mr-1">Territory:</span>
            <button
              type="button"
              onClick={() => setTerritory('all')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                territory === 'all'
                  ? 'bg-ink text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              All Dealers
            </button>
            <button
              type="button"
              onClick={() => setTerritory('Punjab')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                territory === 'Punjab'
                  ? 'bg-brand-blue text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              🌾 Punjab
            </button>
            <button
              type="button"
              onClick={() => setTerritory('Haryana')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                territory === 'Haryana'
                  ? 'bg-brand-green text-white'
                  : 'bg-canvas text-muted border border-line hover:bg-panel hover:text-ink'
              }`}
            >
              🏢 Haryana
            </button>
          </div>
          <input
            className="input"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search active dealers by name, city (e.g. Mandi Gobindgarh, Jind, Rohtak), or officer…"
          />
          <div className="mt-2">
            <LiveSyncBar sync={sync} busy={state === 'loading'} />
          </div>
          {state === 'loading' && <Spinner label="Loading active dealers…" />}
          {state === 'error' && (
            <p className="text-xs font-semibold text-brand-red">
              {error}{' '}
              <button type="button" className="font-bold underline" onClick={retry}>
                Try again
              </button>
            </p>
          )}
          {state === 'ready' && displayRows.length === 0 && (
            <p className="text-xs text-muted">
              {term || territory !== 'all'
                ? 'No active dealer matches that search or territory filter.'
                : 'No active dealer found on the backend.'}
            </p>
          )}
          {state === 'ready' && displayRows.length > 0 && (
            <>
              <div className="max-h-72 overflow-y-auto rounded-field border border-line mt-2">
                {displayRows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setValue('customerId', r.id, { shouldValidate: true, shouldDirty: true });
                      if (r.salespersonId) {
                        setValue('salespersonId', r.salespersonId, { shouldValidate: true, shouldDirty: true });
                      }
                      onSelectCustomer?.(r);
                    }}
                    className={`flex w-full items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-left last:border-b-0 hover:bg-canvas transition ${
                      r.id === value ? 'bg-brand-blue/10' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-[13px] font-bold text-ink">
                        <span>{r.state?.toLowerCase() === 'punjab' ? '🌾' : '🏢'}</span>
                        <span>{r.name}</span>
                      </span>
                      <span className="block text-[10px] text-muted">
                        {r.city || '—'} {r.district ? `(${r.district})` : ''} • {r.state} • Officer: <strong className="text-brand-blue">{r.salesperson || 'Assigned'}</strong>
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] font-bold text-muted">{r.id === value ? '✓ selected' : 'select'}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                <span>
                  {total} active dealer(s) on backend — page {page} of {Math.max(1, Math.ceil(total / 50))}.
                </span>
                <div className="flex items-center gap-1">
                  {page > 1 && (
                    <button type="button" className="btn-ghost btn-sm !py-0.5 text-xs font-bold" onClick={() => setPage((p) => p - 1)}>
                      ← Prev
                    </button>
                  )}
                  {page * 50 < total && (
                    <button type="button" className="btn-ghost btn-sm !py-0.5 text-xs font-bold" onClick={() => setPage((p) => p + 1)}>
                      Next →
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One material line with Unit, Rate, and GST removed from UI. Defaulted to MT and 0 rate behind the scenes. */
function LineBlock({
  index,
  products,
  productsState,
  control,
  setValue,
  watch,
  onRemove,
  canRemove,
}: {
  index: number;
  products: ServerProduct[];
  productsState: 'loading' | 'ready' | 'error';
  control: Control<OrderForm>;
  setValue: UseFormSetValue<OrderForm>;
  watch: UseFormWatch<OrderForm>;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const productId = watch(`lines.${index}.productId`);
  const isCustom = productId === CUSTOM;
  const known = products.some((p) => p.id === productId);
  const orphan = productId !== '' && !isCustom && !known;

  return (
    <div className="rounded-field border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Material Line {index + 1}</p>
        {canRemove && (
          <button type="button" className="btn-ghost btn-sm !py-1 text-brand-red" onClick={onRemove}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={isCustom ? 'sm:col-span-3' : 'sm:col-span-1'}>
          <label className="label">
            Product / Material<span className="text-brand-red"> *</span>
          </label>
          <Controller
            name={`lines.${index}.productId`}
            control={control}
            render={({ field, fieldState }) => (
              <>
                <select
                  className={`input ${fieldState.error ? 'input-error' : ''}`}
                  value={String(field.value ?? '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    field.onChange(next);
                    setValue(`lines.${index}.unit`, 'MT');
                    setValue(`lines.${index}.rateRupees`, '0');
                    setValue(`lines.${index}.gstPercent`, '');
                    if (next === CUSTOM) {
                      setValue(`lines.${index}.productName`, '');
                      return;
                    }
                    const picked = products.find((p) => p.id === next);
                    if (picked) {
                      setValue(`lines.${index}.productName`, picked.name);
                    }
                  }}
                >
                  <option value="">— pick a product —</option>
                  {orphan && (
                    <option value={productId}>
                      {productId} — on the draft, not in the products this screen read
                    </option>
                  )}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value={CUSTOM}>Other — type the material name</option>
                </select>
                {fieldState.error?.message && (
                  <p className="mt-1 text-[11px] font-semibold text-brand-red">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
          {productsState === 'loading' && <p className="mt-1 text-[11px] text-faint">Reading the product master…</p>}
          {productsState === 'error' && (
            <p className="mt-1 text-[11px] font-semibold text-brand-red">
              The product master could not be read — choose “Other” and type the material name.
            </p>
          )}
        </div>

        {isCustom && <TextField name={`lines.${index}.productName`} label="Material name" control={control} required />}

        <TextField
          name={`lines.${index}.quantity`}
          label="Quantity (MT)"
          control={control}
          required
          placeholder="e.g. 10.000"
          hint="Quantity in Metric Tonnes (MT)."
        />

        <TextField
          name={`lines.${index}.rateRupees`}
          label="Rate ₹ / MT (Optional)"
          control={control}
          placeholder="0 (as per slip)"
          hint="Optional. 0 if as per handwritten slip."
        />
      </div>
    </div>
  );
}

export default function OrderNew() {
  const { id: draftId } = useParams();
  const navigate = useNavigate();
  const user = useLiveSession((s) => s.user);
  const isOwner = user?.role === 'owner';

  // A draft the operator came back to. `null` data means "this is a fresh order", which is the only
  // reason the fetcher is unconditional — a hook cannot be skipped by the route.
  const draft = useResource<ServerOrderDetail | null>(
    useCallback(() => (draftId ? getOrder(draftId) : Promise.resolve(null)), [draftId]),
  );

  const { control, handleSubmit, reset, watch, setValue, setError, clearErrors } = useForm<OrderForm>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyForm(),
  });
  const fields = useFieldArray({ control, name: 'lines' });

  const [selectedCustomer, setSelectedCustomer] = useState<ServerCustomer | null>(null);
  const handleSelectCustomer = useCallback((c: ServerCustomer) => {
    setSelectedCustomer(c);
  }, []);
  const [slipPhoto, setSlipPhoto] = useState<{ dataUrl: string; name: string } | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [errorBox, setErrorBox] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [busy, setBusy] = useState<'draft' | 'pending' | ''>('');
  const writeKeyRef = useRef<KeyedSubmission | null>(null);
  const statusKeyRef = useRef<KeyedSubmission | null>(null);
  const versionRef = useRef(0);
  const intentRef = useRef<'draft' | 'pending'>('draft');

  const handleFileCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSlipPhoto({
          dataUrl: reader.result,
          name: file.name || 'order-slip.jpg',
        });
        toast.success('Handwritten order slip captured!');
      }
    };
    reader.readAsDataURL(file);
  };

  const [products, setProducts] = useState<{ state: 'loading' | 'ready' | 'error'; rows: ServerProduct[]; truncated: boolean }>(
    { state: 'loading', rows: [], truncated: false },
  );
  const [employees, setEmployees] = useState<{ state: 'loading' | 'ready' | 'error' | 'refused'; rows: ServerEmployee[] }>({
    state: 'loading',
    rows: [],
  });

  useEffect(() => {
    let alive = true;
    listProducts({ activeOnly: true, pageSize: 200 })
      .then((page) => alive && setProducts({ state: 'ready', rows: page.items, truncated: page.total > page.items.length }))
      .catch(() => {
        if (alive) setProducts({ state: 'error', rows: [], truncated: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  // The salesperson attribution is an owner field: `POST /orders` takes it from the owner and pins
  // an employee's order to the caller. So an employee session neither loads the staff list nor
  // sends the key.
  useEffect(() => {
    if (!isOwner) {
      setEmployees({ state: 'refused', rows: [] });
      return;
    }
    let alive = true;
    listEmployees({ activeOnly: true })
      .then((page) => {
        if (alive) setEmployees({ state: 'ready', rows: page.items });
      })
      .catch((cause) => {
        if (!alive) return;
        setEmployees({ state: cause instanceof ServerError && cause.status === 403 ? 'refused' : 'error', rows: [] });
      });
    return () => {
      alive = false;
    };
  }, [isOwner]);

  const loaded = draft.state === 'ready' ? draft.data : null;
  const editing = loaded !== null;

  useEffect(() => {
    if (loaded === null) return;
    versionRef.current = loaded.version;
    reset(formFromDraft(loaded));
    if (loaded.slipImageData) {
      setSlipPhoto({ dataUrl: loaded.slipImageData, name: 'Attached Slip' });
    }
    writeKeyRef.current = null;
    statusKeyRef.current = null;
  }, [loaded, reset]);

  const salespersonOptions = useMemo(
    () =>
      employees.rows.map((e) => {
        const territoryTag = e.salesTerritory?.toLowerCase().includes('punjab')
          ? '🌾 Punjab'
          : e.salesTerritory?.toLowerCase().includes('haryana')
          ? '🏢 Haryana'
          : '';
        return {
          value: e.id,
          label: `${territoryTag ? `${territoryTag} • ` : ''}${e.name} (${e.role})`,
        };
      }),
    [employees.rows],
  );
  const chosenCustomerId = watch('customerId');

  /** The server names the field it refused, and a name that belongs to an input on this screen puts
   *  its message on that input. `lines` on its own and anything unrecognised stay in the box under
   *  the buttons: placing a message the backend did not place would be the panel guessing.
   *  `party_not_active` is called out on its own because it has an answer the operator can act on —
   *  get the party approved — and reading it as "validation error" hides that. */
  function surface(cause: unknown, fallback: string): void {
    if (!(cause instanceof ServerError)) {
      setErrorBox(fallback);
      return;
    }
    if (cause.code === 'party_not_active') {
      setErrorBox(
        'The backend refused this party: it is not active, so no order can be booked against it. A customer a salesperson entered waits for the owner to approve it.',
      );
      return;
    }
    if (!cause.fields) {
      setErrorBox(cause.message);
      return;
    }
    const named = [
      'customerId',
      'orderDate',
      'dueDate',
      'expectedDispatchDate',
      'paymentTerms',
      'notes',
      'salespersonId',
    ];
    const stray: string[] = [];
    for (const [field, message] of Object.entries(cause.fields)) {
      if (named.includes(field) || /^lines\.\d+\.(productId|productName|unit|quantity|rateRupees|gstPercent)$/.test(field)) {
        setError(field as Path<OrderForm>, { message });
      } else {
        stray.push(`${field}: ${message}`);
      }
    }
    const text = [cause.message, ...stray].filter((s) => s.trim() !== '').join(' ');
    if (text !== '') setErrorBox(text);
  }

  const run = async (values: OrderForm) => {
    if (busy !== '') return;
    setErrorBox('');
    setSavedNote('');
    clearErrors();
    const intent = intentRef.current;

    const candidateLines = values.lines.filter(
      (l) => l.productId.trim() !== '' || l.productName.trim() !== '' || l.quantity.trim() !== ''
    );

    let finalLines: OrderLinePayload[] = [];
    if (candidateLines.length === 0) {
      if (slipPhoto) {
        finalLines = [
          {
            productName: 'Material list as per attached slip',
            quantity: '1.000',
            unit: 'MT',
            ratePaise: 0,
            gstRatePercent: null,
          },
        ];
      } else {
        setErrorBox('Please add at least one material line or capture a photo of the handwritten order slip.');
        return;
      }
    } else {
      const mappedLines = candidateLines.map((l) => ({
        ...l,
        productId: l.productId === CUSTOM ? '' : l.productId,
      }));
      const safeToPaise = (text: string) => {
        const cleaned = (text ?? '').replace(/[,\s₹]/g, '').trim();
        if (cleaned === '' || cleaned === '0') return { ok: true as const, paise: 0 };
        return paiseFromRupees(cleaned);
      };
      const built = buildOrderLines(mappedLines, safeToPaise);
      if (Object.keys(built.problems).length > 0) {
        for (const [path, message] of Object.entries(built.problems)) setError(path as Path<OrderForm>, { message });
        const detailedErrors = Object.values(built.problems).join('; ');
        setErrorBox(detailedErrors || built.message);
        return;
      }
      finalLines = built.lines;
    }

    if (values.customerId === '') {
      setError('customerId', { message: 'Choose the customer this order belongs to.' });
      setErrorBox('No customer is chosen, so nothing was sent.');
      return;
    }

    // The header every write carries.
    const shared = {
      orderDate: values.orderDate,
      dueDate: values.dueDate.trim() === '' ? null : values.dueDate.trim(),
      expectedDispatchDate: values.expectedDispatchDate.trim() === '' ? null : values.expectedDispatchDate.trim(),
      paymentTerms: values.paymentTerms.trim(),
      notes: values.notes.trim(),
      lines: finalLines,
      slipImageData: slipPhoto ? slipPhoto.dataUrl : null,
    };

    setBusy(intent);
    try {
      if (editing && loaded) {
        const patchBody: OrderPatchBody = { ...shared };
        if (values.customerId !== loaded.customerId) patchBody.customerId = values.customerId;
        const submission = idempotencyKeyFor(writeKeyRef.current, { id: loaded.id, patchBody }, newIdempotencyKey);
        writeKeyRef.current = submission;
        const updated = await patchOrder(loaded.id, patchBody, submission.key, versionRef.current);
        writeKeyRef.current = null;
        versionRef.current = updated.version;
        reset(formFromDraft(updated));
        invalidate(syncKeys.order(updated.id), syncKeys.orderList());

        if (intent === 'pending') {
          const statusSubmission = idempotencyKeyFor(
            statusKeyRef.current,
            { id: updated.id, to: 'pending' },
            newIdempotencyKey,
          );
          statusKeyRef.current = statusSubmission;
          const submitted = await setOrderStatus(updated.id, { to: 'pending' }, statusSubmission.key, updated.version);
          statusKeyRef.current = null;
          versionRef.current = submitted.version;
          toast.success(
            submitted.number
              ? `Order ${submitted.number} submitted — that number is the one the server printed`
              : 'Submitted on the backend, but the answer carried no printed number',
          );
          navigate(`/orders/${submitted.id}`);
          return;
        }
        setSavedNote(
          `Order saved. The backend's row version is now ${updated.version}.`,
        );
        toast.success(`Order ${updated.number ?? updated.id} updated on the backend`);
        navigate(`/orders/${updated.id}`);
        return;
      }

      const body: OrderCreateBody = { ...shared, customerId: values.customerId, status: intent };
      if (selectedCustomer?.name) body.customerName = selectedCustomer.name;
      if (selectedCustomer?.state) body.state = selectedCustomer.state;
      if (selectedCustomer?.salesperson) body.salespersonName = selectedCustomer.salesperson;
      if (isOwner && values.salespersonId.trim() !== '') body.salespersonId = values.salespersonId.trim();

      const submission = idempotencyKeyFor(writeKeyRef.current, body, newIdempotencyKey);
      writeKeyRef.current = submission;
      const created = await createOrder(body, submission.key);
      writeKeyRef.current = null;
      invalidate(syncKeys.order(created.id), syncKeys.orderList());
      toast.success(
        intent === 'pending'
          ? created.number
            ? `Order ${created.number} booked on the backend`
            : 'Booked on the backend, but the answer carried no printed number'
          : 'Draft saved on the backend — it takes its printed number when it is submitted',
      );
      navigate(`/orders/${created.id}`);
    } catch (cause) {
      surface(cause, 'The order could not be saved. Nothing was written.');
    } finally {
      setBusy('');
    }
  };

  const submit = handleSubmit(run);

  if (draftId && draft.state === 'loading') {
    return (
      <div>
        <PageHeader title="Edit draft order" />
        <Card>
          <Spinner label="Loading the draft from the backend…" />
        </Card>
      </div>
    );
  }

  if (draft.state === 'error') {
    return (
      <div>
        <PageHeader title={draftId ? 'Edit draft order' : 'New Order'} />
        <Card>
          <p className="text-xs font-semibold text-brand-red">
            {draft.error}{' '}
            <button type="button" className="font-bold underline" onClick={draft.retry}>
              Try again
            </button>
          </p>
          <p className="mt-3 text-xs">
            <Link to="/orders" className="font-bold text-brand-blue hover:underline">
              Back to Orders
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  if (loaded !== null && loaded.status === 'dispatched') {
    return (
      <div>
        <PageHeader title={`Order ${loaded.number ?? loaded.id}`} />
        <Card>
          <p className="text-[13px] font-bold text-ink">
            <StatusBadge status={loaded.status} /> {loaded.number ? `Order ${loaded.number}` : loaded.id}
          </p>
          <p className="mt-2 text-xs text-muted">
            This order has been completely dispatched and cannot be edited. If items were returned or cancelled,
            void the relevant dispatch first.
          </p>
          <p className="mt-3 text-xs">
            <Link to={`/orders/${loaded.id}`} className="btn-primary inline-block">
              Open order details
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={editing ? (loaded?.number ? `Edit Order ${loaded.number}` : 'Edit draft order') : 'New Order'}
        subtitle={
          editing
            ? `A saved draft on ${serverHost()} — saving sends the whole line list through PATCH /orders/{id} with the row version you read`
            : `Booked straight onto ${serverHost()} — a draft takes its printed number when it is submitted`
        }
      />

      <form onSubmit={(e) => void submit(e)} noValidate>
        <Card>
          <CardHeader
            title="Party and header"
            subtitle="Only an active customer is offered: a party waiting for the owner's approval cannot take an order."
          />
          <div className="grid gap-3.5 sm:grid-cols-2">
            <CustomerPicker
              control={control}
              setValue={setValue}
              value={chosenCustomerId}
              label={loaded?.customerName ?? ''}
              locked={editing}
              onSelectCustomer={handleSelectCustomer}
            />
            <DateField name="orderDate" label="Order date" control={control} required />
            <DateField name="dueDate" label="Due date" control={control} hint="Blank leaves it to the customer's credit days." />
            <DateField name="expectedDispatchDate" label="Expected dispatch" control={control} />
            <TextField name="paymentTerms" label="Payment terms" control={control} />
            {isOwner ? (
              <SelectField
                name="salespersonId"
                label="Booked for salesperson (Auto-detected)"
                control={control}
                options={salespersonOptions}
                placeholder="— Auto-selected with dealer —"
                hint="Auto-selected based on dealer's assigned area officer in Punjab/Haryana."
              />
            ) : (
              <p className="rounded-field bg-canvas px-3 py-2 text-[11px] text-muted">
                Signed in as a {user?.role ?? 'non-owner'} account — the backend pins this order to you, so the panel
                sends no salesperson field at all.
              </p>
            )}
            <TextareaField name="notes" label="Notes" control={control} rows={2} className="sm:col-span-2" />
          </div>
          {employees.state === 'error' && (
            <p className="mt-2 rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] text-[#9A5A0B]">
              The staff list could not be loaded. Leave the field unassigned — the order still books.
            </p>
          )}
        </Card>

        {/* 📸 Handwritten Order Slip Photo Card */}
        <div className="mt-4">
          <Card className="border-2 border-dashed border-brand-blue/30 bg-brand-blue/5">
            <CardHeader
              title="📸 Handwritten Order Slip / List Photo"
              subtitle="Capture with camera or upload a photo of the handwritten order slip, diary entry, or WhatsApp list made by the salesperson/dealer."
            />
            <div className="p-3">
              {slipPhoto ? (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-brand-blue/30 bg-white p-3 shadow-sm">
                  <img
                    src={slipPhoto.dataUrl}
                    alt="Order Slip"
                    className="h-24 w-24 rounded-lg object-cover border border-line shadow-sm cursor-pointer hover:opacity-90"
                    onClick={() => setShowSlipModal(true)}
                  />
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-brand-green/20 px-2 py-0.5 text-[10px] font-black text-brand-green">
                        ✓ Slip Attached
                      </span>
                      <span className="text-xs font-bold text-ink">{slipPhoto.name}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      This handwritten slip is attached directly to the order and viewable by the dispatch desk.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSlipModal(true)}
                        className="btn-ghost btn-sm !py-1 text-xs font-bold text-brand-blue flex items-center gap-1"
                      >
                        <Eye size={12} /> View Full Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlipPhoto(null)}
                        className="btn-ghost btn-sm !py-1 text-xs font-bold text-brand-red flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-6 text-center">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    ref={cameraInputRef}
                    className="hidden"
                    onChange={handleFileCapture}
                  />
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileCapture}
                  />
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="btn-primary flex items-center gap-2 !py-2 !px-4 text-xs font-black shadow-sm"
                  >
                    <Camera size={16} /> Snap Photo (Camera)
                  </button>
                  <span className="text-xs text-muted font-bold">OR</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-ghost flex items-center gap-2 !py-2 !px-4 text-xs font-bold border border-line bg-white shadow-sm hover:bg-canvas"
                  >
                    <Upload size={16} /> Upload Image / Slip
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="mt-4">
          <Card>
            <CardHeader
              title="Material lines (Optional if slip attached)"
              subtitle="Add line items in Metric Tonnes (MT). If slip photo is attached, line items are optional."
              actions={
                <button type="button" className="btn-ghost btn-sm" onClick={() => fields.append(blankLine())}>
                  <Plus size={13} /> Add line
                </button>
              }
            />
            {fields.fields.length === 0 ? (
              <div className="rounded-field border border-dashed border-line bg-canvas p-4 text-center">
                <p className="text-xs font-bold text-ink">No individual material lines added.</p>
                <p className="mt-1 text-[11px] text-muted">
                  The order will be booked using the handwritten slip photo above.
                </p>
                <button
                  type="button"
                  className="btn-ghost btn-sm mt-3 inline-flex items-center gap-1.5 border border-line bg-white shadow-sm"
                  onClick={() => fields.append(blankLine())}
                >
                  <Plus size={13} /> Add Material Line
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {fields.fields.map((row, index) => (
                  <LineBlock
                    key={row.id}
                    index={index}
                    products={products.rows}
                    productsState={products.state}
                    control={control}
                    setValue={setValue}
                    watch={watch}
                    canRemove={fields.fields.length > 1 || slipPhoto !== null}
                    onRemove={() => fields.remove(index)}
                  />
                ))}
              </div>
            )}
            {products.state === 'ready' && products.truncated && (
              <p className="mt-2 rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] text-[#9A5A0B]">
                The product master sent only its first {products.rows.length} products. A SKU missing from that picker
                is not a reason to abandon the line: choose “Other” and type the material name.
              </p>
            )}
          </Card>
        </div>

        {errorBox !== '' && (
          <p className="mt-4 rounded-field bg-brand-red/10 px-3.5 py-2.5 text-xs font-bold text-brand-red">{errorBox}</p>
        )}
        {savedNote !== '' && (
          <p className="mt-4 rounded-field bg-brand-green/10 px-3.5 py-2.5 text-xs font-semibold text-brand-green">
            {savedNote}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate(loaded ? `/orders/${loaded.id}` : '/orders')}
          >
            {loaded ? 'Back to the draft' : 'Back to Orders'}
          </button>
          <button
            type="submit"
            className="btn-ghost"
            disabled={busy !== ''}
            onClick={() => {
              intentRef.current = 'draft';
            }}
          >
            {busy === 'draft' ? 'Saving…' : editing ? 'Save draft' : 'Save as draft'}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy !== ''}
            onClick={() => {
              intentRef.current = 'pending';
            }}
          >
            {busy === 'pending' ? 'Working…' : 'Save & submit'}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-faint">
          Both buttons write to {serverHost()}. A new order is one create whose `status` is already the answer —
          “Save &amp; submit” sends <code>pending</code> and the server mints the printed number — while an existing
          draft is PATCHed first and moved to <code>pending</code> after, each step with its own idempotency key.
          Pressing the same button again after a failure reuses that press's key, so the server sees one submission.
        </p>
      </form>

      <Modal open={showSlipModal} onClose={() => setShowSlipModal(false)} title="Handwritten Order Slip" wide>
        {slipPhoto && (
          <div className="flex flex-col items-center">
            <img src={slipPhoto.dataUrl} alt="Order Slip" className="max-h-[75vh] w-auto rounded-lg object-contain shadow-md" />
            <p className="mt-3 text-xs text-muted font-bold">{slipPhoto.name}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
