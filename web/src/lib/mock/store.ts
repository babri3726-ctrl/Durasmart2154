/** The demo store: the fixtures, plus the mutations the panel's own writes make to them.
 *
 *  Deliberately a plain module-level object, not a class or a context: one tab, one store, no
 *  persistence. A reload puts every row back, which is the honest behaviour for a data source
 *  that is not a database, and it means nothing a screen writes can leak into a real record.
 *
 *  Money is integer paise and quantities are decimal strings end to end, exactly as the wire
 *  format has them, so no screen is being shown a number the real backend would have sent as
 *  text.
 */

import * as core from './fixtures/core';
import { DEMO_PERIOD_END, DEMO_PERIOD_START, DEMO_TODAY } from './fixtures/core';
import {
  PROVISIONAL_AS_OF,
  PROVISIONAL_IDENTITY_STATE,
  PROVISIONAL_LABEL,
  PROVISIONAL_SOURCE_PERIOD,
} from '../provisionalSync';
import {
  DEMO_FILE_SHA,
  DEMO_OTHER_SHA,
  DEMO_PREVIEW_DIGEST,
  demoBatch,
  demoImportedStock,
  demoPreview,
  demoQuarantine,
  demoStockItems,
  demoStockSummary,
  demoStockWatch,
  demoUpvcRows,
} from './fixtures/stock';
import {
  DEMO_AS_OF,
  demoDebtorPreview,
  demoDebtorPreviewRows,
  demoDebtors,
  demoProvisionalDebtors,
  demoProvisionalRows,
} from './fixtures/debtors';
import type {
  ServerCustomerDetail,
  ServerDebtorApply,
  ServerDebtorPreview,
  ServerDashboardSummary,
  ServerImportedStock,
  ServerLedgerEntry,
  ServerPerformance,
  ServerProvisionalHistory,
  ServerProvisionalPreview,
  ServerProvisionalRun,
  ServerProvisionalSummary,
  ServerSalespersonPerformance,
  ServerStockGap,
  ServerStockImportBatch,
  ServerStockImportDetail,
  ServerUpvcStock,
  ServerUser,
} from '../serverApi';

export const state = {
  /** The sign-in table. Ships in the bundle and holds no real credential. */
  credentials: core.demoCredentials,
  /** Today, so a created order lands on the same date the fixtures were cut on. */
  today: DEMO_TODAY,
  users: core.demoUsers,
  employees: [...core.demoEmployees],
  products: [...core.demoProducts],
  orderDetails: [...core.demoOrderDetails],
  dispatchDetails: [...core.demoDispatchDetails],
  payments: [...core.demoPayments],
  targets: [...core.demoTargets],
  openingBalances: { ...core.demoOpeningBalances },
  /** Parties created this session, kept beside the fixtures so a created row survives the
   *  re-derivation in `customerRows()` rather than vanishing on the next list read. */
  createdCustomers: [] as ServerCustomerDetail[],
  /** Above the seeded opening-balance ids, so a row created at runtime cannot duplicate one. */
  openingSequence: 100,
  /** Line ids above the fixture range (order lines reach 88, dispatch lines 103) so a row created
   *  at runtime cannot collide with a seeded one. */
  orderLineSequence: 1000,
  dispatchLineSequence: 1000,
  audit: [...core.demoAudit],
  stockBalances: [...core.demoStockBalances],
  stockMovements: [...core.demoStockMovements],
  batch: { ...demoBatch },
  stockItems: [...demoStockItems],
  quarantine: [...demoQuarantine],
  batches: [{ ...demoBatch }] as ServerStockImportBatch[],
  provisional: [...demoProvisionalDebtors],
  debtors: [...demoDebtors],
  /** File hashes already synced, so presenting one twice is reported as a replay the way the
   *  backend reports it rather than as a second write. */
  provisionalRuns: [] as string[],
  provisionalSyncCount: 0,
};

// ── helpers ──────────────────────────────────────────────────────────────

export const paginate = <T>(items: T[], page = 1, pageSize = 50) => {
  const start = (Math.max(1, page) - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: Math.max(1, page),
    pageSize,
    total: items.length,
    nextCursor: start + pageSize < items.length ? String(start + pageSize) : null,
  };
};

const num = (value: string | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

const dec = (value: number) => value.toFixed(3);

/** Re-derived on every read rather than stored, so a created order or a recorded payment moves
 *  the party's figures the way it would against a real backend. */
export const customerRows = (): ServerCustomerDetail[] =>
  [...core.demoCustomerSeeds, ...state.createdCustomers].map((seed) => {
    const orders = state.orderDetails.filter((o) => o.customerId === seed.id && o.status !== 'cancelled');
    const billed = orders.reduce((sum, o) => sum + (o.isBilled ? o.billedPaise : 0), 0);
    const unbilled = orders.reduce((sum, o) => sum + (o.isBilled ? 0 : o.valuePaise), 0);
    const paid = state.payments
      .filter((p) => p.customerId === seed.id && p.voidedAt === null)
      .reduce((sum, p) => sum + p.amountPaise, 0);
    const invoices = state.payments.filter((p) => p.customerId === seed.id && p.voidedAt === null);
    const outstanding = Math.max(0, billed - paid);
    const advance = Math.max(0, paid - billed);
    const overdue = orders
      .filter((o) => o.isBilled && o.orderBalancePaise > 0 && o.dueDate !== null && o.dueDate < DEMO_TODAY)
      .reduce((sum, o) => sum + o.orderBalancePaise, 0);
    const opening = seed.openingPaise;
    return {
      ...seed,
      source: 'panel',
      address: `${seed.city} sample address line`,
      notes: seed.id === 'CUST-DEMO-001' ? 'Prefers morning delivery.' : '',
      ledgerGroup: seed.creditDays > 0 ? 'Regular' : 'Cash',
      creditTerms: `Credit ${seed.creditDays} days`,
      approvedBy: seed.status === 'approved' ? 'USR-DEMO-OWNER' : null,
      approvedAt: seed.status === 'approved' ? '2026-02-01T09:00:00+05:30' : null,
      openingPaise: opening,
      outstandingPaise: outstanding + opening,
      advancePaise: advance,
      unbilledValuePaise: unbilled,
      overduePaise: Math.min(overdue, outstanding + opening),
      isOverdue: overdue > 0,
      invoiceCount: invoices.length,
      orderCount: orders.length,
      lastPaymentDate: invoices.length > 0 ? invoices[invoices.length - 1].paymentDate : null,
    };
  });

export const customerById = (id: string): ServerCustomerDetail | undefined =>
  customerRows().find((c) => c.id === id);

export const ledger = (customerId: string): ServerLedgerEntry[] => {
  const rows: Omit<ServerLedgerEntry, 'balancePaise'>[] = [];
  for (const entry of state.openingBalances[customerId] ?? []) {
    rows.push({
      entryDate: entry.asOf,
      kind: 'opening',
      reference: `OPEN-${entry.id}`,
      entryId: `OB-${entry.id}`,
      orderId: null,
      debitPaise: entry.direction === 'owes' ? entry.amountPaise : 0,
      creditPaise: entry.direction === 'advance' ? entry.amountPaise : 0,
      source: entry.source,
    });
  }
  for (const order of state.orderDetails.filter((o) => o.customerId === customerId && o.isBilled)) {
    rows.push({
      entryDate: order.orderDate,
      kind: 'invoice',
      reference: order.number ?? order.id,
      entryId: order.id,
      orderId: order.id,
      debitPaise: order.billedPaise,
      creditPaise: 0,
      source: order.source,
    });
  }
  for (const payment of state.payments.filter((p) => p.customerId === customerId && p.voidedAt === null)) {
    rows.push({
      entryDate: payment.paymentDate,
      kind: 'payment',
      reference: payment.reference || payment.invoiceNumber,
      entryId: payment.id,
      orderId: payment.orderId,
      debitPaise: 0,
      creditPaise: payment.amountPaise,
      source: payment.source,
    });
  }
  rows.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryId.localeCompare(b.entryId));
  let running = 0;
  return rows.map((row) => {
    running += row.debitPaise - row.creditPaise;
    return { ...row, balancePaise: running };
  });
};

export const dashboardSummary = (): ServerDashboardSummary => {
  const orders = state.orderDetails.filter((o) => o.status !== 'cancelled');
  const parties = customerRows();
  const dispatchedByUnit = new Map<string, { quantity: number; mismatched: number; lines: number }>();
  for (const dispatch of state.dispatchDetails.filter((d) => d.voidedAt === null)) {
    for (const dLine of dispatch.lines) {
      const bucket = dispatchedByUnit.get(dLine.unit) ?? { quantity: 0, mismatched: 0, lines: 0 };
      const product = state.products.find((p) => p.id === dLine.productId);
      const mismatched = product !== undefined && product.unit !== dLine.unit;
      bucket.quantity += num(dLine.quantity);
      if (mismatched) {
        bucket.mismatched += num(dLine.quantity);
        bucket.lines += 1;
      }
      dispatchedByUnit.set(dLine.unit, bucket);
    }
  }
  return {
    periodStart: DEMO_PERIOD_START,
    periodEnd: DEMO_PERIOD_END,
    orderCount: orders.length,
    ordersValuePaise: orders.reduce((sum, o) => sum + o.valuePaise, 0),
    collectedPaise: state.payments.filter((p) => p.voidedAt === null).reduce((sum, p) => sum + p.amountPaise, 0),
    outstandingPaise: parties.reduce((sum, c) => sum + c.outstandingPaise, 0),
    overduePaise: parties.reduce((sum, c) => sum + c.overduePaise, 0),
    pendingApprovalCustomers: parties.filter((c) => c.status === 'pending').length,
    delayedOrderCount: orders.filter((o) => o.dueDate !== null && o.dueDate < DEMO_TODAY && o.status !== 'completed').length,
    dispatched: [...dispatchedByUnit.entries()].map(([unit, value]) => ({
      unit,
      dispatchedQuantity: dec(value.quantity),
      mismatchedDispatchQuantity: dec(value.mismatched),
      mismatchedDispatchLines: value.lines,
    })),
  };
};

export const performance = (): ServerSalespersonPerformance => {
  const active = state.employees.filter((e) => e.active);
  const rows: ServerPerformance[] = active.map((employee) => {
    const own = state.orderDetails.filter((o) => o.salespersonId === employee.id && o.status !== 'cancelled');
    const achieved = own.reduce((sum, o) => sum + num(o.orderedQuantity), 0);
    const went = own.reduce((sum, o) => sum + num(o.dispatchedQuantity), 0);
    const target = state.targets.find((t) => t.employeeId === employee.id) ?? null;
    const targetQuantity = target?.quantity ?? (num(employee.monthlyTargetQty) > 0 ? employee.monthlyTargetQty : null);
    const remaining = targetQuantity === null ? null : Math.max(0, num(targetQuantity) - achieved);
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      periodStart: DEMO_PERIOD_START,
      periodEnd: DEMO_PERIOD_END,
      productCategory: target?.productCategory ?? null,
      targetSource: target ? 'targets' : num(employee.monthlyTargetQty) > 0 ? 'legacy' : 'none',
      excludedTargetRows: 0,
      units: [
        {
          unit: employee.targetUnit,
          targetQuantity,
          achievedQuantity: dec(achieved),
          dispatchedQuantity: dec(went),
          mismatchedDispatchQuantity: '0.000',
          remainingQuantity: remaining === null ? null : dec(remaining),
          achievementPercent:
            targetQuantity === null || num(targetQuantity) === 0
              ? null
              : dec((achieved / num(targetQuantity)) * 100),
          targetZero: targetQuantity !== null && num(targetQuantity) === 0,
          unitMismatch: false,
        },
      ],
    };
  });
  return {
    periodStart: DEMO_PERIOD_START,
    periodEnd: DEMO_PERIOD_END,
    productCategory: null,
    rows,
  };
};

/** The UPVC read, narrowed the way the route narrows it. */
export const upvcStock = (params: { type?: string | null; colour?: string | null; lengthFt?: number | null; q?: string | null }): ServerUpvcStock => {
  const rows = demoUpvcRows.filter(
    (row) =>
      (!params.type || row.stockType === params.type) &&
      (!params.colour || row.colour === params.colour) &&
      (params.lengthFt === null || params.lengthFt === undefined || row.lengthFt === params.lengthFt) &&
      (!params.q || row.label.toLowerCase().includes(params.q.toLowerCase())),
  );
  const pieces = rows.reduce((sum, r) => sum + num(r.pieces), 0);
  const footage = rows.reduce((sum, r) => sum + num(r.footage), 0);
  return {
    ...demoUpvcRowsTotals(rows, pieces, footage),
    available: true,
    batchId: state.batch.id,
    appliedAt: state.batch.appliedAt,
    stockType: (params.type as 'new' | 'old' | 'waste' | null) ?? null,
    colour: params.colour ?? null,
    lengthFt: params.lengthFt ?? null,
    search: params.q ?? null,
    rows,
    stockMovementsCreated: false,
  };
};

const demoUpvcRowsTotals = (rows: typeof demoUpvcRows, pieces: number, footage: number) => {
  const byColour = new Map<string, { pieces: number; footage: number; count: number }>();
  const byLength = new Map<string, { pieces: number; footage: number; count: number }>();
  const matrix = new Map<string, { colour: string; lengthFt: number | null; pieces: number; footage: number; count: number }>();
  for (const row of rows) {
    const colour = byColour.get(row.colour) ?? { pieces: 0, footage: 0, count: 0 };
    colour.pieces += num(row.pieces);
    colour.footage += num(row.footage);
    colour.count += 1;
    byColour.set(row.colour, colour);
    const lengthKey = row.lengthFt === null ? 'none' : String(row.lengthFt);
    const length = byLength.get(lengthKey) ?? { pieces: 0, footage: 0, count: 0 };
    length.pieces += num(row.pieces);
    length.footage += num(row.footage);
    length.count += 1;
    byLength.set(lengthKey, length);
    const cellKey = `${row.colour}|${lengthKey}`;
    const cell = matrix.get(cellKey) ?? {
      colour: row.colour,
      lengthFt: row.lengthFt,
      pieces: 0,
      footage: 0,
      count: 0,
    };
    cell.pieces += num(row.pieces);
    cell.footage += num(row.footage);
    cell.count += 1;
    matrix.set(cellKey, cell);
  }
  return {
    totals: {
      pieces: dec(pieces),
      footage: dec(footage),
      rowCount: rows.length,
      footageRowCount: rows.filter((r) => r.footage !== null).length,
      missingLengthCount: rows.filter((r) => r.lengthFt === null).length,
      negativeCount: rows.filter((r) => r.negative).length,
      staleCount: rows.filter((r) => r.stale).length,
    },
    byColour: [...byColour.entries()].map(([key, value]) => ({
      key,
      label: key,
      pieces: dec(value.pieces),
      footage: dec(value.footage),
      rowCount: value.count,
    })),
    byLength: [...byLength.entries()].map(([key, value]) => ({
      key,
      label: key === 'none' ? 'no length stated' : `${key} ft`,
      pieces: dec(value.pieces),
      footage: dec(value.footage),
      rowCount: value.count,
    })),
    matrix: [...matrix.values()].map((cell) => ({
      colour: cell.colour,
      lengthFt: cell.lengthFt,
      pieces: dec(cell.pieces),
      footage: dec(cell.footage),
      rowCount: cell.count,
    })),
  };
};

export const gap = (label: string, sheet: string, reason: string, description: string): ServerStockGap => ({
  available: false,
  sourceSheet: sheet,
  sourceLabel: label,
  reason,
  description,
  categories: [],
  batchId: state.batch.id,
  appliedAt: state.batch.appliedAt,
});

export const stockImportDetail = (batchId: string): ServerStockImportDetail => ({
  batch: state.batches.find((b) => b.id === batchId) ?? state.batch,
  quarantine: state.quarantine,
  reconciliations: demoPreview.reconciliations,
  warnings: demoPreview.validation.warnings,
});

export const importedStock = (): ServerImportedStock => ({
  ...demoImportedStock,
  snapshot: state.batch,
  items: state.stockItems,
  returnedItemCount: state.stockItems.length,
  quarantineCount: state.quarantine.length,
});

export const stockSummary = () => ({
  ...demoStockSummary,
  snapshot: { ...demoStockSummary.snapshot, batchId: state.batch.id, appliedAt: state.batch.appliedAt },
});

export const watchState = (): typeof demoStockWatch => ({
  ...demoStockWatch,
  latestBatchId: state.batch.id,
  matchesLatestBatch: state.batch.fileSha256 === demoStockWatch.fileSha256,
  matchesAuthorizedRevision: state.batch.authorizedSha256 === demoStockWatch.fileSha256,
});

/** What the preview says about a file: the same plan every time, judged against the revision the
 *  store currently accepts. */
export const stockPreviewFor = (fileName: string, fileSha256: string): typeof demoPreview => ({
  ...demoPreview,
  provenance: { ...demoPreview.provenance, filename: fileName, fileSha256 },
  authorizedFileSha256: state.batch.authorizedSha256,
  authorizedFileMatch: fileSha256 === state.batch.authorizedSha256,
  readyToApply: fileSha256 === state.batch.authorizedSha256 && demoPreview.applyPlanErrors.length === 0,
  applyBlockedReason: fileSha256 === state.batch.authorizedSha256 ? null : 'file_not_authorized',
});

export const debtorPreviewFor = (fileName: string, fileSha256: string): ServerDebtorPreview => ({
  ...demoDebtorPreview,
  filename: fileName,
  fileSha256,
});

export const provisionalPreviewFor = (fileName: string, fileSha256: string): ServerProvisionalPreview => {
  const counts = {
    new: demoProvisionalRows.filter((r) => r.state === 'new').length,
    changed: demoProvisionalRows.filter((r) => r.state === 'changed').length,
    unchanged: demoProvisionalRows.filter((r) => r.state === 'unchanged').length,
    missing: demoProvisionalRows.filter((r) => r.state === 'missing').length,
    blocked: demoProvisionalRows.filter((r) => r.state === 'blocked').length,
    conflict: demoProvisionalRows.filter((r) => r.state === 'conflict').length,
  };
  return {
    filename: fileName,
    fileSha256,
    sizeBytes: 19_200,
    sheetName: 'Parties',
    sheetNames: ['Parties', 'Notes'],
    label: PROVISIONAL_LABEL,
    identityState: PROVISIONAL_IDENTITY_STATE,
    headerRowNumber: 1,
    partyColumnLabel: 'Party',
    debitColumnLabel: 'Debit',
    creditColumnLabel: 'Credit',
    ledgerIdColumnLabel: null,
    asOf: PROVISIONAL_AS_OF,
    asOfVerified: false,
    asOfSource: 'owner-selected',
    dateWarning: 'The cut-over date is the owner’s provisional date: the sheet states none.',
    periodText: PROVISIONAL_SOURCE_PERIOD,
    partyRowCount: demoProvisionalRows.filter((r) => r.sourceRow !== null).length,
    storedCount: state.provisional.filter((d) => !d.archived).length,
    newCount: counts.new,
    changedCount: counts.changed,
    unchangedCount: counts.unchanged,
    missingCount: counts.missing,
    blockedRowCount: counts.blocked,
    conflictCount: counts.conflict,
    archivedCount: state.provisional.filter((d) => d.archived).length,
    rowsListed: demoProvisionalRows.length,
    rowsTruncated: false,
    rows: demoProvisionalRows,
    warnings: [{ code: 'as_of_unverified', message: 'No date on the sheet, so the store keeps the build date.', rowNumber: null }],
    blockers: [],
    syncAvailable: true,
    syncPreviewDigest: DEMO_PREVIEW_DIGEST,
    syncBlockedReason: '',
    businessRecordsCreated: false,
    databaseRowsWritten: false,
    verifiedDebtorRowsTouched: false,
    disclaimer: 'A preview compares the sheet with the store and writes nothing.',
  };
};

export const provisionalSummary = (): ServerProvisionalSummary => {
  const live = state.provisional.filter((d) => !d.archived);
  const groups = new Map<string | null, ServerProvisionalSummary['salespeople'][number]>();
  for (const row of live) {
    const key = row.assignedEmployeeId;
    const group = groups.get(key) ?? {
      employeeId: key,
      employeeName: row.assignedEmployeeName ?? 'Unassigned',
      employeeActive: row.assignedEmployeeActive,
      recordCount: 0,
      debitPaise: 0,
      creditPaise: 0,
      reviewedCount: 0,
      unreviewedCount: 0,
      conflictCount: 0,
    };
    group.recordCount += 1;
    group.debitPaise += row.debitPaise;
    group.creditPaise += row.creditPaise;
    group.reviewedCount += row.reviewed ? 1 : 0;
    group.unreviewedCount += row.reviewed ? 0 : 1;
    group.conflictCount += row.hasConflict ? 1 : 0;
    groups.set(key, group);
  }
  return {
    label: PROVISIONAL_LABEL,
    identityState: PROVISIONAL_IDENTITY_STATE,
    asOf: PROVISIONAL_AS_OF,
    dateWarning: 'The cut-over date is the owner’s provisional date: the sheet states none.',
    recordCount: live.length,
    debitPaise: live.reduce((sum, r) => sum + r.debitPaise, 0),
    creditPaise: live.reduce((sum, r) => sum + r.creditPaise, 0),
    reviewedCount: live.filter((r) => r.reviewed).length,
    unreviewedCount: live.filter((r) => !r.reviewed).length,
    conflictCount: live.filter((r) => r.hasConflict).length,
    archivedCount: state.provisional.filter((r) => r.archived).length,
    unassignedCount: live.filter((r) => r.assignedEmployeeId === null).length,
    salespeople: [...groups.values()],
  };
};

export const provisionalRuns = (): ServerProvisionalRun[] => [
  {
    id: 'PDS-DEMO-0002',
    fileName: 'demo-provisional-march.xlsx',
    fileSha256: DEMO_OTHER_SHA,
    asOf: PROVISIONAL_AS_OF,
    partyRowCount: 4,
    newCount: 1,
    changedCount: 0,
    unchangedCount: 2,
    missingCount: 1,
    conflictCount: 1,
    archivedCount: 0,
    syncedAt: '2026-03-30T17:20:00+05:30',
    syncedByName: 'Demo Owner',
  },
  {
    id: 'PDS-DEMO-0001',
    fileName: 'demo-provisional-feb.xlsx',
    fileSha256: DEMO_FILE_SHA,
    asOf: PROVISIONAL_AS_OF,
    partyRowCount: 3,
    newCount: 3,
    changedCount: 0,
    unchangedCount: 0,
    missingCount: 0,
    conflictCount: 0,
    archivedCount: 0,
    syncedAt: '2026-03-02T11:00:00+05:30',
    syncedByName: 'Demo Owner',
  },
];

export const provisionalHistory = (sourceRef: string): ServerProvisionalHistory => ({
  sourceRef,
  edits: state.audit
    .filter((a) => a.recordId === sourceRef)
    .map((a) => ({
      id: a.id,
      at: a.at,
      action: a.action,
      actorName: a.actorName,
      detail: a.detail,
      changes: a.changes,
    })),
  sourceChanges: [
    {
      syncId: 'PDS-DEMO-0002',
      syncedAt: '2026-03-30T17:20:00+05:30',
      fileName: 'demo-provisional-march.xlsx',
      fileSha256: DEMO_OTHER_SHA,
      changeKind: 'changed',
      previousPartyName: 'Conflicting Sample Works',
      previousDebitPaise: 88000000,
      previousCreditPaise: 0,
      incomingPartyName: 'Conflicting Sample Works',
      incomingDebitPaise: 95000000,
      incomingCreditPaise: 0,
    },
  ],
});

export const debtorApplyResult = (
  fileName: string,
  fileSha256: string,
  replayed: boolean,
): ServerDebtorApply => ({
  filename: fileName,
  fileSha256,
  sheetName: demoDebtorPreview.sheetName,
  asOf: DEMO_AS_OF,
  source: 'sheet',
  snapshotRowCount: demoDebtorPreviewRows.length,
  createdRowCount: replayed ? 0 : demoDebtorPreviewRows.length,
  unchangedRowCount: replayed ? demoDebtorPreviewRows.length : 0,
  replacedRowCount: 0,
  replayed,
  databaseRowsWritten: true,
  businessRecordsCreated: false,
  disclaimer: 'The snapshot is a balance figure per party. It creates no invoice and no ledger row.',
});

// ── writes ───────────────────────────────────────────────────────────────

let sequence = 5000;
export const nextId = (prefix: string) => `${prefix}-DEMO-${++sequence}`;

export const touch = (recordType: string, recordId: string, action: string, detail: string, actor: ServerUser, changes: Record<string, unknown> | null = null) => {
  state.audit.unshift({
    id: nextId('AUD'),
    at: new Date().toISOString(),
    action,
    actorKind: 'user',
    actorUserId: actor.id,
    actorName: actor.name,
    recordType,
    recordId,
    detail,
    changes,
  });
};

export const orderById = (id: string) => state.orderDetails.find((o) => o.id === id);
export const dispatchById = (id: string) => state.dispatchDetails.find((d) => d.id === id);

export const recomputeOrder = (orderId: string) => {
  const order = state.orderDetails.find((o) => o.id === orderId);
  if (!order) return;
  const went = state.dispatchDetails
    .filter((d) => d.orderId === orderId && d.voidedAt === null)
    .flatMap((d) => d.lines);
  for (const line of order.lines) {
    const quantity = went
      .filter((w) => w.orderLineId === line.orderLineId)
      .reduce((sum, w) => sum + num(w.quantity), 0);
    line.dispatchedQuantity = dec(quantity);
    line.dispatchLines = went.filter((w) => w.orderLineId === line.orderLineId).length;
    line.remainingQuantity = dec(num(line.orderedQuantity) - quantity);
  }
  order.dispatchedQuantity = dec(went.reduce((sum, w) => sum + num(w.quantity), 0));
  order.dispatchCount = new Set(
    state.dispatchDetails.filter((d) => d.orderId === orderId && d.voidedAt === null).map((d) => d.id),
  ).size;
  order.lastDispatchDate = order.dispatchCount > 0 ? DEMO_TODAY : null;
  order.valuePaise = order.lines.reduce((sum, l) => sum + l.valuePaise, 0);
  order.orderBalancePaise = (order.isBilled ? order.billedPaise : 0) - order.paidPaise;
  const total = num(order.dispatchedQuantity);
  const ordered = num(order.orderedQuantity);
  order.dispatchStatus = total === 0 ? 'pending' : total < ordered ? 'partial' : 'dispatched';
};
