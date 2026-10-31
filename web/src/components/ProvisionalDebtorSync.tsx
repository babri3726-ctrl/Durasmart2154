import { Link } from 'react-router-dom';
import { FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { Card, CardHeader } from './ui/Card';
import { PROVISIONAL_LABEL, PROVISIONAL_PERIOD_WARNING } from '../lib/provisionalSync';

export default function ProvisionalDebtorSync() {
  return (
    <Card className="mt-6 border border-amber-200/80 bg-amber-50/40">
      <CardHeader
        title={PROVISIONAL_LABEL}
        subtitle="Owner-only provisional reconciliation from unverified workbook imports"
        actions={
          <Link
            to="/debtors/provisional"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-amber-700"
          >
            <FileSpreadsheet size={14} />
            Manage Provisional
          </Link>
        }
      />
      <div className="flex items-start gap-3 text-xs text-amber-900/80">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="leading-relaxed">{PROVISIONAL_PERIOD_WARNING}</p>
      </div>
    </Card>
  );
}
