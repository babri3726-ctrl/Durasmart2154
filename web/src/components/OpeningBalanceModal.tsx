/** Opening balances: the cut-over figures the owner enters before Tally exists.
 *
 *  A different kind of form from the payment one, and the difference is the whole point of the
 *  backend design: a payment is money moving against a bill, while an opening balance is a
 *  figure a business already owed (or was owed) on the day it started keeping books here. It
 *  enters `v_customer_balance` through the opening row and is deliberately kept out of the
 *  overdue ladder, which is built only from invoices — so this screen says so, in the customer's
 *  own panel, instead of letting an owner wonder why a debt that is clearly past due shows no
 *  overdue days. A cut-over figure has no invoice-level source record; the panel must not render
 *  it as if it had one.
 *
 *  What the form sends is a positive amount and a word — `owes` or `advance` — and the server
 *  applies the stored sign. No code in this file knows whether the database wants that sign
 *  positive or negative, and that is on purpose: guessing it here is how the same amount is
 *  entered as an advance on one screen and a debt on another.
 *
 *  Corrections are new rows. The ledger sums every row for the customer, so an erroneous entry
 *  is corrected by recording a second entry that offsets it — nothing on this screen edits or
 *  deletes a row, because the record of a confirmed financial entry is not the panel's to
 *  erase. Who entered each row and when is read back from the server's audit trail, not
 *  re-stated here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from './ui/Overlays';
import { DateField, TextField } from './ui/Field';
import { toast } from '../lib/toast';
import { useLiveSession } from '../lib/liveSession';
import {
  createOpeningBalance,
  getCustomer,
  listCustomers,
  listOpeningBalances,
  newIdempotencyKey,
  openingBalanceHistory,
  ServerError,
  serverHost,
  type OpeningBalanceEntry,
  type ServerAuditEntry,
  type ServerCustomer,
  type ServerCustomerDetail,
} from '../lib/serverApi';
import { exactRupees, foldTerm, idempotencyKeyFor, paiseFromRupees, type KeyedSubmission } from '../lib/entryRules';
import { toDate } from '../lib/format';

export interface OpeningBalancePreset {
  id: string;
  name: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const entrySchema = z
  .object({
    asOf: z.string().min(1, 'Pick the date the balance is effective from.'),
    amount: z.string(),
    direction: z.enum(['owes', 'advance']),
  })
  .superRefine((values, ctx) => {
    const parsed = paiseFromRupees(values.amount);
    if (!parsed.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: parsed.reason });
  });
type EntryForm = z.infer<typeof entrySchema>;

export function OpeningBalanceModal({
  open,
  onClose,
  preset,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  preset?: OpeningBalancePreset | null;
  onSaved?: () => void;
}) {
  const liveUser = useLiveSession((s) => s.user);
  const isOwner = liveUser?.role === 'owner';

  const [customer, setCustomer] = useState<ServerCustomerDetail | null>(null);
  const [entries, setEntries] = useState<OpeningBalanceEntry[]>([]);
  const [history, setHistory] = useState<ServerAuditEntry[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [listError, setListError] = useState('');

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ServerCustomer[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [presetNote, setPresetNote] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const keyRef = useRef<KeyedSubmission | null>(null);

  const { control, watch, handleSubmit, reset } = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: { asOf: today(), amount: '', direction: 'owes' },
  });

  const loadCustomer = useCallback(async (id: string) => {
    setListState('loading');
    setListError('');
    try {
      const [detail, entryPage, audit] = await Promise.all([
        getCustomer(id),
        listOpeningBalances(id),
        openingBalanceHistory(id),
      ]);
      setCustomer(detail);
      setEntries(entryPage.items);
      setHistory(audit);
      setListState('ready');
    } catch (cause) {
      setListState('error');
      setListError(cause instanceof ServerError ? cause.message : 'The backend did not answer.');
    }
  }, []);

  // On open: either load the preset customer or start from the search field. A preset whose id
  // is no longer a backend row leaves its name in the search box so the owner can find the real
  // row, and says why.
  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setSaveError('');
    keyRef.current = null;
    reset({ asOf: today(), amount: '', direction: 'owes' });
    setCustomer(null);
    setEntries([]);
    setHistory([]);
    setResults([]);
    setPresetNote('');
    setSearch(preset?.name ?? '');
    if (preset?.id) {
      getCustomer(preset.id)
        .then((detail) => {
          setCustomer(detail);
          setListState('loading');
          void loadCustomer(detail.id);
        })
        .catch((cause) => {
          if (cause instanceof ServerError && cause.status === 404 && preset.name) {
            setPresetNote(`“${preset.name}” is not a customer on the backend. Search for the customer below.`);
          } else if (cause instanceof ServerError) {
            setListState('error');
            setListError(cause.message);
          }
        });
    } else {
      setListState('idle');
    }
  }, [open, preset?.id, preset?.name, loadCustomer, reset]);

  // Search the backend's customer list, debounced.
  useEffect(() => {
    if (!open || customer) return;
    const term = foldTerm(search);
    if (term.length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    let alive = true;
    setSearchBusy(true);
    const timer = setTimeout(() => {
      listCustomers({ q: term, pageSize: 8 })
        .then((page) => {
          if (!alive) return;
          setResults(page.items);
          setSearchError('');
        })
        .catch((cause) => {
          if (!alive) return;
          setSearchError(cause instanceof ServerError ? cause.message : 'The backend did not answer.');
        })
        .finally(() => {
          if (alive) setSearchBusy(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
      setSearchBusy(false);
    };
  }, [open, customer, search]);

  const direction = watch('direction');
  const amount = watch('amount');
  const asOf = watch('asOf');

  const parsedAmount = useMemo(() => paiseFromRupees(amount), [amount]);

  const save = handleSubmit(async (values) => {
    if (!customer || saveBusy) return;
    const parsed = paiseFromRupees(values.amount);
    if (!parsed.ok) return;
    setSaveBusy(true);
    setSaveError('');
    const payload = { asOf: values.asOf, amountPaise: parsed.paise, direction: values.direction };
    const submission = idempotencyKeyFor(keyRef.current, payload, newIdempotencyKey);
    keyRef.current = submission;
    try {
      await createOpeningBalance(customer.id, payload, submission.key);
      keyRef.current = null;
      toast.success(
        `Opening balance of ${exactRupees(parsed.paise)} saved to the backend for ${customer.name}`,
      );
      setConfirming(false);
      reset({ asOf: today(), amount: '', direction: values.direction });
      await loadCustomer(customer.id);
      onSaved?.();
    } catch (cause) {
      setSaveError(cause instanceof ServerError ? cause.message : 'The entry could not be saved. Nothing was written.');
      setConfirming(false);
    } finally {
      setSaveBusy(false);
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="Opening Balance — cut-over figure">
      <div className="grid gap-4">
          <p className="rounded-field bg-brand-blue/5 px-3 py-2 text-[11px] text-muted">
            Rows save through <b className="text-ink">{serverHost()}</b> and update the company's balance
            figures. A cut-over figure has <b className="text-ink">no invoice behind it</b>: it adds to the
            customer's balance and never to the overdue ladder, so it cannot be shown as individual overdue
            invoices.
          </p>

          {!customer ? (
            <div>
              <label className="label">Find the customer on the backend</label>
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a name, city or mobile…"
                autoFocus
              />
              {presetNote && (
                <p className="mt-2 rounded-field bg-brand-orange/10 px-3 py-2 text-[11px] font-semibold text-[#9A5A0B]">
                  {presetNote}
                </p>
              )}
              {searchBusy && <p className="mt-2 text-[11px] text-faint">Searching…</p>}
              {searchError && <p className="mt-2 text-[11px] font-semibold text-brand-red">{searchError}</p>}
              {results.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-field border border-line">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-left text-[12px] last:border-b-0 hover:bg-canvas"
                      onClick={() => void loadCustomer(r.id)}
                    >
                      <span>
                        <span className="block font-bold text-ink">{r.name}</span>
                        <span className="block text-[10px] text-muted">
                          {r.city || '—'} • {r.mobile} • {r.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold">
                        {r.outstandingPaise > 0 ? `owes ${exactRupees(r.outstandingPaise)}` : r.advancePaise > 0 ? `advance ${exactRupees(r.advancePaise)}` : 'no balance'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {foldTerm(search).length >= 2 && !searchBusy && results.length === 0 && !searchError && (
                <p className="mt-2 text-[11px] text-faint">
                  No backend customer matches. Add the customer first (Customers → Add Customer), then come back.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-black text-ink">{customer.name}</p>
                  <p className="text-[11px] text-muted">
                    {customer.id} • {customer.city || '—'} • {customer.mobile}
                  </p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setCustomer(null)}>
                  Change customer
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-tile bg-canvas p-3 text-center">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-faint">Opening (server)</p>
                  <p className="text-[13px] font-black">{exactRupees(customer.openingPaise)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-faint">Outstanding (server)</p>
                  <p className="text-[13px] font-black">{exactRupees(customer.outstandingPaise)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-faint">Advance (server)</p>
                  <p className="text-[13px] font-black">{exactRupees(customer.advancePaise)}</p>
                </div>
              </div>

              {listState === 'loading' && <p className="text-[11px] text-faint">Loading entries…</p>}
              {listState === 'error' && (
                <p className="rounded-field bg-brand-red/10 px-3 py-2 text-[11px] font-semibold text-brand-red">
                  {listError}
                </p>
              )}
              {listState === 'ready' && (
                <>
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-faint">
                      Recorded entries ({entries.length})
                    </h3>
                    {entries.length === 0 ? (
                      <p className="text-[12px] text-muted">No opening balance has been recorded for this customer.</p>
                    ) : (
                      <div className="overflow-hidden rounded-field border border-line">
                        {entries.map((e) => (
                          <div key={e.id} className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-[12px] last:border-b-0">
                            <span>
                              <b className="text-ink">
                                {e.direction === 'owes'
                                  ? `${customer.name} owes the company`
                                  : `The company holds an advance from ${customer.name}`}
                              </b>
                              <span className="block text-[10px] text-muted">
                                effective {e.asOf} • source {e.source} • row #{e.id}
                              </span>
                            </span>
                            <span className="shrink-0 font-black">{exactRupees(Math.abs(e.amountPaise))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {history.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-faint">
                        Who entered these, and when (server audit trail)
                      </h3>
                      <div className="space-y-1">
                        {history.map((h) => (
                          <p key={h.id} className="text-[11px] text-muted">
                            <b className="text-ink">{h.actorName}</b> • {h.action} • {toDate(h.at).toLocaleString()} — {h.detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {isOwner ? (
                <form onSubmit={save} className="grid gap-3.5 border-t border-line pt-3.5" noValidate>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <DateField name="asOf" label="Effective from" control={control} required />
                    <TextField
                      name="amount"
                      label="Amount (₹)"
                      control={control}
                      required
                      placeholder="e.g. 1,25,000"
                      hint="Always a positive amount — the direction below says which way it points"
                    />
                  </div>
                  <Controller
                    name="direction"
                    control={control}
                    render={({ field }) => (
                      <div>
                        <label className="label">Direction</label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(
                            [
                              { value: 'owes', label: 'Customer owes the company', hint: 'An outstanding balance at cut-over' },
                              { value: 'advance', label: 'Customer has an advance with the company', hint: 'Money the company holds on the customer’s behalf' },
                            ] as const
                          ).map((option) => (
                            <label
                              key={option.value}
                              className={`flex cursor-pointer items-start gap-2.5 rounded-field border px-3 py-2.5 ${field.value === option.value ? 'border-brand-blue bg-brand-blue/5' : 'border-line'}`}
                            >
                              <input
                                type="radio"
                                className="mt-0.5 accent-brand-blue"
                                checked={field.value === option.value}
                                onChange={() => field.onChange(option.value)}
                              />
                              <span>
                                <span className="block text-[12px] font-bold text-ink">{option.label}</span>
                                <span className="block text-[10px] text-muted">{option.hint}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <p className="mt-1 text-[10px] text-faint">
                          The stored debit/credit sign is applied by the backend — this form never guesses it.
                        </p>
                      </div>
                    )}
                  />
                  <p className="rounded-field bg-canvas px-3 py-2 text-[11px] text-muted">
                    Corrections are <b className="text-ink">new entries</b>, never edits: the customer's balance is
                    the sum of the rows above, so a mistake is offset by a second entry and both remain readable
                    in the audit trail. If you entered an advance wrongly, record an offsetting entry in the
                    opposite direction.
                  </p>
                  {confirming && parsedAmount.ok && (
                    <div className="rounded-field border border-brand-blue/40 bg-brand-blue/5 px-3.5 py-2.5 text-[12px]">
                      <p className="font-bold text-ink">
                        Confirm: record {exactRupees(parsedAmount.paise)} for {customer.name} as{' '}
                        {direction === 'owes' ? 'an amount they owe the company' : 'an advance the company holds'}, effective {asOf}.
                      </p>
                      <p className="mt-1 text-[10px] text-muted">This row becomes part of the company's balance figures immediately.</p>
                    </div>
                  )}
                  {saveError && (
                    <p className="rounded-field bg-brand-red/10 px-3 py-2 text-xs font-bold text-brand-red">{saveError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    {confirming ? (
                      <>
                        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
                          Back
                        </button>
                        <button type="submit" className="btn-primary" disabled={saveBusy}>
                          {saveBusy ? 'Saving…' : 'Confirm & Save'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!parsedAmount.ok || listState === 'loading'}
                        onClick={async () => {
                          // Validate the whole form, then show the confirmation instead of saving.
                          const valid = await new Promise<boolean>((resolve) => {
                            void handleSubmit(
                              () => resolve(true),
                              () => resolve(false),
                            )();
                          });
                          if (valid) setConfirming(true);
                        }}
                      >
                        Review entry
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <p className="rounded-field bg-canvas px-3 py-2 text-[11px] text-muted">
                  Recording opening balances is limited to the owner's account; the backend refuses other roles.
                  You can still read the entries above.
                </p>
              )}
            </>
          )}
        </div>
    </Modal>
  );
}
