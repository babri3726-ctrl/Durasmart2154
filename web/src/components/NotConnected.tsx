/** The honest placeholder for a module this panel shows no data for.
 *
 *  This panel is live-only: it shows company records read from the backend or nothing at all.
 *  Modules still waiting render this card instead of a demo table, so no screen ever presents
 *  example rows as if they were company data. The page title and the module's own nav label are
 *  kept exactly, so the panel still reads as the same product.
 *
 *  `absence` decides the sentence, and it matters: "the backend has no endpoint" and "the
 *  backend answers it and this screen does not call it" are true of different things and are
 *  fixed by different people. The card used to say the first about every module including
 *  Settings, whose `GET`/`PATCH /settings` exist today — and whose values the server
 *  already applies, since a new customer with blank credit days inherits the business
 *  default (`backend/app/services/customers.py`). Mirrors
 *  `ModuleAbsence` in `../mobile/lib/core/not_connected.dart`.
 */

import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { Card, PageHeader } from './ui/Card';

export type ModuleAbsence = 'noEndpoint' | 'endpointNotCalled';

const WORDS: Record<ModuleAbsence, [string, string]> = {
  noEndpoint: [
    'Not connected to the backend yet',
    'has no backend endpoints yet, so this module shows no data — the demo table it used to render was removed rather than kept as an example. It will list real company records once its endpoints exist.',
  ],
  endpointNotCalled: [
    'The backend has this; this screen does not call it',
    'is answered by the backend today — but this screen does not call it, so it shows no data rather than a browser-side guess at what the server would return.',
  ],
};

export function NotConnected({
  title,
  hint,
  absence = 'noEndpoint',
}: {
  title: string;
  hint?: string;
  absence?: ModuleAbsence;
}) {
  const [headline, reason] = WORDS[absence];
  return (
    <>
      <PageHeader title={title} />
      <div className="mx-auto max-w-lg py-10">
        <Card className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-orange/15 text-[#C96B15]">
            <PlugZap size={22} />
          </div>
          <h2 className="text-[15px] font-black text-ink">{headline}</h2>
          <p className="mt-1.5 text-[13px] text-muted">
            {title} {reason}
          </p>
          {hint && <p className="mt-2 text-[11px] leading-relaxed text-faint">{hint}</p>}
          <Link to="/customers" className="btn-primary mt-4 inline-block">Go to Customers (live)</Link>
        </Card>
      </div>
    </>
  );
}
