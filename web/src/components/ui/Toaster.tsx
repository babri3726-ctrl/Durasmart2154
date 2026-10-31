import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useToasts } from '../../lib/toast';

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };
const STYLES = {
  success: 'border-l-brand-green text-brand-green',
  error: 'border-l-brand-red text-brand-red',
  info: 'border-l-brand-blue text-brand-blue',
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="fixed bottom-5 right-5 z-[70] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`card flex items-start gap-2.5 border-l-4 p-3.5 text-sm shadow-pop ${STYLES[t.kind]}`}>
            <Icon size={17} className="mt-0.5 shrink-0" />
            <p className="flex-1 font-semibold text-ink">{t.message}</p>
            <button className="text-faint hover:text-ink" onClick={() => dismiss(t.id)}>×</button>
          </div>
        );
      })}
    </div>
  );
}
