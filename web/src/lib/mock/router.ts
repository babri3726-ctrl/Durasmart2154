/** The in-browser answer to every request the panel makes when no backend is configured.
 *
 *  It speaks the real wire contract on purpose: the same `/api/v1` paths, the same query names,
 *  the same `{error:{code,message,fields}}` envelope, the same `409 version_conflict` and
 *  `422 validation_failed` refusals, and the same idempotency and `If-Match` rules. A screen cannot
 *  tell it from a server, which is the point — the UI is being demonstrated, not stubbed per
 *  component.
 *
 *  Nothing here opens a socket, and nothing here holds a credential: `demoCredentials` are the
 *  sign-in form's own demo identifiers and the "tokens" issued are random strings checked only for
 *  presence. Every number is invented in `fixtures/`.
 */

import { demoState } from './demoState';
import {
  DEMO_FILE_SHA,
  DEMO_PREVIEW_DIGEST,
  demoBatch,
  demoPreview,
} from './fixtures/stock';
import { PROVISIONAL_AS_OF, PROVISIONAL_LABEL } from '../provisionalSync';
import { orderLine } from './fixtures/core';
import {
  customerById,
  customerRows,
  dashboardSummary,
  debtorApplyResult,
  debtorPreviewFor,
  gap,
  importedStock,
  ledger,
  nextId,
  paginate,
  performance,
  provisionalHistory,
  provisionalPreviewFor,
  provisionalRuns,
  provisionalSummary,
  recomputeOrder,
  state,
  stockPreviewFor,
  stockSummary,
  touch,
  upvcStock,
  watchState,
} from './store';
import type {
  CustomerCreateBody,
  DispatchCapabilityBody,
  DispatchCreateBody,
  DispatchPatchBody,
  OrderCreateBody,
  OrderLineInput,
  OrderPatchBody,
  OrderStatusBody,
  ProvisionalConflictResolution,
  ProvisionalEditBody,
  ServerCustomer,
  ServerCustomerDetail,
  ServerDebtor,
  ServerDispatch,
  ServerDispatchBalance,
  ServerDispatchDetail,
  ServerEmployee,
  ServerLedgerEntry,
  ServerMatch,
  ServerOrder,
  ServerOrderDetail,
  ServerOrderLine,
  ServerPayment,
  ServerProduct,
  ServerProvisionalDebtor,
  ServerProvisionalMutation,
  ServerProvisionalSync,
  ServerStockImportApply,
  ServerStockImportBatch,
  ServerTarget,
  ServerUser,
} from '../serverApi';
import type { ServerStockPreview } from '../stockPreviewModel';

/** A per-tab nonce. Rotation hands out a new access value; the mock only asks that one is present. */
let tokenSeed = 0;
const mintToken = (kind: string) => `demo-${kind}-${(++tokenSeed).toString(36)}-${Date.now().toString(36)}`;

/** A signed-in tab: access token → who, and which rotation family it belongs to.
 *
 *  `family` is the refresh token the access token was minted with. Rotating hands the family to
 *  the new refresh token, so logging out removes every credential that came from one sign-in —
 *  which is what the real server does, and what makes the panel's replay detection observable.
 *
 *  `userKey` is the `demoUsers` key (`'owner'`), not the user's id (`'USR-DEMO-OWNER'`) — the two
 *  differ, and a session that stores the id cannot be looked back up in a table indexed by key. */
interface DemoSession {
  userKey: string;
  family: string;
}

/** The two registries, kept in the tab.
 *
 *  The demo book itself is rebuilt from the fixtures on every load — a reload is meant to undo
 *  what this session wrote. A session is different: it belongs to the tab, and the panel stores
 *  its tokens in `sessionStorage` for exactly that reason. Keeping the mock's side of the pair
 *  only in module memory would sign nobody back in after a refresh, so a plain F5 would read as
 *  "the credential was refused" rather than as what it is. */
const SESSION_STORE_KEY = 'demo.sessions';

const readStoredSessions = (): { access: [string, DemoSession][]; refresh: [string, DemoSession][] } => {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORE_KEY);
    const parsed = raw === null ? null : (JSON.parse(raw) as { access?: [string, DemoSession][]; refresh?: [string, DemoSession][] });
    return { access: parsed?.access ?? [], refresh: parsed?.refresh ?? [] };
  } catch {
    return { access: [], refresh: [] };
  }
};

const storedSessions = readStoredSessions();
const sessions = new Map<string, DemoSession>(storedSessions.access);
const refreshSessions = new Map<string, DemoSession>(storedSessions.refresh);

const persistSessions = (): void => {
  try {
    window.sessionStorage.setItem(
      SESSION_STORE_KEY,
      JSON.stringify({ access: [...sessions], refresh: [...refreshSessions] }),
    );
  } catch {
    // A tab that cannot keep its sessions still answers every request; it just signs out on reload.
  }
};

/** Drops every credential of one family: the access tokens it minted and the refresh tokens it rotated into. */
const dropFamily = (family: string): void => {
  for (const [token, session] of sessions) if (session.family === family) sessions.delete(token);
  for (const [token, session] of refreshSessions) if (session.family === family) refreshSessions.delete(token);
  persistSessions();
};

/** A deterministic stand-in for SHA-256 over the uploaded bytes.
 *
 *  The apply routes bind a confirmation to the previewed file by hash, so the mock needs a hash
 *  that is stable for the same bytes — not a cryptographic one. Same bytes, same 64 hex
 *  characters; a different file produces a different value and the panel's "the file changed under
 *  you" refusal becomes reachable. */
const bytesKey = async (body: BodyInit | null): Promise<string> => {
  const view = toBytes(body);
  if (view === null) return DEMO_FILE_SHA;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < view.length; index += 1) {
    h1 = Math.imul(h1 ^ view[index], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + view[index] + index, 0x85ebca6b) >>> 0;
  }
  const block = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return (block + sizeNibbles(view.length) + 'c3f2a9d40b7e5168').repeat(2).slice(0, 64);
};

const sizeNibbles = (size: number) => size.toString(16).padStart(8, '0').repeat(4);

const toBytes = (body: BodyInit | null): Uint8Array | null => {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return null;
};

// ── responses ────────────────────────────────────────────────────────────

const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const text = (payload: string): Response =>
  new Response(payload, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } });

const noContent = (): Response => new Response(null, { status: 204 });

/** The server's own refusal shape, so `send()` raises the same `ServerError` a real 4xx would. */
const refuse = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response =>
  json(status, { error: { code, message, ...(fields === undefined ? {} : { fields }) } });

/** Which refusal a read answers, from `?demo=` in the address bar. */
const demoRefusal = (what: string): Response | null => {
  const mode = demoState();
  if (mode === 'error') {
    return refuse(503, 'demo_error', `The demo store was told to fail: ${what} is unavailable in error mode.`);
  }
  return null;
};

/** How long a mock answer waits. Fixed, not random: two reloads of the same screen must show the
 *  same thing, or a screenshot proves nothing.
 *
 *  `?demo=loading` stretches the beat so a screen's skeleton can actually be looked at — except on
 *  the session routes. A parked sign-in or boot rehydration leaves the whole panel behind the
 *  startup splash, and then no skeleton is ever reached, which is the only reason the mode exists. */
const STALL_EXEMPT = /^\/(me|auth\/)/;

const delay = async (pathname: string): Promise<void> => {
  const ms = demoState() === 'loading' && !STALL_EXEMPT.test(pathname) ? 45_000 : 220;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

// ── session helpers ──────────────────────────────────────────────────────

const callerOf = (request: Request): ServerUser | null => {
  const header = request.headers.get('Authorization');
  const access = header !== null && header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(access);
  if (session === undefined) return null;
  const user = state.users[session.userKey];
  return user === undefined ? null : user;
};

const isOwner = (user: ServerUser | null): boolean => user?.role === 'owner';

const ownerOnly = (): Response =>
  refuse(403, 'forbidden', 'The owner performs this action in the demo store.');

// ── list filtering ───────────────────────────────────────────────────────

const has = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? '').toLowerCase().includes(needle.toLowerCase());

const pageQuery = (params: URLSearchParams, fallback: number) => ({
  page: Number(params.get('page') ?? '1') || 1,
  pageSize: Number(params.get('pageSize') ?? String(fallback)) || fallback,
});

// ── the routes ───────────────────────────────────────────────────────────

type Handler = (
  request: Request,
  params: URLSearchParams,
  path: Params,
  body: unknown,
) => Response | Promise<Response>;

type Params = Record<string, string>;

const routes: [method: string, pattern: RegExp, handler: Handler][] = [
  // ── session ────────────────────────────────────────────────────────────
  ['POST', /^\/auth\/login$/, (_request, _q, _p, body) => login(body)],
  ['POST', /^\/auth\/refresh$/, (_request, _q, _p, body) => refresh(body)],
  ['POST', /^\/auth\/logout$/, (request, _q, _p, body) => logout(request, body)],
  ['GET', /^\/me$/, (request) => {
    const user = callerOf(request);
    return user === null ? refuse(401, 'unauthenticated', 'The demo session is not active.') : json(200, user);
  }],

  // ── dashboard ──────────────────────────────────────────────────────────
  ['GET', /^\/dashboard\/summary$/, () => demoRefusal('the dashboard') ?? json(200, emptyable(dashboardSummary(), 'orderCount'))],
  ['GET', /^\/dashboard\/salesperson-performance$/, () => json(200, demoState() === 'empty' ? { ...performance(), rows: [] } : performance())],

  // ── customers ──────────────────────────────────────────────────────────
  ['GET', /^\/customers$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows: (ServerCustomer | ServerCustomerDetail)[] = customerRows();
    const filtered = rows.filter(
      (row) =>
        (!query.get('q') || has(row.name, query.get('q')!) || has(row.mobile, query.get('q')!)) &&
        (!query.get('city') || has(row.city, query.get('city')!)) &&
        (!query.get('salespersonId') || row.salespersonId === query.get('salespersonId')) &&
        (!query.get('status') || row.status === query.get('status')),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] : filtered, size.page, size.pageSize));
  }],
  ['POST', /^\/customers$/, (request, _q, _p, body) => createCustomer(request, body as CustomerCreateBody)],
  ['GET', /^\/customers\/match$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const name = query.get('name') ?? '';
    const mobile = query.get('mobile') ?? '';
    const matches: ServerMatch[] = customerRows()
      .filter((row) => (name !== '' && has(row.name, name)) || (mobile !== '' && row.mobile.endsWith(mobile)))
      .slice(0, 10)
      .map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        mobile: row.mobile,
        status: row.status,
        source: row.source,
        reason: name !== '' ? 'Name contains the text typed.' : 'Mobile ends with the digits typed.',
      }));
    return json(200, matches);
  }],
  ['GET', /^\/customers\/(?<id>[^/]+)$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const customer = customerById(decodeURIComponent(params.id));
    return customer === undefined
      ? refuse(404, 'not_found', 'No customer in the demo store carries that id.')
      : json(200, customer);
  }],
  ['POST', /^\/customers\/(?<id>[^/]+)\/approve$/, (request, _q, params) => decideCustomer(request, params.id, 'approved')],
  ['POST', /^\/customers\/(?<id>[^/]+)\/reject$/, (request, _q, params) => decideCustomer(request, params.id, 'rejected')],
  ['GET', /^\/customers\/(?<id>[^/]+)\/ledger$/, (request, query, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = ledger(decodeURIComponent(params.id));
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerLedgerEntry[] : rows, size.page, size.pageSize));
  }],
  ['GET', /^\/customers\/(?<id>[^/]+)\/opening-balances$/, (request, query, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const entries = state.openingBalances[decodeURIComponent(params.id)] ?? [];
    return json(200, paginate(entries, 1, pageQuery(query, 200).pageSize));
  }],
  ['POST', /^\/customers\/(?<id>[^/]+)\/opening-balances$/, (request, _q, params, body) => addOpeningBalance(request, params.id, body)],
  ['GET', /^\/customers\/(?<id>[^/]+)\/opening-balances\/history$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const id = decodeURIComponent(params.id);
    return json(200, state.audit.filter((row) => row.recordId === id || row.recordType === 'opening_balance'));
  }],

  // ── employees ──────────────────────────────────────────────────────────
  ['GET', /^\/employees$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.employees.filter(
      (row) =>
        (!query.get('q') || has(row.name, query.get('q')!)) &&
        (!query.get('department') || row.department === query.get('department')) &&
        (!(query.get('activeOnly') === 'true') || row.active),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerEmployee[] : rows, size.page, size.pageSize));
  }],
  ['POST', /^\/employees\/(?<id>[^/]+)\/dispatch-capability$/, (request, _q, params, body) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const employee = state.employees.find((row) => row.id === decodeURIComponent(params.id));
    if (employee === undefined) return refuse(404, 'not_found', 'No employee in the demo store carries that id.');
    const input = body as DispatchCapabilityBody;
    if (typeof input.mayDispatch !== 'boolean' || typeof input.reason !== 'string' || input.reason.trim() === '') {
      return refuse(422, 'validation_failed', 'The grant needs the flag and a reason.', { reason: 'Enter why this person may record a dispatch.' });
    }
    const previous = employee.mayDispatch;
    const changed = previous !== input.mayDispatch;
    employee.mayDispatch = input.mayDispatch;
    if (changed) {
      touch('employee', employee.id, 'employee.dispatch_capability_changed', input.reason, actor(request));
    }
    return json(200, {
      employeeId: employee.id,
      name: employee.name,
      mayDispatch: employee.mayDispatch,
      previousMayDispatch: previous,
      changed,
      reason: input.reason,
    });
  }],

  // ── targets ────────────────────────────────────────────────────────────
  ['GET', /^\/targets$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.targets.filter(
      (row) =>
        (!query.get('employeeId') || row.employeeId === query.get('employeeId')) &&
        (!query.get('from') || row.periodEnd >= query.get('from')!) &&
        (!query.get('to') || row.periodStart <= query.get('to')!),
    );
    const size = pageQuery(query, 200);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerTarget[] : rows, size.page, size.pageSize));
  }],
  ['PUT', /^\/targets$/, (request, _q, _p, body) => upsertTarget(request, body as ServerTargetInput)],

  // ── orders ─────────────────────────────────────────────────────────────
  ['GET', /^\/orders$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const user = callerOf(request);
    const rows = briefs().filter(
      (row) =>
        (isOwner(user) || row.salespersonId === user?.employeeId) &&
        (!query.get('q') || has(row.customerName, query.get('q')!) || has(row.number, query.get('q')!)) &&
        (!query.get('status') || row.status === query.get('status')) &&
        (!query.get('dispatchStatus') || row.dispatchStatus === query.get('dispatchStatus')) &&
        (!query.get('customerId') || row.customerId === query.get('customerId')) &&
        (!query.get('salespersonId') || row.salespersonId === query.get('salespersonId')) &&
        (!query.get('from') || row.orderDate >= query.get('from')!) &&
        (!query.get('to') || row.orderDate <= query.get('to')!),
    );
    const size = pageQuery(query, 20);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerOrder[] : rows, size.page, size.pageSize));
  }],
  ['POST', /^\/orders$/, (request, _q, _p, body) => createOrder(request, body as OrderCreateBody)],
  ['GET', /^\/orders\/(?<id>[^/]+)$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const order = orderOr404(decodeURIComponent(params.id));
    return order instanceof Response ? order : json(200, order);
  }],
  ['PATCH', /^\/orders\/(?<id>[^/]+)$/, (request, _q, params, body) => patchOrder(request, decodeURIComponent(params.id), body as OrderPatchBody)],
  ['POST', /^\/orders\/(?<id>[^/]+)\/status$/, (request, _q, params, body) => setOrderStatus(request, decodeURIComponent(params.id), body as OrderStatusBody)],
  ['GET', /^\/orders\/(?<id>[^/]+)\/dispatch-balance$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const order = orderOr404(decodeURIComponent(params.id));
    if (order instanceof Response) return order;
    const balance: ServerDispatchBalance = {
      orderId: order.id,
      number: order.number,
      status: order.status,
      dispatchStatus: order.dispatchStatus,
      lines: order.lines,
    };
    return json(200, balance);
  }],

  // ── dispatches ─────────────────────────────────────────────────────────
  ['GET', /^\/dispatches$/, (request, query) => {
    const denied = dispatchGuard(request);
    if (denied) return denied;
    const rows = state.dispatchDetails.filter(
      (row) =>
        (!query.get('q') || has(row.customerName, query.get('q')!) || has(row.orderNumber, query.get('q')!) || has(row.vehicle, query.get('q')!)) &&
        (!query.get('orderId') || row.orderId === query.get('orderId')) &&
        (!query.get('from') || row.dispatchDate >= query.get('from')!) &&
        (!query.get('to') || row.dispatchDate <= query.get('to')!),
    );
    const size = pageQuery(query, 20);
    const page = paginate(demoState() === 'empty' ? [] : rows.map(short), size.page, size.pageSize);
    return json(200, page);
  }],
  ['POST', /^\/dispatches$/, (request, _q, _p, body) => createDispatch(request, body as DispatchCreateBody)],
  ['GET', /^\/dispatches\/(?<id>[^/]+)$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    return dispatchOr404(decodeURIComponent(params.id));
  }],
  ['PATCH', /^\/dispatches\/(?<id>[^/]+)$/, (request, _q, params, body) => patchDispatch(request, decodeURIComponent(params.id), body as DispatchPatchBody)],
  ['POST', /^\/dispatches\/(?<id>[^/]+)\/void$/, (request, _q, params, body) => voidDispatch(request, decodeURIComponent(params.id), body)],
  ['PATCH', /^\/dispatches\/(?<id>[^/]+)\/delivery-status$/, (request, _q, params, body) => setDeliveryStatus(request, decodeURIComponent(params.id), body)],
  ['POST', /^\/dispatches\/(?<id>[^/]+)\/review$/, (request, _q, params, body) => reviewDispatch(request, decodeURIComponent(params.id), body)],

  // ── payments and products ──────────────────────────────────────────────
  ['GET', /^\/payments$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.payments.filter(
      (row) =>
        (!query.get('q') || has(row.customerName, query.get('q')!) || has(row.reference, query.get('q')!) || has(row.invoiceNumber, query.get('q')!)) &&
        (!query.get('customerId') || row.customerId === query.get('customerId')) &&
        (!query.get('orderId') || row.orderId === query.get('orderId')) &&
        (!query.get('from') || row.paymentDate >= query.get('from')!) &&
        (!query.get('to') || row.paymentDate <= query.get('to')!),
    );
    const size = pageQuery(query, 20);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerPayment[] : rows, size.page, size.pageSize));
  }],
  ['GET', /^\/products$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.products.filter(
      (row) =>
        (!query.get('q') || has(row.name, query.get('q')!) || has(row.sku, query.get('q')!)) &&
        (!query.get('category') || row.category === query.get('category')),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerProduct[] : rows, size.page, size.pageSize));
  }],

  // ── stock ──────────────────────────────────────────────────────────────
  ['GET', /^\/stock\/balances$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.stockBalances.filter(
      (row) =>
        (!query.get('q') || has(row.productName, query.get('q')!) || has(row.sku, query.get('q')!)) &&
        (!query.get('category') || row.category === query.get('category')) &&
        (query.get('lowStockOnly') !== 'true' || row.isLowStock),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] : rows, size.page, size.pageSize));
  }],
  ['GET', /^\/stock\/movements$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.stockMovements.filter(
      (row) =>
        (!query.get('q') || has(row.productName, query.get('q')!) || has(row.sku, query.get('q')!)) &&
        (!query.get('category') || productCategory(row.productId) === query.get('category')) &&
        (!query.get('from') || row.movementDate >= query.get('from')!) &&
        (!query.get('to') || row.movementDate <= query.get('to')!),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] : rows, size.page, size.pageSize));
  }],
  ['GET', /^\/stock\/summary$/, (request) => guard(request) ?? json(200, emptyable(stockSummary(), 'categories'))],
  ['GET', /^\/stock\/upvc$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    if (demoState() === 'empty') {
      return json(200, { ...upvcStock({}), rows: [], byColour: [], byLength: [], matrix: [] });
    }
    return json(200, upvcStock({
      type: query.get('type'),
      colour: query.get('colour'),
      lengthFt: query.get('lengthFt') === null ? null : Number(query.get('lengthFt')),
      q: query.get('q'),
    }));
  }],
  ['GET', /^\/stock\/imported$/, (request) => guard(request) ?? json(200, emptyable(importedStock(), 'items'))],
  ['GET', /^\/stock\/accessories$/, (request) => guard(request) ?? json(200, gap('Accessories', 'Accessories', 'sheet_not_in_apply_plan', 'The approved apply plan covers three sheets. Accessories is not one of them, so there is no figure to show.'))],
  ['GET', /^\/stock\/production$/, (request) => guard(request) ?? json(200, gap('Production', 'Production', 'sheet_not_in_apply_plan', 'The approved apply plan covers three sheets. Production is not one of them, so there is no figure to show.'))],

  // ── workbook imports ───────────────────────────────────────────────────
  ['POST', /^\/imports\/excel\/stock-preview$/, (request) => previewUpload(request, stockPreviewFor)],
  ['POST', /^\/imports\/excel\/stock-import$/, (request, query) => applyUpload(request, query)],
  ['GET', /^\/imports\/excel\/stock-watch$/, (request) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    return json(200, watchState());
  }],
  ['POST', /^\/imports\/excel\/stock-watch\/preview$/, (request) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const watch = watchState();
    if (!watch.readable) return refuse(409, 'stock_watch_unreadable', 'The watched workbook is not readable in the demo store.');
    return json(200, stockPreviewFor('1-1-1.xlsx', watch.fileSha256 ?? DEMO_FILE_SHA));
  }],
  ['POST', /^\/imports\/excel\/stock-watch\/apply$/, (request, query) => applyWatched(request, query, false)],
  ['POST', /^\/imports\/excel\/stock-watch\/sync$/, (request, query) => applyWatched(request, query, true)],
  ['GET', /^\/imports\/excel\/stock-imports$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const rows = state.batches.filter((row) => !query.get('q') || has(row.filename, query.get('q')!));
    const size = pageQuery(query, 20);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerStockImportBatch[] : rows, size.page, size.pageSize));
  }],
  ['GET', /^\/imports\/excel\/stock-imports\/(?<id>[^/]+)$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    return stockImportDetailOr404(decodeURIComponent(params.id));
  }],
  ['GET', /^\/imports\/excel\/stock-imports\/(?<id>[^/]+)\/items$/, (request, query, params) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.stockItems.filter(
      (row) => row.sourceBatchId === decodeURIComponent(params.id) && (!query.get('q') || has(row.displayLabel, query.get('q')!)),
    );
    const size = pageQuery(query, 20);
    return json(200, paginate(rows, size.page, size.pageSize));
  }],

  // ── debtors ────────────────────────────────────────────────────────────
  ['GET', /^\/debtors$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    const rows = state.debtors.filter(
      (row) =>
        (!query.get('q') || has(row.customerName, query.get('q')!)) &&
        (!query.get('asOf') || row.asOf === query.get('asOf')),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerDebtor[] : rows, size.page, size.pageSize));
  }],
  ['POST', /^\/debtors\/imports\/preview$/, (request) => previewUpload(request, debtorPreviewFor)],
  ['POST', /^\/debtors\/imports\/apply$/, (request, query) => applyDebtors(request, query)],

  // ── provisional debtors ────────────────────────────────────────────────
  ['GET', /^\/debtors\/provisional\/summary$/, (request) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    return json(200, provisionalSummary());
  }],
  ['GET', /^\/debtors\/provisional\/export$/, (request) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const rows = state.provisional.filter((row) => !row.archived);
    return text([
      'Party,Debit paise,Credit paise,As of,Reviewed,Assigned to',
      ...rows.map((row) => `"${row.partyName}",${row.debitPaise},${row.creditPaise},${row.asOf},${row.reviewed ? 'yes' : 'no'},${row.assignedEmployeeName ?? ''}`),
    ].join('\r\n'));
  }],
  ['GET', /^\/debtors\/provisional\/runs$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const rows = provisionalRuns().filter((row) => !query.get('q') || has(row.fileName, query.get('q')!));
    const size = pageQuery(query, 20);
    return json(200, paginate(rows, size.page, size.pageSize));
  }],
  ['GET', /^\/debtors\/provisional$/, (request, query) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    const rows = state.provisional.filter(
      (row) =>
        (!query.get('q') || has(row.partyName, query.get('q')!)) &&
        (query.get('archived') !== 'true' || row.archived) &&
        (query.get('archived') !== 'false' || !row.archived) &&
        (!query.get('employeeId') || row.assignedEmployeeId === query.get('employeeId')),
    );
    const size = pageQuery(query, 50);
    return json(200, paginate(demoState() === 'empty' ? [] as ServerProvisionalDebtor[] : rows, size.page, size.pageSize));
  }],
  ['POST', /^\/debtors\/provisional\/preview$/, (request) => previewUpload(request, provisionalPreviewFor)],
  ['POST', /^\/debtors\/provisional\/sync$/, (request, query) => syncProvisional(request, query)],
  ['GET', /^\/debtors\/provisional\/(?<ref>[^/]+)\/history$/, (request, _q, params) => {
    const denied = guard(request);
    if (denied) return denied;
    if (!isOwner(callerOf(request))) return ownerOnly();
    return json(200, provisionalHistory(decodeURIComponent(params.ref)));
  }],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/edit$/, (request, _q, params, body) => editProvisional(request, params.ref, body as ProvisionalEditBody)],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/archive$/, (request, _q, params, body) => setProvisionalArchived(request, params.ref, body, true)],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/restore$/, (request, _q, params, body) => setProvisionalArchived(request, params.ref, body, false)],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/assignment$/, (request, _q, params, body) => assignProvisional(request, params.ref, body)],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/review$/, (request, _q, params) => reviewProvisional(request, params.ref)],
  ['POST', /^\/debtors\/provisional\/(?<ref>[^/]+)\/conflict$/, (request, _q, params, body) => resolveProvisionalConflict(request, params.ref, body)],
];

// ── entry point ──────────────────────────────────────────────────────────

export async function mockRequest(path: string, init: RequestInit): Promise<Response> {
  const url = new URL(`http://demo.local${path}`);
  const request = new Request(`http://demo.local${path}`, init);
  const pathname = url.pathname.replace(/^\/api\/v1/, '');

  // Every answer is deliberately late by a beat, so skeletons and spinners are the real states the
  // panel has, not code that never runs. See `delay` for what `?demo=loading` does with it.
  await delay(pathname);

  const body = await readBody(request);

  for (const [method, pattern, handler] of routes) {
    if (method !== init.method && !(method === 'GET' && (init.method === undefined || init.method === 'GET'))) continue;
    const match = pattern.exec(pathname);
    if (match === null) continue;
    try {
      return toResponse(await handler(request, url.searchParams, match.groups ?? {}, body));
    } catch (cause) {
      return refuse(500, 'demo_store_error', `The demo store could not answer ${pathname}: ${describe(cause)}`);
    }
  }
  return refuse(404, 'not_found', `The demo store has no answer for ${init.method ?? 'GET'} ${pathname}.`);
}

const toResponse = (value: Response | undefined | null): Response =>
  value ?? refuse(500, 'demo_store_error', 'The demo store produced no answer.');

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const readBody = async (request: Request): Promise<unknown> => {
  if (request.body === null) return undefined;
  const contentType = request.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) return await request.json();
  return undefined;
};

/** `demo=empty` asks "what does a screen look like with nothing in it?". Only list-ish reads
 *  answer empty; the shapes stay valid so the screen renders its own empty state, not an error. */
const emptyable = <T extends object>(payload: T, key: string): T => {
  if (demoState() !== 'empty') return payload;
  const clone = { ...payload } as Record<string, unknown>;
  for (const candidate of Object.keys(clone)) {
    if (Array.isArray(clone[candidate])) clone[candidate] = [];
  }
  if (typeof clone[key] === 'number') clone[key] = 0;
  return clone as T;
};

// ── guards ───────────────────────────────────────────────────────────────

const guard = (request: Request): Response | null => {
  if (callerOf(request) === null) {
    return refuse(401, 'unauthenticated', 'The demo session is not active. Sign in again.');
  }
  return demoRefusal('the requested data');
};

/** Dispatch reads are gated on D-3's capability rather than the role. */
const dispatchGuard = (request: Request): Response | null => {
  const denied = guard(request);
  if (denied) return denied;
  const user = callerOf(request);
  if (isOwner(user)) return null;
  const employee = state.employees.find((row) => row.id === user?.employeeId);
  if (employee?.mayDispatch !== true) {
    return refuse(403, 'forbidden', 'This login does not hold the dispatch right in the demo store.');
  }
  return null;
};

const actor = (request: Request): ServerUser => callerOf(request) ?? state.users.owner;

/** A movement row carries a product id, not a category — the stock screens filter on the latter. */
const productCategory = (productId: string): string | null =>
  state.products.find((row) => row.id === productId)?.category ?? null;

const versionCheck = (request: Request, current: number): Response | null => {
  const header = request.headers.get('If-Match');
  if (header === null) {
    return refuse(400, 'precondition_required', 'The demo store needs the row version this screen read.');
  }
  if (Number(header) !== current) {
    return refuse(409, 'version_conflict', 'Someone saved this row after this screen read it. Reload and try again.');
  }
  return null;
};

// ── session handlers ─────────────────────────────────────────────────────

interface Credentials {
  identifier: string;
  password: string;
}

const login = (body: unknown): Response => {
  const { identifier, password } = (body ?? {}) as Partial<Credentials>;
  const userId = state.credentials[`${String(identifier ?? '').trim().toLowerCase()}|${String(password ?? '')}`];
  const user = userId === undefined ? undefined : state.users[userId];
  if (user === undefined) {
    return refuse(401, 'invalid_credentials', 'No demo login answers to that identifier and password.');
  }
  const access = mintToken('access');
  const refresh = mintToken('refresh');
  sessions.set(access, { userKey: userId, family: refresh });
  refreshSessions.set(refresh, { userKey: userId, family: refresh });
  persistSessions();
  return json(200, {
    accessToken: access,
    refreshToken: refresh,
    tokenType: 'bearer',
    accessExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    expiresIn: 1800,
    user,
  });
};

const refresh = (body: unknown): Response => {
  const { refreshToken } = (body ?? {}) as { refreshToken?: string };
  const present = refreshToken === undefined ? undefined : refreshSessions.get(refreshToken);
  const user = present === undefined ? undefined : state.users[present.userKey];
  if (user === undefined || present === undefined) {
    return refuse(401, 'invalid_refresh_token', 'The demo store does not recognise that refresh token.');
  }
  // The real server rotates the refresh token and treats a second presentation of the old one as
  // a replay. The mock rotates too, so the panel's single-flight logic is exercised rather than
  // papered over: the family survives, the presented token does not.
  refreshSessions.delete(refreshToken as string);
  const access = mintToken('access');
  const next = mintToken('refresh');
  sessions.set(access, { userKey: present.userKey, family: present.family });
  refreshSessions.set(next, { userKey: present.userKey, family: present.family });
  persistSessions();
  return json(200, {
    accessToken: access,
    refreshToken: next,
    tokenType: 'bearer',
    accessExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    expiresIn: 1800,
    user,
  });
};

const logout = (_request: Request, body: unknown): Response => {
  const { refreshToken } = (body ?? {}) as { refreshToken?: string };
  const present = refreshToken === undefined ? undefined : refreshSessions.get(refreshToken);
  if (present !== undefined) dropFamily(present.family);
  return noContent();
};

// ── customer handlers ────────────────────────────────────────────────────

const createCustomer = (request: Request, body: CustomerCreateBody): Response => {
  const user = callerOf(request);
  if (user === null) return refuse(401, 'unauthenticated', 'The demo session is not active.');
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return refuse(422, 'validation_failed', 'A party needs a name.', { name: 'Enter the customer name.' });
  }
  const id = nextId('CUST');
  const employee = state.employees.find((row) => row.id === (body.salespersonId ?? user.employeeId));
  const pendingBy = !isOwner(user);
  const detail: ServerCustomerDetail = {
    id,
    name: body.name.trim(),
    mobile: body.mobile ?? '',
    contactPerson: body.contactPerson ?? '',
    city: body.city ?? '',
    district: body.district ?? '',
    state: body.state ?? '',
    address: body.address ?? '',
    notes: body.notes ?? '',
    salespersonId: employee?.id ?? null,
    creditDays: body.creditDays ?? 0,
    status: pendingBy ? 'pending' : 'approved',
    source: 'panel',
    ledgerGroup: (body.creditDays ?? 0) > 0 ? 'Regular' : 'Cash',
    creditTerms: `Credit ${body.creditDays ?? 0} days`,
    approvedBy: pendingBy ? null : user.id,
    approvedAt: pendingBy ? null : new Date().toISOString(),
    openingPaise: 0,
    outstandingPaise: 0,
    advancePaise: 0,
    unbilledValuePaise: 0,
    overduePaise: 0,
    isOverdue: false,
    invoiceCount: 0,
    orderCount: 0,
    lastPaymentDate: null,
  };
  state.createdCustomers.push(detail);
  touch('customer', id, pendingBy ? 'customer.entry_created' : 'customer.created', detail.name, user);
  return json(201, detail);
};

const decideCustomer = (request: Request, rawId: string, decision: 'approved' | 'rejected'): Response => {
  const user = callerOf(request);
  if (user === null) return refuse(401, 'unauthenticated', 'The demo session is not active.');
  if (!isOwner(user)) return ownerOnly();
  const id = decodeURIComponent(rawId);
  const row = state.createdCustomers.find((customer) => customer.id === id);
  if (row === undefined) return refuse(404, 'not_found', 'That customer is not in the demo store.');
  if (row.status !== 'pending') {
    return refuse(409, 'conflict', `This party is already ${row.status}, so the decision is spent.`);
  }
  row.status = decision;
  row.approvedBy = user.id;
  row.approvedAt = new Date().toISOString();
  touch('customer', id, `customer.${decision}`, row.name, user);
  return json(200, row);
};

const addOpeningBalance = (request: Request, rawId: string, body: unknown): Response => {
  const user = callerOf(request);
  if (user === null) return refuse(401, 'unauthenticated', 'The demo session is not active.');
  const customerId = decodeURIComponent(rawId);
  if (customerById(customerId) === undefined) return refuse(404, 'not_found', 'That customer is not in the demo store.');
  const input = body as { asOf?: string; amountPaise?: number; direction?: string; source?: string };
  const errors: Record<string, string> = {};
  if (typeof input.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) errors.asOf = 'Pick a date.';
  if (typeof input.amountPaise !== 'number' || !Number.isInteger(input.amountPaise) || input.amountPaise < 0) {
    errors.amountPaise = 'Enter a whole number of paise.';
  }
  if (input.direction !== 'owes' && input.direction !== 'advance') errors.direction = 'Choose owes or advance.';
  if (Object.keys(errors).length > 0) return refuse(422, 'validation_failed', 'The opening balance needs a date, an amount and a direction.', errors);
  const entry = {
    id: state.openingSequence++,
    customerId,
    asOf: input.asOf as string,
    amountPaise: input.amountPaise as number,
    direction: input.direction as 'owes' | 'advance',
    source: input.source ?? 'panel',
    createdAt: new Date().toISOString(),
  };
  state.openingBalances[customerId] = [...(state.openingBalances[customerId] ?? []), entry];
  touch('opening_balance', customerId, 'opening_balance.created', `${entry.asOf} ${entry.direction} ${entry.amountPaise}`, user);
  return json(201, entry);
};

// ── target handler ───────────────────────────────────────────────────────

interface ServerTargetInput {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  productCategory: string | null;
  quantity: string;
  unit: string;
}

const upsertTarget = (request: Request, body: ServerTargetInput): Response => {
  const user = callerOf(request);
  if (user === null) return refuse(401, 'unauthenticated', 'The demo session is not active.');
  if (!isOwner(user)) return ownerOnly();
  const employee = state.employees.find((row) => row.id === body.employeeId);
  if (employee === undefined) return refuse(404, 'not_found', 'That employee is not in the demo store.');
  if (typeof body.quantity !== 'string' || !/^\d+(\.\d{1,3})?$/.test(body.quantity)) {
    return refuse(422, 'validation_failed', 'The target quantity must be a decimal string.', { quantity: 'Enter a quantity such as 1200.000.' });
  }
  const overlapping = state.targets.find(
    (row) =>
      row.employeeId === employee.id &&
      row.periodStart <= body.periodEnd &&
      row.periodEnd >= body.periodStart &&
      (row.periodStart !== body.periodStart || row.periodEnd !== body.periodEnd),
  );
  if (overlapping !== undefined) {
    return refuse(409, 'target_overlap', `${overlapping.periodStart} to ${overlapping.periodEnd} already has a target for this employee.`);
  }
  const existing = state.targets.find(
    (row) => row.employeeId === employee.id && row.periodStart === body.periodStart && row.periodEnd === body.periodEnd,
  );
  if (existing !== undefined) {
    existing.quantity = body.quantity;
    existing.unit = body.unit;
    existing.productCategory = body.productCategory ?? null;
    existing.setBy = user.name;
    existing.updatedAt = new Date().toISOString();
    touch('target', existing.id, 'target.updated', `${employee.name} ${existing.periodStart}`, user);
    return json(200, existing);
  }
  const created = {
    id: nextId('TGT'),
    employeeId: employee.id,
    employeeName: employee.name,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    productCategory: body.productCategory ?? null,
    quantity: body.quantity,
    unit: body.unit,
    setBy: user.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies ServerTarget;
  state.targets.push(created);
  touch('target', created.id, 'target.created', `${employee.name} ${created.periodStart}`, user);
  return json(201, created);
};

// ── order handlers ───────────────────────────────────────────────────────

const briefs = (): ServerOrder[] => state.orderDetails.map((order) => {
  const { lines: _lines, paymentTerms: _paymentTerms, notes: _notes, ...brief } = order;
  return brief;
});

const orderOr404 = (id: string): ServerOrderDetail | Response => {
  const order = state.orderDetails.find((row) => row.id === decodeURIComponent(id));
  return order === undefined ? refuse(404, 'not_found', 'That order is not in the demo store.') : order;
};

const createOrder = (request: Request, body: OrderCreateBody): Response => {
  const user = callerOf(request);
  if (user === null) return refuse(401, 'unauthenticated', 'The demo session is not active.');
  if (body.customerId === undefined || customerById(body.customerId) === undefined) {
    return refuse(422, 'validation_failed', 'Pick a customer that exists.', { customerId: 'No such party in the demo store.' });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return refuse(422, 'validation_failed', 'An order needs at least one line.', { lines: 'Add a line.' });
  }
  const salesperson = isOwner(user)
    ? state.employees.find((row) => row.id === (body.salespersonId ?? user.employeeId))
    : state.employees.find((row) => row.id === user.employeeId);
  const status = body.status === 'pending' ? 'pending' : 'draft';
  const id = nextId('ORD');
  const detail = buildOrder(id, body, status, salesperson ?? null);
  state.orderDetails.unshift(detail);
  touch('order', id, 'order.created', detail.customerName, user);
  return json(status === 'pending' ? 201 : 200, detail);
};

const buildOrder = (
  id: string,
  body: OrderCreateBody,
  status: 'draft' | 'pending',
  salesperson: ServerEmployee | null,
): ServerOrderDetail => {
  const customer = customerById(body.customerId);
  const lines = body.lines.map((line, index) => buildLine(line, index + 1));
  return {
    id,
    number: status === 'pending' ? `ORD-${state.today.slice(0, 4)}-DEMO-${id.slice(-4)}` : null,
    customerId: body.customerId,
    customerName: customer?.name ?? 'Unknown party',
    salespersonId: salesperson?.id ?? null,
    orderDate: body.orderDate ?? state.today,
    dueDate: body.dueDate ?? null,
    expectedDispatchDate: body.expectedDispatchDate ?? null,
    status,
    dispatchStatus: 'pending',
    source: 'panel',
    version: 1,
    cancelledAt: null,
    lineCount: lines.length,
    orderedQuantity: sum(lines.map((line) => Number(line.orderedQuantity))),
    dispatchedQuantity: '0.000',
    valuePaise: lines.reduce((total, line) => total + line.valuePaise, 0),
    invoiceCount: 0,
    billedPaise: 0,
    paymentCount: 0,
    paidPaise: 0,
    orderBalancePaise: 0,
    isBilled: false,
    dispatchCount: 0,
    lastDispatchDate: null,
    lines,
    paymentTerms: body.paymentTerms ?? '',
    notes: body.notes ?? '',
  };
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0).toFixed(3);

const buildLine = (input: OrderLineInput, lineNo: number): ServerOrderLine => {
  const product = state.products.find((row) => row.id === input.productId || row.name === input.productName);
  const name = product?.name ?? input.productName ?? 'Unmapped material';
  return orderLine(
    product?.id ?? input.productId ?? null,
    name,
    input.unit,
    Number(input.quantity).toFixed(3),
    '0.000',
    input.ratePaise,
    lineNo,
    state.orderLineSequence++,
    input.gstRatePercent ?? null,
  );
};

const patchOrder = (request: Request, id: string, body: OrderPatchBody): Response => {
  const order = orderOr404(id);
  if (order instanceof Response) return order;
  const stale = versionCheck(request, order.version);
  if (stale !== null) return stale;
  if (order.status !== 'draft') return refuse(409, 'not_editable', 'Only a draft can be edited in the demo store.');
  if (body.lines !== undefined) {
    order.lines = body.lines.map((line, index) => buildLine(line, index + 1));
    order.lineCount = order.lines.length;
    order.orderedQuantity = sum(order.lines.map((line) => Number(line.orderedQuantity)));
    order.valuePaise = order.lines.reduce((total, line) => total + line.valuePaise, 0);
  }
  if (body.orderDate !== undefined) order.orderDate = body.orderDate;
  if (body.dueDate !== undefined) order.dueDate = body.dueDate;
  if (body.expectedDispatchDate !== undefined) order.expectedDispatchDate = body.expectedDispatchDate;
  if (body.paymentTerms !== undefined) order.paymentTerms = body.paymentTerms;
  if (body.notes !== undefined) order.notes = body.notes;
  order.version += 1;
  touch('order', order.id, 'order.updated', order.customerName, actor(request));
  return json(200, order);
};

const ORDER_FLOW: Record<string, string[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['confirmed', 'cancelled'],
  confirmed: ['pendingDispatch', 'completed', 'cancelled'],
  pendingDispatch: ['dispatched', 'completed', 'cancelled'],
  dispatched: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const setOrderStatus = (request: Request, id: string, body: OrderStatusBody): Response => {
  const order = orderOr404(id);
  if (order instanceof Response) return order;
  const stale = versionCheck(request, order.version);
  if (stale !== null) return stale;
  const allowed = ORDER_FLOW[order.status] ?? [];
  if (!allowed.includes(body.to)) {
    return refuse(409, 'invalid_transition', `The demo store cannot move an order from ${order.status} to ${body.to}.`);
  }
  if (body.to === 'cancelled' && Number(order.dispatchedQuantity) > 0 && (body.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'A cancel of a partly dispatched order needs a reason.', { reason: 'Say why.' });
  }
  if (order.status === 'draft' && body.to === 'pending' && order.number === null) {
    order.number = `ORD-${state.today.slice(0, 4)}-DEMO-${order.id.slice(-4)}`;
  }
  order.status = body.to;
  if (body.to === 'cancelled') order.cancelledAt = new Date().toISOString();
  order.version += 1;
  touch('order', order.id, `order.status_${body.to}`, body.reason ?? order.customerName, actor(request));
  return json(200, order);
};

// ── dispatch handlers ────────────────────────────────────────────────────

const short = (detail: ServerDispatchDetail): ServerDispatch => {
  const { lines: _lines, ...brief } = detail;
  return brief;
};

const dispatchOr404 = (id: string): Response => {
  const detail = state.dispatchDetails.find((row) => row.id === decodeURIComponent(id));
  return detail === undefined ? refuse(404, 'not_found', 'That consignment is not in the demo store.') : json(200, detail);
};

const createDispatch = (request: Request, body: DispatchCreateBody): Response => {
  const denied = dispatchGuard(request);
  if (denied !== null) return denied;
  const order = orderOr404(body.orderId);
  if (order instanceof Response) return order;
  if (typeof body.dispatchDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dispatchDate)) {
    return refuse(422, 'validation_failed', 'A dispatch needs the date it actually went out.', { dispatchDate: 'Pick a date.' });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return refuse(422, 'validation_failed', 'A dispatch needs at least one line.', { lines: 'Add a line.' });
  }
  for (const line of body.lines) {
    const orderLine = order.lines.find((row) => row.orderLineId === line.orderLineId);
    if (orderLine === undefined) {
      return refuse(422, 'validation_failed', 'A dispatched line is not on this order.', { lines: `No order line ${line.orderLineId}.` });
    }
    if (Number(line.quantity) > Number(orderLine.remainingQuantity)) {
      return refuse(409, 'over_dispatch', `${orderLine.productName} has ${orderLine.remainingQuantity} ${orderLine.unit} left to send.`);
    }
  }
  const user = actor(request);
  const id = nextId('DSP');
  const detail: ServerDispatchDetail = {
    id,
    number: `DSP-${2004 + state.dispatchDetails.length}`,
    orderId: order.id,
    orderNumber: order.number,
    customerId: order.customerId,
    customerName: order.customerName,
    dispatchDate: body.dispatchDate,
    vehicle: body.vehicle ?? '',
    driver: body.driver ?? '',
    driverPhone: body.driverPhone ?? '',
    transportName: body.transportName ?? '',
    notes: body.notes ?? '',
    deliveryStatus: 'pending',
    deliveredAt: null,
    version: 1,
    source: 'panel',
    sourceRef: null,
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    createdByName: user.name,
    voidedAt: null,
    voidedBy: null,
    voidedByName: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByName: null,
    lineCount: body.lines.length,
    lines: body.lines.map((line, index) => {
      const orderLine = order.lines.find((row) => row.orderLineId === line.orderLineId);
      return {
        dispatchLineId: state.dispatchLineSequence++,
        orderLineId: line.orderLineId,
        lineNo: orderLine?.lineNo ?? index + 1,
        productId: orderLine?.productId ?? null,
        productName: orderLine?.productName ?? 'Unmapped material',
        quantity: Number(line.quantity).toFixed(3),
        unit: line.unit,
        batchNo: line.batchNo ?? '',
        warehouse: line.warehouse ?? '',
      };
    }),
  };
  state.dispatchDetails.unshift(detail);
  recomputeOrder(order.id);
  if (order.status === 'confirmed' || order.status === 'pendingDispatch') {
    order.status = order.dispatchStatus === 'dispatched' ? 'dispatched' : 'pendingDispatch';
    touch('order', order.id, 'order.status_auto', order.status, user);
  }
  touch('dispatch', id, 'dispatch.created', detail.customerName, user);
  return json(201, detail);
};

const patchDispatch = (request: Request, id: string, body: DispatchPatchBody): Response => {
  const denied = dispatchGuard(request);
  if (denied !== null) return denied;
  const detail = state.dispatchDetails.find((row) => row.id === id);
  if (detail === undefined) return refuse(404, 'not_found', 'That consignment is not in the demo store.');
  const stale = versionCheck(request, detail.version);
  if (stale !== null) return stale;
  if ((body.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'Correcting a consignment needs a reason.', { reason: 'Say why.' });
  }
  if (detail.voidedAt !== null) return refuse(409, 'already_voided', 'A voided consignment cannot be edited.');
  if (detail.reviewedAt !== null && !isOwner(callerOf(request))) {
    return refuse(409, 'reviewed_locked', 'This consignment was reviewed, so only the owner may change it.');
  }
  for (const key of ['dispatchDate', 'vehicle', 'driver', 'driverPhone', 'transportName', 'notes'] as const) {
    const value = body[key];
    if (value !== undefined) detail[key] = value;
  }
  detail.version += 1;
  touch('dispatch', detail.id, 'dispatch.updated', body.reason, actor(request));
  return json(200, detail);
};

const voidDispatch = (request: Request, id: string, body: unknown): Response => {
  const denied = dispatchGuard(request);
  if (denied !== null) return denied;
  const detail = state.dispatchDetails.find((row) => row.id === decodeURIComponent(id));
  if (detail === undefined) return refuse(404, 'not_found', 'That consignment is not in the demo store.');
  const input = body as { reason?: string };
  if ((input.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'A void needs a reason.', { reason: 'Say why this record is cancelled.' });
  }
  if (detail.voidedAt !== null) return refuse(409, 'already_voided', 'This consignment is already voided.');
  const orderId = detail.orderId;
  const user = actor(request);
  detail.voidedAt = new Date().toISOString();
  detail.voidedBy = user.id;
  detail.voidedByName = user.name;
  detail.version += 1;
  recomputeOrder(orderId);
  touch('dispatch', detail.id, 'dispatch.voided', input.reason ?? detail.customerName, user);
  return json(200, detail);
};

const DELIVERY_FLOW: Record<string, string[]> = {
  pending: ['inTransit', 'partial', 'delivered'],
  inTransit: ['partial', 'delivered'],
  partial: ['delivered'],
  delivered: [],
};

const setDeliveryStatus = (request: Request, id: string, body: unknown): Response => {
  const denied = dispatchGuard(request);
  if (denied !== null) return denied;
  const detail = state.dispatchDetails.find((row) => row.id === decodeURIComponent(id));
  if (detail === undefined) return refuse(404, 'not_found', 'That consignment is not in the demo store.');
  const stale = versionCheck(request, detail.version);
  if (stale !== null) return stale;
  const input = body as { to?: string };
  const allowed = DELIVERY_FLOW[detail.deliveryStatus] ?? [];
  if (input.to === undefined || !allowed.includes(input.to)) {
    return refuse(409, 'invalid_transition', `The demo store cannot move ${detail.deliveryStatus} to ${String(input.to)}.`);
  }
  detail.deliveryStatus = input.to;
  if (input.to === 'delivered') detail.deliveredAt = new Date().toISOString();
  detail.version += 1;
  touch('dispatch', detail.id, `dispatch.delivery_${input.to}`, detail.customerName, actor(request));
  return json(200, detail);
};

const reviewDispatch = (request: Request, id: string, body: unknown): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const detail = state.dispatchDetails.find((row) => row.id === decodeURIComponent(id));
  if (detail === undefined) return refuse(404, 'not_found', 'That consignment is not in the demo store.');
  const stale = versionCheck(request, detail.version);
  if (stale !== null) return stale;
  if (detail.voidedAt !== null) return refuse(409, 'already_voided', 'A voided consignment is not reviewed.');
  if (detail.reviewedAt !== null) return refuse(409, 'already_reviewed', 'This consignment is already reviewed.');
  const user = actor(request);
  const note = (body as { note?: string }).note ?? '';
  detail.reviewedAt = new Date().toISOString();
  detail.reviewedBy = user.id;
  detail.reviewedByName = user.name;
  detail.version += 1;
  touch('dispatch', detail.id, 'dispatch.reviewed', note === '' ? detail.customerName : note, user);
  return json(200, detail);
};

// ── workbook handlers ────────────────────────────────────────────────────

const previewUpload = async (
  request: Request,
  build: (fileName: string, fileSha256: string) => ServerStockPreview | { filename: string; fileSha256: string },
): Promise<Response> => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (demoState() === 'error') {
    return refuse(503, 'demo_error', 'The demo store was told to fail: the workbook could not be read.');
  }
  const fileName = requestUrl(request)?.searchParams.get('fileName') ?? 'workbook.xlsx';
  const sha = await bytesKey(request.body);
  const label = fileName === '' ? 'workbook.xlsx' : fileName;
  const payload = build(label, label.startsWith('1-1-1') ? DEMO_FILE_SHA : sha);
  const errors = shapeErrors(payload);
  if (errors.length > 0) return refuse(502, 'invalid_response', `The demo preview is malformed: ${errors.join(' ')}`);
  return json(200, payload);
};

const shapeErrors = (payload: unknown): string[] => {
  const value = payload as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ['businessRecordsCreated', 'databaseRowsWritten']) {
    if (key in value && value[key] !== false) errors.push(`${key} must be false in a preview`);
  }
  if ('readyToApply' in value && typeof value.readyToApply !== 'boolean') errors.push('readyToApply must be true or false');
  return errors;
};

const requestUrl = (request: Request): URL | null => {
  try {
    return new URL(request.url);
  } catch {
    return null;
  }
};

const applyUpload = async (request: Request, query: URLSearchParams): Promise<Response> => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  if (query.get('confirm') !== 'true') return refuse(400, 'confirm_required', 'Applying needs the owner’s confirmation.');
  const sha = await bytesKey(request.body);
  if (query.get('fileSha256') !== sha) {
    return refuse(409, 'file_changed_since_preview', 'The bytes sent no longer match the preview. Preview the file again.');
  }
  const fileName = query.get('fileName') ?? 'workbook.xlsx';
  return applyStock(request, fileName, sha, query.get('previewDigest') ?? '');
};

const applyStock = (request: Request, fileName: string, sha: string, digest: string): Response => {
  const preview = stockPreviewFor(fileName, sha);
  if (digest !== DEMO_PREVIEW_DIGEST) {
    return refuse(409, 'preview_stale', 'The plan digest sent is not one the demo preview issued.');
  }
  if (!preview.authorizedFileMatch) {
    return refuse(409, 'file_not_authorized', `${fileName} is not the authorised revision in the demo store.`);
  }
  if (preview.applyPlanErrors.length > 0) {
    return refuse(409, 'stock_import_blocked', 'The apply plan refuses this workbook.');
  }
  const batch = recordBatch(request, fileName, sha);
  return json(200, { batch, replayed: false, stockMovementsCreated: false, businessRecordsCreated: false } satisfies ServerStockImportApply);
};

const applyWatched = (request: Request, query: URLSearchParams, authorise: boolean): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  if (query.get('confirm') !== 'true') return refuse(400, 'confirm_required', 'Applying needs the owner’s confirmation.');
  const watch = watchState();
  const declared = query.get('fileSha256');
  if (declared === null || declared !== watch.fileSha256) {
    return refuse(409, 'file_changed_since_preview', 'The watched workbook changed after this screen read it.');
  }
  const fileName = (watch.path ?? '1-1-1.xlsx').split(/[\\/]/).pop() ?? '1-1-1.xlsx';
  if (authorise) {
    // The press is the consent: the on-disk revision becomes the accepted one, then applies.
    state.batch.authorizedSha256 = declared;
    touch('stock_authorized_revision', '1', 'stock_import.authorized', fileName, actor(request), {
      authorized_sha256: declared,
    });
  }
  if (!stockPreviewFor(fileName, declared).authorizedFileMatch) {
    return refuse(409, 'file_not_authorized', `${fileName} is not the authorised revision in the demo store.`);
  }
  const batch = recordBatch(request, fileName, declared);
  return json(200, { batch, replayed: false, stockMovementsCreated: false, businessRecordsCreated: false } satisfies ServerStockImportApply);
};

const recordBatch = (request: Request, fileName: string, sha: string): ServerStockImportBatch => {
  const user = actor(request);
  const batch: ServerStockImportBatch = {
    ...demoBatch,
    id: nextId('SIM'),
    filename: fileName,
    fileSha256: sha,
    authorizedSha256: state.batch.authorizedSha256,
    appliedAt: new Date().toISOString(),
    appliedBy: user.name,
    state: 'applied',
  };
  state.batch = { ...batch };
  state.batches.unshift(batch);
  touch('stock_import', batch.id, 'stock_import.applied', fileName, user);
  return batch;
};

const stockImportDetailOr404 = (id: string): Response => {
  const batchId = decodeURIComponent(id);
  const batch = state.batches.find((row) => row.id === batchId);
  if (batch === undefined) return refuse(404, 'not_found', 'That batch is not in the demo store.');
  return json(200, {
    batch,
    quarantine: state.quarantine,
    reconciliations: demoPreview.reconciliations,
    warnings: demoPreview.validation.warnings,
  });
};

const applyDebtors = async (request: Request, query: URLSearchParams): Promise<Response> => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  if (query.get('confirm') !== 'true') return refuse(400, 'confirm_required', 'Applying needs the owner’s confirmation.');
  const sha = await bytesKey(request.body);
  if (query.get('fileSha256') !== sha) {
    return refuse(409, 'file_changed_since_preview', 'The bytes sent no longer match the preview.');
  }
  if (query.get('previewDigest') !== DEMO_PREVIEW_DIGEST) {
    return refuse(409, 'preview_stale', 'The plan digest sent is not one the demo preview issued.');
  }
  const preview = debtorPreviewFor(query.get('fileName') ?? 'debtors.xlsx', sha);
  if (!preview.applyAvailable && query.get('allowReplacement') !== 'true') {
    return refuse(409, `apply_blocked_${preview.applyBlockedReason}`, 'Unresolved rows block the apply. Resolve them or re-export the file.');
  }
  const fileName = query.get('fileName') ?? 'debtors.xlsx';
  return json(200, debtorApplyResult(fileName, sha, false));
};

const syncProvisional = async (request: Request, query: URLSearchParams): Promise<Response> => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  if (query.get('confirm') !== 'true') return refuse(400, 'confirm_required', 'Syncing needs the owner’s confirmation.');
  const sha = await bytesKey(request.body);
  if (query.get('fileSha256') !== sha) {
    return refuse(409, 'file_changed_since_preview', 'The bytes sent no longer match the preview.');
  }
  if (query.get('previewDigest') !== DEMO_PREVIEW_DIGEST) {
    return refuse(409, 'preview_stale', 'The sync digest sent is not one the demo preview issued.');
  }
  const fileName = query.get('fileName') ?? 'provisional.xlsx';
  const replayedRun = state.provisionalRuns.includes(sha);
  if (!replayedRun) {
    state.provisionalRuns.push(sha);
    state.provisionalSyncCount += 1;
    touch('debtor_provisional_sync', `PDS-DEMO-${state.provisionalSyncCount}`, 'debtor_provisional.synced', fileName, actor(request));
  }
  const outcome: ServerProvisionalSync = {
    filename: fileName,
    fileSha256: sha,
    sheetName: 'Parties',
    label: PROVISIONAL_LABEL,
    asOf: PROVISIONAL_AS_OF,
    partyRowCount: 3,
    newCount: replayedRun ? 0 : 1,
    changedCount: replayedRun ? 0 : 0,
    unchangedCount: replayedRun ? 4 : 3,
    missingCount: 1,
    conflictCount: 1,
    archivedCount: 0,
    missingProvisionalIds: ['TMP-DL-DEMO-0002'],
    syncId: replayedRun ? null : `PDS-DEMO-${state.provisionalSyncCount}`,
    syncedAt: replayedRun ? null : new Date().toISOString(),
    replayed: replayedRun,
    databaseRowsWritten: !replayedRun,
    businessRecordsCreated: false,
    verifiedDebtorRowsTouched: false,
    disclaimer: 'A sync stores provisional balance observations. It creates no customer, ledger row or order.',
  };
  return json(200, outcome);
};

// ── provisional management handlers ──────────────────────────────────────

const provisionalOr404 = (ref: string): ServerProvisionalDebtor | Response => {
  const row = state.provisional.find((candidate) => candidate.sourceRef === decodeURIComponent(ref));
  return row === undefined ? refuse(404, 'not_found', 'That provisional record is not in the demo store.') : row;
};

const mutation = (row: ServerProvisionalDebtor, changed: boolean, message: string): Response =>
  json(200, { debtor: row, changed, message } satisfies ServerProvisionalMutation);

const editProvisional = (request: Request, ref: string, body: ProvisionalEditBody): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const row = provisionalOr404(ref);
  if (row instanceof Response) return row;
  const user = actor(request);
  let changed = false;
  if (body.partyName !== undefined && body.partyName !== row.partyName) {
    row.partyName = body.partyName;
    row.nameManuallyEdited = true;
    changed = true;
  }
  if (body.debitPaise !== undefined && body.debitPaise !== row.debitPaise) {
    row.debitPaise = body.debitPaise;
    changed = true;
  }
  if (body.creditPaise !== undefined && body.creditPaise !== row.creditPaise) {
    row.creditPaise = body.creditPaise;
    changed = true;
  }
  if (changed) {
    row.amountsManuallyEdited = true;
    row.updatedAt = new Date().toISOString();
    touch('debtor_provisional', row.sourceRef, 'debtor_provisional.edited', body.reason ?? row.partyName, user, {
      partyName: row.partyName,
      debitPaise: row.debitPaise,
      creditPaise: row.creditPaise,
    });
  }
  return mutation(row, changed, changed ? 'The figure is stored as edited.' : 'Nothing changed, so nothing was written.');
};

const setProvisionalArchived = (request: Request, ref: string, body: unknown, archived: boolean): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const row = provisionalOr404(ref);
  if (row instanceof Response) return row;
  const input = body as { reason?: string };
  if ((input.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'Archiving a provisional record needs a reason.', { reason: 'Say why.' });
  }
  if (row.archived === archived) {
    return mutation(row, false, archived ? 'This record is already archived.' : 'This record is already active.');
  }
  const user = actor(request);
  row.archived = archived;
  row.archivedAt = archived ? new Date().toISOString() : null;
  row.archivedBy = archived ? user.id : null;
  row.archivedByName = archived ? user.name : null;
  row.archiveReason = archived ? input.reason ?? '' : null;
  row.updatedAt = new Date().toISOString();
  touch('debtor_provisional', row.sourceRef, archived ? 'debtor_provisional.archived' : 'debtor_provisional.restored', input.reason ?? '', user);
  return mutation(row, true, archived ? 'The record is archived and stays in the history.' : 'The record is back in the list.');
};

const assignProvisional = (request: Request, ref: string, body: unknown): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const row = provisionalOr404(ref);
  if (row instanceof Response) return row;
  const input = body as { employeeId?: string | null; reason?: string };
  if ((input.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'Assigning a provisional record needs a reason.', { reason: 'Say why.' });
  }
  const wanted = input.employeeId ?? null;
  const employee = wanted === null ? null : state.employees.find((candidate) => candidate.id === wanted) ?? null;
  if (wanted !== null && employee === null) {
    return refuse(404, 'not_found', 'That employee is not in the demo store.');
  }
  const user = actor(request);
  row.assignedEmployeeId = employee?.id ?? null;
  row.assignedEmployeeName = employee?.name ?? null;
  row.assignedEmployeeActive = employee?.active ?? null;
  row.assignedAt = new Date().toISOString();
  row.assignedBy = user.id;
  row.assignedByName = user.name;
  row.updatedAt = row.assignedAt;
  touch('debtor_provisional', row.sourceRef, 'debtor_provisional.assigned', input.reason ?? '', user, {
    assignedEmployeeId: row.assignedEmployeeId,
  });
  return mutation(row, true, employee === null ? 'The record is unassigned again.' : `Assigned to ${employee.name}.`);
};

const reviewProvisional = (request: Request, ref: string): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const row = provisionalOr404(ref);
  if (row instanceof Response) return row;
  if (row.reviewed) return mutation(row, false, 'This record is already reviewed.');
  const user = actor(request);
  row.reviewed = true;
  row.reviewedAt = new Date().toISOString();
  row.reviewedBy = user.id;
  row.reviewedByName = user.name;
  row.updatedAt = row.reviewedAt;
  touch('debtor_provisional', row.sourceRef, 'debtor_provisional.reviewed', row.partyName, user);
  return mutation(row, true, 'Reviewed. It still is not a verified Tally identity.');
};

const resolveProvisionalConflict = (request: Request, ref: string, body: unknown): Response => {
  const denied = guard(request);
  if (denied !== null) return denied;
  if (!isOwner(callerOf(request))) return ownerOnly();
  const row = provisionalOr404(ref);
  if (row instanceof Response) return row;
  const input = body as { resolution?: ProvisionalConflictResolution; reason?: string };
  if (input.resolution !== 'accept_source' && input.resolution !== 'keep_manual') {
    return refuse(422, 'validation_failed', 'Choose which side of the conflict wins.', { resolution: 'accept_source or keep_manual' });
  }
  if ((input.reason ?? '').trim() === '') {
    return refuse(422, 'validation_failed', 'Resolving a conflict needs a reason.', { reason: 'Say why.' });
  }
  if (!row.hasConflict) return mutation(row, false, 'This record has no conflict to resolve.');
  const user = actor(request);
  if (input.resolution === 'accept_source') {
    row.importedPartyName = row.pendingPartyName ?? row.importedPartyName;
    row.importedDebitPaise = row.pendingDebitPaise ?? row.importedDebitPaise;
    row.importedCreditPaise = row.pendingCreditPaise ?? row.importedCreditPaise;
    row.partyName = row.importedPartyName;
    row.debitPaise = row.importedDebitPaise;
    row.creditPaise = row.importedCreditPaise;
    row.nameManuallyEdited = false;
    row.amountsManuallyEdited = false;
  }
  row.hasConflict = false;
  row.pendingPartyName = null;
  row.pendingDebitPaise = null;
  row.pendingCreditPaise = null;
  row.pendingFileSha256 = null;
  row.pendingDetectedAt = null;
  row.updatedAt = new Date().toISOString();
  touch('debtor_provisional', row.sourceRef, `debtor_provisional.conflict_${input.resolution}`, input.reason ?? '', user);
  return mutation(
    row,
    true,
    input.resolution === 'accept_source' ? 'The incoming figures are now the stored ones.' : 'Your edit stands; the incoming figures were dropped.',
  );
};
