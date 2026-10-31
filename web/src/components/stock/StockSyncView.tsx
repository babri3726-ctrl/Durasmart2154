/** Excel Import / Sync: the existing approved-snapshot read, the batch history and the workbook
 *  preview/apply, kept as three sub-tabs so the rest of the stock section can stay about reading.
 *
 *  These routes are owner-only on the server. This view does not pre-check the role; each screen
 *  shows the server's refusal to an employee, which is the same answer the route gives.
 */

import { useState } from 'react';
import { Tabs } from '../ui/Card';
import ApprovedStock from '../ApprovedStock';
import StockImportHistory from '../StockImportHistory';
import StockWorkbookPreview from '../StockWorkbookPreview';
import WatchedWorkbook from './WatchedWorkbook';

export default function StockSyncView() {
  const [tab, setTab] = useState('apply');
  return (
    <div>
      <div className="mb-3">
        <p className="text-[12px] font-black text-ink">Excel Import / Sync</p>
        <p className="mt-0.5 max-w-3xl text-[11px] text-muted">
          The workbook is the source of truth. Previewing a file writes nothing; applying it stores
          one dated snapshot for both clients in one transaction, and posts no stock movement,
          product master or debtor row. Refreshing a stock screen is a read and never applies a file.
        </p>
      </div>
      <WatchedWorkbook />
      <Tabs
        tabs={[
          { key: 'apply', label: 'Workbook preview & apply' },
          { key: 'history', label: 'Applied batches' },
          { key: 'approved', label: 'Approved snapshot' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'apply' && <StockWorkbookPreview />}
      {tab === 'history' && <StockImportHistory />}
      {tab === 'approved' && <ApprovedStock />}
    </div>
  );
}
