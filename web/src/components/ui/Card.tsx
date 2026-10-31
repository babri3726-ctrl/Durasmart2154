import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`card p-5 ${onClick ? 'cursor-pointer transition hover:shadow-pop' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="section-title">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  gradient,
  icon,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  gradient: string;
  icon: ReactNode;
  to?: string;
}) {
  const body = (
    <div className="card relative overflow-hidden p-5">
      <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${gradient} opacity-15`} />
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-card`}>{icon}</div>
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-[23px] font-black leading-tight tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-black tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-brand-green/12 text-brand-green',
  approved: 'bg-brand-green/12 text-brand-green',
  delivered: 'bg-brand-green/12 text-brand-green',
  converted: 'bg-brand-green/12 text-brand-green',
  completed: 'bg-brand-green/12 text-brand-green',
  Dispatched: 'bg-brand-green/12 text-brand-green',
  pending: 'bg-brand-orange/15 text-[#C96B15]',
  'Order Pending': 'bg-brand-orange/15 text-[#C96B15]',
  pendingApproval: 'bg-brand-orange/15 text-[#C96B15]',
  pendingDispatch: 'bg-brand-purple/12 text-brand-purple',
  'Pending for Dispatch': 'bg-brand-purple/12 text-brand-purple',
  Confirmed: 'bg-brand-blue/10 text-brand-blue',
  acknowledged: 'bg-brand-blue/10 text-brand-blue',
  inTransit: 'bg-brand-blue/10 text-brand-blue',
  assigned: 'bg-brand-teal/12 text-[#0E8E7E]',
  contact: 'bg-brand-teal/12 text-[#0E8E7E]',
  vacant: 'bg-brand-red/10 text-brand-red',
  overdue: 'bg-brand-red/10 text-brand-red',
  rejected: 'bg-brand-red/10 text-brand-red',
  missed: 'bg-brand-red/10 text-brand-red',
  lost: 'bg-faint/15 text-muted',
  draft: 'bg-line text-muted',
  high: 'bg-brand-red/10 text-brand-red',
  normal: 'bg-brand-blue/10 text-brand-blue',
  low: 'bg-line text-muted',
  // Backend vocabularies the read screens carry (lowercase, as the API sends them):
  confirmed: 'bg-brand-blue/10 text-brand-blue',
  dispatched: 'bg-brand-green/12 text-brand-green',
  partial: 'bg-brand-orange/15 text-[#C96B15]',
  cancelled: 'bg-brand-red/10 text-brand-red',
  in: 'bg-brand-green/12 text-brand-green',
  out: 'bg-brand-red/10 text-brand-red',
  adjust: 'bg-brand-purple/12 text-brand-purple',
  reserved: 'bg-brand-orange/15 text-[#C96B15]',
  released: 'bg-line text-muted',
  'over-dispatched': 'bg-brand-red/10 text-brand-red',
  opening: 'bg-line text-muted',
  invoice: 'bg-brand-blue/10 text-brand-blue',
  creditNote: 'bg-brand-orange/15 text-[#C96B15]',
  payment: 'bg-brand-green/12 text-brand-green',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-line text-muted';
  return <span className={`chip ${cls}`}>{label ?? status}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-line text-muted">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>
      </div>
      <p className="text-sm font-extrabold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-blue border-t-transparent" />
      {label}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-field bg-line/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-[10px] px-3.5 py-1.5 text-[13px] font-bold transition-colors ${active === t.key ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {t.label}
          {t.count !== undefined && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${active === t.key ? 'bg-brand-blue/10 text-brand-blue' : 'bg-line text-muted'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
