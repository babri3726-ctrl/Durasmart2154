/** The three formatters a live screen still needs.
 *
 *  Ported from the phone app's `../mobile/lib/core/formatters.dart`, then reduced to
 *  what this panel actually renders. What was dropped matters more than what stayed:
 *
 *  - `rupeesShort()` rounded to whole rupees and stays deleted. `rupees()` below does *not*: money
 *    is the server's integer paise, and a message that quotes "₹1,251" for a ₹1,250.50 order is a
 *    different number from the one on the invoice. Entry and confirmation figures keep going through
 *    `exactRupees` in `entryRules.ts`; `rupees()` exists because the share text needs the same
 *    figure and these two files may not import each other — neither may import anything, so that
 *    `node --test` can load both without a bundler.
 *  - `waNumber()` / `whatsappShareUrl()` built `wa.me` links for a sharing feature that left with
 *    the demo store. They came back with `D-12`: the order screens hand a **text** to WhatsApp.
 *    There is no messaging route on the backend and none is called — the link is built here from
 *    the customer row the server already sent, and the browser opens it.
 *  - `qtyLabel()` took a `number`, but quantities arrive as decimal *strings* and are rendered as
 *    sent, so the sign and the trailing digits survived. The re-added version takes the string.
 *  - The date helpers that remained (`dayMonthLabel`, `monthLabel`, `relativeDay`, `fmt`,
 *    `isoDate`, `daysBetween`) belonged to the demo charts and the tour/task screens.
 *
 *  Ledger and voucher dates print as the server sent them — a `2026-10-01` is a calendar date, not
 *  an instant, and re-formatting one through the browser's timezone is how a date moves by a day.
 *  `fmtDateTime` is for real timestamps only: `voidedAt`, session times.
 *
 *  No imports and no DOM in this file, the same rule `entryRules.ts` follows: `node --test` loads
 *  it directly with type stripping, so the share-text builder below is pinned by a boundary test
 *  rather than only seen in a browser.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function dateTimeLabel(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${dateLabel(d)} • ${hh}:${mm}`;
}

export function fmtDateTime(iso: string): string {
  return dateTimeLabel(new Date(iso));
}

/** Parse an ISO-ish date input value to a Date (local, start of day). */
export function toDate(value: string): Date {
  return new Date(value);
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => (p ? p[0].toUpperCase() : ''))
    .slice(0, 2)
    .join('');
}

// ── money and quantity labels ────────────────────────────────────────────

/** `12000050` paise → `₹1,20,000.50`, grouped the Indian way. Exact: the paisa fraction is printed,
 *  never rounded away, and a negative keeps its sign instead of being clamped to zero. */
export function rupees(paise: number): string {
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

/** A quantity as the server sent it, with its unit after it. `quantity` is a decimal **string**
 *  (`"5.000"`), so the trailing digits a NUMERIC column kept survive instead of becoming `5`.
 *  Nothing here parses, pads or re-rounds it. */
export function qtyLabel(quantity: string, unit: string): string {
  const q = (quantity ?? '').trim();
  const u = (unit ?? '').trim();
  if (q === '') return u;
  return u === '' ? q : `${q} ${u}`;
}

// ── WhatsApp text/share handoff (D-12) ───────────────────────────────────
//
// Client-side only. There is no messaging route on the backend, no fetch to Meta and no phone
// lookup beyond the customer row the server already returned: the panel builds a *text* and either
// copies it or opens a `wa.me` link, and what the operator then sends is their own doing.

const NON_DIGITS = /\D/g;

/** Digits a `wa.me` URL accepts. Ten local digits become `91`-prefixed; a leading `0` and a `+`
 *  are stripped; anything that is not 10 or 12 digits after that is not a number the link can be
 *  built for, and the caller says so instead of opening WhatsApp at the wrong address. */
export function waNumber(mobile: string): string | null {
  let digits = (mobile ?? '').replace(NON_DIGITS, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  return null;
}

/** `https://wa.me/<number>?text=<encoded>`, or null when there is no usable number.
 *  The text is encoded whole, so a multi-line order summary arrives as one message. */
export function whatsappShareUrl(mobile: string, text: string): string | null {
  const number = waNumber(mobile);
  if (number === null) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** How to name an order to a person in one sentence. A draft is addressed by its internal id in a
 *  URL and nowhere on screen: S-10 of `SALES_DISPATCH_P3_IMPLEMENTATION_PLAN.md` §12.1 forbids
 *  printing that id in the printed number's place, so an order whose `number` has not arrived says
 *  so in words instead of falling back to the id. */
export function orderLabel(order: { number?: string | null }): string {
  return order.number ? `Order ${order.number}` : 'The order (no printed number yet)';
}

/** What a share row needs, described loosely on purpose: the page passes the server's own fields
 *  (`ServerOrderDetail` plus the lines mapped to `orderedQuantity`), and this builder never
 *  invents a value it was not handed. No totals are computed here — the order value is the
 *  server's `valuePaise`, and a line shows the quantity and rate it was ordered at. */
export interface ShareLine {
  productName: string;
  quantity: string;
  unit: string;
  ratePaise?: number | null;
}

export interface ShareOrder {
  number: string | null;
  customerName: string;
  orderDate?: string | null;
  status?: string | null;
  valuePaise?: number | null;
  lines: ShareLine[];
}

/** The message body. An unsubmitted draft is named as one and shown without a number, because the
 *  printed number is minted at submission and a share text that quoted one would be a lie. */
export function orderShareText(order: ShareOrder): string {
  const head = order.number ? `Order ${order.number}` : 'Order draft (no number yet)';
  const rows: string[] = [head, order.customerName];
  const meta: string[] = [];
  if (order.orderDate) meta.push(order.orderDate);
  if (order.status) meta.push(order.status);
  if (meta.length) rows.push(meta.join(' • '));
  rows.push('');
  order.lines.forEach((line, i) => {
    const parts = [`${i + 1}. ${line.productName.trim() || 'Unnamed item'} — ${qtyLabel(line.quantity, line.unit)}`];
    if (typeof line.ratePaise === 'number') parts.push(`@ ${rupees(line.ratePaise)}`);
    rows.push(parts.join(' '));
  });
  if (typeof order.valuePaise === 'number') {
    rows.push('');
    rows.push(`Order value: ${rupees(order.valuePaise)}`);
  }
  return rows.join('\n');
}

