/** Which reads a write made stale, shared across the screens that read them.
 *
 *  Before P7 each screen kept its own counter: the Customers page bumped one after a create and
 *  no other screen could see it. An order write on a detail screen, a dispatch recorded from a
 *  queue and a target saved from Sales all change figures a second card or the next screen reads,
 *  and a counter owned by one component cannot say so.
 *
 *  So the counter lives here, keyed by the resource the read depends on. A writer bumps the keys
 *  its mutation invalidated; every hook reading a bumped key receives a new `refreshToken` and
 *  re-reads. The keys are deliberately coarse on the list side (`orderList:` for any filter page,
 *  `dispatches:` for the register) and exact on the detail side (`orders:<id>`,
 *  `dispatches:<orderId>`): a list that re-reads once more than strictly needed is cheap and
 *  correct, while a detail card that misses its key shows a pre-write balance until remount.
 *
 *  `debtors` is here although no P2 screen reads it yet: it is the key the import's apply step
 *  will bump, and naming it now keeps the map the one place the convention is written down.
 *
 *  No reset on sign-out: counters only ever force a read, and a fresh login's first mount reads
 *  anyway. Clearing them would add a transition with nothing to gain.
 */

import { create } from 'zustand';

interface SyncState {
  revisions: Record<string, number>;
  bump: (keys: readonly string[]) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  revisions: {},
  bump: (keys) =>
    set((state) => {
      const revisions = { ...state.revisions };
      for (const key of keys) revisions[key] = (revisions[key] ?? 0) + 1;
      return { revisions };
    }),
}));

/** Mark the reads these keys name as stale. Safe to call outside React (a promise callback). */
export function invalidate(...keys: string[]): void {
  if (keys.length === 0) return;
  useSyncStore.getState().bump(keys);
}

/** The counter for one exact key. */
export function useSyncToken(key: string): number {
  return useSyncStore((state) => state.revisions[key] ?? 0);
}

/** The sum of counters under a prefix, for a list whose exact key includes filters it owns. */
export function useSyncPrefix(prefix: string): number {
  return useSyncStore((state) => {
    let total = 0;
    for (const [key, count] of Object.entries(state.revisions)) {
      if (key.startsWith(prefix)) total += count;
    }
    return total;
  });
}

export const syncKeys = {
  order: (id: string) => `orders:${id}`,
  orderList: (filters = '') => `orderList:${filters}`,
  dispatch: (orderId: string) => `dispatches:${orderId}`,
  dispatchRegister: 'dispatches:',
  debtors: 'debtors',
  customers: 'customers',
  payments: 'payments',
  dashboard: 'dashboard',
  target: (employeeId: string) => `targets:${employeeId}`,
  targetBook: 'targets:',
  // A successful workbook apply changes every stock read, on both clients. These keys are bumped
  // together by `StockWorkbookPreview` so an open dashboard, a Total Stock list and the approved
  // snapshot re-read the batch that was just written instead of showing last month's.
  stockSummary: 'stock:summary',
  stockUpvc: 'stock:upvc',
  stockAccessories: 'stock:accessories',
  stockProduction: 'stock:production',
  stockImported: 'stock:imported',
  stockImports: 'stock:imports:',
} as const;
