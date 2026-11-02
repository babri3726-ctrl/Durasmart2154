import { PageHeader } from '../components/ui/Card';
import HrPbTargetsCard from '../components/HrPbTargetsCard';
import { invalidate, syncKeys, useSyncPrefix } from '../lib/syncStore';

function useSalesContractStub(saved?: { employeeId: string }) {
  if (saved) {
    invalidate(syncKeys.target(saved.employeeId));
  }
  return useSyncPrefix(syncKeys.targetBook);
}

export default function Sales() {
  void useSalesContractStub;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Targets"
        subtitle="Regional sales targets, party orders, and material dispatches synced from OneDrive (HR-PB.xlsx)"
      />
      <HrPbTargetsCard />
    </div>
  );
}
