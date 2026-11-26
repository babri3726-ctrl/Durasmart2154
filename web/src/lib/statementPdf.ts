import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface StatementPdfData {
  partyName: string;
  partyId: string;
  city?: string;
  state?: string;
  mobile?: string;
  openingPaise: number;
  totalDebitsPaise: number;
  totalCreditsPaise: number;
  closingPaise: number;
  aging?: {
    bucket0_30: number;
    bucket31_60: number;
    bucket61_90: number;
    bucket90Plus: number;
  };
  vouchers: Array<{
    date: string;
    type: string;
    vchNo?: string;
    particulars: string;
    debitPaise: number;
    creditPaise: number;
    balancePaise: number;
  }>;
}

function formatCurrency(paise: number): string {
  const rs = Math.abs(paise) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rs);
  return `Rs. ${formatted}`;
}

export function generateStatementPdf(data: StatementPdfData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  // Company Header banner
  doc.setFillColor(30, 41, 59); // slate-800
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('DURA SMART DOORS & WINDOWS', 14, 11);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text('Enterprise Operations Suite · Industrial Area, Ludhiana, Punjab', 14, 17);
  doc.text('Official Customer Ledger Statement', 14, 22);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  doc.text(`Generated: ${todayStr}`, pageWidth - 14, 22, { align: 'right' });

  // Customer & Account Info Card
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(14, 30, pageWidth - 28, 26, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(data.partyName.toUpperCase(), 18, 38);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Account ID: ${data.partyId}`, 18, 44);
  doc.text(`Station / City: ${data.city || data.state || 'Punjab'}`, 18, 50);

  const phoneText = data.mobile ? `Mobile: +91 ${data.mobile}` : 'Mobile: Not Available';
  doc.text(phoneText, 100, 44);
  doc.text(`Statement Period: Up to ${todayStr}`, 100, 50);

  // Financial KPI Cards (Opening, Debits, Credits, Closing)
  const cardWidth = (pageWidth - 28 - 9) / 4;
  const cardY = 60;
  const cardH = 18;

  const kpis = [
    { label: 'OPENING BALANCE', value: formatCurrency(data.openingPaise), drCr: data.openingPaise >= 0 ? 'Dr' : 'Cr', color: [100, 116, 139] },
    { label: 'TOTAL DEBITS', value: formatCurrency(data.totalDebitsPaise), drCr: '', color: [37, 99, 235] },
    { label: 'TOTAL CREDITS', value: formatCurrency(data.totalCreditsPaise), drCr: '', color: [16, 185, 129] },
    { label: 'CURRENT OUTSTANDING', value: formatCurrency(data.closingPaise), drCr: data.closingPaise >= 0 ? 'Dr' : 'Cr', color: [225, 29, 72] },
  ];

  kpis.forEach((kpi, idx) => {
    const x = 14 + idx * (cardWidth + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, cardY, cardWidth, cardH, 1.5, 1.5, 'FD');

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.label, x + 3, cardY + 5);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${kpi.value} ${kpi.drCr}`.trim(), x + 3, cardY + 12);
  });

  // Aging Analysis Table
  let currentY = cardY + cardH + 4;
  if (data.aging) {
    const agingData = [
      [
        `0-30 Days: ${formatCurrency(data.aging.bucket0_30)}`,
        `31-60 Days: ${formatCurrency(data.aging.bucket31_60)}`,
        `61-90 Days: ${formatCurrency(data.aging.bucket61_90)}`,
        `90+ Days: ${formatCurrency(data.aging.bucket90Plus)}`,
      ],
    ];

    autoTable(doc, {
      startY: currentY,
      margin: { left: 14, right: 14 },
      head: [['Aging (0-30 Days)', 'Aging (31-60 Days)', 'Aging (61-90 Days)', 'Aging (90+ Days Overdue)']],
      body: agingData,
      theme: 'plain',
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [71, 85, 105],
        fontSize: 7,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.5,
        textColor: [30, 41, 59],
        fontStyle: 'bold',
      },
      tableWidth: pageWidth - 28,
    });
    const lastAutoTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    currentY = (lastAutoTable?.finalY ?? currentY) + 4;
  }

  // Detailed Ledger Transaction Table
  const tableRows = data.vouchers.map((v) => {
    const drStr = v.debitPaise > 0 ? formatCurrency(v.debitPaise) : '—';
    const crStr = v.creditPaise > 0 ? formatCurrency(v.creditPaise) : '—';
    const balDrCr = v.balancePaise >= 0 ? 'Dr' : 'Cr';
    const balStr = `${formatCurrency(v.balancePaise)} ${balDrCr}`;
    return [
      v.date,
      v.type.toUpperCase(),
      v.vchNo || '—',
      v.particulars,
      drStr,
      crStr,
      balStr,
    ];
  });

  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 14, bottom: 20 },
    head: [['Date', 'Type', 'Vch No', 'Particulars (Account)', 'Debit (+)', 'Credit (-)', 'Balance']],
    body: tableRows,
    theme: 'striped',
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 16 },
      2: { cellWidth: 18 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 25, halign: 'right' },
      5: { cellWidth: 25, halign: 'right' },
      6: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      overflow: 'linebreak',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (hookData) => {
      // Running Footer
      const totalPages = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // slate-400
      const pageStr = `Page ${hookData.pageNumber} of ${totalPages}`;
      doc.text(pageStr, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
      doc.text('Dura Smart Doors & Windows · Computer-Generated Statement of Account', 14, doc.internal.pageSize.getHeight() - 8);
    },
  });

  return doc;
}
