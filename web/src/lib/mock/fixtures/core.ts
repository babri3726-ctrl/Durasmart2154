/** The people, parties and goods the demo store starts with.
 *
 *  Every name, number, phone and address here is invented. Nothing is drawn from a real
 *  customer book, and the identifiers carry `DEMO` so a row cannot be mistaken for a live one.
 *  Figures are shaped the way the backend shapes them: money in integer paise, quantities as
 *  decimal strings, dates as `YYYY-MM-DD`, timestamps as ISO with the +05:30 offset the server
 *  writes.
 */

import type {
  OpeningBalanceEntry,
  ServerAuditEntry,
  ServerDispatch,
  ServerDispatchDetail,
  ServerEmployee,
  ServerOrder,
  ServerOrderDetail,
  ServerOrderLine,
  ServerPayment,
  ServerProduct,
  ServerStockBalance,
  ServerStockMovement,
  ServerTarget,
  ServerUser,
} from '../../serverApi';

/** Fixed so a preview digest never changes between reloads. */
export const DEMO_NOW = '2026-03-31T09:00:00+05:30';
export const DEMO_TODAY = '2026-03-31';
export const DEMO_PERIOD_START = '2026-03-01';
export const DEMO_PERIOD_END = '2026-03-31';

const rs = (paise: number) => paise;

export const demoUsers: Record<string, ServerUser> = {
  owner: {
    id: 'USR-OWNER-ISHU',
    name: 'Ishu Jindal',
    email: 'ishu.jindal@durasmart.com',
    role: 'owner',
    department: 'Management',
    employeeId: 'OWNER-01',
    phone: '+91 98140 10001',
  },
  employee: {
    id: 'USR-EMP-SP-01',
    name: 'AJAY JI',
    email: 'ajay.ji@durasmart.com',
    role: 'employee',
    department: 'Sales',
    employeeId: 'EMP-SP-01',
    phone: '9814010000',
  },
};

/** Credentials the mock accepts, keyed `identifier|password`. */
export const demoCredentials: Record<string, keyof typeof demoUsers> = {
  'ishu.jindal@durasmart.com|Ishu@DuraSmart#2026': 'owner',
  'ishujindal|Ishu@DuraSmart#2026': 'owner',
  'owner|Ishu@DuraSmart#2026': 'owner',
  'ajay.ji@durasmart.com|DuraSmart@2026': 'employee',
  'EMP-SP-01|DuraSmart@2026': 'employee',
  'ajay|DuraSmart@2026': 'employee',
};

/** Authorised login guidance for staff. */
export const demoLoginHints: { identifier: string; password: string; reaches: string }[] = [
  { identifier: 'ishujindal', password: 'Ishu@DuraSmart#2026', reaches: 'Owner — Ishu Jindal (Full Executive Control)' },
  { identifier: 'EMP-SP-01', password: 'DuraSmart@2026', reaches: 'Sales Officer — AJAY JI (Field Sales & Bookings)' },
];

const employeeSeed: [string, string, string, string, string, string, boolean][] = [
  ['EMP-DEMO-101', 'Asha Rao', 'Salesperson', 'Sales', '1500.000', 'kg', true],
  ['EMP-DEMO-102', 'Vikram Nair', 'Salesperson', 'Sales', '900.000', 'kg', true],
  ['EMP-DEMO-103', 'Farid Shaikh', 'Salesperson', 'Trade', '400.000', 'Nos', true],
  ['EMP-DEMO-104', 'Meera Joshi', 'Warehouse', 'Dispatch', '0.000', 'kg', true],
  ['EMP-DEMO-105', 'Sunil Prabhu', 'Salesperson', 'Sales', '600.000', 'kg', false],
];

export const demoEmployees: ServerEmployee[] = employeeSeed.map(
  ([id, name, role, department, monthlyTargetQty, targetUnit, active], index) => ({
    id,
    name,
    role,
    department,
    phone: `00000000${10 + index}`,
    city: ['Pune', 'Nashik', 'Pune', 'Pune', 'Kolhapur'][index],
    monthlyTargetQty,
    targetUnit,
    active,
    mayDispatch: id === 'EMP-DEMO-104' || id === 'EMP-DEMO-101',
  }),
);

const productSeed: [string, string, string, string, string, string, string][] = [
  ['PRD-DEMO-COIL-01', 'MS Coil 2.00mm x 300mm', 'steel-coil', '2.00mm x 300mm', '2.00', 'kg', '1200.000'],
  ['PRD-DEMO-COIL-02', 'MS Coil 1.20mm x 600mm', 'steel-coil', '1.20mm x 600mm', '1.20', 'kg', '800.000'],
  ['PRD-DEMO-SLIT-01', 'Slit Strip 1.50mm x 100mm', 'steel-coil', '1.50mm x 100mm', '1.50', 'kg', '500.000'],
  ['PRD-DEMO-PROF-01', 'MS Angle 40x40x5', 'profile-kanda', '40x40x5 mm', '5.00', 'kg', '300.000'],
  ['PRD-DEMO-PROF-02', 'MS Channel 50x30', 'profile-kanda', '50x30 mm', '3.00', 'kg', '250.000'],
  ['PRD-DEMO-KAND-01', 'Kanda Boot 0.55mm', 'profile-kanda', '0.55mm', '0.55', 'Nos', '1000.000'],
  ['PRD-DEMO-GP-01', 'GP Sheet 0.60mm Grey', 'gp-sheet', '0.60mm', '0.60', 'kg', '400.000'],
  ['PRD-DEMO-UPVC-01', 'UPVC Pipe 3in x 10ft', 'upvc-new', '3 inch', '3.00', 'Nos', '120.000'],
  ['PRD-DEMO-UPVC-02', 'UPVC Elbow 2in', 'upvc-new', '2 inch', '2.00', 'Nos', '400.000'],
];

export const demoProducts: ServerProduct[] = productSeed.map(
  ([id, name, category, spec, thickness, unit, minStockQty], index) => ({
    id,
    name,
    sku: `DEMO-${String(1001 + index)}`,
    category,
    spec,
    thickness,
    unit,
    minStockQty,
    gstRatePercent: category === 'upvc-new' ? '18.000' : '18.000',
    active: index !== 8,
    source: 'manual',
  }),
);

const partySeed: [string, string, string, string, string, number, string][] = [
  ['CUST-DEMO-001', 'Demo Traders', 'Pune', 'Pune', 'Maharashtra', 30, 'EMP-DEMO-101'],
  ['CUST-DEMO-002', 'Sample Steel Works', 'Nashik', 'Nashik', 'Maharashtra', 15, 'EMP-DEMO-102'],
  ['CUST-DEMO-003', 'Test Retail Hub', 'Pune', 'Pune', 'Maharashtra', 0, 'EMP-DEMO-101'],
  ['CUST-DEMO-004', 'Practice Fabricators', 'Solapur', 'Solapur', 'Maharashtra', 45, 'EMP-DEMO-103'],
  ['CUST-DEMO-005', 'Model Pipe Suppliers', 'Nanded', 'Nanded', 'Maharashtra', 30, 'EMP-DEMO-103'],
  ['CUST-DEMO-006', 'Example Coil Traders', 'Kolhapur', 'Kolhapur', 'Maharashtra', 20, 'EMP-DEMO-102'],
  ['CUST-DEMO-007', 'Trial Buildcon', 'Pune', 'Pune', 'Maharashtra', 60, 'EMP-DEMO-101'],
  ['CUST-DEMO-008', 'Specimen Metals', 'Aurangabad', 'Chhatra Sambhiji Nagar', 'Maharashtra', 30, 'EMP-DEMO-102'],
  ['CUST-DEMO-009', 'Sample Hardware House', 'Sangli', 'Sangli', 'Maharashtra', 0, 'EMP-DEMO-103'],
  ['CUST-DEMO-010', 'Prototype Polymers', 'Pune', 'Pune', 'Maharashtra', 15, 'EMP-DEMO-101'],
] as unknown as [string, string, string, string, string, number, string][];

/** Outstanding figures are the store's own; these seeds are the opening position each row starts
 *  from, so a screen never shows a balance that no order produced. */
export const demoCustomerSeeds = partySeed.map(
  ([id, name, city, district, state, creditDays, salespersonId], index) => ({
    id,
    name,
    city,
    district,
    state,
    salespersonId,
    creditDays,
    mobile: `98000${String(10000 + index)}`,
    contactPerson: `${name.split(' ')[0]} Contact`,
    openingPaise: rs(index % 3 === 0 ? 250000000 : 0),
    status: index === 7 ? 'pending' : 'approved',
  }),
);

export const demoOpeningBalances: Record<string, OpeningBalanceEntry[]> = {
  'CUST-DEMO-001': [
    {
      id: 1,
      customerId: 'CUST-DEMO-001',
      asOf: '2026-04-01',
      amountPaise: 250000000,
      direction: 'owes',
      source: 'panel',
      createdAt: DEMO_NOW,
    },
  ],
};

export const demoAudit: ServerAuditEntry[] = [
  {
    id: 'AUD-DEMO-0001',
    at: DEMO_NOW,
    action: 'opening_balance.created',
    actorKind: 'user',
    actorUserId: 'USR-DEMO-OWNER',
    actorName: 'Demo Owner',
    recordType: 'opening_balance',
    recordId: '1',
    detail: 'Opening balance recorded against the sample party.',
    changes: { amountPaise: 250000000, direction: 'owes' },
  },
  {
    id: 'AUD-DEMO-0002',
    at: '2026-03-30T16:42:10+05:30',
    action: 'stock_import.applied',
    actorKind: 'user',
    actorUserId: 'USR-DEMO-OWNER',
    actorName: 'Demo Owner',
    recordType: 'stock_import_batch',
    recordId: 'SIM-DEMO-0001',
    detail: 'Workbook applied from the panel.',
    changes: { applied: 6, quarantined: 1 },
  },
];

// ── orders, dispatches and receipts ──────────────────────────────────────

interface LineSpec {
  productId: string;
  productName: string;
  unit: string;
  ordered: string;
  dispatched: string;
  ratePaise: number;
}

/** One order line, shared by the seeded orders and by the orders the panel creates at runtime, so
 *  a new row is money-shaped the same way as the demo book it joins. */
export const orderLine = (
  productId: string | null,
  productName: string,
  unit: string,
  ordered: string,
  dispatched: string,
  ratePaise: number,
  lineNo: number,
  orderLineId: number,
  gstRatePercent: string | null = '18.000',
): ServerOrderLine => {
  const qty = Number(ordered);
  const went = Number(dispatched);
  return {
    orderLineId,
    lineNo,
    productId,
    productName,
    unit,
    orderedQuantity: ordered,
    ratePaise,
    gstRatePercent,
    dispatchedQuantity: dispatched,
    dispatchLines: went > 0 ? 1 : 0,
    remainingQuantity: (qty - went).toFixed(3),
    valuePaise: Math.round((qty * ratePaise) / 1000),
  };
};

const orderSeed: {
  id: string;
  number: string | null;
  customerId: string;
  status: string;
  dispatchStatus: string;
  orderDate: string;
  dueDate: string | null;
  expected: string | null;
  lines: LineSpec[];
  billed: boolean;
  paidPaise: number;
  salespersonId: string;
}[] = [
  {
    id: 'ORD-DEMO-0001',
    number: 'ORD-1001',
    customerId: 'CUST-DEMO-001',
    status: 'confirmed',
    dispatchStatus: 'partial',
    orderDate: '2026-03-04',
    dueDate: '2026-04-03',
    expected: '2026-03-20',
    salespersonId: 'EMP-DEMO-101',
    billed: true,
    paidPaise: 150000000,
    lines: [
      { productId: 'PRD-DEMO-COIL-01', productName: 'MS Coil 2.00mm x 300mm', unit: 'kg', ordered: '1200.000', dispatched: '800.000', ratePaise: 620000 },
      { productId: 'PRD-DEMO-SLIT-01', productName: 'Slit Strip 1.50mm x 100mm', unit: 'kg', ordered: '400.000', dispatched: '0.000', ratePaise: 645000 },
    ],
  },
  {
    id: 'ORD-DEMO-0002',
    number: 'ORD-1002',
    customerId: 'CUST-DEMO-002',
    status: 'dispatched',
    dispatchStatus: 'dispatched',
    orderDate: '2026-03-06',
    dueDate: '2026-04-05',
    expected: '2026-03-18',
    salespersonId: 'EMP-DEMO-102',
    billed: true,
    paidPaise: 0,
    lines: [
      { productId: 'PRD-DEMO-PROF-01', productName: 'MS Angle 40x40x5', unit: 'kg', ordered: '600.000', dispatched: '600.000', ratePaise: 610000 },
    ],
  },
  {
    id: 'ORD-DEMO-0003',
    number: 'ORD-1003',
    customerId: 'CUST-DEMO-005',
    status: 'pendingDispatch',
    dispatchStatus: 'pending',
    orderDate: '2026-03-11',
    dueDate: '2026-04-10',
    expected: '2026-03-25',
    salespersonId: 'EMP-DEMO-103',
    billed: false,
    paidPaise: 0,
    lines: [
      { productId: 'PRD-DEMO-UPVC-01', productName: 'UPVC Pipe 3in x 10ft', unit: 'Nos', ordered: '150.000', dispatched: '0.000', ratePaise: 210000 },
      { productId: 'PRD-DEMO-UPVC-02', productName: 'UPVC Elbow 2in', unit: 'Nos', ordered: '300.000', dispatched: '0.000', ratePaise: 45000 },
    ],
  },
  {
    id: 'ORD-DEMO-0004',
    number: 'ORD-1004',
    customerId: 'CUST-DEMO-004',
    status: 'completed',
    dispatchStatus: 'dispatched',
    orderDate: '2026-02-14',
    dueDate: '2026-03-16',
    expected: '2026-03-01',
    salespersonId: 'EMP-DEMO-101',
    billed: true,
    paidPaise: 92000000,
    lines: [
      { productId: 'PRD-DEMO-PROF-02', productName: 'MS Channel 50x30', unit: 'kg', ordered: '250.000', dispatched: '250.000', ratePaise: 590000 },
    ],
  },
  {
    id: 'ORD-DEMO-0005',
    number: null,
    customerId: 'CUST-DEMO-007',
    status: 'draft',
    dispatchStatus: 'pending',
    orderDate: '2026-03-28',
    dueDate: null,
    expected: null,
    salespersonId: 'EMP-DEMO-101',
    billed: false,
    paidPaise: 0,
    lines: [
      { productId: 'PRD-DEMO-COIL-02', productName: 'MS Coil 1.20mm x 600mm', unit: 'kg', ordered: '900.000', dispatched: '0.000', ratePaise: 660000 },
    ],
  },
  {
    id: 'ORD-DEMO-0006',
    number: 'ORD-1006',
    customerId: 'CUST-DEMO-006',
    status: 'confirmed',
    dispatchStatus: 'pending',
    orderDate: '2026-03-19',
    dueDate: '2026-03-22',
    expected: '2026-03-21',
    salespersonId: 'EMP-DEMO-102',
    billed: false,
    paidPaise: 0,
    lines: [
      { productId: 'PRD-DEMO-GP-01', productName: 'GP Sheet 0.60mm Grey', unit: 'kg', ordered: '340.000', dispatched: '0.000', ratePaise: 720000 },
    ],
  },
  {
    id: 'ORD-DEMO-0007',
    number: 'ORD-1007',
    customerId: 'CUST-DEMO-003',
    status: 'cancelled',
    dispatchStatus: 'pending',
    orderDate: '2026-03-02',
    dueDate: null,
    expected: null,
    salespersonId: 'EMP-DEMO-103',
    billed: false,
    paidPaise: 0,
    lines: [
      { productId: 'PRD-DEMO-KAND-01', productName: 'Kanda Boot 0.55mm', unit: 'Nos', ordered: '80.000', dispatched: '0.000', ratePaise: 32000 },
    ],
  },
  {
    id: 'ORD-DEMO-0008',
    number: 'ORD-1008',
    customerId: 'CUST-DEMO-010',
    status: 'confirmed',
    dispatchStatus: 'partial',
    orderDate: '2026-03-24',
    dueDate: '2026-04-23',
    expected: '2026-04-02',
    salespersonId: 'EMP-DEMO-101',
    billed: true,
    paidPaise: 40000000,
    lines: [
      { productId: 'PRD-DEMO-UPVC-01', productName: 'UPVC Pipe 3in x 10ft', unit: 'Nos', ordered: '60.000', dispatched: '20.000', ratePaise: 210000 },
    ],
  },
];

const customerName = (id: string) =>
  demoCustomerSeeds.find((c) => c.id === id)?.name ?? 'Unknown party';

export const demoOrderDetails: ServerOrderDetail[] = orderSeed.map((seed, orderIndex) => {
  const lines = seed.lines.map((l, i) =>
    orderLine(l.productId, l.productName, l.unit, l.ordered, l.dispatched, l.ratePaise, i + 1, orderIndex * 10 + i + 1),
  );
  const orderedQuantity = lines
    .reduce((sum, l) => sum + Number(l.orderedQuantity), 0)
    .toFixed(3);
  const dispatchedQuantity = lines
    .reduce((sum, l) => sum + Number(l.dispatchedQuantity), 0)
    .toFixed(3);
  const valuePaise = lines.reduce((sum, l) => sum + l.valuePaise, 0);
  const invoiceCount = seed.billed ? 1 : 0;
  const billedPaise = seed.billed ? valuePaise : 0;
  return {
    ...seed,
    id: seed.id,
    number: seed.number,
    customerName: customerName(seed.customerId),
    lineCount: lines.length,
    orderedQuantity,
    dispatchedQuantity,
    valuePaise,
    invoiceCount,
    billedPaise,
    paymentCount: seed.paidPaise > 0 ? 1 : 0,
    paidPaise: seed.paidPaise,
    orderBalancePaise: billedPaise - seed.paidPaise,
    isBilled: seed.billed,
    expectedDispatchDate: seed.expected,
    dispatchCount: Number(dispatchedQuantity) > 0 ? 1 : 0,
    lastDispatchDate: Number(dispatchedQuantity) > 0 ? '2026-03-15' : null,
    version: 1,
    source: 'panel',
    cancelledAt: seed.status === 'cancelled' ? '2026-03-05T11:00:00+05:30' : null,
    paymentTerms: 'Credit 30 days',
    notes: orderIndex === 0 ? 'Deliver in two consignments.' : '',
    lines,
  } as ServerOrderDetail;
});

export const demoOrderBriefs: ServerOrder[] = demoOrderDetails.map(({ lines: _lines, paymentTerms: _pt, notes: _n, ...brief }) => brief);

const dispatchSeed = [
  { id: 'DSP-DEMO-0001', number: 'DSP-2001', orderId: 'ORD-DEMO-0001', date: '2026-03-15', vehicle: 'MH12DEMO01', driver: 'Demo Driver', deliveryStatus: 'delivered' },
  { id: 'DSP-DEMO-0002', number: 'DSP-2002', orderId: 'ORD-DEMO-0002', date: '2026-03-12', vehicle: 'MH15DEMO02', driver: 'Sample Driver', deliveryStatus: 'delivered' },
  { id: 'DSP-DEMO-0003', number: 'DSP-2003', orderId: 'ORD-DEMO-0004', date: '2026-03-02', vehicle: 'MH12DEMO03', driver: 'Practice Driver', deliveryStatus: 'delivered' },
  { id: 'DSP-DEMO-0004', number: 'DSP-2004', orderId: 'ORD-DEMO-0008', date: '2026-03-27', vehicle: 'MH14DEMO04', driver: 'Test Driver', deliveryStatus: 'inTransit' },
];

export const demoDispatchDetails: ServerDispatchDetail[] = dispatchSeed.map((seed, index) => {
  const order = demoOrderDetails.find((o) => o.id === seed.orderId)!;
  const orderLine = order.lines[0];
  return {
    id: seed.id,
    number: seed.number,
    orderId: seed.orderId,
    orderNumber: order.number,
    customerId: order.customerId,
    customerName: order.customerName,
    dispatchDate: seed.date,
    vehicle: seed.vehicle,
    driver: seed.driver,
    driverPhone: '9898989898',
    transportName: 'Demo Logistics',
    notes: index === 0 ? 'E-way copy with the driver.' : '',
    deliveryStatus: seed.deliveryStatus,
    deliveredAt: seed.deliveryStatus === 'delivered' ? `${seed.date}T18:30:00+05:30` : null,
    version: 1,
    source: 'panel',
    sourceRef: null,
    createdAt: `${seed.date}T10:05:00+05:30`,
    createdBy: 'USR-DEMO-OWNER',
    createdByName: 'Demo Owner',
    voidedAt: null,
    voidedBy: null,
    voidedByName: null,
    reviewedAt: index === 0 ? `${seed.date}T19:00:00+05:30` : null,
    reviewedBy: index === 0 ? 'USR-DEMO-OWNER' : null,
    reviewedByName: index === 0 ? 'Demo Owner' : null,
    lineCount: 1,
    lines: [
      {
        dispatchLineId: 100 + index,
        orderLineId: orderLine.orderLineId,
        lineNo: orderLine.lineNo,
        productId: orderLine.productId,
        productName: orderLine.productName,
        quantity: orderLine.dispatchedQuantity,
        unit: orderLine.unit,
        batchNo: `B-DEMO-${10 + index}`,
        warehouse: 'Main',
      },
    ],
  };
});

export const demoDispatchBriefs: ServerDispatch[] = demoDispatchDetails.map(({ lines: _lines, ...brief }) => brief);

export const demoPayments: ServerPayment[] = [
  {
    id: 'PAY-DEMO-0001',
    customerId: 'CUST-DEMO-001',
    customerName: customerName('CUST-DEMO-001'),
    orderId: 'ORD-DEMO-0001',
    orderNumber: 'ORD-1001',
    invoiceNumber: 'INV-3001',
    invoiceAmountPaise: 768000000,
    amountPaise: 150000000,
    paymentDate: '2026-03-18',
    method: 'NEFT',
    reference: 'DEMO-NEFT-0001',
    notes: '',
    allowAdvance: false,
    duplicateSuspected: false,
    duplicateOfId: null,
    voidedAt: null,
    source: 'panel',
    sourceRef: null,
    createdAt: '2026-03-18T12:00:00+05:30',
  },
  {
    id: 'PAY-DEMO-0002',
    customerId: 'CUST-DEMO-004',
    customerName: customerName('CUST-DEMO-004'),
    orderId: 'ORD-DEMO-0004',
    orderNumber: 'ORD-1004',
    invoiceNumber: 'INV-3002',
    invoiceAmountPaise: 147500000,
    amountPaise: 92000000,
    paymentDate: '2026-03-09',
    method: 'Cash',
    reference: '',
    notes: 'Part payment against the sample invoice.',
    allowAdvance: false,
    duplicateSuspected: false,
    duplicateOfId: null,
    voidedAt: null,
    source: 'panel',
    sourceRef: null,
    createdAt: '2026-03-09T17:10:00+05:30',
  },
  {
    id: 'PAY-DEMO-0003',
    customerId: 'CUST-DEMO-010',
    customerName: customerName('CUST-DEMO-010'),
    orderId: 'ORD-DEMO-0008',
    orderNumber: 'ORD-1008',
    invoiceNumber: 'INV-3003',
    invoiceAmountPaise: 12600000,
    amountPaise: 40000000,
    paymentDate: '2026-03-28',
    method: 'UPI',
    reference: 'DEMO-UPI-0003',
    notes: 'Advance held on the account.',
    allowAdvance: true,
    duplicateSuspected: false,
    duplicateOfId: null,
    voidedAt: null,
    source: 'panel',
    sourceRef: null,
    createdAt: '2026-03-28T09:40:00+05:30',
  },
  {
    id: 'PAY-DEMO-0004',
    customerId: 'CUST-DEMO-002',
    customerName: customerName('CUST-DEMO-002'),
    orderId: null,
    orderNumber: null,
    invoiceNumber: 'INV-3004',
    invoiceAmountPaise: 366000000,
    amountPaise: 0,
    paymentDate: '2026-03-29',
    method: 'Cheque',
    reference: 'DEMO-CHQ-0004',
    notes: 'Voided receipt, kept in the list on purpose.',
    allowAdvance: false,
    duplicateSuspected: true,
    duplicateOfId: 'PAY-DEMO-0001',
    voidedAt: '2026-03-30T08:00:00+05:30',
    source: 'panel',
    sourceRef: null,
    createdAt: '2026-03-29T15:00:00+05:30',
  },
];

export const demoTargets: ServerTarget[] = [
  {
    id: 'TGT-DEMO-0001',
    employeeId: 'EMP-DEMO-101',
    employeeName: 'Asha Rao',
    periodStart: DEMO_PERIOD_START,
    periodEnd: DEMO_PERIOD_END,
    productCategory: 'steel-coil',
    quantity: '1500.000',
    unit: 'kg',
    setBy: 'Demo Owner',
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
  },
  {
    id: 'TGT-DEMO-0002',
    employeeId: 'EMP-DEMO-103',
    employeeName: 'Farid Shaikh',
    periodStart: DEMO_PERIOD_START,
    periodEnd: DEMO_PERIOD_END,
    productCategory: null,
    quantity: '400.000',
    unit: 'Nos',
    setBy: 'Demo Owner',
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
  },
];

/** Stock balances the movement ledger below actually adds up to. Kept by hand rather than
 *  derived so a screen can show a low-stock and a mismatched-unit row without a fake engine. */
export const demoStockBalances: ServerStockBalance[] = [
  {
    productId: 'PRD-DEMO-COIL-01',
    sku: 'DEMO-1001',
    productName: 'MS Coil 2.00mm x 300mm',
    category: 'steel-coil',
    spec: '2.00mm x 300mm',
    thickness: '2.00',
    unit: 'kg',
    gstRatePercent: '18.000',
    active: true,
    minStockQty: '1200.000',
    movementCount: 3,
    onHandQuantity: '1450.000',
    reservedQuantity: '400.000',
    mismatchedUnitMovements: 1,
    mismatchedUnitQuantity: '25.000',
    lastMovementDate: '2026-03-27',
    availableQuantity: '1050.000',
    isLowStock: false,
  },
  {
    productId: 'PRD-DEMO-COIL-02',
    sku: 'DEMO-1002',
    productName: 'MS Coil 1.20mm x 600mm',
    category: 'steel-coil',
    spec: '1.20mm x 600mm',
    thickness: '1.20',
    unit: 'kg',
    gstRatePercent: '18.000',
    active: true,
    minStockQty: '800.000',
    movementCount: 2,
    onHandQuantity: '610.000',
    reservedQuantity: '900.000',
    mismatchedUnitMovements: 0,
    mismatchedUnitQuantity: '0.000',
    lastMovementDate: '2026-03-21',
    availableQuantity: '-290.000',
    isLowStock: true,
  },
  {
    productId: 'PRD-DEMO-PROF-01',
    sku: 'DEMO-1004',
    productName: 'MS Angle 40x40x5',
    category: 'profile-kanda',
    spec: '40x40x5 mm',
    thickness: '5.00',
    unit: 'kg',
    gstRatePercent: '18.000',
    active: true,
    minStockQty: '300.000',
    movementCount: 2,
    onHandQuantity: '980.000',
    reservedQuantity: '0.000',
    mismatchedUnitMovements: 0,
    mismatchedUnitQuantity: '0.000',
    lastMovementDate: '2026-03-12',
    availableQuantity: '980.000',
    isLowStock: false,
  },
  {
    productId: 'PRD-DEMO-UPVC-01',
    sku: 'DEMO-1008',
    productName: 'UPVC Pipe 3in x 10ft',
    category: 'upvc-new',
    spec: '3 inch',
    thickness: '3.00',
    unit: 'Nos',
    gstRatePercent: '18.000',
    active: true,
    minStockQty: '120.000',
    movementCount: 1,
    onHandQuantity: '240.000',
    reservedQuantity: '210.000',
    mismatchedUnitMovements: 0,
    mismatchedUnitQuantity: '0.000',
    lastMovementDate: '2026-03-26',
    availableQuantity: '30.000',
    isLowStock: true,
  },
];

export const demoStockMovements: ServerStockMovement[] = [
  {
    id: 'MOV-DEMO-0001',
    productId: 'PRD-DEMO-COIL-01',
    sku: 'DEMO-1001',
    productName: 'MS Coil 2.00mm x 300mm',
    kind: 'opening',
    deltaQuantity: '1000.000',
    unit: 'kg',
    batchNo: 'B-DEMO-10',
    warehouse: 'Main',
    reference: 'Workbook row 14',
    reason: 'Stock snapshot',
    movementDate: '2026-03-01',
    source: 'stock_import',
    sourceRef: 'SIM-DEMO-0001',
    createdAt: DEMO_NOW,
    createdBy: 'USR-DEMO-OWNER',
  },
  {
    id: 'MOV-DEMO-0002',
    productId: 'PRD-DEMO-COIL-01',
    sku: 'DEMO-1001',
    productName: 'MS Coil 2.00mm x 300mm',
    kind: 'dispatch',
    deltaQuantity: '-200.000',
    unit: 'kg',
    batchNo: 'B-DEMO-10',
    warehouse: 'Main',
    reference: 'DSP-2001',
    reason: 'Consignment left the yard',
    movementDate: '2026-03-15',
    source: 'dispatch',
    sourceRef: 'DSP-DEMO-0001',
    createdAt: '2026-03-15T10:20:00+05:30',
    createdBy: 'USR-DEMO-OWNER',
  },
  {
    id: 'MOV-DEMO-0003',
    productId: 'PRD-DEMO-COIL-01',
    sku: 'DEMO-1001',
    productName: 'MS Coil 2.00mm x 300mm',
    kind: 'adjustment',
    deltaQuantity: '650.000',
    unit: 'Nos',
    batchNo: '',
    warehouse: 'Main',
    reference: 'DEMO-STOCK-CHECK',
    reason: 'Unit stated on the sheet does not match the product unit',
    movementDate: '2026-03-27',
    source: 'manual',
    sourceRef: null,
    createdAt: '2026-03-27T11:00:00+05:30',
    createdBy: 'USR-DEMO-OWNER',
  },
  {
    id: 'MOV-DEMO-0004',
    productId: 'PRD-DEMO-UPVC-01',
    sku: 'DEMO-1008',
    productName: 'UPVC Pipe 3in x 10ft',
    kind: 'opening',
    deltaQuantity: '240.000',
    unit: 'Nos',
    batchNo: 'B-DEMO-14',
    warehouse: 'Yard 2',
    reference: 'Workbook row 88',
    reason: 'Stock snapshot',
    movementDate: '2026-03-01',
    source: 'stock_import',
    sourceRef: 'SIM-DEMO-0001',
    createdAt: DEMO_NOW,
    createdBy: 'USR-DEMO-OWNER',
  },
];

/** The party rows as the store keeps them. `ServerCustomer`'s money and count columns are
 *  derived from the orders and receipts above, so no screen can be shown a figure that no
 *  document in the demo produced — see `customerRows()` in `store.ts`, which does the deriving. */

