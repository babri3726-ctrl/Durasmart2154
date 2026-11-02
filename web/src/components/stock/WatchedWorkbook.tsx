/** The watched workbook: a file the demo store holds, reported without applying anything.
 *
 *  Detect-and-confirm, deliberately. Seeing a new revision is not consent: the preview must be
 *  read again through the store, the checkbox starts unticked on every reading, and the apply
 *  button sends the hash and digest the store issued. The route re-reads the bytes and refuses a
 *  change that happened in between, so the snapshot applied is exactly the one reviewed here.
 *
 *  `Sync now` is the shortcut for a revision nobody has authorised: the press is the consent, and
 *  the store authorises those bytes and applies them in one transaction. It still goes through a
 *  confirmation dialog, still re-reads and re-hashes the file, and still refuses a plan it cannot
 *  apply — the difference is only that the owner does not have to preview the same file first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderSync, RefreshCw, UploadCloud, Zap } from 'lucide-react';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/Overlays';
import { invalidate, syncKeys } from '../../lib/syncStore';
import {
  applyWatchedWorkbook,
  previewWatchedWorkbook,
  readStockWatch,
  syncWatchedWorkbook,
  uploadExcelWorkbook,
  ServerError,
  type ServerStockImportApply,
  type ServerStockWatch,
} from '../../lib/serverApi';
import type { ServerStockPreview } from '../../lib/stockPreviewModel';
import type { ReactNode } from 'react';

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'ready'; preview: ServerStockPreview }
  | { kind: 'failed'; message: string };

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'applied'; outcome: ServerStockImportApply }
  | { kind: 'failed'; message: string };

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'bg-brand-green/12 text-brand-green'
      : tone === 'warn'
        ? 'bg-brand-orange/15 text-[#C96B15]'
        : 'bg-line text-muted';
  return <span className={`chip ${cls}`}>{children}</span>;
}

export default function WatchedWorkbook() {
  const [watch, setWatch] = useState<ServerStockWatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [confirmed, setConfirmed] = useState(false);
  const [apply, setApply] = useState<ApplyState>({ kind: 'idle' });
  const [confirmingSync, setConfirmingSync] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [directUploading, setDirectUploading] = useState(false);

  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDirectUploading(true);
    setError(null);
    try {
      await uploadExcelWorkbook(file);
      invalidate(
        syncKeys.stockSummary,
        syncKeys.stockUpvc,
        syncKeys.stockAccessories,
        syncKeys.stockProduction,
        syncKeys.stockImported,
        syncKeys.stockImports,
      );
      await load();
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj?.message || 'Direct upload failed');
    } finally {
      setDirectUploading(false);
      e.target.value = '';
    }
  };


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWatch(await readStockWatch());
    } catch (cause) {
      setError(cause instanceof ServerError ? cause.message : 'The watcher status could not be read.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readPreview = useCallback(async () => {
    setPreview({ kind: 'reading' });
    setConfirmed(false);
    setApply({ kind: 'idle' });
    try {
      setPreview({ kind: 'ready', preview: await previewWatchedWorkbook() });
    } catch (cause) {
      setPreview({
        kind: 'failed',
        message: cause instanceof ServerError ? cause.message : 'The watched file could not be read.',
      });
    }
  }, []);

  const applyRevision = useCallback(async () => {
    if (preview.kind !== 'ready' || !watch?.fileSha256) return;
    setApply({ kind: 'applying' });
    try {
      const outcome = await applyWatchedWorkbook({
        fileSha256: watch.fileSha256,
        previewDigest: preview.preview.applyPreviewDigest,
      });
      invalidate(
        syncKeys.stockSummary,
        syncKeys.stockUpvc,
        syncKeys.stockAccessories,
        syncKeys.stockProduction,
        syncKeys.stockImported,
        syncKeys.stockImports,
      );
      setApply({ kind: 'applied', outcome });
      setPreview({ kind: 'idle' });
      await load();
    } catch (cause) {
      setApply({
        kind: 'failed',
        message: cause instanceof ServerError ? cause.message : 'The revision could not be applied.',
      });
    }
  }, [preview, watch, load]);

  const runSync = useCallback(async () => {
    if (!watch?.fileSha256) return;
    setConfirmingSync(false);
    setPreview({ kind: 'idle' });
    setConfirmed(false);
    setApply({ kind: 'applying' });
    try {
      const outcome = await syncWatchedWorkbook({ fileSha256: watch.fileSha256 });
      invalidate(
        syncKeys.stockSummary,
        syncKeys.stockUpvc,
        syncKeys.stockAccessories,
        syncKeys.stockProduction,
        syncKeys.stockImported,
        syncKeys.stockImports,
      );
      setApply({ kind: 'applied', outcome });
      await load();
    } catch (cause) {
      setApply({
        kind: 'failed',
        message:
          cause instanceof ServerError
            ? cause.message
            : 'The revision could not be authorised and applied.',
      });
    }
  }, [watch, load]);

  const canSync =
    watch?.configured === true &&
    watch.present &&
    watch.readable;

  const canReview =
    watch?.configured === true &&
    watch.present &&
    watch.readable &&
    watch.matchesAuthorizedRevision &&
    !watch.matchesLatestBatch;

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-black text-ink">
            <FolderSync size={14} /> Watched workbook
          </p>
          <p className="mt-0.5 max-w-3xl text-[11px] text-muted">
            The demo store reports whether the file it watches differs from the snapshot already
            applied. Review a preview first if you want to inspect the figures, or press Sync now to
            authorise this file's revision and apply it in one confirmed step.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} /> {loading ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] font-semibold text-brand-red">{error}</p>}

      {watch && (
        <div className="mt-3 rounded-field border border-line bg-canvas px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {!watch.configured && <Badge tone="muted">not configured</Badge>}
            {watch.configured && !watch.present && <Badge tone="warn">file missing</Badge>}
            {watch.configured && watch.present && !watch.readable && <Badge tone="warn">unreadable</Badge>}
            {watch.readable && watch.matchesLatestBatch && <Badge tone="ok">already applied</Badge>}
            {watch.readable && !watch.matchesLatestBatch && watch.matchesAuthorizedRevision && (
              <Badge tone="warn">new revision ready for review</Badge>
            )}
            {watch.readable && !watch.matchesLatestBatch && !watch.matchesAuthorizedRevision && (
              <Badge tone="muted">not the authorised revision</Badge>
            )}
            <span className="text-[11px] font-semibold text-ink">{watch.note}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted">
            <span title={watch.path ?? undefined}>file: {watch.path ?? '—'}</span>
            <span>sha256: {shortHash(watch.fileSha256)}</span>
            <span>size: {watch.sizeBytes ?? '—'} bytes</span>
            <span>modified: {watch.modifiedAt ? new Date(watch.modifiedAt).toLocaleString() : '—'}</span>
            <span>latest batch: {watch.latestBatchId ?? 'none'}</span>
          </div>
        </div>
      )}

      {canSync && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setConfirmingSync(true)}
            disabled={apply.kind === 'applying' || directUploading}
          >
            <Zap size={13} /> {apply.kind === 'applying' ? 'Syncing…' : 'Sync now'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleDirectUpload}
          />
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={directUploading}
          >
            <UploadCloud size={13} /> {directUploading ? 'Uploading…' : 'Upload Workbook from PC'}
          </button>
          <span className="text-[11px] text-muted">
            Authorises this file's revision and applies it in one step — the press is the consent.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirmingSync}
        title="Sync this workbook now?"
        message={`This authorises revision ${shortHash(watch?.fileSha256 ?? null)} and applies it as the effective stock snapshot, replacing the current one. There is no undo.`}
        confirmLabel="Authorise and apply"
        danger
        onConfirm={() => void runSync()}
        onCancel={() => setConfirmingSync(false)}
      />

      {canReview && (
        <div className="mt-3">
          {preview.kind === 'idle' && (
            <button type="button" className="btn-primary" onClick={() => void readPreview()}>
              Read preview of this revision
            </button>
          )}
          {preview.kind === 'reading' && (
            <p className="text-[11px] text-muted">Reading the watched file…</p>
          )}
          {preview.kind === 'failed' && (
            <p className="text-[11px] font-semibold text-brand-red">{preview.message}</p>
          )}
          {preview.kind === 'ready' && (
            <div className="rounded-field border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge tone={preview.preview.readyToApply ? 'ok' : 'warn'}>
                  {preview.preview.readyToApply ? 'ready to apply' : 'not ready'}
                </Badge>
                <span className="text-muted">
                  {preview.preview.applyableItemCount} figures applyable ·{' '}
                  {preview.preview.quarantineRowCount} withheld · digest{' '}
                  {shortHash(preview.preview.applyPreviewDigest)}
                </span>
              </div>
              {preview.preview.applyBlockedReason && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-brand-red">
                  <AlertTriangle size={12} /> {preview.preview.applyBlockedReason}
                </p>
              )}
              <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I have reviewed this reading and confirm applying these figures.
              </label>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!confirmed || !preview.preview.readyToApply || apply.kind === 'applying'}
                  onClick={() => void applyRevision()}
                >
                  {apply.kind === 'applying' ? 'Applying…' : 'Apply this revision'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setPreview({ kind: 'idle' });
                    setConfirmed(false);
                  }}
                  disabled={apply.kind === 'applying'}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {apply.kind === 'failed' && (
        <p className="mt-2 text-[11px] font-semibold text-brand-red">{apply.message}</p>
      )}
      {apply.kind === 'applied' && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-brand-green">
          <CheckCircle2 size={13} /> Applied batch {apply.outcome.batch.id}
          {apply.outcome.replayed ? ' (replay — nothing written twice)' : ''}. The stock screens will
          read the new snapshot now.
        </p>
      )}
    </Card>
  );
}
