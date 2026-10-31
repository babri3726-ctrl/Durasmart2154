/** UPVC New, Old, Waste and the combined UPVC Total Stock tab.
 *
 *  Pieces and footage are separate answers. Pieces are the workbook's Total column; footage is the
 *  server's per-row pieces × the length class, and a row with no stated length has no footage. The
 *  totals here are the server's totals over the filtered rows — this screen never adds a page of
 *  rows up, and it never calls the sheet's `Feet` column footage.
 *
 *  Filtering by type, colour, length and text happens in the query, so a total always describes
 *  the rows above it. Negative pieces are real balances and stay visible in red.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { EmptyState } from '../ui/Card';
import { LiveSyncBar } from '../ui/LiveSync';
import { Pager } from '../ui/Pager';
import { StockReadState } from './StockBits';
import { isNegativeQuantity } from '../../lib/liveDisplay';
import {
  FOOTAGE_NOTE,
  FOOTAGE_UNIT_TEXT,
  PIECES_UNIT_TEXT,
  groupedQuantity,
  pageOf,
  serverTimestampText,
} from '../../lib/stockView';
import { syncKeys, useSyncToken } from '../../lib/syncStore';
import { useResource } from '../../lib/useResource';
import {
  readUpvcStock,
  type ServerUpvcCell,
  type ServerUpvcGroup,
  type ServerUpvcTotals,
  type ServerUpvcType,
} from '../../lib/serverApi';

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<ServerUpvcType, string> = { new: 'New', old: 'Old', waste: 'Waste' };

const lengthKey = (lengthFt: number | null) => (lengthFt === null ? 'unknown' : String(lengthFt));

const lengthLabel = (lengthFt: number | null) => (lengthFt === null ? 'No length' : `${lengthFt} ft`);

/** The mockup's colour × length matrix.
 *
 *  The cells come from the server's cross-tab; this component only lays them out. The right
 *  margin is the server's `byColour` group and the bottom margin its `byLength` group, so every
 *  total on this table is a figure the server computed over the same filtered rows — the panel
 *  never adds a cell, and a cell with no figure stays a dash rather than a zero.
 */
function ColourLengthMatrix({
  cells,
  byColour,
  byLength,
  totals,
}: {
  cells: ServerUpvcCell[];
  byColour: ServerUpvcGroup[];
  byLength: ServerUpvcGroup[];
  totals: ServerUpvcTotals;
}) {
  const [measure, setMeasure] = useState<'pieces' | 'footage'>('pieces');

  if (cells.length === 0) {
    return (
      <div className="rounded-field border border-line bg-white p-3">
        <p className="text-[12px] font-black text-ink">Colour by length</p>
        <p className="mt-1 text-[11px] text-muted">No group in the current filter.</p>
      </div>
    );
  }

  const lengths = [...new Set(cells.map((cell) => cell.lengthFt))].sort((left, right) =>
    left === null ? 1 : right === null ? -1 : left - right,
  );
  const colours = [...new Set(cells.map((cell) => cell.colour))].sort((left, right) =>
    left.localeCompare(right),
  );
  const cellAt = new Map(cells.map((cell) => [`${cell.colour}|${lengthKey(cell.lengthFt)}`, cell]));
  const colourGroup = new Map(byColour.map((group) => [group.key, group]));
  const lengthGroup = new Map(byLength.map((group) => [group.key, group]));
  const figureOf = (value: string | null) =>
    value === null ? <span className="text-faint">—</span> : groupedQuantity(value);

  return (
    <div className="rounded-field border border-line bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-black text-ink">Colour by length</p>
          <p className="text-[10px] text-muted">
            {measure === 'pieces'
              ? 'The workbook’s Total column per colour and length class.'
              : 'Pieces × the stated length, the only derived figure here.'}
          </p>
        </div>
        <div className="flex gap-1">
          {(['pieces', 'footage'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setMeasure(choice)}
              className={`chip ${measure === choice ? 'bg-brand-blue text-white' : 'bg-canvas text-muted'}`}
            >
              {choice === 'pieces' ? PIECES_UNIT_TEXT : FOOTAGE_UNIT_TEXT}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-2 text-left font-extrabold">Colour</th>
              {lengths.map((length) => (
                <th key={lengthKey(length)} className="px-2 py-1 text-right font-extrabold">
                  {lengthLabel(length)}
                </th>
              ))}
              <th className="py-1 pl-2 text-right font-extrabold">
                Total {measure === 'pieces' ? 'Pcs' : 'Ft'}
              </th>
            </tr>
          </thead>
          <tbody>
            {colours.map((colour) => {
              const group = colourGroup.get(colour);
              return (
                <tr key={colour} className="border-b border-line/50">
                  <td className="py-1 pr-2 font-bold text-ink">{colour}</td>
                  {lengths.map((length) => {
                    const cell = cellAt.get(`${colour}|${lengthKey(length)}`);
                    const value = cell === undefined ? null : cell[measure];
                    const shown = value !== null && isNegativeQuantity(value);
                    return (
                      <td
                        key={lengthKey(length)}
                        className={`px-2 py-1 text-right tabular-nums ${shown ? 'font-black text-brand-red' : cell === undefined ? '' : 'font-bold text-ink'}`}
                      >
                        {cell === undefined ? <span className="text-faint">—</span> : figureOf(value)}
                        {cell !== undefined && cell.rowCount > 1 && (
                          <span className="block text-[9px] font-normal text-faint">
                            {cell.rowCount} rows
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1 pl-2 text-right font-black tabular-nums text-ink">
                    {group === undefined ? <span className="text-faint">—</span> : figureOf(group[measure])}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-line">
              <td className="py-1 pr-2 text-[10px] font-extrabold uppercase text-muted">Total</td>
              {lengths.map((length) => {
                const group = lengthGroup.get(lengthKey(length));
                return (
                  <td key={lengthKey(length)} className="px-2 py-1 text-right font-black tabular-nums text-ink">
                    {group === undefined ? <span className="text-faint">—</span> : figureOf(group[measure])}
                  </td>
                );
              })}
              <td className="py-1 pl-2 text-right font-black tabular-nums text-ink">
                {figureOf(totals[measure])}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-faint">
        A dash means the sheet states no such row — it is not a zero balance. The margins are the
        server’s own by-colour, by-length and overall totals over these filtered rows.
      </p>
    </div>
  );
}

export default function StockUpvc({
  mode,
  heading,
  description,
}: {
  mode: ServerUpvcType | null;
  heading: string;
  description: string;
}) {
  const [type, setType] = useState<ServerUpvcType | null>(mode);
  const [colour, setColour] = useState('');
  const [lengthFt, setLengthFt] = useState('');
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [page, setPage] = useState(1);
  const [colourOptions, setColourOptions] = useState<string[]>([]);
  const [lengthOptions, setLengthOptions] = useState<number[]>([]);

  useEffect(() => {
    setType(mode);
  }, [mode]);

  // One debounce for the text term; the selects apply immediately because a tap is not typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedTerm(term.trim()), term.trim() === '' ? 0 : 350);
    return () => window.clearTimeout(timer);
  }, [term]);

  const fetcher = useCallback(
    () =>
      readUpvcStock({
        type: type ?? undefined,
        colour: colour || undefined,
        lengthFt: lengthFt === '' ? undefined : Number(lengthFt),
        q: appliedTerm || undefined,
      }),
    [type, colour, lengthFt, appliedTerm],
  );
  const token = useSyncToken(syncKeys.stockUpvc);
  const { state, data, error, retry, sync } = useResource(fetcher, token);

  // The option lists come from whatever the server says exists. They are merged rather than
  // replaced so choosing one colour does not remove the other colours from the selector.
  useEffect(() => {
    if (data === null || !data.available) return;
    setColourOptions((current) => {
      const merged = new Set(current);
      for (const row of data.rows) merged.add(row.colour);
      return [...merged].sort((left, right) => left.localeCompare(right));
    });
    setLengthOptions((current) => {
      const merged = new Set(current);
      for (const row of data.rows) if (row.lengthFt !== null) merged.add(row.lengthFt);
      return [...merged].sort((left, right) => left - right);
    });
  }, [data]);

  const totals = data?.totals;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const paged = useMemo(() => pageOf(rows, currentPage, PAGE_SIZE), [rows, currentPage]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-ink">{heading}</p>
          <p className="mt-0.5 max-w-2xl text-[11px] text-muted">{description}</p>
        </div>
        <LiveSyncBar sync={sync} busy={state === 'loading'} />
      </div>

      <StockReadState state={state} error={error} retry={retry} loadingLabel="Reading UPVC stock…" />

      {state === 'ready' && data !== null && (
        <>
          {data.available ? (
            <div className="mb-3 rounded-field border border-line bg-white p-3 text-[10px] text-muted">
              <span className="font-bold text-ink">Snapshot {data.batchId ?? '—'}</span> · applied{' '}
              {serverTimestampText(data.appliedAt)} · filtered read from{' '}
              {type === null ? 'all three UPVC bands' : `${TYPE_LABEL[type]} only`}
              {colour !== '' && ` · colour ${colour}`}
              {lengthFt !== '' && ` · ${lengthFt} ft`}
              {appliedTerm !== '' && ` · search “${appliedTerm}”`}
            </div>
          ) : (
            <EmptyState
              title="No approved snapshot to filter"
              hint="An owner applies a workbook on the Excel Import / Sync tab. Until then there are no UPVC rows to read."
            />
          )}

          {data.available && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Pieces</p>
                  <p className="mt-1 text-[20px] font-black tabular-nums text-ink">
                    {groupedQuantity(totals?.pieces ?? '0')}{' '}
                    <span className="text-[11px] font-normal text-muted">{PIECES_UNIT_TEXT}</span>
                  </p>
                  <p className="text-[10px] text-muted">the workbook’s Total column</p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Footage</p>
                  <p className="mt-1 text-[20px] font-black tabular-nums text-ink">
                    {groupedQuantity(totals?.footage ?? '0')}{' '}
                    <span className="text-[11px] font-normal text-muted">{FOOTAGE_UNIT_TEXT}</span>
                  </p>
                  <p className="text-[10px] text-muted">
                    over {totals?.footageRowCount ?? 0} of {totals?.rowCount ?? 0} rows
                  </p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Rows in this filter</p>
                  <p className="mt-1 text-[20px] font-black tabular-nums text-ink">{totals?.rowCount ?? 0}</p>
                  <p className="text-[10px] text-muted">
                    {totals?.staleCount ?? 0} stale · {totals?.missingLengthCount ?? 0} with no length
                  </p>
                </div>
                <div className="rounded-field border border-line bg-white p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Negative balances</p>
                  <p className={`mt-1 text-[20px] font-black tabular-nums ${(totals?.negativeCount ?? 0) > 0 ? 'text-brand-red' : 'text-ink'}`}>
                    {totals?.negativeCount ?? 0}
                  </p>
                  <p className="text-[10px] text-muted">kept as the sheet wrote them; never zeroed</p>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-end gap-2">
                {mode === null && (
                  <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                    Stock type
                    <select
                      className="input mt-1 block !w-36 !py-1.5 normal-case font-semibold text-ink"
                      value={type ?? ''}
                      onChange={(event) => {
                        setType(event.target.value === '' ? null : (event.target.value as ServerUpvcType));
                        setPage(1);
                      }}
                    >
                      <option value="">All three</option>
                      <option value="new">New</option>
                      <option value="old">Old</option>
                      <option value="waste">Waste</option>
                    </select>
                  </label>
                )}
                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Colour
                  <select
                    className="input mt-1 block !w-40 !py-1.5 normal-case font-semibold text-ink"
                    value={colour}
                    onChange={(event) => {
                      setColour(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All colours</option>
                    {colourOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Length
                  <select
                    className="input mt-1 block !w-32 !py-1.5 normal-case font-semibold text-ink"
                    value={lengthFt}
                    onChange={(event) => {
                      setLengthFt(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All lengths</option>
                    {lengthOptions.map((option) => (
                      <option key={option} value={String(option)}>
                        {option} ft
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
                  Search
                  <span className="relative mt-1 block">
                    <Search size={13} className="pointer-events-none absolute left-2 top-2 text-faint" />
                    <input
                      className="input !w-56 !py-1.5 !pl-7 normal-case font-semibold text-ink"
                      value={term}
                      onChange={(event) => {
                        setTerm(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Colour, label, type…"
                    />
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setType(mode);
                    setColour('');
                    setLengthFt('');
                    setTerm('');
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-muted">No UPVC row matches those filters.</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-field border border-line bg-white">
                    <table className="w-full min-w-[620px] border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-canvas/70 text-left text-[10px] uppercase tracking-wide text-muted">
                          <th className="px-3 py-2 font-extrabold">Stock type</th>
                          <th className="px-3 py-2 font-extrabold">Colour / label</th>
                          <th className="px-3 py-2 text-right font-extrabold">Length</th>
                          <th className="px-3 py-2 text-right font-extrabold">{PIECES_UNIT_TEXT}</th>
                          <th className="px-3 py-2 text-right font-extrabold">{FOOTAGE_UNIT_TEXT}</th>
                          <th className="px-3 py-2 font-extrabold">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((row, index) => (
                          <tr key={`${row.stockType}-${row.colour}-${row.lengthFt ?? 'none'}-${row.label}-${index}`} className="border-t border-line/60">
                            <td className="px-3 py-2 text-muted">{row.stockTypeLabel}</td>
                            <td className="px-3 py-2">
                              <p className="font-bold text-ink">{row.colour}</p>
                              <p className="text-[10px] text-faint">{row.label}</p>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted">
                              {row.lengthFt === null ? '—' : `${row.lengthFt} ft`}
                            </td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums ${
                                row.negative || isNegativeQuantity(row.pieces)
                                  ? 'font-black text-brand-red'
                                  : 'font-bold text-ink'
                              }`}
                            >
                              {groupedQuantity(row.pieces)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">
                              {row.footage === null ? <span className="text-faint">—</span> : groupedQuantity(row.footage)}
                            </td>
                            <td className="px-3 py-2">
                              <span className="flex flex-wrap gap-1">
                                {row.negative && <span className="chip bg-brand-red/10 text-brand-red">negative</span>}
                                {row.stale && <span className="chip bg-brand-orange/15 text-[#C96B15]">stale</span>}
                                {!row.negative && !row.stale && <span className="text-faint">—</span>}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={currentPage} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
                </>
              )}

              <div className="mt-4">
                <ColourLengthMatrix
                  cells={data.matrix}
                  byColour={data.byColour}
                  byLength={data.byLength}
                  totals={data.totals}
                />
                <p className="mt-1 text-[10px] text-faint">
                  The length class is the sheet’s own; its Feet column is a length label and is
                  never read as footage.
                </p>
              </div>

              <p className="mt-3 text-[10px] text-muted">{FOOTAGE_NOTE}</p>
              <p className="mt-1 text-[10px] text-faint">
                Filtering and totalling happen on the server. This screen adds no quantities and
                writes nothing; stock movements created {String(data.stockMovementsCreated)}.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
