/** The boundary rules the live entry forms share, kept pure so `node --test` can load them.
 *
 *  A form is where typed text becomes an API request, and that transformation has exactly two
 *  honest failure modes: sending something the server will refuse (the round trip wastes the
 *  owner's time), or sending something *different* from what the person typed (which is worse —
 *  the server accepts it and the books are wrong). These functions are the one place that
 *  decides what "500" means in paise, when a mobile number is usable, and when a retry of a
 *  failed submission is the same submission.
 *
 *  The mobile rules mirror `backend/app/services/customers.py` on purpose: the same input must
 *  produce the same refusal on both sides, and `scripts/entry-boundary-test.mjs` pins cases that
 *  both suites would catch if they drifted.
 *
 *  No `import.meta.env`, no fetch, no DOM — only erasable TypeScript, because the test runner
 *  loads this file with type stripping and no bundler.
 */

const MOBILE_SPACING = /[\s\-().]/g;
const MOBILE = /^[6-9]\d{9}$/;
const RUPEES = /^\d+(\.\d{1,2})?$/;

/** Rupees larger than this are refused rather than converted: `rupees * 100` must stay inside
 *  the float integers JavaScript compares exactly (2^53), and no trade invoice is a trillion. */
const MAX_RUPEES = 1_000_000_000_000;

export interface LiveCustomerDraft {
  name: string;
  mobile: string;
  contactPerson: string;
  city: string;
  district: string;
  state: string;
  address: string;
  notes: string;
  salespersonId: string;
  /** As typed. Blank means "use the business default", which is the server's rule. */
  creditDays: string;
}

export type PaiseResult = { ok: true; paise: number } | { ok: false; reason: string };

/** An exact amount for an entry screen: `125050` → `₹1,250.50`, never rounded.
 *
 *  The rest of the panel uses `format.rupees()`, which rounds to whole rupees — fine for a
 *  dashboard tile, wrong for a confirmation. An owner about to save ₹1,250.50 must not be asked
 *  to confirm "₹1,251", because that is a different number from the one that will be stored, and
 *  a confirmation that quotes a different number is worse than none. Grouping follows the
 *  Indian convention the rest of the panel uses. */
export function exactRupees(paise: number): string {
  const rounded = Math.round(paise);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100).toString();
  const frac = String(abs % 100).padStart(2, '0');
  let grouped: string;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const lastThree = whole.slice(-3);
    let prefix = whole.slice(0, -3);
    const chunks: string[] = [];
    while (prefix.length > 2) {
      chunks.unshift(prefix.slice(-2));
      prefix = prefix.slice(0, -2);
    }
    if (prefix) chunks.unshift(prefix);
    grouped = `${chunks.join(',')},${lastThree}`;
  }
  return `${negative ? '-₹' : '₹'}${grouped}.${frac}`;
}

/** `"1,20,000.50"` → `12000050`. Commas and a leading ₹ are tolerated because that is how the
 *  number is copied out of a bill; anything else non-numeric is not. The amount is always
 *  positive — which way the money points is the direction radio's job, and letting the sign in
 *  through this door twice is how one of the two doors ends up wrong. */
export function paiseFromRupees(text: string): PaiseResult {
  const cleaned = text.replace(/[,\s₹]/g, '');
  if (cleaned === '') return { ok: false, reason: 'Enter an amount in rupees.' };
  if (!RUPEES.test(cleaned)) {
    return { ok: false, reason: 'Enter a positive amount with at most two decimal places.' };
  }
  const rupees = Number(cleaned);
  if (rupees <= 0) return { ok: false, reason: 'The amount must be greater than zero.' };
  if (rupees > MAX_RUPEES) return { ok: false, reason: 'That amount is larger than the panel can represent exactly.' };
  return { ok: true, paise: Math.round(rupees * 100) };
}

/** `+91 98765-43210` and `09876543210` both become `9876543210` — the same normalisation the
 *  server stores, so the duplicate check and the saved row agree on what the number is. */
export function normaliseMobile(raw: string): string {
  let digits = (raw ?? '').replace(MOBILE_SPACING, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

/** Null when the number is usable; the refusal the server would give otherwise. */
export function mobileProblem(raw: string): string | null {
  return MOBILE.test(normaliseMobile(raw)) ? null : 'Enter a 10-digit mobile number beginning 6-9.';
}

/** Every field the server would refuse before the request is worth making. The map is keyed by
 *  the API's own field names, so the form can hand each message to the field it belongs to.
 *  This is a courtesy, not the gate: the server validates the same rules again. */
export function customerDraftProblems(draft: LiveCustomerDraft): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!draft.name.trim()) problems.name = 'The customer needs a name.';
  const mobile = mobileProblem(draft.mobile);
  if (mobile) problems.mobile = mobile;
  const credit = draft.creditDays.trim();
  if (credit !== '') {
    const days = Number(credit);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      problems.creditDays = 'Enter a whole number of days between 0 and 365, or leave it blank.';
    }
  }
  return problems;
}

/** The typed term folded the way `GET /customers/match` folds it — case and spacing ignored —
 *  so the panel's query and the server's comparison agree about what "same" means. */
export function foldTerm(text: string): string {
  return text.trim().split(/\s+/).join(' ').toLowerCase();
}

/** JSON with object keys sorted at every level, so two bodies that differ only in key order
 *  fingerprint identically — the same canonicalisation the server's idempotency check does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortValue(record[key]);
    return sorted;
  }
  return value;
}

export interface KeyedSubmission {
  key: string;
  fingerprint: string;
}

/** One idempotency key per submission *intent*. A retry of the identical body reuses its key —
 *  that is what makes the retry safe — while an edit after a failure is a different submission
 *  and gets a fresh key, because the server answers `409` to a key reused for a different body
 *  and the owner would see a conflict they cannot act on. */
export function idempotencyKeyFor(
  stored: KeyedSubmission | null,
  payload: unknown,
  makeKey: () => string,
): KeyedSubmission {
  const fingerprint = canonicalJson(payload);
  if (stored && stored.fingerprint === fingerprint) return stored;
  return { key: makeKey(), fingerprint };
}
