/** Small pieces shared by the stock views: status chips, the snapshot banner, figure rendering and
 *  the one control that starts an automatic re-read.
 *
 *  The status vocabulary is the backend's (`resolved`, `withheld`, `unavailable`, `warning`), and
 *  an unknown value renders as itself. A withheld figure is never shown as zero; a category with
 *  no resolved rows shows the withheld amount beside the word "withheld" and no stock quantity.
 */

import type { ReactNode } from 'react';
import { Spinner } from '../ui/Card';
import { isNegativeQuantity } from '../../lib/liveDisplay';
import { unitText } from '../../lib/stockPreviewModel';
import {
  FOOTAGE_UNIT_TEXT,
  PIECES_UNIT_TEXT,
  groupedQuantity,
  serverTimestampText,
} from '../../lib/stockView';
import {
  AUTO_SYNC_CHOICES,
  AUTO_SYNC_LABEL,
  autoSyncSentence,
} from '../../lib/useStockAutoSync';
import type { ServerStockBatchBrief, ServerStockCategoryStatus } from '../../lib/serverApi';

const STATUS_TONE: Record<string, string> = {
  resolved: 'bg-brand-green/12 text-brand-green',
  withheld: 'bg-brand-orange/15 text-[#C96B15]',
  unavailable: 'bg-line text-muted',
  warning: 'bg-brand-orange/15 text-[#C96B15]',
  info: 'bg-brand-blue/10 text-brand-blue',
  critical: 'bg-brand-red/10 text-brand-red',
};

export function StockChip({ value }: { value: string }) {
  return <span className={`chip ${STATUS_TONE[value] ?? 'bg-line text-muted'}`}>{value}</span>;
}

export function CategoryStatusChip({ status }: { status: ServerStockCategoryStatus }) {
  const text = status === 'resolved' ? 'read and applied' : status === 'withheld' ? 'withheld by the plan' : 'not imported';
  return <span className={`chip ${STATUS_TONE[status] ?? 'bg-line text-muted'}`}>{text}</span>;
}

/** One decimal string and its unit, grouped for reading. `null` is a dash, never a zero. */
export function QuantityFigure({
  value,
  unit,
  strong = false,
}: {
  value: string | null;
  unit: string | null;
  strong?: boolean;
}) {
  if (value === null) return <span className="text-faint">—</span>;
  return (
    <span className={isNegativeQuantity(value) ? 'font-black text-brand-red' : strong ? 'font-black text-ink' : 'font-bold text-ink'}>
      {groupedQuantity(value)} <span className="text-[10px] font-normal text-muted">{unitText(unit)}</span>
    </span>
  );
}

/** Pieces and footage, kept apart on purpose. The two are different measures of the same rows; a
 *  combined figure would be a number the workbook never states. */
export function UpvcFigures({
  pieces,
  footage,
  strong = false,
}: {
  pieces: string | null;
  footage: string | null;
  strong?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span>
        <span className={isNegativeQuantity(pieces ?? '') ? 'font-black text-brand-red' : strong ? 'font-black text-ink' : 'font-bold text-ink'}>
          {pieces === null ? '—' : groupedQuantity(pieces)}
        </span>{' '}
        <span className="text-[10px] font-normal text-muted">{PIECES_UNIT_TEXT}</span>
      </span>
      <span>
        <span className="font-bold text-ink">{footage === null ? '—' : groupedQuantity(footage)}</span>{' '}
        <span className="text-[10px] font-normal text-muted">{FOOTAGE_UNIT_TEXT}</span>
      </span>
    </span>
  );
}

/** The batch every figure on this screen came from. */
export function SnapshotBanner({ snapshot }: { snapshot: ServerStockBatchBrief }) {
  if (!snapshot.available) {
    return (
      <div className="mb-4 rounded-field border border-line bg-white p-3 text-[11px] text-muted">
        No workbook has been applied. The dashboard has no approved level to show; the Movement
        Ledger is a different question and remains available.
      </div>
    );
  }
  const sha = snapshot.fileSha256;
  const short = sha === null ? 'not recorded' : sha.length <= 16 ? sha : `${sha.slice(0, 16)}…`;
  const matches = snapshot.authorizedSha256 !== null && sha === snapshot.authorizedSha256;
  return (
    <div className="mb-4 rounded-field border border-line bg-white p-3">
      <p className="flex flex-wrap items-baseline gap-2 text-[12px] font-black text-ink">
        {snapshot.filename ?? 'unnamed workbook'}
        <span className="chip bg-brand-green/12 text-brand-green">approved snapshot</span>
        <span className="text-[10px] font-semibold text-muted">
          {snapshot.appliedItemCount} applied · {snapshot.staleCount} stale · {snapshot.quarantineCount} withheld
        </span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span>
          batch <span className="font-mono text-ink">{snapshot.batchId ?? '—'}</span>
        </span>
        <span>
          applied <span className="font-bold text-ink">{serverTimestampText(snapshot.appliedAt)}</span>
          {snapshot.appliedByName !== null && (
            <>
              {' '}by <span className="font-bold text-ink">{snapshot.appliedByName}</span>
            </>
          )}
        </span>
        <span>
          file SHA-256 <span className="font-mono text-ink">{short}</span>{' '}
          {snapshot.authorizedSha256 !== null && (
            <span className={matches ? 'font-bold text-brand-green' : 'font-bold text-brand-red'}>
              {matches ? 'matches the authorised revision' : 'does not match the authorised revision'}
            </span>
          )}
        </span>
        <span>sheets read: {snapshot.sheetsRead.length === 0 ? 'none' : snapshot.sheetsRead.join(', ')}</span>
      </p>
      <p className="mt-1 text-[10px] text-muted">
        This is a level the owner approved in a workbook, not a sum of movements. The apply wrote no
        stock movement, product master or debtor row; the Movement Ledger remains the server’s SUM
        over recorded movements.
      </p>
    </div>
  );
}

export function AutoSyncSelect({
  seconds,
  onChoose,
}: {
  seconds: number;
  onChoose: (seconds: number) => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted">
        Automatic re-read
        <select
          className="input mt-1 block !w-56 !py-1.5 normal-case font-semibold text-ink"
          value={seconds}
          onChange={(event) => onChoose(Number(event.target.value))}
        >
          {AUTO_SYNC_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {AUTO_SYNC_LABEL[choice]}
            </option>
          ))}
        </select>
      </label>
      <p className="max-w-[15rem] text-right text-[10px] text-faint">{autoSyncSentence(seconds)}</p>
    </div>
  );
}

/** A section that is named by the workbook but carries no stored figure. The reason is the
 *  server's; the panel adds no rows and no zero. */
export function UnavailableBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-field border border-brand-orange/40 bg-brand-orange/5 p-4">
      <p className="text-[12px] font-black text-ink">{title}</p>
      <p className="mt-1 max-w-3xl text-[11px] text-ink">{description}</p>
      {children}
    </div>
  );
}

export function StockReadState({
  state,
  error,
  retry,
  loadingLabel,
}: {
  state: 'loading' | 'ready' | 'error';
  error: string;
  retry: () => void;
  loadingLabel: string;
}) {
  if (state === 'loading') return <Spinner label={loadingLabel} />;
  if (state === 'error') {
    return (
      <p className="text-xs font-semibold text-brand-red">
        {error}{' '}
        <button type="button" className="font-bold underline" onClick={retry}>
          Try again
        </button>
      </p>
    );
  }
  return null;
}
