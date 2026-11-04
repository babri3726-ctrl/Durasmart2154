/** The panel's one door to the backend, for the endpoints the server actually answers.
 *
 *  Everything live on screen comes through this file: sign-in, the customer master and its
 *  ledger, opening balances, and since Phase 4 the read screens for orders, payments, stock,
 *  products and employees. Every write carries an `Idempotency-Key`, and every write to a row this
 *  client has just read carries that row's `version` as `If-Match`: manual customer entry and
 *  opening balances, the order book (create, edit a draft, move its status) and — since Phase 5 —
 *  the five dispatch routes of §2.6, whose gate is the capability on the employee record rather
 *  than the role. Since Phase 2C one route takes the workbook
 *  itself as the request body — `previewStockWorkbook` below, the panel's only
 *  `application/octet-stream` call and the only one that is not JSON in and JSON out. Modules
 *  whose endpoints do not exist yet render an honest placeholder instead — this client does not
 *  grow a call to a URL the backend has not built.
 *
 *  Configuration is `VITE_API_BASE_URL`, read at build time into the bundle — and it is optional
 *  here. Without it `apiTransport.ts` answers every request from the built-in mock store, so the
 *  functions below behave identically whether the bytes came off a socket or out of that store:
 *  the screens never learn which. Nothing else is baked in — no credentials, no keys, no address.
 *
 *  Tokens live in `sessionStorage`, not `localStorage`: they die with the tab, and they are
 *  readable only by this origin. That is a real tradeoff and not the equal of an httpOnly
 *  cookie — script injected into this page could read them — but it is the honest minimum for a
 *  panel with no cookie plumbing, and it is strictly better than localStorage's "forever".
 *
 *  Every non-2xx answer throws `ServerError` carrying the server's own `{code, message, fields}`
 *  envelope, so a screen shows what the server said instead of inventing a friendlier sentence.
 *  A 401 on an authenticated call is retried once after `/auth/refresh`; if the refresh fails the
 *  tokens are dropped and the caller is told to sign in again — except when the refresh failed only
 *  because the backend could not be reached, which proves nothing about a token and therefore keeps
 *  the session. The rotations themselves are single-flighted, because this server treats a
 *  refresh token presented twice as a replay. The rules that decide all of this live in
 *  `sessionRules.ts`, which has no imports so `scripts/session-refresh-test.mjs` can test them.
 */

/** The base URL, whether a backend was supplied, and the transport itself all live in
 *  `apiTransport.ts` — the one place a build chooses between a real backend and the built-in mock
 *  store. This file shapes requests; it no longer decides where they go. */
import { API_BASE_URL, DATA_SOURCE_LABEL, realBackendConfigured, transportFetch } from './apiTransport';

/** Host only — shown in status lines. With no backend it names the built-in store, so a status
 *  line never claims nothing is configured while the panel is in fact answering. */
export function serverHost(): string {
  if (!realBackendConfigured()) return DATA_SOURCE_LABEL;
  try {
    return new URL(API_BASE_URL).host;
  } catch {
    return API_BASE_URL;
  }
}

import {
  readStockPreviewPayload,
  type ServerReconciliation,
  type ServerStockPreview,
  type ServerStockWarning,
} from './stockPreviewModel';
import {
  EXPIRED_SESSION_MESSAGE,
  canAttemptRequest,
  credentialIsSpent,
  credentialRefused,
} from './sessionRules';
import {
  PROVISIONAL_AS_OF,
  PROVISIONAL_IDENTITY_STATE,
  PROVISIONAL_LABEL,
} from './provisionalSync';

const ACCESS_KEY = 'ds.server.access';
const REFRESH_KEY = 'ds.server.refresh';

/** Every call's budget, and it stays 20 seconds for everything that answers from a query. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** `POST /imports/excel/stock-preview` gets its own, because it is the one route that spends
 *  real time *parsing* rather than querying: the backend stops itself at 20 seconds of parsing
 *  (`PARSE_BUDGET_SECONDS`) and answers with a structured refusal, so a client on the ordinary
 *  budget would give up at the same moment and report "could not be reached" for a file the
 *  server had in fact refused. Waiting longer cannot turn that refusal into a success — it only
 *  lets the server's own words arrive. Global timeouts are untouched; this is per route. */
export const STOCK_PREVIEW_TIMEOUT_MS = 90_000;

export class ServerError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(message: string, options: { code: string; status: number; fields?: Record<string, string> }) {
    super(message);
    this.name = 'ServerError';
    this.code = options.code;
    this.status = options.status;
    this.fields = options.fields;
  }
}

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'employee';
  department: string;
  employeeId: string | null;
  phone: string;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessExpiresAt: string;
  expiresIn: number;
  user: ServerUser;
}

export interface ServerPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  nextCursor: string | null;
}

/** The columns the panel's live screens display; the API returns more. */
export interface ServerCustomer {
  id: string;
  name: string;
  city: string;
  district: string;
  state: string;
  mobile: string;
  contactPerson: string;
  status: string;
  creditDays: number;
  salespersonId: string | null;
  salesperson?: string | null;
  source: string;
  openingPaise: number;
  outstandingPaise: number;
  advancePaise: number;
  unbilledValuePaise: number;
  overduePaise: number;
  isOverdue: boolean;
  invoiceCount: number;
  orderCount: number;
  lastPaymentDate: string | null;
}

export interface ServerCustomerDetail extends ServerCustomer {
  address: string;
  notes: string;
  ledgerGroup: string;
  creditTerms: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface ServerEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
  phone: string;
  city: string;
  salesTerritory?: string;
  /** Decimal string as the server sends it ("1500.000") — a target is never float-math'd here. */
  monthlyTargetQty: string;
  targetUnit: string;
  active: boolean;
  /** D-3's capability, read off the same column the dispatch gate reads. A fact about the record,
   *  not a permission in this client: the server re-reads it on every dispatch request. */
  mayDispatch: boolean;
}

export interface ServerMatch {
  id: string;
  name: string;
  city: string;
  mobile: string;
  status: string;
  source: string;
  reason: string;
}

export interface OpeningBalanceEntry {
  id: number;
  customerId: string;
  asOf: string;
  amountPaise: number;
  direction: 'owes' | 'advance';
  source: string;
  createdAt: string;
}

export interface ServerAuditEntry {
  id: string;
  at: string;
  action: string;
  actorKind: string;
  actorUserId: string | null;
  actorName: string;
  recordType: string;
  recordId: string;
  detail: string;
  changes: Record<string, unknown> | null;
}

export interface CustomerCreateBody {
  name: string;
  mobile: string;
  contactPerson: string;
  city: string;
  district: string;
  state: string;
  address: string;
  notes: string;
  salespersonId: string | null;
  salesperson?: string | null;
  creditDays: number | null;
}

export interface OpeningBalanceCreateBody {
  asOf: string;
  amountPaise: number;
  direction: 'owes' | 'advance';
}

// ── tokens ───────────────────────────────────────────────────────────────

function readToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeTokens(access: string | null, refresh: string | null): void {
  try {
    if (access === null) sessionStorage.removeItem(ACCESS_KEY);
    else sessionStorage.setItem(ACCESS_KEY, access);
    if (refresh === null) sessionStorage.removeItem(REFRESH_KEY);
    else sessionStorage.setItem(REFRESH_KEY, refresh);
  } catch {
    // A browser that refuses storage still works until the tab reloads; the session simply
    // does not survive the reload, which the operator discovers at the sign-in screen.
  }
}

export const hasServerSession = (): boolean => readToken(ACCESS_KEY) !== null;

export function clearServerSession(): void {
  writeTokens(null, null);
}

/** Registered by `liveSession.ts`, which cannot be imported here because it imports this file. */
let onSessionRefused: (() => void) | null = null;

export function setSessionRefusedHandler(handler: () => void): void {
  onSessionRefused = handler;
}

/** The backend looked at this tab's credential and refused it, so the credential is gone.
 *
 *  Dropping it is what stops the flood: every screen still mounted would otherwise send the same
 *  refused token and take the same 401. No token value is read, printed or kept here — the two
 *  copies are removed by key, and the only thing that leaves is the fact that the session ended.
 */
function endServerSession(): void {
  clearServerSession();
  onSessionRefused?.();
}

// ── request core ─────────────────────────────────────────────────────────

interface SendOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  extraHeaders?: Record<string, string>;
  /** The request body as bytes, sent with `Content-Type: application/octet-stream`. Mutually
   *  exclusive with `body`: a workbook is not JSON, and `JSON.stringify` of one would be the
   *  panel inventing a wire format the backend never asked for. Nothing that sets `bytes` goes
   *  through the JSON path, and nothing that sets `body` is affected by this one. */
  bytes?: Uint8Array | ArrayBuffer;
  /** This route's own budget. Absent means `DEFAULT_TIMEOUT_MS`, so a long-running route can be
   *  given room without loosening every other call in the panel. */
  timeoutMs?: number;
  /** Return the raw body instead of a JSON parse. Only the CSV export asks for this: its body is
   *  `text/csv`, and running it through `JSON.parse` would discard a document the owner asked to
   *  download. Error bodies are still read as the server's JSON envelope. */
  text?: boolean;
  /** internal: a 401 was already retried after a refresh */
  retried?: boolean;
}

async function send<T>(path: string, options: SendOptions = {}): Promise<T> {
  const { method = 'GET', body, bytes, auth = true, extraHeaders, timeoutMs, text: wantsText, retried = false } = options;
  if (!canAttemptRequest({ auth, access: readToken(ACCESS_KEY), refresh: readToken(REFRESH_KEY) })) {
    // Nothing to authenticate with. The session was refused and cleared already; asking the
    // server again would only re-collect the 401 that cleared it.
    throw new ServerError(EXPIRED_SESSION_MESSAGE, { code: 'unauthenticated', status: 401 });
  }
  const headers: Record<string, string> = { ...extraHeaders };
  if (bytes !== undefined) headers['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  const access = auth ? readToken(ACCESS_KEY) : null;
  if (access) headers.Authorization = `Bearer ${access}`;
  const budgetMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await transportFetch(path, {
      method,
      headers,
      // A `Uint8Array` body survives a retry: `fetch` reads it rather than draining it, which is
      // what lets the 401 path below resend the same workbook after a token refresh.
      body: bytes !== undefined ? bytes : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(budgetMs),
    });
  } catch (cause) {
    throw new ServerError(
      cause instanceof DOMException && cause.name === 'TimeoutError'
        ? `The backend at ${serverHost()} did not answer within ${Math.round(budgetMs / 1000)} seconds.`
        : `The backend at ${serverHost()} could not be reached.`,
      { code: 'network', status: 0 },
    );
  }

  if (credentialRefused(response.status) && auth) {
    // The server refused the credential this call carried. Rotate once and resend the same
    // request; `retried` is what keeps a refusal from becoming a loop.
    if (!retried) {
      const outcome = await refreshTokens();
      if (outcome.status === 'rotated') return send<T>(path, { ...options, retried: true });
      if (outcome.status === 'unreachable') {
        // No answer about the token at all. The credentials stay: the operator's network failed,
        // not their sign-in, and the next screen entry can ask again.
        throw outcome.error;
      }
      endServerSession();
      throw new ServerError(outcome.message, { code: 'unauthenticated', status: 401 });
    }
    // A second 401, after a token the server itself had just issued. This client cannot make the
    // credential work and must not keep trying with it.
    endServerSession();
    throw new ServerError(EXPIRED_SESSION_MESSAGE, { code: 'unauthenticated', status: 401 });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | undefined;
    const detail = envelope?.error;
    throw new ServerError(detail?.message ?? `The backend answered ${response.status}.`, {
      code: detail?.code ?? 'server_error',
      status: response.status,
      fields: detail?.fields,
    });
  }
  if (wantsText) return text as T;
  return parsed as T;
}

// ── session ──────────────────────────────────────────────────────────────

export async function signIn(identifier: string, password: string): Promise<ServerUser> {
  const result = await send<LoginResult>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier, password },
  });
  writeTokens(result.accessToken, result.refreshToken);
  return result.user;
}

/** What one rotation attempt produced. `refused` and `unreachable` are the whole distinction:
 *  the first spends the session and the second must not. */
type RefreshOutcome =
  | { status: 'rotated' }
  | { status: 'refused'; message: string }
  | { status: 'unreachable'; error: unknown };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Rotates the stored token, at most once at a time however many calls asked for it.
 *
 *  Not tidiness. The server rotates the refresh token on every `POST /auth/refresh` and treats a
 *  presentation of one it already rotated as a replay: it revokes every session in that token's
 *  family and writes an `auth.token_replay` audit entry naming this account
 *  (`backend/app/services/auth.py:250-272`). A dashboard that fires four requests at once on an
 *  expired access token would therefore send the same stored refresh value four times and, from
 *  the second answer onwards, look like the attacker it is reporting.
 */
function refreshTokens(): Promise<RefreshOutcome> {
  const running = refreshInFlight;
  if (running) return running;
  const attempt = rotateTokens().finally(() => {
    // Only this attempt's own slot: a later caller must not have its fresh rotation discarded
    // by an earlier one finishing.
    if (refreshInFlight === attempt) refreshInFlight = null;
  });
  refreshInFlight = attempt;
  return attempt;
}

async function rotateTokens(): Promise<RefreshOutcome> {
  const refresh = readToken(REFRESH_KEY);
  if (!refresh) return { status: 'refused', message: EXPIRED_SESSION_MESSAGE };
  try {
    const result = await send<LoginResult>('/auth/refresh', {
      method: 'POST',
      auth: false,
      body: { refreshToken: refresh },
    });
    writeTokens(result.accessToken, result.refreshToken);
    return { status: 'rotated' };
  } catch (cause) {
    if (!credentialIsSpent(cause)) return { status: 'unreachable', error: cause };
    // The server's own words about its own refusal, when it had any.
    const message = cause instanceof ServerError ? cause.message : EXPIRED_SESSION_MESSAGE;
    return { status: 'refused', message };
  }
}

/** `GET /me` — what the stored token is worth right now, or null when there is no session. */
export async function rehydrate(): Promise<ServerUser | null> {
  if (!hasServerSession()) return null;
  try {
    return await send<ServerUser>('/me');
  } catch (error) {
    if (error instanceof ServerError && error.status === 401) {
      // An unreachable backend during boot must not destroy a token that may still be good;
      // only an explicit refusal clears the session.
      clearServerSession();
      return null;
    }
    if (error instanceof ServerError && error.code === 'network') return null;
    throw error;
  }
}

export async function signOut(): Promise<void> {
  const refresh = readToken(REFRESH_KEY);
  if (refresh) {
    try {
      await send<void>('/auth/logout', { method: 'POST', auth: false, body: { refreshToken: refresh } });
    } catch {
      // The local session ends either way; a logout the server never heard still ends it here.
    }
  }
  clearServerSession();
}

// ── customers ────────────────────────────────────────────────────────────

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function createCustomer(body: CustomerCreateBody, idempotencyKey: string): Promise<ServerCustomerDetail> {
  return send<ServerCustomerDetail>('/customers', {
    method: 'POST',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

export function getCustomer(id: string): Promise<ServerCustomerDetail> {
  return send<ServerCustomerDetail>(`/customers/${encodeURIComponent(id)}`);
}

/** The owner's decision on a party a salesperson entered (`D-11`: the entry lands in
 *  `pendingApproval` and only the owner can move it out of there).
 *
 *  Both carry no body — the decision is the route — so the only thing distinguishing one
 *  submission from a retry of it is the `Idempotency-Key`. The server answers `409 conflict`
 *  when the party is no longer `pendingApproval`, which is what makes a double-click or a second
 *  owner on the same row safe: the row is decided once and the panel shows that answer instead of
 *  a second approval. A `403` for an employee token is the same rule enforced server-side; these
 *  calls are offered to the owner only, never used as the enforcement. */
export function approveCustomer(id: string, idempotencyKey: string): Promise<ServerCustomerDetail> {
  return send<ServerCustomerDetail>(`/customers/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

export function rejectCustomer(id: string, idempotencyKey: string): Promise<ServerCustomerDetail> {
  return send<ServerCustomerDetail>(`/customers/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

export interface ListCustomersParams {
  q?: string;
  city?: string;
  salespersonId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function listCustomers(params: ListCustomersParams = {}): Promise<ServerPage<ServerCustomer>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.city) query.set('city', params.city);
  if (params.salespersonId) query.set('salespersonId', params.salespersonId);
  if (params.status) query.set('status', params.status);
  // `page` was missing here while every other list method sent it, so the customer book could
  // only ever show its first page — the server honored `?page=` the whole time.
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 50));
  return send<ServerPage<ServerCustomer>>(`/customers?${query.toString()}`);
}

export function matchCustomers(params: { name?: string; city?: string; mobile?: string }): Promise<ServerMatch[]> {
  const query = new URLSearchParams();
  if (params.name) query.set('name', params.name);
  if (params.city) query.set('city', params.city);
  if (params.mobile) query.set('mobile', params.mobile);
  return send<ServerMatch[]>(`/customers/match?${query.toString()}`);
}

// ── employees ────────────────────────────────────────────────────────────

export interface ListEmployeesParams {
  q?: string;
  department?: string;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function listEmployees(params: ListEmployeesParams = {}): Promise<ServerPage<ServerEmployee>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.department) query.set('department', params.department);
  if (params.activeOnly) query.set('activeOnly', 'true');
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 200));
  return send<ServerPage<ServerEmployee>>(`/employees?${query.toString()}`);
}

/** `POST /employees/{id}/dispatch-capability` — the owner granting or withdrawing D-3's capability.
 *
 *  `reason` is not decoration: the server refuses a change without one, and the audit row it writes
 *  carries the owner, the employee, the value before and the value after. The panel's switch is a
 *  convenience on top of that rule, never the rule — an `employees` token that posts the same body
 *  gets the same `403` it would have got before this screen existed.
 *
 *  `changed: false` is an answer, not a failure: the record already held what this call asked for,
 *  and the backend wrote no event for it. `previousMayDispatch` is the same pair the audit row
 *  carries, so the screen can say which without asking the trail. */
export interface DispatchCapabilityBody {
  mayDispatch: boolean;
  reason: string;
}

export interface ServerDispatchCapability {
  employeeId: string;
  name: string;
  mayDispatch: boolean;
  previousMayDispatch: boolean;
  changed: boolean;
  reason: string;
}

export function setDispatchCapability(
  employeeId: string,
  body: DispatchCapabilityBody,
  idempotencyKey: string,
): Promise<ServerDispatchCapability> {
  return send<ServerDispatchCapability>(
    `/employees/${encodeURIComponent(employeeId)}/dispatch-capability`,
    {
      method: 'POST',
      body,
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

// ── reporting and targets ────────────────────────────────────────────────

export interface ReportingWindowParams {
  from?: string;
  to?: string;
}

/** `GET /dashboard/summary` — the owner's KPI block. `outstandingPaise` and `overduePaise` are
 *  current balances and ignore the window; order value, collections and the dispatch register are
 *  bounded by it. `delayedOrderCount` is a count of orders whose expected dispatch date has passed,
 *  kept separate from the overdue rupee figure because the two are different questions. */
export interface ServerDashboardUnit {
  unit: string;
  dispatchedQuantity: string;
  mismatchedDispatchQuantity: string;
  mismatchedDispatchLines: number;
}

export interface ServerDashboardSummary {
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  ordersValuePaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  pendingApprovalCustomers: number;
  delayedOrderCount: number;
  dispatched: ServerDashboardUnit[];
}

/** One unit's slice of a salesperson's performance. There is one row per unit and no grand total:
 *  D-8 forbids summing across units. `targetQuantity` is null when no target exists in this unit
 *  while `targetZero` is the separate fact that a target of `0.000` was entered. A client shows
 *  `achievementPercent` as sent and never divides two strings itself. */
export interface ServerUnitProgress {
  unit: string;
  targetQuantity: string | null;
  achievedQuantity: string;
  dispatchedQuantity: string;
  mismatchedDispatchQuantity: string;
  remainingQuantity: string | null;
  achievementPercent: string | null;
  targetZero: boolean;
  unitMismatch: boolean;
}

export interface ServerPerformance {
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  productCategory: string | null;
  targetSource: 'targets' | 'legacy' | 'none';
  excludedTargetRows: number;
  units: ServerUnitProgress[];
}

export interface ServerSalespersonPerformance {
  periodStart: string;
  periodEnd: string;
  productCategory: string | null;
  rows: ServerPerformance[];
}

function windowQuery(params: ReportingWindowParams): string {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return query.toString();
}

export function dashboardSummary(params: ReportingWindowParams = {}): Promise<ServerDashboardSummary> {
  return send<ServerDashboardSummary>(`/dashboard/summary?${windowQuery(params)}`);
}

export interface ServerCockpitRecentOrder {
  id: string;
  number: string;
  customerName: string;
  date: string;
  totalPaise: number;
  status: string;
  itemsCount: number;
}

export interface ServerCockpitTopDebtor {
  id: string;
  name: string;
  city: string;
  salesperson: string;
  balance: number;
}

export interface ServerCockpitTerritory {
  target: number;
  dispatched: number;
  percent: number;
  dealers: number;
}

export interface ServerCockpitStockQuick {
  metalKg: string;
  profileKg: string;
  upvcPieces: number;
  accessoriesPieces: number;
}

export interface ServerCockpitData {
  summary: ServerDashboardSummary;
  recentOrders: ServerCockpitRecentOrder[];
  topDebtors: ServerCockpitTopDebtor[];
  territories: {
    punjab: ServerCockpitTerritory;
    haryana: ServerCockpitTerritory;
  };
  stockQuick: ServerCockpitStockQuick;
}

export function dashboardCockpit(params: ReportingWindowParams = {}): Promise<ServerCockpitData> {
  return send<ServerCockpitData>(`/dashboard/cockpit?${windowQuery(params)}`);
}

export function salespersonPerformance(
  params: ReportingWindowParams & { employeeId?: string; productCategory?: string } = {},
): Promise<ServerSalespersonPerformance> {
  const query = new URLSearchParams(windowQuery(params));
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.productCategory) query.set('productCategory', params.productCategory);
  return send<ServerSalespersonPerformance>(`/dashboard/salesperson-performance?${query.toString()}`);
}

export interface ServerTarget {
  id: string;
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  productCategory: string | null;
  quantity: string;
  unit: string;
  setBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListTargetsParams extends ReportingWindowParams {
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

export function listTargets(params: ListTargetsParams = {}): Promise<ServerPage<ServerTarget>> {
  const query = new URLSearchParams(windowQuery(params));
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 200));
  return send<ServerPage<ServerTarget>>(`/targets?${query.toString()}`);
}

/** `PUT /targets` — the owner's write, identified by employee, period and category rather than by
 *  an id. Re-sending the same triple replaces the target (`200`); a new row answers `201`. No
 *  `setBy` field: the owner is the token. A different period that overlaps one already stored is
 *  `409 target_overlap` — the server refuses rather than prorating. */
export interface TargetUpsertBody {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  productCategory: string | null;
  quantity: string;
  unit: string;
}

export function putTarget(body: TargetUpsertBody, idempotencyKey: string): Promise<ServerTarget> {
  return send<ServerTarget>('/targets', {
    method: 'PUT',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── opening balances ─────────────────────────────────────────────────────

export function listOpeningBalances(customerId: string): Promise<ServerPage<OpeningBalanceEntry>> {
  const query = new URLSearchParams({ pageSize: '200' });
  return send<ServerPage<OpeningBalanceEntry>>(
    `/customers/${encodeURIComponent(customerId)}/opening-balances?${query.toString()}`,
  );
}

export function openingBalanceHistory(customerId: string): Promise<ServerAuditEntry[]> {
  return send<ServerAuditEntry[]>(`/customers/${encodeURIComponent(customerId)}/opening-balances/history`);
}

export function createOpeningBalance(
  customerId: string,
  body: OpeningBalanceCreateBody,
  idempotencyKey: string,
): Promise<OpeningBalanceEntry> {
  return send<OpeningBalanceEntry>(`/customers/${encodeURIComponent(customerId)}/opening-balances`, {
    method: 'POST',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── orders ───────────────────────────────────────────────────────────────

/** One row of `v_order_summary`. Quantities are decimal **strings** ("5.000") exactly as the
 *  server's NUMERIC columns serialize: they are rendered, never float-math'd, and
 *  `remainingQuantity`/`orderBalancePaise` keep their sign on purpose — a negative is a real
 *  finding (over-dispatch, credit), not something to clamp away.
 *  `number` is null for an order that has never been submitted: the printed number is minted at
 *  first submission and a draft has none, so no screen may show one for it — and `id` is a
 *  different identifier and never appears in this field's place. */
export interface ServerOrder {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  salespersonId: string | null;
  salesperson?: string | null;
  salespersonName?: string | null;
  state?: string | null;
  slipImageData?: string | null;
  orderDate: string;
  dueDate: string | null;
  expectedDispatchDate: string | null;
  status: string;
  dispatchStatus: string;
  source: string;
  version: number;
  cancelledAt: string | null;
  lineCount: number;
  orderedQuantity: string;
  dispatchedQuantity: string;
  valuePaise: number;
  invoiceCount: number;
  billedPaise: number;
  paymentCount: number;
  paidPaise: number;
  orderBalancePaise: number;
  isBilled: boolean;
  dispatchCount: number;
  lastDispatchDate: string | null;
}

export interface ServerOrderLine {
  orderLineId: number;
  lineNo: number;
  productId: string | null;
  productName: string;
  unit: string;
  orderedQuantity: string;
  ratePaise: number;
  gstRatePercent: string | null;
  dispatchedQuantity: string;
  dispatchLines: number;
  remainingQuantity: string;
  valuePaise: number;
}

export interface ServerOrderDetail extends ServerOrder {
  paymentTerms: string;
  notes: string;
  lines: ServerOrderLine[];
}

/** `GET /orders/{id}/dispatch-balance` — the server's own over-dispatch figures, the same rows the
 *  dispatch write is checked against under the order's row lock. Read it immediately before
 *  posting, which is why the entry screen loads this route rather than the order's own lines: the
 *  form validates against what the server is about to validate against. `number` is null for the
 *  same reason `ServerOrder.number` is — a draft has no printed number, and a draft is one of the
 *  two states `POST /dispatches` refuses (`412 order_not_dispatchable`). */
export interface ServerDispatchBalance {
  orderId: string;
  number: string | null;
  status: string;
  dispatchStatus: string;
  customerName?: string;
  salespersonName?: string;
  state?: string;
  slipImageData?: string;
  lines: ServerOrderLine[];
}

export interface ListOrdersParams {
  q?: string;
  status?: string;
  /** The delivery axis, not the commercial one. For a caller holding D-3's dispatch capability
   *  this filter also widens the read past their own salesperson — that is the queue, and the
   *  widening happens only when the parameter is named. */
  dispatchStatus?: DispatchStatusFilter;
  customerId?: string;
  salespersonId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listOrders(params: ListOrdersParams = {}): Promise<ServerPage<ServerOrder>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.dispatchStatus) query.set('dispatchStatus', params.dispatchStatus);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.salespersonId) query.set('salespersonId', params.salespersonId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerOrder>>(`/orders?${query.toString()}`);
}

export function getOrder(orderId: string): Promise<ServerOrderDetail> {
  return send<ServerOrderDetail>(`/orders/${encodeURIComponent(orderId)}`);
}

export function quickDispatchOrder(
  orderId: string,
  body: { vehicleNo?: string; notes?: string; dispatchDate?: string } = {},
): Promise<ServerOrderDetail> {
  return send<ServerOrderDetail>(`/orders/${encodeURIComponent(orderId)}/quick-dispatch`, {
    method: 'POST',
    body,
  });
}

export function getDispatchBalance(orderId: string): Promise<ServerDispatchBalance> {
  return send<ServerDispatchBalance>(`/orders/${encodeURIComponent(orderId)}/dispatch-balance`);
}

/** One line as it is *sent*. There is no `lineNo`: the server numbers the lines when it stores
 *  them, so the panel never invents an ordering the owner did not choose. `quantity`, `unit` and
 *  `gstRatePercent` keep the wire types the read side uses — a decimal **string** and an integer
 *  number of paise — so nothing here converts a rate through a float. `productId` and `productName`
 *  are alternatives: a mapped SKU sends the id, an unmapped material sends the typed name. */
export interface OrderLineInput {
  productId?: string;
  productName?: string;
  quantity: string;
  unit: string;
  ratePaise: number;
  gstRatePercent?: string | null;
}

/** `POST /orders`. `status` is `"draft"` unless the create is also its own submission
 *  (`"pending"`), and a draft has no printed `number` until it is submitted.
 *  `salespersonId` is **owner only**: an employee session must not send it, because the server
 *  pins the order to its caller and a sent id would be a second, contradicting claim about who
 *  booked the order. */
export interface OrderCreateBody {
  customerId: string;
  customerName?: string;
  lines: OrderLineInput[];
  status?: 'draft' | 'pending';
  orderDate?: string;
  dueDate?: string | null;
  expectedDispatchDate?: string | null;
  paymentTerms?: string;
  notes?: string;
  salespersonId?: string;
  salespersonName?: string;
  state?: string;
  slipImageData?: string | null;
}

/** `PATCH /orders/{id}` — draft only. `lines` **replaces the whole list**, so every line is sent
 *  every time; sending a partial list silently deletes the rest. */
export interface OrderPatchBody {
  customerId?: string;
  customerName?: string;
  orderDate?: string;
  dueDate?: string | null;
  expectedDispatchDate?: string | null;
  paymentTerms?: string;
  notes?: string;
  lines?: OrderLineInput[];
  slipImageData?: string | null;
}

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'pendingDispatch'
  | 'dispatched'
  | 'completed'
  | 'cancelled';

/** `POST /orders/{id}/status`. `draft → pending` is the submit and mints the printed `number`.
 *  `reason` is required by the server for a force-cancel of an order that already has dispatched
 *  quantity, and refused-but-harmless elsewhere. */
export interface OrderStatusBody {
  to: OrderStatus;
  reason?: string;
}

/** Concurrency: the routes that change a row require `If-Match` carrying that row's `version`.
 *  The response body is the updated order detail and its own `version` is the new ETag value, so
 *  the version is read off the row rather than the header — `send` returns the parsed body and
 *  there is no second fetch layer to add here. A stale version is `409 version_conflict` and an
 *  absent header is `400 precondition_required`, both shown as the failure they are rather than
 *  quietly overwriting what someone else saved. */
function ifMatch(version: number): Record<string, string> {
  return { 'If-Match': String(version) };
}

export function createOrder(body: OrderCreateBody, idempotencyKey: string): Promise<ServerOrderDetail> {
  return send<ServerOrderDetail>('/orders', {
    method: 'POST',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

export function patchOrder(
  orderId: string,
  body: OrderPatchBody,
  idempotencyKey: string,
  version: number,
): Promise<ServerOrderDetail> {
  return send<ServerOrderDetail>(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
  });
}

export function setOrderStatus(
  orderId: string,
  body: OrderStatusBody,
  idempotencyKey: string,
  version: number,
): Promise<ServerOrderDetail> {
  return send<ServerOrderDetail>(`/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'POST',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
  });
}

export function deleteOrder(
  orderId: string,
): Promise<{ deleted: boolean; id: string; number?: string }> {
  return send<{ deleted: boolean; id: string; number?: string }>(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
  });
}

// ── dispatches ───────────────────────────────────────────────────────────

/** What the order view's `dispatchStatus` column can hold, derived from the dispatch rows: how
 *  much of the ordered quantity has gone out. It is *not* the same vocabulary as
 *  `DeliveryStatus` below, and the two words mean different things on the same screen — an order
 *  can be `partial` (some of it left) while the consignment on the truck is `inTransit`. */
export type DispatchStatusFilter = 'pending' | 'partial' | 'dispatched';

/** One consignment's position on the delivery axis. `pending` is what a fresh record is, so the
 *  server accepts only the other three as targets — a route that could set `pending` would be a
 *  way to un-send a truck by re-labelling it. */
export type DeliveryStatus = 'pending' | 'inTransit' | 'delivered' | 'partial';

/** One line of a consignment: what went, of which product, against which order line. There is no
 *  money here and none will be added — the delivery read carries the goods and the ledger stays
 *  where the ledger lives. */
export interface ServerDispatchLine {
  dispatchLineId: number;
  orderLineId: number;
  lineNo: number;
  productId: string | null;
  productName: string;
  quantity: string;
  unit: string;
  batchNo: string;
  warehouse: string;
}

/** A row of `GET /dispatches`: the delivery record, its recorder, and no lines. `number` is never
 *  null, unlike an order's, because a consignment is created with its printed reference. A voided
 *  delivery stays in the list carrying `voidedAt`/`voidedBy`/`voidedByName` rather than vanishing:
 *  quantities that moved and came back are a fact the register has to show. The `reviewed*` trio is
 *  N-2's state, carried on the list row so the register can say whether the correction window is
 *  still open without a second read. `lineCount` is a count and not a quantity because a
 *  consignment of 5 MT and 5 NOS has no meaningful total of 10. */
export interface ServerDispatch {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string | null;
  customerId: string;
  customerName: string;
  dispatchDate: string;
  vehicle: string;
  driver: string;
  driverPhone: string;
  transportName: string;
  notes: string;
  deliveryStatus: string;
  deliveredAt: string | null;
  version: number;
  source: string;
  sourceRef: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedByName: string | null;
  /** N-2's review state. Null until the owner reviews the consignment; after that a paperwork
   *  `PATCH` is the owner's alone and the backend answers another caller `409 reviewed_locked`. */
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  lineCount: number;
}

export interface ServerDispatchDetail extends ServerDispatch {
  lines: ServerDispatchLine[];
}

/** One line as it is *sent*, against the order line it comes off. There is no `productId`: the
 *  product is whatever that line was cut on, so a consignment of a SKU the order never carried
 *  cannot be built by a client. `quantity` is a decimal string for the same reason every other
 *  quantity on this API is. */
export interface DispatchLineInput {
  orderLineId: number;
  quantity: string;
  unit: string;
  batchNo?: string;
  warehouse?: string;
}

/** `POST /dispatches`. `dispatchDate` is required rather than defaulted to today — the person at
 *  the desk knows whether the truck went today or the day it actually left. No `deliveryStatus`:
 *  a fresh consignment has not moved. No `photoFileIds` either, and the server rejects the key as
 *  unknown (D-9 stays undecided). */
export interface DispatchCreateBody {
  orderId: string;
  dispatchDate: string;
  vehicle?: string;
  driver?: string;
  driverPhone?: string;
  transportName?: string;
  notes?: string;
  lines: DispatchLineInput[];
}

/** `PATCH /dispatches/{id}` — the header fields of a consignment, with `reason` required.
 *  Quantities are absent by rule, not by omission: a wrong delivered figure is corrected by a
 *  void and a fresh record, never by an edit that rewrites what left the yard. `reason` goes into
 *  the audit row, which is where this API keeps the *why* of every mutation. Before N-2's review
 *  the recorder or the owner may correct; after it, the owner alone (`409 reviewed_locked`). */
export interface DispatchPatchLine {
  dispatchLineId?: number;
  orderLineId?: number;
  quantity: string;
  unit?: string;
}

export interface DispatchPatchBody {
  dispatchDate?: string;
  vehicle?: string;
  driver?: string;
  driverPhone?: string;
  transportName?: string;
  notes?: string;
  lines?: DispatchPatchLine[];
  reason: string;
}

export interface ListDispatchesParams {
  q?: string;
  orderId?: string;
  salespersonId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listDispatches(
  params: ListDispatchesParams = {},
): Promise<ServerPage<ServerDispatch>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.orderId) query.set('orderId', params.orderId);
  if (params.salespersonId) query.set('salespersonId', params.salespersonId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerDispatch>>(`/dispatches?${query.toString()}`);
}

export function createDispatch(
  body: DispatchCreateBody,
  idempotencyKey: string,
): Promise<ServerDispatchDetail> {
  return send<ServerDispatchDetail>('/dispatches', {
    method: 'POST',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });
}

export function patchDispatch(
  dispatchId: string,
  body: DispatchPatchBody,
  idempotencyKey: string,
  version: number,
): Promise<ServerDispatchDetail> {
  return send<ServerDispatchDetail>(`/dispatches/${encodeURIComponent(dispatchId)}`, {
    method: 'PATCH',
    body,
    extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
  });
}

/** `POST /dispatches/{id}/void`. The row survives with its stamp and the quantity comes back to
 *  the order; the owner's right alone, and a reason the audit row carries. */
export function voidDispatch(
  dispatchId: string,
  reason: string,
  idempotencyKey: string,
  version: number,
): Promise<ServerDispatchDetail> {
  return send<ServerDispatchDetail>(`/dispatches/${encodeURIComponent(dispatchId)}/void`, {
    method: 'POST',
    body: { reason },
    extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
  });
}

export function setDeliveryStatus(
  dispatchId: string,
  to: Exclude<DeliveryStatus, 'pending'>,
  idempotencyKey: string,
  version: number,
): Promise<ServerDispatchDetail> {
  return send<ServerDispatchDetail>(
    `/dispatches/${encodeURIComponent(dispatchId)}/delivery-status`,
    {
      method: 'PATCH',
      body: { to },
      extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
    },
  );
}

/** `POST /dispatches/{id}/review` — N-2's owner-only stamp that closes the correction window on one
 *  consignment. The note is optional and goes into the audit row with the owner's name. A second
 *  review is `409 already_reviewed`, a voided consignment `409 already_voided`, and the parent
 *  order's version does not move because no quantity changed. */
export function reviewDispatch(
  dispatchId: string,
  note: string,
  idempotencyKey: string,
  version: number,
): Promise<ServerDispatchDetail> {
  return send<ServerDispatchDetail>(`/dispatches/${encodeURIComponent(dispatchId)}/review`, {
    method: 'POST',
    body: { note },
    extraHeaders: { 'Idempotency-Key': idempotencyKey, ...ifMatch(version) },
  });
}

/** Does this login hold D-3's dispatch capability? Asked of the server rather than read off the
 *  role, because the two are not the same question: the owner needs no grant and an employee needs
 *  the flag on his `employee` row, and only the backend is standing where it can see either.
 *
 *  `GET /dispatches` is the cheapest route that answers on exactly that gate
 *  (`deps.require_dispatch_right`), so the probe is one page-sized read of the register the
 *  dispatch desk was going to ask for anyway. A `403` means "not this login" and is returned as
 *  `false`, because it is a permission answer and not a failure; anything else — no backend, an
 *  expired session, a `500` — is thrown so the screen says which instead of rendering a desk that
 *  looks unauthorised. The refusal is never *assumed* in either direction: every write below still
 *  goes out with the caller's own token and is gated by the server again, so a screen that guessed
 *  wrong can only ever be refused, never permitted. */
export async function mayRecordDispatch(): Promise<boolean> {
  try {
    await listDispatches({ pageSize: 1 });
    return true;
  } catch (cause) {
    if (cause instanceof ServerError && cause.status === 403) return false;
    throw cause;
  }
}

// ── payments ─────────────────────────────────────────────────────────────

/** A receipt row. Voided receipts are listed **with** their `voidedAt` stamp and absent from
 *  every balance, and `duplicateSuspected` marks the same money arriving from the other
 *  source until a human voids one — the screen shows both facts instead of smoothing them. */
export interface ServerPayment {
  id: string;
  customerId: string;
  customerName: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceNumber: string;
  invoiceAmountPaise: number;
  amountPaise: number;
  paymentDate: string;
  method: string;
  reference: string;
  notes: string;
  allowAdvance: boolean;
  duplicateSuspected: boolean;
  duplicateOfId: string | null;
  voidedAt: string | null;
  source: string;
  sourceRef: string | null;
  createdAt: string;
}

export interface ListPaymentsParams {
  q?: string;
  customerId?: string;
  orderId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listPayments(params: ListPaymentsParams = {}): Promise<ServerPage<ServerPayment>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.orderId) query.set('orderId', params.orderId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerPayment>>(`/payments?${query.toString()}`);
}

export interface PaymentCreateInput {
  customerId: string;
  customerName?: string;
  amountPaise: number;
  paymentDate?: string;
  method?: string;
  reference?: string;
  notes?: string;
}

export function recordPayment(body: PaymentCreateInput, idempotencyKey?: string): Promise<ServerPayment> {
  return send<ServerPayment>('/payments', {
    method: 'POST',
    body,
    extraHeaders: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

export function voidPayment(paymentId: string): Promise<ServerPayment> {
  return send<ServerPayment>(`/payments/${encodeURIComponent(paymentId)}/void`, {
    method: 'POST',
  });
}

export function deletePayment(paymentId: string): Promise<{ success: boolean; id: string; deleted: boolean }> {
  return send<{ success: boolean; id: string; deleted: boolean }>(`/payments/${encodeURIComponent(paymentId)}`, {
    method: 'DELETE',
  });
}

export function purgeTestPayments(): Promise<{ success: boolean; purgedCount: number }> {
  return send<{ success: boolean; purgedCount: number }>('/payments/purge-tests', {
    method: 'POST',
  });
}

// ── products and stock ───────────────────────────────────────────────────

export interface ServerProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  spec: string;
  thickness: string;
  unit: string;
  minStockQty: string;
  gstRatePercent: string | null;
  active: boolean;
  source: string;
}

/** A row of `v_stock_balance`: a SUM over movements, never a stored figure someone forgot
 *  to update. `mismatchedUnit*` counts movements held in a unit other than the product's
 *  own, which the SUM refuses to add rather than read 2000 Kg as 2000 MT. */
export interface ServerStockBalance {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  spec: string;
  thickness: string;
  unit: string;
  gstRatePercent: string | null;
  active: boolean;
  minStockQty: string;
  movementCount: number;
  onHandQuantity: string;
  reservedQuantity: string;
  mismatchedUnitMovements: number;
  mismatchedUnitQuantity: string;
  lastMovementDate: string | null;
  availableQuantity: string;
  isLowStock: boolean;
}

export interface ServerStockMovement {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  kind: string;
  deltaQuantity: string;
  unit: string;
  batchNo: string;
  warehouse: string;
  reference: string;
  reason: string;
  movementDate: string;
  source: string;
  sourceRef: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface ListProductsParams {
  q?: string;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function listProducts(params: ListProductsParams = {}): Promise<ServerPage<ServerProduct>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.activeOnly) query.set('activeOnly', 'true');
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerProduct>>(`/products?${query.toString()}`);
}

export interface ListStockBalancesParams {
  q?: string;
  lowOnly?: boolean;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function listStockBalances(
  params: ListStockBalancesParams = {},
): Promise<ServerPage<ServerStockBalance>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.lowOnly) query.set('lowOnly', 'true');
  if (params.activeOnly) query.set('activeOnly', 'true');
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerStockBalance>>(`/stock/balances?${query.toString()}`);
}

export interface ListStockMovementsParams {
  q?: string;
  productId?: string;
  kind?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listStockMovements(
  params: ListStockMovementsParams = {},
): Promise<ServerPage<ServerStockMovement>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.productId) query.set('productId', params.productId);
  if (params.kind) query.set('kind', params.kind);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerStockMovement>>(`/stock/movements?${query.toString()}`);
}

// ── stock workbook preview ───────────────────────────────────────────────

/** A workbook's name is a label, never a location. In a browser `File.name` is already the last
 *  segment, but the value is reduced to one here rather than trusted: the absolute path of the
 *  operator's file has no business appearing in a URL, in the body the server echoes it back into,
 *  or in a log line — and the file itself is never sent anywhere but to this backend. */
export function workbookLabel(name: string): string {
  const stem = (name.split(/[\\/]/).pop() ?? '').trim().slice(0, 120);
  return stem === '' ? 'workbook' : stem;
}

/** `POST /imports/excel/stock-preview` — read the three approved sheets of an `.xlsx` and report
 *  what they say. The only call in this file that sends bytes, and the only one that gets its own
 *  timeout.
 *
 *  It creates nothing, and three things make that more than a claim: the panel sends no
 *  `Idempotency-Key` because there is no write to de-duplicate, the route takes no session on the
 *  server at all, and `readStockPreviewPayload` refuses a response whose `readyToApply`,
 *  `businessRecordsCreated` or `stockChanged` arrives as anything but `false`. An employee token is
 *  refused by the server (`403`) before a single byte of the workbook is read, exactly as the other
 *  four import routes refuse it — the `Content-Type` header is not the credential.
 */
export async function previewStockWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
): Promise<ServerStockPreview> {
  const query = new URLSearchParams({ fileName: workbookLabel(fileName) });
  const payload = await send<unknown>(`/imports/excel/stock-preview?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
  return readStockPreviewPayload(payload);
}

// ── confirmed stock import, history and the approved snapshot ────────────

export interface ServerStockImportBatch {
  id: string;
  state: string;
  filename: string;
  sourceFormat: string;
  fileSha256: string;
  authorizedSha256: string;
  fileSizeBytes: number;
  previewDigest: string;
  outcomeDigest: string;
  workbookPropertyModifiedAt: string | null;
  sheetsEnumerated: string[];
  sheetsRead: string[];
  validationStatus: string;
  warningCount: number;
  tableCount: number;
  rowCount: number;
  itemCount: number;
  appliedItemCount: number;
  carriedForwardCount: number;
  staleCount: number;
  quarantineCount: number;
  appliedAt: string;
  appliedBy: string;
}

/** One effective figure in a batch. `quantity` is decimal text, never a number. A `stale` row is
 *  the last approved figure for a key the newest workbook did not apply; `carryReason` says why. */
export interface ServerStockImportItem {
  itemKey: string;
  sourceBatchId: string;
  carriedFromBatchId: string | null;
  carryReason: string | null;
  sourceSheet: string;
  sectionId: string;
  sectionSourceLabel: string;
  sectionDisplayName: string;
  tableId: string;
  tableFamily: string;
  tableDisplayName: string;
  rowNumber: number;
  role: string;
  labelCoordinate: string;
  sourceLabel: string;
  displayLabel: string;
  columnKey: string;
  columnLabel: string;
  valueCoordinate: string;
  quantity: string;
  unit: string | null;
  dimensionLabel: string | null;
  dimensionValueText: string | null;
  dimensionCoordinate: string | null;
  warnings: string[];
  stale: boolean;
  carriedForward: boolean;
}

export interface ServerStockImportQuarantine {
  itemKey: string;
  sourceSheet: string;
  sectionId: string;
  sectionDisplayName: string;
  tableId: string;
  tableFamily: string;
  rowNumber: number;
  role: string;
  association: string;
  labelCoordinate: string;
  sourceLabel: string;
  columnKey: string;
  columnLabel: string;
  valueCoordinate: string | null;
  quantity: string | null;
  unit: string | null;
  parentLabel: string | null;
  parentCoordinate: string | null;
  physicalParentLabel: string | null;
  physicalParentCoordinate: string | null;
  reasons: string[];
  warnings: string[];
}

export interface ServerStockImportDetail {
  batch: ServerStockImportBatch;
  quarantine: ServerStockImportQuarantine[];
  reconciliations: ServerReconciliation[];
  warnings: ServerStockWarning[];
}

export interface ServerImportedStock {
  available: boolean;
  snapshot: ServerStockImportBatch | null;
  items: ServerStockImportItem[];
  returnedItemCount: number;
  staleCount: number;
  quarantineCount: number;
  stockMovementsCreated: false;
}

export interface ServerStockImportApply {
  batch: ServerStockImportBatch;
  replayed: boolean;
  stockMovementsCreated: false;
  businessRecordsCreated: false;
}

/** `GET /stock/imported` — the latest approved workbook snapshot, readable by both roles. This is
 *  the owner-approved level, not the movement-derived balance; `available: false` means no import
 *  has been applied yet, not that the godown is empty. */
export function readImportedStock(): Promise<ServerImportedStock> {
  return send<ServerImportedStock>('/stock/imported');
}

// ── the shared stock dashboard (GET /stock/summary) ──────────────────────

/** The batch behind every stock figure. `available: false` is a normal state — no workbook has
 *  been applied — not an empty godown. */
export interface ServerStockBatchBrief {
  available: boolean;
  batchId: string | null;
  filename: string | null;
  appliedAt: string | null;
  appliedByName: string | null;
  fileSha256: string | null;
  authorizedSha256: string | null;
  itemCount: number;
  appliedItemCount: number;
  staleCount: number;
  quarantineCount: number;
  sheetsRead: string[];
}

export type ServerStockCategoryStatus = 'resolved' | 'withheld' | 'unavailable';
export type ServerUpvcType = 'new' | 'old' | 'waste';

/** One card's figures. A metal card has `quantity` and no `pieces`/`footage`; a UPVC card has
 *  `pieces` and `footage` and does not add them. `withheldQuantity` is never folded into
 *  `quantity`: GP is withheld, not zero. */
export interface ServerStockCategory {
  key: string;
  label: string;
  sourceSheet: string | null;
  status: ServerStockCategoryStatus;
  figureCount: number;
  withheldCount: number;
  quantity: string | null;
  withheldQuantity: string | null;
  unit: string | null;
  pieces: string | null;
  footage: string | null;
  negativeCount: number;
  staleCount: number;
  note: string | null;
}

/** One source row. A withheld row has `status: 'withheld'`, the plan's reasons and no
 *  `sourceBatchId`; a resolved row has the batch that first supplied the figure. */
export interface ServerStockMaterial {
  itemKey: string;
  categoryKey: string;
  categoryLabel: string;
  sourceSheet: string;
  sectionId: string;
  sectionName: string;
  tableId: string;
  tableDisplayName: string;
  label: string;
  columnLabel: string;
  status: 'resolved' | 'withheld';
  rowNumber: number;
  sourceLabel: string;
  labelCoordinate: string;
  company: string | null;
  quantity: string | null;
  unit: string | null;
  stockType: ServerUpvcType | null;
  colour: string | null;
  dimensionLabel: string | null;
  dimensionValue: string | null;
  lengthFt: number | null;
  footage: string | null;
  reasons: string[];
  warnings: string[];
  stale: boolean;
  sourceBatchId: string | null;
  carriedFromBatchId: string | null;
  carryReason: string | null;
  valueCoordinate: string | null;
}

export interface ServerStockWithheldGroup {
  categoryKey: string;
  categoryLabel: string;
  sourceSheet: string;
  count: number;
  quantity: string | null;
  reasons: Record<string, number>;
}

export interface ServerStockWarningBrief {
  key: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  count: number;
}

/** `GET /stock/summary` — the dashboard body both clients share. */
export interface ServerStockSummary {
  available: boolean;
  snapshot: ServerStockBatchBrief;
  categories: ServerStockCategory[];
  materials: ServerStockMaterial[];
  withheld: ServerStockWithheldGroup[];
  warnings: ServerStockWarningBrief[];
  stockMovementsCreated: false;
}

export function readStockSummary(): Promise<ServerStockSummary> {
  return send<ServerStockSummary>('/stock/summary');
}

// ── the UPVC floor read (GET /stock/upvc) ────────────────────────────────

export interface ServerUpvcRow {
  stockType: ServerUpvcType;
  stockTypeLabel: string;
  colour: string;
  lengthFt: number | null;
  label: string;
  pieces: string;
  footage: string | null;
  stale: boolean;
  negative: boolean;
}

export interface ServerUpvcGroup {
  key: string;
  label: string;
  pieces: string;
  footage: string;
  rowCount: number;
}

/** One colour-and-length cell of the cross-tab. The server sums it; the panel only lays the
 *  cells out, so a matrix figure is never a client-side addition. `lengthFt` is null for the
 *  rows whose length the sheet never stated. */
export interface ServerUpvcCell {
  colour: string;
  lengthFt: number | null;
  pieces: string;
  footage: string;
  rowCount: number;
}

export interface ServerUpvcTotals {
  pieces: string;
  footage: string;
  rowCount: number;
  footageRowCount: number;
  missingLengthCount: number;
  negativeCount: number;
  staleCount: number;
}

export interface ServerUpvcStock {
  available: boolean;
  batchId: string | null;
  appliedAt: string | null;
  stockType: ServerUpvcType | null;
  colour: string | null;
  lengthFt: number | null;
  search: string | null;
  rows: ServerUpvcRow[];
  totals: ServerUpvcTotals;
  byColour: ServerUpvcGroup[];
  byLength: ServerUpvcGroup[];
  matrix: ServerUpvcCell[];
  stockMovementsCreated: false;
}

export interface UpvcStockParams {
  type?: ServerUpvcType;
  colour?: string;
  lengthFt?: number;
  q?: string;
}

/** `GET /stock/upvc` — pieces and derived footage, filtered and totalled by the server. */
export function readUpvcStock(params: UpvcStockParams = {}): Promise<ServerUpvcStock> {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.colour) query.set('colour', params.colour);
  if (params.lengthFt !== undefined) query.set('lengthFt', String(params.lengthFt));
  if (params.q) query.set('q', params.q);
  return send<ServerUpvcStock>(`/stock/upvc?${query.toString()}`);
}

// ── the two honest gaps (GET /stock/accessories, GET /stock/production) ──

export interface ServerStockGapCategory {
  key: string;
  label: string;
}

/** `available` is `false` because the source sheet is not in the approved apply plan. The body
 *  names the groups and the reason; a client must not add figures of its own. */
export interface ServerStockGap {
  available: false;
  sourceSheet: string;
  sourceLabel: string;
  reason: string;
  description: string;
  categories: ServerStockGapCategory[];
  batchId: string | null;
  appliedAt: string | null;
}

export function readStockAccessories(): Promise<ServerStockGap> {
  return send<ServerStockGap>('/stock/accessories');
}

export function readStockProduction(): Promise<ServerStockGap> {
  return send<ServerStockGap>('/stock/production');
}

export interface ApplyStockImportInput {
  fileName: string;
  fileSha256: string;
  previewDigest: string;
}

/** `POST /imports/excel/stock-import` — apply the exact bytes the owner just previewed.
 *
 *  Three things bind the confirmation to what was previewed: the bytes are the same array the
 *  preview read, `fileSha256` is the hash those bytes produced, and `previewDigest` is the plan
 *  digest the preview response issued. The route re-parses, re-plans and refuses a digest that does
 *  not match, so a confirmation cannot drift onto another file. `confirm=true` is explicit and is
 *  sent only from the apply action — never from the preview itself. */
export function applyStockImport(
  bytes: Uint8Array | ArrayBuffer,
  input: ApplyStockImportInput,
): Promise<ServerStockImportApply> {
  const query = new URLSearchParams({
    fileSha256: input.fileSha256,
    previewDigest: input.previewDigest,
    confirm: 'true',
    fileName: workbookLabel(input.fileName),
  });
  return send<ServerStockImportApply>(`/imports/excel/stock-import?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
}

/** The watched file's state. The server reads a configured path; nothing is applied by reading. */
export interface ServerStockWatch {
  configured: boolean;
  path: string | null;
  present: boolean;
  readable: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  fileSha256: string | null;
  matchesLatestBatch: boolean;
  matchesAuthorizedRevision: boolean;
  latestBatchId: string | null;
  note: string;
}

/** `GET /imports/excel/stock-watch` — owner-only. */
export function readStockWatch(): Promise<ServerStockWatch> {
  return send<ServerStockWatch>('/imports/excel/stock-watch');
}

/** `POST /imports/excel/stock-watch/preview` — the server reads the watched file and previews it. */
export function previewWatchedWorkbook(): Promise<ServerStockPreview> {
  return send<ServerStockPreview>('/imports/excel/stock-watch/preview', {
    method: 'POST',
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
}

/** `POST /imports/excel/stock-watch/apply` — same confirmation rules as an upload, no bytes sent. */
export function applyWatchedWorkbook(input: {
  fileSha256: string;
  previewDigest: string;
}): Promise<ServerStockImportApply> {
  const query = new URLSearchParams({
    fileSha256: input.fileSha256,
    previewDigest: input.previewDigest,
    confirm: 'true',
  });
  return send<ServerStockImportApply>(`/imports/excel/stock-watch/apply?${query.toString()}`, {
    method: 'POST',
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
}

/**
 * `POST /imports/excel/stock-watch/sync` — authorise the on-disk revision and apply it.
 *
 * One press, one transaction: the server re-reads the file, refuses it if the bytes no longer
 * match `fileSha256`, judges the plan, and only then records the authorisation and the snapshot
 * together. `confirm=true` is the consent — the dialog in front of this call is where the owner
 * gives it.
 */
export function syncWatchedWorkbook(input: { fileSha256: string }): Promise<ServerStockImportApply> {
  const query = new URLSearchParams({
    fileSha256: input.fileSha256,
    confirm: 'true',
  });
  return send<ServerStockImportApply>(`/imports/excel/stock-watch/sync?${query.toString()}`, {
    method: 'POST',
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
}

export interface ListStockImportsParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

/** `GET /imports/excel/stock-imports` — applied batches, newest first. Owner-only on the server. */
export function listStockImports(
  params: ListStockImportsParams = {},
): Promise<ServerPage<ServerStockImportBatch>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerStockImportBatch>>(`/imports/excel/stock-imports?${query.toString()}`);
}

/** `GET /imports/excel/stock-imports/{id}` — one batch with its quarantine and findings. */
export function getStockImport(batchId: string): Promise<ServerStockImportDetail> {
  return send<ServerStockImportDetail>(
    `/imports/excel/stock-imports/${encodeURIComponent(batchId)}`,
  );
}

/** `GET /imports/excel/stock-imports/{id}/items` — every effective figure, stale ones included. */
export function listStockImportItems(
  batchId: string,
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<ServerPage<ServerStockImportItem>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 20));
  return send<ServerPage<ServerStockImportItem>>(
    `/imports/excel/stock-imports/${encodeURIComponent(batchId)}/items?${query.toString()}`,
  );
}

// ── debtors ──────────────────────────────────────────────────────────────

/** One imported closing balance. `asOf` is the date the source file stated and `importedAt` is
 *  when this server received it; both are shown because they answer different questions. There is
 *  deliberately no net field: the owner has not approved `debit − credit`, and a client that
 *  computed one would be inventing the figure D-10 refused. */
export interface ServerDebtor {
  id?: string;
  customerId: string;
  customerName: string;
  name?: string;
  state?: string;
  city?: string;
  district?: string;
  salesperson?: string;
  balance?: number;
  balance_formatted?: string;
  status?: string;
  asOf: string;
  debitPaise: number;
  creditPaise: number;
  importedAt: string;
}

export interface ListDebtorsParams {
  q?: string;
  asOf?: string;
  state?: string;
  salesperson?: string;
  page?: number;
  pageSize?: number;
}

export function listDebtors(params: ListDebtorsParams = {}): Promise<ServerPage<ServerDebtor>> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.asOf) query.set('asOf', params.asOf);
  if (params.state) query.set('state', params.state);
  if (params.salesperson) query.set('salesperson', params.salesperson);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 50));
  return send<ServerPage<ServerDebtor>>(`/debtors?${query.toString()}`);
}

export function createDebtor(body: { name: string; state?: string; city?: string; district?: string; salesperson?: string; balance?: number }): Promise<ServerDebtor> {
  return send<ServerDebtor>('/debtors', {
    method: 'POST',
    body,
  });
}

export function updateDebtor(id: string, body: Partial<{ name: string; state: string; city: string; district: string; salesperson: string; balance: number }>): Promise<ServerDebtor> {
  return send<ServerDebtor>(`/debtors/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
}

export function deleteDebtor(id: string): Promise<{ deleted: boolean; id: string }> {
  return send<{ deleted: boolean; id: string }>(`/debtors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function syncHrPbTargets(): Promise<{ status: string; message: string; rows_processed?: number }> {
  return send<{ status: string; message: string; rows_processed?: number }>('/imports/excel/hr-pb/sync', {
    method: 'POST',
  });
}

export async function uploadExcelWorkbook(file: File): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch(`${API_BASE_URL}/api/v1/imports/excel/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new ServerError(`Excel upload failed: ${txt}`, { code: 'upload_failed', status: resp.status });
  }
  return resp.json();
}

export function listSalesTargets<T = Record<string, unknown>>(params: { state?: string; salesperson?: string; q?: string } = {}): Promise<T> {
  const query = new URLSearchParams();
  if (params.state) query.set('state', params.state);
  if (params.salesperson) query.set('salesperson', params.salesperson);
  if (params.q) query.set('q', params.q);
  return send<T>(`/sales/targets?${query.toString()}`);
}

export function getFinancialAnalytics<T = Record<string, unknown>>(): Promise<T> {
  return send<T>('/dashboard/financial-analytics');
}

export type DebtorRowVerdict = 'resolved' | 'missing' | 'ambiguous' | 'invalid';

export interface ServerDebtorPreviewRow {
  rowNumber: number;
  partyName: string;
  sourceRef: string | null;
  /** Which namespace's mapping resolved this row: `tally`, `durasmart` (a `DSLED-…` mint), or
   *  `null` while the row is unresolved. The issuer of a reference nobody answers is not knowable. */
  refSource: string | null;
  debitPaise: number | null;
  creditPaise: number | null;
  direction: 'debit' | 'credit' | null;
  verdict: DebtorRowVerdict;
  reason: string | null;
  customerId: string | null;
  customerName: string | null;
  candidateIds: string[];
  issues: string[];
}

export interface ServerDebtorPreviewFinding {
  code: string;
  message: string;
  rowNumber: number | null;
}

/** The preview is a diagnosis of a file, not an import. `businessRecordsCreated` and
 *  `databaseRowsWritten` are typed as the literal `false` the schema sends and
 *  `readDebtorPreviewPayload` refuses anything else. `applyAvailable` is *not* a write claim — it is
 *  the server's readiness verdict, a computed boolean, and the only thing that gates the Apply
 *  control. `applyPreviewDigest` is the content hash of what an apply of this exact reading would
 *  write; it is present whether or not the file is eligible, and the apply endpoint demands it back. */
export interface ServerDebtorPreview {
  filename: string;
  fileSha256: string;
  sizeBytes: number;
  sheetName: string;
  sheetNames: string[];
  source: string;
  refSource: string | null;
  headerRowNumber: number | null;
  partyColumnLabel: string | null;
  ledgerIdColumnLabel: string | null;
  debitColumnLabel: string | null;
  creditColumnLabel: string | null;
  asOf: string | null;
  asOfVerified: boolean;
  asOfSource: string | null;
  periodText: string | null;
  dataRowCount: number;
  blankRowCount: number;
  totalRowCount: number;
  zeroBalanceRowCount: number;
  resolvedRowCount: number;
  missingRowCount: number;
  ambiguousRowCount: number;
  invalidRowCount: number;
  unresolvedRowCount: number;
  rowsListed: number;
  rowsTruncated: boolean;
  rows: ServerDebtorPreviewRow[];
  warnings: ServerDebtorPreviewFinding[];
  blockers: ServerDebtorPreviewFinding[];
  applyAvailable: boolean;
  applyPreviewDigest: string;
  applyBlockedReason: string;
  businessRecordsCreated: false;
  databaseRowsWritten: false;
  disclaimer: string;
}

/** A preview that claims to have *written* anything is not a preview. `businessRecordsCreated`
 *  and `databaseRowsWritten` must both be literally `false`, or the answer is refused at the
 *  transport. `applyAvailable` is allowed to be `true` — it says the file *could* be applied, not
 *  that it was — and `applyPreviewDigest` is required to be a 64-character hex string, because an
 *  apply without the digest to send back is a confirmation that cannot be bound to a reading. */
function readDebtorPreviewPayload(payload: unknown): ServerDebtorPreview {
  if (!payload || typeof payload !== 'object') {
    throw new ServerError('The debtor preview answer could not be read.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  const preview = payload as Partial<ServerDebtorPreview> & Record<string, unknown>;
  for (const key of ['businessRecordsCreated', 'databaseRowsWritten'] as const) {
    if (preview[key] !== false) {
      throw new ServerError(
        'The server answered a debtor preview that claims to have written data. A preview stores nothing.',
        { code: 'invalid_response', status: 200 },
      );
    }
  }
  if (typeof preview.applyAvailable !== 'boolean') {
    throw new ServerError('The debtor preview did not state whether it can be applied.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  if (typeof preview.applyPreviewDigest !== 'string' || preview.applyPreviewDigest.length !== 64) {
    throw new ServerError('The debtor preview is missing its apply plan digest.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  if (
    !Array.isArray(preview.rows) ||
    !Array.isArray(preview.blockers) ||
    !Array.isArray(preview.warnings)
  ) {
    throw new ServerError('The debtor preview answer is missing its findings.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  return preview as ServerDebtorPreview;
}

/** `POST /debtors/imports/preview` — owner-only, raw workbook bytes, no apply. There is no
 *  `Idempotency-Key` because there is no write to de-duplicate; the server's own two write flags and
 *  the guard above say the same thing twice. */
export async function previewDebtorWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
): Promise<ServerDebtorPreview> {
  const query = new URLSearchParams({ fileName: workbookLabel(fileName) });
  const payload = await send<unknown>(`/debtors/imports/preview?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
  return readDebtorPreviewPayload(payload);
}

/** The outcome of one confirmed debtor apply. The three counts together cover `snapshotRowCount`
 *  planned figures — newly stored, already present, replaced under approval. `replayed` is the
 *  all-unchanged case; `databaseRowsWritten` says plainly whether the database moved at all.
 *  `businessRecordsCreated` is the literal `false` the schema sends: an apply stores dated balance
 *  observations and audit rows, and creates no customer, ledger mapping, order or movement. */
export interface ServerDebtorApply {
  filename: string;
  fileSha256: string;
  sheetName: string;
  asOf: string;
  source: string;
  snapshotRowCount: number;
  createdRowCount: number;
  unchangedRowCount: number;
  replacedRowCount: number;
  replayed: boolean;
  databaseRowsWritten: boolean;
  businessRecordsCreated: false;
  disclaimer: string;
}

export interface ApplyDebtorInput {
  fileName: string;
  fileSha256: string;
  previewDigest: string;
  /** The *second* explicit approval, sent only after the backend refused with
   *  `debtor_import_replacement_requires_approval`. Default false — it is never inferred. */
  allowReplacement?: boolean;
}

/** An apply that claims to have created business records is not this apply. `databaseRowsWritten`
 *  is allowed to be `true` — writing snapshot rows is the point — but the narrower
 *  `businessRecordsCreated` must stay `false`. */
function readDebtorApplyPayload(payload: unknown): ServerDebtorApply {
  if (!payload || typeof payload !== 'object') {
    throw new ServerError('The debtor apply answer could not be read.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  const outcome = payload as Partial<ServerDebtorApply> & Record<string, unknown>;
  if (outcome.businessRecordsCreated !== false) {
    throw new ServerError(
      'The server answered a debtor apply that claims to have created business records. It creates none.',
      { code: 'invalid_response', status: 200 },
    );
  }
  return outcome as ServerDebtorApply;
}

/** `POST /debtors/imports/apply` — apply the exact bytes the owner just previewed.
 *
 *  Three things bind the confirmation to what was previewed: the bytes are the same array the
 *  preview read, `fileSha256` is the hash those bytes produced, and `previewDigest` is the
 *  `applyPreviewDigest` the preview response issued. The route re-parses, re-resolves identity
 *  against the current mappings, and refuses a digest that does not match, so a confirmation cannot
 *  drift onto another file. `confirm=true` is explicit and is sent only from this apply action —
 *  never from the preview. `allowReplacement=true` is a separate gate, supplied only after the
 *  backend has refused a changed figure and the owner has chosen to approve the replacement. */
export async function applyDebtorWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  input: ApplyDebtorInput,
): Promise<ServerDebtorApply> {
  const query = new URLSearchParams({
    fileSha256: input.fileSha256,
    previewDigest: input.previewDigest,
    confirm: 'true',
    fileName: workbookLabel(input.fileName),
  });
  if (input.allowReplacement) query.set('allowReplacement', 'true');
  const payload = await send<unknown>(`/debtors/imports/apply?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
  return readDebtorApplyPayload(payload);
}

// ── provisional debtors (original-format sync) ───────────────────────────

export type ServerProvisionalRowState =
  | 'new'
  | 'changed'
  | 'unchanged'
  | 'missing'
  | 'blocked'
  | 'conflict'
  | 'archived';

/** One line of the provisional review. The incoming figures are `debitPaise`/`creditPaise`; a
 *  `changed`, `missing`, `conflict` or `archived` row also carries the stored `previous*` side, so
 *  the owner sees both figures. `imported*` is the last source side accepted; `manuallyEdited` says
 *  the effective values no longer equal it, which is why a different incoming value opens a
 *  conflict instead of replacing anything. `provisionalId` is a stored `TMP-DL-…` for a matched
 *  record or the identifier a new row would mint on sync. There is no customer id here and there
 *  never will be: these records are not verified identities. */
export interface ServerProvisionalRow {
  sourceRow: number | null;
  provisionalId: string | null;
  state: ServerProvisionalRowState;
  partyName: string;
  partyKey: string | null;
  debitPaise: number | null;
  creditPaise: number | null;
  previousPartyName: string | null;
  previousDebitPaise: number | null;
  previousCreditPaise: number | null;
  importedPartyName: string | null;
  importedDebitPaise: number | null;
  importedCreditPaise: number | null;
  manuallyEdited: boolean;
  issues: string[];
}

export interface ServerProvisionalFinding {
  code: string;
  message: string;
  rowNumber: number | null;
}

/** The diagnosis of one original-format upload. `syncAvailable` is the server's readiness verdict
 *  (not a write claim) and is the only thing that gates the sync control; `syncPreviewDigest` is
 *  what the sync endpoint demands back. Every record is labelled provisional, and the date is the
 *  owner-selected `2026-04-01` with `asOfVerified` literally false — the workbook never verified it. */
export interface ServerProvisionalPreview {
  filename: string;
  fileSha256: string;
  sizeBytes: number;
  sheetName: string;
  sheetNames: string[];
  label: string;
  identityState: string;
  headerRowNumber: number | null;
  partyColumnLabel: string | null;
  debitColumnLabel: string | null;
  creditColumnLabel: string | null;
  ledgerIdColumnLabel: string | null;
  asOf: string;
  asOfVerified: false;
  asOfSource: string;
  dateWarning: string;
  periodText: string | null;
  partyRowCount: number;
  storedCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  missingCount: number;
  blockedRowCount: number;
  conflictCount: number;
  archivedCount: number;
  rowsListed: number;
  rowsTruncated: boolean;
  rows: ServerProvisionalRow[];
  warnings: ServerProvisionalFinding[];
  blockers: ServerProvisionalFinding[];
  syncAvailable: boolean;
  syncPreviewDigest: string;
  syncBlockedReason: string;
  businessRecordsCreated: false;
  databaseRowsWritten: false;
  verifiedDebtorRowsTouched: false;
  disclaimer: string;
}

/** The provisional preview is refused unless it says all three things a preview must: it carries
 *  the provisional label and identity state, it wrote nothing (`businessRecordsCreated`,
 *  `databaseRowsWritten`, `verifiedDebtorRowsTouched` all literally false), and its date is the
 *  owner's `2026-04-01` with `asOfVerified` false. A server that claimed source-verified balances
 *  would be making the one claim this workflow exists to avoid, so the transport refuses it rather
 *  than render it. The digest must be 64 characters, because a sync without it cannot be bound to
 *  this reading. */
function readProvisionalPreviewPayload(payload: unknown): ServerProvisionalPreview {
  if (!payload || typeof payload !== 'object') {
    throw new ServerError('The provisional preview answer could not be read.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  const preview = payload as Partial<ServerProvisionalPreview> & Record<string, unknown>;
  if (preview.label !== PROVISIONAL_LABEL || preview.identityState !== PROVISIONAL_IDENTITY_STATE) {
    throw new ServerError(
      'The server answered a provisional preview without the provisional label. These records must stay labelled provisional.',
      { code: 'invalid_response', status: 200 },
    );
  }
  for (const key of [
    'businessRecordsCreated',
    'databaseRowsWritten',
    'verifiedDebtorRowsTouched',
  ] as const) {
    if (preview[key] !== false) {
      throw new ServerError(
        'The server answered a provisional preview that claims to have written data. A preview stores nothing and touches no verified debtor row.',
        { code: 'invalid_response', status: 200 },
      );
    }
  }
  if (preview.asOf !== PROVISIONAL_AS_OF || preview.asOfVerified !== false) {
    throw new ServerError(
      'The server answered a provisional preview with a date it claims the workbook verified. The provisional date is the owner’s and is never source-verified.',
      { code: 'invalid_response', status: 200 },
    );
  }
  if (typeof preview.syncAvailable !== 'boolean') {
    throw new ServerError('The provisional preview did not state whether it can be synced.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  if (typeof preview.syncPreviewDigest !== 'string' || preview.syncPreviewDigest.length !== 64) {
    throw new ServerError('The provisional preview is missing its sync plan digest.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  if (
    !Array.isArray(preview.rows) ||
    !Array.isArray(preview.blockers) ||
    !Array.isArray(preview.warnings)
  ) {
    throw new ServerError('The provisional preview answer is missing its findings.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  return preview as ServerProvisionalPreview;
}

/** `POST /debtors/provisional/preview` — owner-only, the original workbook as bytes. It reads
 *  `Sheet1` only on the server, excludes the Grand Total row and stores nothing. There is no
 *  `Idempotency-Key` because there is no write to de-duplicate. */
export async function previewProvisionalDebtorWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
): Promise<ServerProvisionalPreview> {
  const query = new URLSearchParams({ fileName: workbookLabel(fileName) });
  const payload = await send<unknown>(`/debtors/provisional/preview?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
  return readProvisionalPreviewPayload(payload);
}

/** The outcome of one confirmed provisional sync. `replayed` is the no-op case and then there is
 *  no run to name (`syncId` null, `databaseRowsWritten` false). A real sync names its run and wrote
 *  rows. `missingProvisionalIds` restates every stored record the upload omitted; they were kept,
 *  not deleted. The two narrowed flags say no business record and no verified debtor row moved. */
export interface ServerProvisionalSync {
  filename: string;
  fileSha256: string;
  sheetName: string;
  label: string;
  asOf: string;
  partyRowCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  missingCount: number;
  conflictCount: number;
  archivedCount: number;
  missingProvisionalIds: string[];
  syncId: string | null;
  syncedAt: string | null;
  replayed: boolean;
  databaseRowsWritten: boolean;
  businessRecordsCreated: false;
  verifiedDebtorRowsTouched: false;
  disclaimer: string;
}

/** A provisional sync carries the label, the owner's date, and the two literal `false` claims; a
 *  replay must name no run and write nothing, while a real sync must name its run and say it wrote.
 *  An answer that contradicts itself is refused rather than shown as a success. */
function readProvisionalSyncPayload(payload: unknown): ServerProvisionalSync {
  if (!payload || typeof payload !== 'object') {
    throw new ServerError('The provisional sync answer could not be read.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  const outcome = payload as Partial<ServerProvisionalSync> & Record<string, unknown>;
  if (outcome.label !== PROVISIONAL_LABEL) {
    throw new ServerError(
      'The server answered a provisional sync without the provisional label. These records must stay labelled provisional.',
      { code: 'invalid_response', status: 200 },
    );
  }
  for (const key of ['businessRecordsCreated', 'verifiedDebtorRowsTouched'] as const) {
    if (outcome[key] !== false) {
      throw new ServerError(
        'The server answered a provisional sync that claims to have created business records or touched verified debtors. It can do neither.',
        { code: 'invalid_response', status: 200 },
      );
    }
  }
  if (outcome.asOf !== PROVISIONAL_AS_OF) {
    throw new ServerError(
      'The server answered a provisional sync for a date other than the owner-selected provisional date.',
      { code: 'invalid_response', status: 200 },
    );
  }
  if (typeof outcome.replayed !== 'boolean' || typeof outcome.databaseRowsWritten !== 'boolean') {
    throw new ServerError('The provisional sync did not say whether it wrote anything.', {
      code: 'invalid_response',
      status: 200,
    });
  }
  if (outcome.replayed) {
    if (outcome.databaseRowsWritten !== false || outcome.syncId !== null) {
      throw new ServerError(
        'The server described a provisional replay that also writes or names a run. A replay writes nothing.',
        { code: 'invalid_response', status: 200 },
      );
    }
  } else if (
    outcome.databaseRowsWritten !== true ||
    typeof outcome.syncId !== 'string' ||
    outcome.syncId === ''
  ) {
    throw new ServerError(
      'The server described a provisional sync without saying it wrote or naming its run.',
      { code: 'invalid_response', status: 200 },
    );
  }
  if (!Array.isArray(outcome.missingProvisionalIds)) {
    throw new ServerError(
      'The provisional sync answer is missing the records it reports as missing.',
      { code: 'invalid_response', status: 200 },
    );
  }
  return outcome as ServerProvisionalSync;
}

export interface SyncProvisionalInput {
  fileName: string;
  fileSha256: string;
  previewDigest: string;
}

/** `POST /debtors/provisional/sync` — apply the exact bytes the owner just previewed to the
 *  *provisional* store. The same three bindings as the verified apply hold: the bytes, their
 *  SHA-256 and the `syncPreviewDigest` the server issued. `confirm=true` is sent only from this
 *  action. The route re-reads the file, rebuilds the plan against the provisional store as it
 *  stands now, refuses a stale digest, and writes only the `debtor_provisional_*` tables. There is
 *  no replacement approval here: a changed figure is exactly what a repeat sync is for, and the
 *  previous value is kept in the sync history. */
export async function syncProvisionalDebtorWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  input: SyncProvisionalInput,
): Promise<ServerProvisionalSync> {
  const query = new URLSearchParams({
    fileSha256: input.fileSha256,
    previewDigest: input.previewDigest,
    confirm: 'true',
    fileName: workbookLabel(input.fileName),
  });
  const payload = await send<unknown>(`/debtors/provisional/sync?${query.toString()}`, {
    method: 'POST',
    bytes,
    timeoutMs: STOCK_PREVIEW_TIMEOUT_MS,
  });
  return readProvisionalSyncPayload(payload);
}

// ── provisional debtor management (Round 12) ─────────────────────────────
//
// The read and write routes behind `/debtors/provisional`. Every one is owner-only on the backend,
// including the reads and the CSV. These types deliberately have no net, outstanding or balance
// field: the row carries two figures, the summary sums each side, and the screen prints both.

export interface ServerProvisionalDebtor {
  sourceRef: string;
  partyName: string;
  originalPartyName: string;
  importedPartyName: string;
  debitPaise: number;
  creditPaise: number;
  originalDebitPaise: number;
  originalCreditPaise: number;
  importedDebitPaise: number;
  importedCreditPaise: number;
  nameManuallyEdited: boolean;
  amountsManuallyEdited: boolean;
  hasConflict: boolean;
  pendingPartyName: string | null;
  pendingDebitPaise: number | null;
  pendingCreditPaise: number | null;
  pendingFileSha256: string | null;
  pendingDetectedAt: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archivedByName: string | null;
  archiveReason: string | null;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  assignedEmployeeActive: boolean | null;
  assignedAt: string | null;
  assignedBy: string | null;
  assignedByName: string | null;
  asOf: string;
  sourceRow: number;
  sourceFileSha256: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerProvisionalSummaryGroup {
  employeeId: string | null;
  employeeName: string;
  employeeActive: boolean | null;
  recordCount: number;
  debitPaise: number;
  creditPaise: number;
  reviewedCount: number;
  unreviewedCount: number;
  conflictCount: number;
}

export interface ServerProvisionalSummary {
  label: string;
  identityState: string;
  asOf: string;
  dateWarning: string;
  recordCount: number;
  debitPaise: number;
  creditPaise: number;
  reviewedCount: number;
  unreviewedCount: number;
  conflictCount: number;
  archivedCount: number;
  unassignedCount: number;
  salespeople: ServerProvisionalSummaryGroup[];
}

export interface ServerProvisionalMutation {
  debtor: ServerProvisionalDebtor;
  changed: boolean;
  message: string;
}

export interface ServerProvisionalRun {
  id: string;
  fileName: string;
  fileSha256: string;
  asOf: string;
  partyRowCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  missingCount: number;
  conflictCount: number;
  archivedCount: number;
  syncedAt: string;
  syncedByName: string | null;
}

export interface ServerProvisionalHistoryEdit {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  detail: string;
  changes: Record<string, unknown> | null;
}

export interface ServerProvisionalHistorySource {
  syncId: string;
  syncedAt: string;
  fileName: string;
  fileSha256: string;
  changeKind: 'new' | 'changed';
  previousPartyName: string | null;
  previousDebitPaise: number | null;
  previousCreditPaise: number | null;
  incomingPartyName: string;
  incomingDebitPaise: number;
  incomingCreditPaise: number;
}

export interface ServerProvisionalHistory {
  sourceRef: string;
  edits: ServerProvisionalHistoryEdit[];
  sourceChanges: ServerProvisionalHistorySource[];
}

/** The management filters are the list route's own query names. `salespersonId` is an employee id
 *  or the literal `unassigned`; `archived` defaults to the working list on the server and is sent
 *  explicitly so the screen's current tab is always what the answer describes. */
export interface ProvisionalManagementFilters {
  q?: string;
  salespersonId?: string;
  reviewed?: boolean;
  archived?: 'active' | 'archived' | 'all';
  hasConflict?: boolean;
  page?: number;
  pageSize?: number;
}

function provisionalQuery(filters: ProvisionalManagementFilters, includePaging = true): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  if (filters.salespersonId) query.set('salespersonId', filters.salespersonId);
  if (filters.reviewed !== undefined) query.set('reviewed', String(filters.reviewed));
  if (filters.archived) query.set('archived', filters.archived);
  if (filters.hasConflict !== undefined) query.set('hasConflict', String(filters.hasConflict));
  if (includePaging && filters.page) query.set('page', String(filters.page));
  if (includePaging && filters.pageSize) query.set('pageSize', String(filters.pageSize));
  return query;
}

export function listProvisionalDebtors(
  filters: ProvisionalManagementFilters = {},
): Promise<ServerPage<ServerProvisionalDebtor>> {
  return send<ServerPage<ServerProvisionalDebtor>>(
    `/debtors/provisional?${provisionalQuery(filters).toString()}`,
  );
}

export function getProvisionalSummary(
  filters: ProvisionalManagementFilters = {},
): Promise<ServerProvisionalSummary> {
  return send<ServerProvisionalSummary>(
    `/debtors/provisional/summary?${provisionalQuery(filters, false).toString()}`,
  );
}

/** `GET /debtors/provisional/export` — the filtered list as UTF-8 CSV, BOM included by the server.
 *  The same filters as the list, so the file and the screen describe one set of records. */
export function exportProvisionalDebtorsCsv(
  filters: ProvisionalManagementFilters = {},
): Promise<string> {
  return send<string>(`/debtors/provisional/export?${provisionalQuery(filters, false).toString()}`, {
    text: true,
  });
}

export function listProvisionalRuns(
  params: { page?: number; pageSize?: number } = {},
): Promise<ServerPage<ServerProvisionalRun>> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 50));
  return send<ServerPage<ServerProvisionalRun>>(`/debtors/provisional/runs?${query.toString()}`);
}

export function getProvisionalHistory(sourceRef: string): Promise<ServerProvisionalHistory> {
  return send<ServerProvisionalHistory>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/history`,
  );
}

export interface ProvisionalEditBody {
  partyName?: string;
  debitPaise?: number;
  creditPaise?: number;
  reason?: string;
}

/** `POST /debtors/provisional/{ref}/edit` — correction of the effective name or either amount.
 *  Confirmation is always sent from a dialog the owner has read; a balance change without a reason
 *  is refused by the server even though this body could carry one. `original*` and `imported*` are
 *  never touched by this route, and the temporary id never changes on a rename. */
export function editProvisionalDebtor(
  sourceRef: string,
  body: ProvisionalEditBody,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/edit`,
    {
      method: 'POST',
      body: { ...body, confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export function archiveProvisionalDebtor(
  sourceRef: string,
  reason: string,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/archive`,
    {
      method: 'POST',
      body: { reason, confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export function restoreProvisionalDebtor(
  sourceRef: string,
  reason: string,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/restore`,
    {
      method: 'POST',
      body: { reason, confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export function assignProvisionalDebtor(
  sourceRef: string,
  employeeId: string | null,
  reason: string,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/assignment`,
    {
      method: 'POST',
      body: { employeeId, reason, confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export function reviewProvisionalDebtor(
  sourceRef: string,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/review`,
    {
      method: 'POST',
      body: { confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export type ProvisionalConflictResolution = 'accept_source' | 'keep_manual';

export function resolveProvisionalConflict(
  sourceRef: string,
  resolution: ProvisionalConflictResolution,
  reason: string,
  idempotencyKey: string,
): Promise<ServerProvisionalMutation> {
  return send<ServerProvisionalMutation>(
    `/debtors/provisional/${encodeURIComponent(sourceRef)}/conflict`,
    {
      method: 'POST',
      body: { resolution, reason, confirm: true },
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

// ── customer ledger ──────────────────────────────────────────────────────

export type LedgerKind = 'opening' | 'invoice' | 'creditNote' | 'payment';

/** One line of a customer's running balance. `balancePaise` is summed in SQL over the rows
 *  returned, so the last row equals the customer's ledger figure — the screen never re-adds
 *  it. Voided receipts are excluded here but stay listed on the Payment screen. */
export interface ServerLedgerEntry {
  entryDate: string;
  kind: LedgerKind;
  reference: string;
  entryId: string;
  orderId: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  source: string;
}

export function getCustomerLedger(
  customerId: string,
  params: { from?: string; to?: string; page?: number; pageSize?: number } = {},
): Promise<ServerPage<ServerLedgerEntry>> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize ?? 50));
  return send<ServerPage<ServerLedgerEntry>>(`/customers/${encodeURIComponent(customerId)}/ledger?${query.toString()}`);
}

// ── invitations, signup & profile ───────────────────────────────────────

export interface InvitationRecord {
  id: string;
  code: string;
  role: string;
  department: string;
  employee_id?: string;
  sales_territory?: string;
  monthly_target_qty: number;
  target_unit: string;
  may_dispatch: number;
  max_uses: number;
  used_count: number;
  expires_at: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  created_by: string;
  created_at: string;
}

export interface VerifyInvitationResult {
  valid: boolean;
  code?: string;
  role?: string;
  department?: string;
  salesTerritory?: string;
  monthlyTargetQty?: number;
  targetUnit?: string;
  mayDispatch?: boolean;
  reason?: string;
}

export interface SignupInput {
  name: string;
  identifier: string;
  password: string;
  phone?: string;
  inviteCode: string;
}

export function createInvitation(input: {
  role?: string;
  department?: string;
  salesTerritory?: string;
  monthlyTargetQty?: number;
  targetUnit?: string;
  mayDispatch?: boolean;
  maxUses?: number;
  expiresInDays?: number;
}): Promise<InvitationRecord> {
  return send<InvitationRecord>('/auth/invitations', {
    method: 'POST',
    body: input,
  });
}

export function listInvitations(): Promise<InvitationRecord[]> {
  return send<InvitationRecord[]>('/auth/invitations');
}

export function revokeInvitation(code: string): Promise<{ success: boolean; code: string }> {
  return send<{ success: boolean; code: string }>(`/auth/invitations/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

export function verifyInvitationCode(code: string): Promise<VerifyInvitationResult> {
  return send<VerifyInvitationResult>('/auth/invitations/verify', {
    method: 'POST',
    auth: false,
    body: { code },
  });
}

export async function signUpUser(input: SignupInput): Promise<ServerUser> {
  const result = await send<LoginResult>('/auth/signup', {
    method: 'POST',
    auth: false,
    body: input,
  });
  writeTokens(result.accessToken, result.refreshToken);
  return result.user;
}

export function fetchUserProfile(): Promise<ServerUser & {
  salesTerritory?: string;
  monthlyTargetQty?: string;
  targetUnit?: string;
  isOwner?: boolean;
  isDispatch?: boolean;
}> {
  return send('/auth/me');
}

export function updateUserProfile(input: {
  name?: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<ServerUser> {
  return send('/auth/me', {
    method: 'PATCH',
    body: input,
  });
}

export interface ForgotPasswordResult {
  status: string;
  message: string;
  identifier: string;
  devOtp?: string;
  expiresAt?: string;
  user?: {
    id: string;
    name: string;
    role: string;
    maskedContact: string;
  };
}

export function requestPasswordReset(identifier: string): Promise<ForgotPasswordResult> {
  return send<ForgotPasswordResult>('/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: { identifier },
  });
}

export function resetPassword(input: {
  identifier: string;
  otp: string;
  newPassword: string;
  confirmPassword?: string;
}): Promise<{ status: string; message: string }> {
  return send<{ status: string; message: string }>('/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: input,
  });
}


