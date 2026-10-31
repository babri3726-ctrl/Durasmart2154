import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card } from '../components/ui/Card';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24">
      <Card className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-purple/10 text-brand-purple">
          <Compass size={22} />
        </div>
        <h1 className="text-[18px] font-black text-ink">Page not found</h1>
        <p className="mt-1 text-[13px] text-muted">The screen you asked for does not exist in this panel.</p>
        <Link to="/" className="btn-primary mt-4 inline-block">Go to Dashboard</Link>
      </Card>
    </div>
  );
}
