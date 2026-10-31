/** The stock workbook preview and the owner's confirmed import.
 *
 *  This is the panel's only screen that sends bytes, and the only one that can start a stock
 *  import, so the two rules that shape every line below are:
 *
 *  **Reading is not confirming.** Uploading a file and viewing its plan writes nothing. The apply
 *  control exists only after a reading that the server marked ready, sits behind an explicit
 *  checkbox, and sends the same bytes, their SHA-256 and the plan digest the server issued. A file
 *  chosen another day, or a preview that has scrolled out of mind, cannot be applied by a stray
 *  click: the checkbox starts unticked on every reading and the button stays disabled until it is
 *  ticked. The three flags on the preview remain `false` and are still refused by the transport if
 *  they ever arrive otherwise; the apply route is the only place a snapshot is written.
 *
 *  **The sheet's figures, not the panel's.** Nothing on this screen adds two quantities together.
 *  Every number is either a cell the server read (with its coordinate beside it) or a difference the
 *  server computed and signed. A grand total is a footer because the workbook prints it as one; the
 *  rows under it are not re-added to it, because `1,577,529` is the sheet's own answer and a client
 *  that produced a different one would be a second, less careful bookkeeper.
 *
 *  Owner decision **D-1** (2026-10-16) says which UPVC line is *the stock position*: TOTAL, with the
 *  STOCK line still rendered beside it and the gap between them still reconciled. **D-2** and **D-3**
 *  say two other things are *not* settled: a row whose group was guessed from its own text stays
 *  labelled as guessed, and no company name is supplied where the sheet disagrees with itself. Those
 *  are presentational choices about emphasis and honesty, and the screen states them as such.
 */

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, FileSearch, ShieldAlert } from 'lucide-react';
import { Card, EmptyState, Spinner } from './ui/Card';
import { isNegativeQuantity } from '../lib/liveDisplay';
import { useLiveSession } from '../lib/liveSession';
import { invalidate, syncKeys } from '../lib/syncStore';
import {
  applyStockImport,
  previewStockWorkbook,
  ServerError,
  type ServerStockImportApply,
} from '../lib/serverApi';
import {
  ALONGSIDE_HEADING_TEXT,
  AUTHORITY_HEADING_TEXT,
  DIFFERENCE_CONVENTION_TEXT,
  StockPreviewShapeError,
  applyReadinessText,
  associationNote,
  freshnessNote,
  ledgerAuthority,
  quantityText,
  rowRoleLabel,
  summaryLine,
  tableFamilyLabel,
  unitText,
  valueSourceLabel,
  type ServerReconciliation,
  type ServerStockCell,
  type ServerStockPreview,
  type ServerStockRow,
  type ServerStockSection,
  type ServerStockTable,
  type ServerStockWarning,
  type ServerValidation,
} from '../lib/stockPreviewModel';

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'uploading'; label: string; bytes: number }
  | { kind: 'done'; preview: ServerStockPreview; bytes: Uint8Array; label: string }
  | { kind: 'failed'; code: string; message: string; details: string[] };

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'applied'; outcome: ServerStockImportApply }
  | { kind: 'failed'; message: string; details: string[] };

/** Local styles for the server's own vocabularies. The label shown is always the raw value — these
 *  only pick a colour, so a code this panel has never seen still reads as itself. */
const TONE: Record<string, string> = {
  passed: 'bg-brand-green/12 text-brand-green',
  complete: 'bg-brand-green/12 text-brand-green',
  matching: 'bg-brand-green/12 text-brand-green',
  warning: 'bg-brand-orange/15 text-[#C96B15]',
  incomplete: 'bg-brand-orange/15 text-[#C96B15]',
  differs: 'bg-brand-orange/15 text-[#C96B15]',
  failed: 'bg-brand-red/10 text-brand-red',
  notCompared: 'bg-line text-muted',
};

function Tone({ value }: { value: string }) {
  return <span className={`chip ${TONE[value] ?? 'bg-line text-muted'}`}>{value}</span>;
}

/** One figure, exactly as the wire sent it: decimal text or the em dash. Never a rounded float, and
 *  never a zero standing in for a value the sheet did not hold. */
function Cell({ cell, strong = false }: { cell: ServerStockCell; strong?: boolean }) {
  const missing = cell.value === null;
  const negative = cell.value !== null && isNegativeQuantity(cell.value);
  return (
    <span
      title={`${cell.coordinate} · ${valueSourceLabel(cell.source)}${cell.warnings.length ? ` · ${cell.warnings.join(', ')}` : ''}`}
      className={
        negative
          ? 'font-bold text-brand-red'
          : missing
            ? 'font-semibold text-faint'
            : strong
              ? 'font-black text-ink'
              : 'font-semibold text-ink'
      }
    >
      {quantityText(cell.value)}
    </span>
  );
}

/** A figure that is not a plain typed number says so: where it came from, and what the reading had
 *  to warn about for that one cell. A missing cache is shown as no value plus this badge, never as
 *  a zero. */
function SourceBadge({ cell }: { cell: ServerStockCell }) {
  if (cell.source === 'static' && cell.warnings.length === 0) return null;
  return (
    <span className="chip bg-line text-muted">
      {valueSourceLabel(cell.source)}
      {cell.warnings.length > 0 && ` · ${cell.warnings.join(', ')}`}
    </span>
  );
}

function RowLine({
  table,
  row,
  authoritative,
  alongside,
}: {
  table: ServerStockTable;
  row: ServerStockRow;
  authoritative: boolean;
  alongside: boolean;
}) {
  const isTotal = row.role === 'grandTotal';
  const isSubtotal = row.role === 'groupSubtotal';
  return (
    <tr
      className={
        isTotal
          ? 'border-t-2 border-line bg-canvas/60'
          : isSubtotal
            ? 'border-t border-line/70 bg-canvas/30'
            : 'border-b border-line/50 last:border-b-0'
      }
    >
      <td className="px-3 py-2 align-top text-[10px] tabular-nums text-faint">{row.rowNumber}</td>
      <td className="px-3 py-2 align-top text-[11px]">
        <span className={isTotal ? 'font-black text-ink' : isSubtotal ? 'font-extrabold text-ink' : 'font-semibold text-ink'}>
          {row.label === '' ? <span className="font-normal italic text-faint">no label on the sheet</span> : row.label}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
          <span className="chip bg-line text-muted">{rowRoleLabel(row.role)}</span>
          {authoritative && <span className="chip bg-brand-blue/10 text-brand-blue">stock position (D-1)</span>}
          {alongside && <span className="chip bg-brand-blue/10 text-brand-blue">shown alongside</span>}
          <span className="text-faint">{row.labelCoordinate}</span>
          {row.parentLabel !== null && (
            <span title="The group this row sits under on the sheet, as the reading reported it.">
              under “{row.parentLabel}”
              {row.parentCoordinate !== null && <span className="text-faint"> · {row.parentCoordinate}</span>}
            </span>
          )}
          {row.association !== 'notApplicable' && (
            <span className="chip bg-brand-orange/15 text-[#C96B15]" title={associationNote(row.association)}>
              {row.association}
            </span>
          )}
          <span className={row.unit === null ? 'chip bg-canvas text-faint' : 'chip bg-canvas text-muted'}>
            {unitText(row.unit)}
          </span>
          {row.warnings.map((warning) => (
            <span key={warning} className="chip bg-brand-red/10 text-brand-red">
              {warning}
            </span>
          ))}
          {row.strays.length > 0 && (
            <span
              className="chip bg-brand-purple/12 text-brand-purple"
              title={`Values the sheet placed outside this table's declared columns: ${row.strays.join(', ')}`}
            >
              {row.strays.length} value{row.strays.length === 1 ? '' : 's'} outside the columns
            </span>
          )}
        </span>
      </td>
      {table.valueColumns.map((column) => {
        const cell = row.cells.find((candidate) => candidate.columnKey === column.key);
        return (
          <td key={column.key} className="px-3 py-2 text-right align-top text-[11px] tabular-nums">
            {cell ? (
              <>
                <Cell cell={cell} strong={isTotal} /> <SourceBadge cell={cell} />
              </>
            ) : (
              <span className="text-faint">—</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function ReconciliationLine({ item }: { item: ServerReconciliation }) {
  return (
    <li className="border-b border-line/50 py-1.5 last:border-b-0">
      <span className="flex flex-wrap items-baseline gap-2 text-[11px]">
        <span className="font-extrabold text-ink">{item.code}</span>
        <span className="text-muted">
          {item.tableId} · {item.sheet}
        </span>
        {item.displayedTotalCoordinate !== null && <span className="text-faint">{item.displayedTotalCoordinate}</span>}
        {item.cell !== null && (
          <span className="text-faint">
            {item.cell.sheet}!{item.cell.coordinate}
          </span>
        )}
      </span>
      <span className="mt-0.5 flex flex-wrap items-baseline gap-3 text-[11px] tabular-nums">
        <span>
          <span className="text-muted">the sheet displays </span>
          <span className="font-bold">{quantityText(item.displayedTotal)}</span>
        </span>
        <span>
          <span className="text-muted">the rows add up to </span>
          <span className="font-bold">{quantityText(item.computed)}</span>
        </span>
        <span>
          <span className="text-muted">difference </span>
          <span
            className={
              item.difference !== null && isNegativeQuantity(item.difference)
                ? 'font-black text-brand-red'
                : 'font-black text-[#C96B15]'
            }
          >
            {quantityText(item.difference)}
          </span>
        </span>
      </span>
      <span className="block text-[10px] text-muted">{item.detail}</span>
    </li>
  );
}

function WarningLine({ item }: { item: ServerStockWarning }) {
  const where = [
    item.sourceSheet,
    item.tableId,
    item.rowNumber !== null ? `row ${item.rowNumber}` : null,
    item.coordinate,
    item.columnLabel,
  ].filter((part): part is string => part !== null && part !== '');
  return (
    <li className="py-1 text-[11px]">
      <span className="chip bg-brand-orange/15 text-[#C96B15]">{item.code}</span>{' '}
      <span className="text-ink">{item.message}</span>
      {where.length > 0 && <span className="ml-1 text-faint">({where.join(' · ')})</span>}
    </li>
  );
}

function ValidationBlock({ validation }: { validation: ServerValidation }) {
  return (
    <div className="mb-4 rounded-field border border-line bg-white p-3">
      <p className="flex flex-wrap items-center gap-2 text-[12px] font-black text-ink">
        Validation on this reading <Tone value={validation.status} />
      </p>
      <p className="mt-1 text-[10px] text-muted">
        The worst outcome any check reached — not the apply readiness signal. Readiness is decided
        by the apply plan below from the file's authorised revision and the plan's blocking errors,
        and a warning here is shown as a warning rather than smoothed into a pass.
      </p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {validation.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-[11px]">
            <Tone value={check.status} />
            <span>
              <span className="font-bold text-ink">{check.id}</span> <span className="text-muted">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {validation.warnings.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-muted">
            Warnings ({validation.warnings.length})
          </p>
          <ul className="mt-1 divide-y divide-line/50">
            {validation.warnings.map((warning, index) => (
              <WarningLine key={`${warning.code}-${index}`} item={warning} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const shortDigest = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 16)}…`);

/** The apply plan, and the only control in this panel that writes a stock snapshot.
 *
 *  The confirmation is not a dialog opened by the preview: it is a checkbox that starts unticked
 *  and a button disabled until it is ticked, rendered only for a plan the server marked ready. The
 *  action it starts re-sends the same bytes and declares their hash plus the plan digest, so the
 *  server can prove the confirmation belongs to this file and this reading. */
function ApplyPlanBlock({
  preview,
  confirmed,
  onConfirmed,
  applyState,
  onApply,
}: {
  preview: ServerStockPreview;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  applyState: ApplyState;
  onApply: () => void;
}) {
  const ready = preview.readyToApply;
  const applied = applyState.kind === 'applied';
  return (
    <div
      className={`mb-4 rounded-field border-2 p-3 ${
        ready ? 'border-brand-green/40 bg-brand-green/5' : 'border-brand-orange/40 bg-brand-orange/5'
      }`}
    >
      <p className="flex flex-wrap items-center gap-2 text-[12px] font-black text-ink">
        Apply plan <Tone value={ready ? 'passed' : 'failed'} /> <span>{ready ? 'ready' : 'blocked'}</span>
      </p>
      <p className="mt-1 text-[11px] text-ink">{applyReadinessText(preview)}</p>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span>
          authorised revision{' '}
          <span className="font-mono text-ink">
            {preview.authorizedFileSha256 === null ? 'none configured' : shortDigest(preview.authorizedFileSha256)}
          </span>
        </span>
        <span>
          this file{' '}
          <span className="font-mono text-ink">{shortDigest(preview.provenance.fileSha256)}</span>{' '}
          <span className={preview.authorizedFileMatch ? 'font-bold text-brand-green' : 'font-bold text-brand-red'}>
            {preview.authorizedFileMatch ? 'matches' : 'does not match'}
          </span>
        </span>
        <span>
          plan digest <span className="font-mono text-ink">{shortDigest(preview.applyPreviewDigest)}</span>
        </span>
        <span>{preview.applyableItemCount} figures to apply</span>
        <span>{preview.quarantineRowCount} read rows withheld</span>
      </p>

      {preview.applyPlanErrors.length > 0 && (
        <ul className="mt-2 space-y-1 text-[10px] text-brand-red">
          {preview.applyPlanErrors.map((error, index) => {
            const where = [
              error.sourceSheet,
              error.tableId,
              error.rowNumber !== null ? `row ${error.rowNumber}` : null,
            ].filter((part): part is string => part !== null && part !== '');
            return (
              <li key={`${error.code}-${index}`}>
                <span className="font-black">{error.code}</span> {error.detail}
                {where.length > 0 && <span className="text-muted"> ({where.join(' · ')})</span>}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-2 text-[10px] text-muted">
        Viewing this page wrote nothing. Applying stores a dated snapshot for this panel and the
        phone. It posts no stock movement, changes no product master and does not touch debtor
        balances. The snapshot is the level the owner approved in this file; the balance tab remains
        a SUM over movements and is not rewritten by an import.
      </p>

      {!ready && (
        <p className="mt-2 text-[10px] font-bold text-[#C96B15]">
          No apply control is offered for this reading. Preview a file that the server marks ready.
        </p>
      )}

      {ready && !applied && (
        <div className="mt-3 rounded-field border border-line bg-white p-3">
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={confirmed}
              disabled={applyState.kind === 'applying'}
              onChange={(event) => onConfirmed(event.target.checked)}
            />
            <span>
              I have read this preview and confirm applying{' '}
              <span className="font-black">{preview.applyableItemCount} figures</span> from{' '}
              <span className="font-bold">{preview.provenance.filename}</span> (SHA-256{' '}
              <span className="font-mono">{shortDigest(preview.provenance.fileSha256)}</span>) to the
              approved stock snapshot. I understand {preview.quarantineRowCount} read rows will be
              withheld and reported, not applied.
            </span>
          </label>
          <button
            type="button"
            className="btn-primary btn-sm mt-2"
            disabled={!confirmed || applyState.kind === 'applying'}
            onClick={onApply}
          >
            {applyState.kind === 'applying' ? 'Applying…' : `Apply ${preview.applyableItemCount} figures`}
          </button>
        </div>
      )}

      {applyState.kind === 'applying' && (
        <div className="mt-2">
          <Spinner label="The backend is re-reading the workbook, re-building the plan and writing the snapshot in one transaction…" />
        </div>
      )}

      {applyState.kind === 'failed' && (
        <div className="mt-3 rounded-field border border-brand-red/30 bg-white p-3">
          <p className="flex items-center gap-2 text-[11px] font-black text-brand-red">
            <ShieldAlert size={14} /> This import did not happen
          </p>
          <p className="mt-1 text-[11px] text-ink">{applyState.message}</p>
          {applyState.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10px] text-muted">
              {applyState.details.map((detail) => (
                <li key={detail}>· {detail}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[10px] text-muted">
            The server refused the apply or the transaction rolled back. No snapshot, batch or audit
            row was left behind.
          </p>
        </div>
      )}

      {applyState.kind === 'applied' && (
        <div className="mt-3 rounded-field border border-brand-green/30 bg-white p-3">
          <p className="flex items-center gap-2 text-[11px] font-black text-brand-green">
            <CheckCircle2 size={14} />{' '}
            {applyState.outcome.replayed
              ? 'Already applied — this exact file was imported before'
              : 'Snapshot applied'}
          </p>
          <p className="mt-1 text-[11px] text-ink">
            {applyState.outcome.replayed
              ? 'The server returned the existing batch and wrote nothing a second time. The approved stock is unchanged.'
              : 'The snapshot was written in one transaction. Both the panel and the phone read it from the backend.'}
          </p>
          <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted">
            <span>
              batch <span className="font-mono font-bold text-ink">{applyState.outcome.batch.id}</span>
            </span>
            <span>{applyState.outcome.batch.appliedAt}</span>
            <span>{applyState.outcome.batch.appliedItemCount} applied</span>
            <span>{applyState.outcome.batch.carriedForwardCount} carried forward</span>
            <span>{applyState.outcome.batch.staleCount} stale</span>
            <span>{applyState.outcome.batch.quarantineCount} withheld</span>
            <span>stock movements created {String(applyState.outcome.stockMovementsCreated)}</span>
            <span>business records created {String(applyState.outcome.businessRecordsCreated)}</span>
          </p>
          <p className="mt-1 text-[10px] text-muted">
            Every stock read — dashboard, Total Stock, UPVC, the two gap tabs and the approved
            snapshot — re-reads the new batch on its next refresh. The phone reads the same backend
            and shows the same snapshot; nothing is copied from this panel to the app.
          </p>
        </div>
      )}
    </div>
  );
}

function TableBlock({ table, reconciliations }: { table: ServerStockTable; reconciliations: ServerReconciliation[] }) {  const authority = ledgerAuthority(table);
  const alongsideRows = authority?.alongside.map((row) => row.rowNumber) ?? [];
  const renderedCells = new Set(table.rows.flatMap((row) => row.cells.map((cell) => cell.coordinate)));
  const grandTotalAlreadyShown =
    table.displayedGrandTotal !== null && renderedCells.has(table.displayedGrandTotal.coordinate);
  const note = freshnessNote(table);

  return (
    <div className="mb-4 rounded-field border border-line bg-white">
      <div className="border-b border-line px-3 py-2">
        <p className="flex flex-wrap items-baseline gap-2 text-[12px] font-black text-ink">
          {table.displayName}
          <span className="chip bg-line text-muted">{tableFamilyLabel(table.family)}</span>
          <Tone value={table.completeness} />
          {table.duplicateOf !== null && (
            <span
              className="chip bg-brand-purple/12 text-brand-purple"
              title={`This table restates ${table.duplicateOf}. A restatement is never added to the table it restates.`}
            >
              restates {table.duplicateOf} — {table.duplicateState ?? 'not compared'}
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span>
            id <span className="font-bold text-ink">{table.id}</span>
          </span>
          <span className="text-faint">{table.sourceSheet}</span>
          <span title="The label the sheet itself wrote, kept next to the name this panel shows.">
            sheet label “{table.sourceLabel}” · {table.sourceLabelCoordinate}
          </span>
          {table.sourceHeading !== '' && (
            <span>
              heading “{table.sourceHeading}” · {table.sourceHeadingCoordinate}
            </span>
          )}
          <span>
            header row {table.headerRow} · labels in {table.labelColumn}
          </span>
          {table.firstDataRow !== null && (
            <span>
              rows {table.firstDataRow}–{table.lastDataRow}
            </span>
          )}
          <span>{table.rowCount} rows</span>
          <span>formula cache {table.formulaCacheUsed ? 'used' : 'not used'}</span>
        </p>
        {authority !== null && (
          <p className="mt-1 text-[10px] text-muted">
            <span className="font-bold text-brand-blue">{AUTHORITY_HEADING_TEXT}</span>
            {authority.alongside.length > 0 && <span className="ml-2">{ALONGSIDE_HEADING_TEXT}</span>}
          </p>
        )}
        {note !== null && <p className="mt-1 text-[10px] italic text-[#C96B15]">{note}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">row</th>
              <th className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                {table.labelColumn} · as the sheet labels it
              </th>
              {table.valueColumns.map((column) => (
                <th
                  key={column.key}
                  className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted"
                >
                  {column.label}
                  <span className="ml-1 font-normal normal-case text-faint">{column.coordinate}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <RowLine
                key={row.rowNumber}
                table={table}
                row={row}
                authoritative={
                  authority !== null &&
                  authority.authoritative !== null &&
                  authority.authoritative.rowNumber === row.rowNumber
                }
                alongside={alongsideRows.includes(row.rowNumber)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-3 py-2 text-[11px]">
        {table.displayedGrandTotal !== null && !grandTotalAlreadyShown && (
          <p className="flex flex-wrap items-baseline gap-2 font-black text-ink">
            <span>Grand total the sheet prints</span>
            <Cell cell={table.displayedGrandTotal} strong />
            <span className="font-normal text-faint">{table.displayedGrandTotal.coordinate}</span>
          </p>
        )}
        {table.displayedTotals.length > 0 && (
          <p className="flex flex-wrap items-baseline gap-2 text-[10px] text-muted">
            <span className="font-extrabold uppercase tracking-wide">Totals the sheet prints, quoted and not re-added</span>
            {table.displayedTotals.map((cell) => (
              <span key={cell.coordinate} className="tabular-nums">
                {cell.coordinate} {quantityText(cell.value)}
              </span>
            ))}
          </p>
        )}
        {table.warnings.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
            {table.warnings.map((code) => (
              <span key={code} className="chip bg-brand-orange/15 text-[#C96B15]">
                {code}
              </span>
            ))}
          </p>
        )}
        {reconciliations.length > 0 && (
          <>
            <p className="mt-2 text-[10px] font-extrabold uppercase tracking-wide text-muted">
              Differences this reading reports and does not resolve ({reconciliations.length})
            </p>
            <p className="text-[10px] italic text-faint">{DIFFERENCE_CONVENTION_TEXT}</p>
            <ul className="mt-1">
              {reconciliations.map((item, index) => (
                <ReconciliationLine key={`${item.code}-${index}`} item={item} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: ServerStockSection }) {
  const byTable = new Map<string, ServerReconciliation[]>();
  section.reconciliations.forEach((item) => {
    const bucket = byTable.get(item.tableId);
    if (bucket) bucket.push(item);
    else byTable.set(item.tableId, [item]);
  });
  const knownTables = new Set(section.tables.map((table) => table.id));
  const unattributed = section.reconciliations.filter((item) => !knownTables.has(item.tableId));

  return (
    <div className="mb-6">
      <div className="mb-2">
        <p className="flex flex-wrap items-baseline gap-2 text-[14px] font-black text-ink">
          {section.displayName}
          <Tone value={section.completeness} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <span>
            id <span className="font-bold text-ink">{section.id}</span>
          </span>
          <span className="text-faint">{section.sourceSheet}</span>
          <span>kind {section.kind}</span>
          <span title="The name the sheet wrote, shown wherever the displayed name was rewritten.">
            sheet label “{section.sourceLabel}” · {section.sourceLabelCoordinate}
          </span>
          {section.aliasApplied && <span className="chip bg-brand-blue/10 text-brand-blue">name rewritten by the read rules</span>}
          {!section.sectionTitlePresent && (
            <span className="chip bg-line text-muted">grouped by a column band, not by a title cell</span>
          )}
          <span>{section.tables.length} tables</span>
        </p>
        {section.warnings.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
            {section.warnings.map((code) => (
              <span key={code} className="chip bg-brand-orange/15 text-[#C96B15]">
                {code}
              </span>
            ))}
          </p>
        )}
      </div>
      {section.tables.map((table) => (
        <TableBlock key={table.id} table={table} reconciliations={byTable.get(table.id) ?? []} />
      ))}
      {unattributed.length > 0 && (
        <div className="rounded-field border border-line bg-white px-3 py-2">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#C96B15]">
            Differences naming a table this screen does not show ({unattributed.length})
          </p>
          <ul>
            {unattributed.map((item, index) => (
              <ReconciliationLine key={`${item.code}-${index}`} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function StockWorkbookPreview() {
  const user = useLiveSession((state) => state.user);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [fileName, setFileName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (file: File) => {
    setConfirmed(false);
    setApplyState({ kind: 'idle' });
    setPhase({ kind: 'reading' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setPhase({ kind: 'uploading', label: file.name, bytes: bytes.byteLength });
      const preview = await previewStockWorkbook(bytes, file.name);
      setPhase({ kind: 'done', preview, bytes, label: file.name });
    } catch (error) {
      if (error instanceof StockPreviewShapeError) {
        setPhase({ kind: 'failed', code: 'malformed_response', message: error.message, details: error.details });
      } else if (error instanceof ServerError) {
        setPhase({
          kind: 'failed',
          code: error.code,
          message:
            error.status === 0
              ? error.message
              : `${error.status} · ${error.code} — ${error.message}`,
          details: Object.entries(error.fields ?? {}).map(([field, reason]) => `${field}: ${reason}`),
        });
      } else {
        setPhase({
          kind: 'failed',
          code: 'upload_interrupted',
          message:
            'The workbook never reached the backend: this browser could not read the file, or the upload was interrupted.',
          details: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }, []);

  const apply = useCallback(async () => {
    if (phase.kind !== 'done' || !phase.preview.readyToApply || !confirmed) return;
    setApplyState({ kind: 'applying' });
    try {
      const outcome = await applyStockImport(phase.bytes, {
        fileName: phase.label,
        fileSha256: phase.preview.provenance.fileSha256,
        previewDigest: phase.preview.applyPreviewDigest,
      });
      setApplyState({ kind: 'applied', outcome });
      // The apply is the one write in the stock section. Every read key is bumped together so an
      // open dashboard or list re-reads the batch that was just committed instead of showing the
      // previous one. A replayed apply bumps them too: the read is still the server's current answer.
      invalidate(
        syncKeys.stockSummary,
        syncKeys.stockUpvc,
        syncKeys.stockAccessories,
        syncKeys.stockProduction,
        syncKeys.stockImported,
        syncKeys.stockImports,
      );
    } catch (error) {
      if (error instanceof ServerError) {
        setApplyState({
          kind: 'failed',
          message:
            error.status === 0
              ? error.message
              : `${error.status} · ${error.code} — ${error.message}`,
          details: Object.entries(error.fields ?? {}).map(([field, reason]) => `${field}: ${reason}`),
        });
      } else {
        setApplyState({
          kind: 'failed',
          message: 'The apply request did not complete.',
          details: [error instanceof Error ? error.message : String(error)],
        });
      }
    }
  }, [phase, confirmed]);

  // `/stock` is open to employees, and the server refuses this read for them, so the refusal is
  // stated as a refusal. Rendering an empty table instead would present a permission answer as
  // "the office has no stock data", which is the one mistake this screen could not take back.
  if (user === null) return null;
  if (user.role !== 'owner') {
    return (
      <div className="py-6">
        <Card className="mx-auto max-w-lg text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red">
            <ShieldAlert size={22} />
          </div>
          <p className="text-[15px] font-black text-ink">The backend answers this read for owner accounts only</p>
          <p className="mt-1.5 text-[13px] text-muted">
            You are signed in as {user.name} ({user.role}). The stock-preview read refuses an employee
            token before a single byte of a workbook is read, so nothing was uploaded and nothing is
            listed. That is the server's answer, not a button this panel chose to hide — and it is why
            this screen shows a refusal rather than an empty table.
          </p>
        </Card>
      </div>
    );
  }

  const preview = phase.kind === 'done' ? phase.preview : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            void run(file);
          }}
        />
        <button type="button" className="btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
          <FileSearch size={15} /> Choose workbook
        </button>
        <p className="max-w-xl text-[11px] text-muted">
          Read in this browser and sent as bytes to this backend, and nowhere else. The file's own
          header decides whether it is a workbook — the name is a label, and the panel keeps the path
          to itself. Reading this file writes nothing; an import is the separate, confirmed action in
          the apply plan below.
        </p>
      </div>

      {fileName !== '' && (
        <p className="mb-3 text-[11px] font-bold text-ink">
          {/* A browser reports only this name, never the folder it came from, and this panel sends
           *  the name as a label: no operator path reaches a URL, the response or a log line. */}
          {fileName}
          {phase.kind === 'uploading' && (
            <span className="font-normal text-muted"> · {(phase.bytes / 1024).toFixed(1)} kB read in this browser</span>
          )}
          {phase.kind === 'done' && (
            <span className="font-normal text-muted"> · {phase.preview.provenance.sizeBytes} bytes the backend counted</span>
          )}
        </p>
      )}

      {phase.kind === 'idle' && (
        <EmptyState
          title="No workbook read yet"
          hint="Choose an .xlsx and this screen reports what its three approved sheets say — the cell each figure came from, the totals the sheet prints, and every difference between them. Reading writes nothing; if the server marks the file ready, you can confirm an import below the reading."
        />
      )}
      {phase.kind === 'reading' && <Spinner label="Reading the file in this browser…" />}
      {phase.kind === 'uploading' && (
        <Spinner
          label={`Reading ${phase.label} on the backend — a large workbook takes seconds, and the backend stops itself at 20 seconds of parsing and says so.`}
        />
      )}

      {phase.kind === 'failed' && (
        <Card className="border border-brand-red/30">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-black text-brand-red">
            <ShieldAlert size={16} /> This reading did not happen
          </p>
          <p className="mt-1 text-[11px] text-ink">{phase.message}</p>
          <p className="mt-1 text-[10px] text-muted">
            Code <span className="font-bold">{phase.code}</span>. Shown as a refusal: no rows, no
            totals and no stock position appear below it, because the backend produced none. Nothing
            was written either way.
          </p>
          {phase.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-muted">
              {phase.details.map((detail) => (
                <li key={detail}>· {detail}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => inputRef.current?.click()}>
            Choose another workbook
          </button>
        </Card>
      )}

      {preview !== null && (
        <div>
          <div className="mb-3 rounded-field border border-line bg-white p-3">
            <p className="text-[11px] font-bold text-ink">{summaryLine(preview).text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted">
              <span>
                file <span className="font-bold text-ink">{preview.provenance.filename}</span>
              </span>
              <span>
                SHA-256 <span className="font-mono text-ink">{preview.provenance.fileSha256}</span>
              </span>
              <span>{preview.provenance.sizeBytes} bytes</span>
              <span>
                the workbook's own “modified” property{' '}
                <span className="font-bold text-ink">
                  {preview.provenance.workbookPropertyModifiedAt ?? 'not stated'}
                </span>
              </span>
              <span>format {preview.sourceFormat}</span>
              <span>
                sheets: {preview.provenance.sheetsRead.length} read of{' '}
                {preview.provenance.sheetsEnumerated.length} in the file ({preview.provenance.sheetsRead.join(', ') ||
                  'none'})
              </span>
              <span>approved {preview.allowedSheets.join(', ')}</span>
              <span>
                formula cache {preview.provenance.formulaCacheUsed ? 'used' : 'not used'} ·{' '}
                {preview.formulaCacheMissingCount} missing · {preview.formulaCacheUnusableCount} unusable
              </span>
              <span>
                warnings {preview.warningCount} counted, {preview.validation.warnings.length} listed
                {preview.warningCount > preview.validation.warnings.length
                  ? ' (the list is capped; the count is not)'
                  : ''}
              </span>
              <span>{preview.incompleteTableCount} incomplete tables</span>
            </p>
            <p className="mt-2 text-[10px] font-bold text-brand-blue">
              {preview.disclaimer} — businessRecordsCreated{' '}
              {String(preview.businessRecordsCreated)}, stockChanged {String(preview.stockChanged)}.
              Ready to apply is the server's readiness signal, not a write that already happened.
            </p>
          </div>

          <ValidationBlock validation={preview.validation} />

          <ApplyPlanBlock
            preview={preview}
            confirmed={confirmed}
            onConfirmed={setConfirmed}
            applyState={applyState}
            onApply={() => void apply()}
          />

          <p className="mb-3 text-[10px] text-muted">
            The four UPVC ledgers print both a STOCK and a TOTAL line for the same families, and the
            workbook never says which of them is the ledger. Per owner decision D-1 the TOTAL line is
            shown as the stock position; the STOCK line stays visible beside it and the signed
            difference between them stays on this page. Two figures that disagree are reported as two
            figures: nothing here picks one and throws the other away, and nothing here was
            recalculated. {preview.reconciliations.length} differences are listed under the table each
            one belongs to.
          </p>

          {preview.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}
