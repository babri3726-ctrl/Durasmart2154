/** Shared display rules for the live read screens. The server's vocabularies stay the
 *  server's — an unknown code renders raw rather than being silently renamed to a known one. */

/** Dispatch states from `v_order_summary.dispatch_status`. */
export const DISPATCH_LABEL: Record<string, string> = {
  pending: 'awaiting dispatch',
  partial: 'partially dispatched',
  dispatched: 'dispatched',
};

/** Quantities arrive as decimal strings ("5.000"). The only thing the panel may conclude
 *  about them is the sign: a leading minus means over-dispatch, and it has to stay visible —
 *  the server refuses to clamp it, and so do we. */
export const isNegativeQuantity = (quantity: string): boolean => quantity.trim().startsWith('-');

/** Where one *consignment* is on the road — `dispatch.delivery_status`
 *  (`backend/app/models/trade.py:48`), the four words the check constraint allows.
 *
 *  A different vocabulary from `DISPATCH_LABEL` above, and the two must never be folded into one
 *  map: they are computed from different rows about different things. An order whose second trip is
 *  still in the yard reads `partial` on the delivery-progress axis while the consignment that
 *  finished the first trip reads `delivered`, and a screen that called both of them "dispatched"
 *  would be reporting goods that had not moved. */
export const DELIVERY_LABEL: Record<string, string> = {
  pending: 'recorded, not yet moved',
  inTransit: 'in transit',
  partial: 'part-delivered',
  delivered: 'delivered',
};
