/** Manual customer entry that actually saves — through the backend the panel is configured with.
 *
 *  The panel's only customer form: it always posts to `POST /customers`, and every failure it
 *  can have is the server's own answer shown verbatim. Nothing is written to the browser, so a
 *  saved customer is visible to every device on this backend and survives reloads.
 *
 *  The duplicate warning is the live `GET /customers/match` — the same endpoint the server
 *  scopes by salesperson — so what the owner is warned about is what the database actually
 *  holds, not what this browser happens to remember. It warns rather than blocks, exactly as
 *  the endpoint is documented: two firms legitimately share a name, and the owner is the one
 *  who knows.
 *
 *  One idempotency key per submission intent, held across retries of the identical body and
 *  replaced when the owner edits and resubmits — see `entryRules.idempotencyKeyFor`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from './ui/Overlays';
import { CheckboxField, SelectField, TextField, TextareaField } from './ui/Field';
import { toast } from '../lib/toast';
import {
  createCustomer,
  listEmployees,
  matchCustomers,
  newIdempotencyKey,
  ServerError,
  serverHost,
  type CustomerCreateBody,
  type ServerCustomerDetail,
  type ServerEmployee,
  type ServerMatch,
} from '../lib/serverApi';
import { customerDraftProblems, foldTerm, idempotencyKeyFor, normaliseMobile, type KeyedSubmission } from '../lib/entryRules';

const liveSchema = z
  .object({
    name: z.string(),
    mobile: z.string(),
    contactPerson: z.string().max(120),
    city: z.string().max(80),
    district: z.string().max(80),
    state: z.string().max(80),
    address: z.string().max(400),
    notes: z.string().max(2000),
    salespersonId: z.string(),
    creditDays: z.string(),
    ackDup: z.boolean(),
  })
  .superRefine((values, ctx) => {
    for (const [field, message] of Object.entries(customerDraftProblems(values))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  });
type LiveForm = z.infer<typeof liveSchema>;

const EMPTY: LiveForm = {
  name: '',
  mobile: '',
  contactPerson: '',
  city: '',
  district: '',
  state: '',
  address: '',
  notes: '',
  salespersonId: '',
  creditDays: '',
  ackDup: false,
};

export function LiveCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: ServerCustomerDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<{
    state: 'loading' | 'ready' | 'refused' | 'error';
    rows: ServerEmployee[];
    /** More active staff exist than this page carried; `total` is the server's count. */
    truncated?: boolean;
    total?: number;
  }>({ state: 'loading', rows: [] });
  const [matches, setMatches] = useState<ServerMatch[]>([]);
  const [matchError, setMatchError] = useState('');
  const keyRef = useRef<KeyedSubmission | null>(null);

  const { control, watch, handleSubmit, reset, setError: setFieldError, clearErrors } = useForm<LiveForm>({
    resolver: zodResolver(liveSchema),
    defaultValues: EMPTY,
  });

  const name = watch('name');
  const mobile = watch('mobile');
  const ackDup = watch('ackDup');

  // The staff list is owner-only on the server; an employee session gets 403 and is told so
  // rather than shown an empty picker that looks like "no staff exist".
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEmployees({ state: 'loading', rows: [] });
    // `activeOnly` is the server's rule, asked for as a filter — not a browser-side pass over a
    // page that may have stopped short. If it did stop short, the picker says so instead of
    // letting a missing salesperson read as "not on staff".
    listEmployees({ activeOnly: true })
      .then((page) => {
        if (alive) {
          setEmployees({
            state: 'ready',
            rows: page.items,
            truncated: page.total > page.items.length,
            total: page.total,
          });
        }
      })
      .catch((cause) => {
        if (!alive) return;
        if (cause instanceof ServerError && cause.status === 403) setEmployees({ state: 'refused', rows: [] });
        else setEmployees({ state: 'error', rows: [] });
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Duplicate warning against the server, debounced. Only asked when there is something worth
  // asking: a name of a few characters or a mobile that has all ten digits.
  useEffect(() => {
    if (!open) return;
    const folded = foldTerm(name ?? '');
    const digits = normaliseMobile(mobile ?? '');
    if (folded.length < 3 && (!digits || digits.length !== 10)) {
      setMatches([]);
      setMatchError('');
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      matchCustomers({ name: folded || undefined, mobile: digits || undefined })
        .then((rows) => {
          if (alive) {
            setMatches(rows);
            setMatchError('');
          }
        })
        .catch(() => {
          // A failed warning must not read as "no duplicates found".
          if (alive) setMatchError('Could not check for duplicates — the backend did not answer.');
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, name, mobile]);

  const blockedByDup = matches.length > 0 && !ackDup;
  const salespersonOptions = useMemo(
    () => employees.rows.map((e) => ({ value: e.id, label: `${e.name} • ${e.role}` })),
    [employees.rows],
  );

  const submit = handleSubmit(async (values) => {
    if (busy) return;
    setBusy(true);
    setError('');
    clearErrors();
    const payload: CustomerCreateBody = {
      name: values.name.trim(),
      mobile: values.mobile.trim(),
      contactPerson: values.contactPerson.trim(),
      city: values.city.trim(),
      district: values.district.trim(),
      state: values.state.trim(),
      address: values.address.trim(),
      notes: values.notes.trim(),
      salespersonId: values.salespersonId || null,
      creditDays: values.creditDays.trim() === '' ? null : Number(values.creditDays.trim()),
    };
    const submission = idempotencyKeyFor(keyRef.current, payload, newIdempotencyKey);
    keyRef.current = submission;
    try {
      const created = await createCustomer(payload, submission.key);
      keyRef.current = null;
      toast.success(
        created.status === 'active'
          ? `${created.name} saved to the backend and active`
          : `${created.name} saved to the backend — awaiting owner approval before it can take orders`,
      );
      reset(EMPTY);
      setMatches([]);
      onCreated?.(created);
      onClose();
    } catch (cause) {
      if (cause instanceof ServerError) {
        if (cause.fields) {
          for (const [field, message] of Object.entries(cause.fields)) {
            if (field === 'name' || field === 'mobile' || field === 'salespersonId') {
              setFieldError(field, { message });
            } else {
              setError((previous) => (previous ? `${previous} ${message}` : message));
            }
          }
        } else {
          setError(cause.message);
        }
      } else {
        setError('The customer could not be saved. Nothing was written.');
      }
    } finally {
      setBusy(false);
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Customer — saved to the backend">
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <p className="rounded-field bg-brand-blue/5 px-3 py-2 text-[11px] text-muted">
          This form writes a row through <b className="text-ink">{serverHost()}</b>. The customer is
          visible to every screen that reads that source.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField name="name" label="Customer name" control={control} required />
          <TextField name="mobile" label="Mobile" control={control} required placeholder="10-digit" />
          <TextField name="city" label="City" control={control} />
          <TextField name="district" label="District" control={control} />
          <TextField name="state" label="State" control={control} />
          <TextField name="contactPerson" label="Contact person" control={control} />
          <TextField
            name="creditDays"
            label="Credit days"
            control={control}
            type="number"
            hint="Blank uses the business default from Settings"
          />
          <SelectField
            name="salespersonId"
            label="Assigned salesperson"
            control={control}
            options={salespersonOptions}
            placeholder="— Not assigned —"
          />
        </div>
        {employees.state === 'refused' && (
          <p className="rounded-field bg-canvas px-3 py-2 text-[11px] text-muted">
            The staff list is owner-only, so it could not be loaded for this account. Leave the field
            unassigned and the owner can assign later.
          </p>
        )}
        {employees.state === 'ready' && employees.truncated && (
          <p className="rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] text-[#9A5A0B]">
            The server counts {employees.total} active staff and sent the first{' '}
            {employees.rows.length} — a salesperson missing from this picker is not necessarily off
            the staff list. Save the customer unassigned and assign them from the employee screen.
          </p>
        )}
        {employees.state === 'error' && (
          <p className="rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] text-[#9A5A0B]">
            The staff list could not be loaded. You can still save the customer unassigned.
          </p>
        )}
        <TextareaField name="address" label="Address" control={control} rows={2} />
        <TextareaField name="notes" label="Notes" control={control} rows={2} />
        {matchError && (
          <p className="rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] font-semibold text-[#9A5A0B]">{matchError}</p>
        )}
        {matches.length > 0 && (
          <div className="rounded-field border border-brand-orange/40 bg-brand-orange/10 px-3.5 py-2.5 text-[12px] text-[#9A5A0B]">
            <p className="mb-1 font-bold">{matches.length} customer(s) on the backend look similar:</p>
            <ul className="list-inside list-disc">
              {matches.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <b>{m.name}</b> • {m.city || '—'} • {m.mobile} ({m.reason})
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <CheckboxField name="ackDup" label="This is genuinely a different customer — save it anyway" control={control} />
            </div>
          </div>
        )}
        {error && <p className="rounded-field bg-brand-red/10 px-3 py-2 text-xs font-bold text-brand-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || blockedByDup}>
            {busy ? 'Saving…' : matches.length > 0 ? 'Save as a new customer' : 'Save to backend'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
