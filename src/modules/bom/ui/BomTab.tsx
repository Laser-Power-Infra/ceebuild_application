'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Upload } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { confirmBomAction, currentUploadAction, listPiecesAction, listPiecesFacetAction, reopenBomAction, updatePieceAction } from '@/app/actions/bom';
import { FLAGS, PIECE_COLUMNS, type PieceRow, type PiecesMeta } from '../columns';
import type { UploadSummary } from '../server/query';
import { BomImport } from './BomImport';

export function BomTab({ orderId, role, quotedMt, onChanged }: { orderId: number; role: string; quotedMt: number | null; onChanged: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [upload, setUpload] = useState<UploadSummary | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [reload, setReload] = useState(0);

  const refresh = useCallback(async () => {
    const r = await currentUploadAction(orderId);
    if (r.success) setUpload(r.data);
    else setError(r.error);
  }, [orderId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scope = useMemo(() => (upload ? { uploadId: String(upload.id) } : undefined), [upload]);
  const locked = upload?.status === 'CORRECT';
  const columns = useMemo(
    () => PIECE_COLUMNS.map((c) => (c.edit ? { ...c, canEdit: () => canEdit && !locked } : c)),
    [canEdit, locked],
  );

  const afterChange = () => {
    void refresh();
    setReload((n) => n + 1);
    onChanged();
  };

  const confirm = async () => {
    if (!upload) return;
    const r = await confirmBomAction(upload.id, note);
    if (!r.success) return setError(r.error);
    setConfirming(false);
    setNote('');
    afterChange();
  };

  if (upload === undefined) return <p className="text-sm text-slate-500">Loading BOM…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        {upload ? (
          <div className="text-sm">
            <div className="font-bold text-slate-900">
              {upload.fileName}
              {upload.sheetName ? <span className="font-medium text-slate-500"> · sheet {upload.sheetName}</span> : null}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${locked ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
              >
                {locked ? '✓ Correct BOM' : 'Draft – being checked'}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              {upload.rowCount} rows · uploaded by {upload.uploadedByName ?? '–'} on {new Date(upload.createdAt).toLocaleString('en-IN')}
              {upload.previousUploads > 0 && ` · replaces ${upload.previousUploads} earlier upload(s)`}
              {!upload.archived && ' · file not archived (S3 not configured)'}
              {locked && upload.confirmedByName && ` · confirmed by ${upload.confirmedByName}`}
              {upload.overrideNote && ` · override: ${upload.overrideNote}`}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No BOM yet. Upload the client BOM (xlsx) to build the piece list.</p>
        )}
        <div className="flex-1" />
        {canEdit ? (
          <div className="flex gap-2">
            {upload && !locked && (
              <Button onClick={() => setConfirming(true)}>
                <CheckCircle2 /> Correct BOM
              </Button>
            )}
            {/* An Admin override approval can only be reopened by an Admin (enforced on the server too). */}
            {upload && locked && (!upload.overrideNote || role === 'Admin') && (
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await reopenBomAction(upload.id);
                  if (r.success) afterChange();
                  else setError(r.error);
                }}
              >
                <RotateCcw /> Reopen
              </Button>
            )}
            <Button variant={upload ? 'outline' : 'default'} onClick={() => setImporting(true)}>
              <Upload /> {upload ? 'Upload new version' : 'Upload BOM'}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-slate-500">Sign in to upload or edit the BOM</span>
        )}
      </div>

      {upload && upload.sectionMasterCount === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          Section master not filled: the kg/m and approved-section checks are skipped until the GTP sections are added in{' '}
          <a href="/admin/sections" className="underline">GTP sections</a>.
        </div>
      )}
      <FormError error={error} />

      {upload && scope && (
        <ServerTable<PieceRow, PiecesMeta>
          tableId={`bom:${upload.id}`}
          columns={columns}
          rowId={(r) => String(r.id)}
          scope={scope}
          reloadToken={reload}
          fetchPage={listPiecesAction}
          fetchFacet={listPiecesFacetAction}
          searchPlaceholder="Search mark, section, description, issue"
          rowClassName={(r) => (r.flagged ? 'bg-rose-50' : undefined)}
          onEdit={async (row, column, value) => {
            const r = await updatePieceAction(row.id, column.key, value);
            if (!r.success) {
              setError(r.error);
              return false;
            }
            setError('');
            void refresh();
            onChanged();
            return true;
          }}
          header={({ meta, total, extra, setExtra }) => (
            <div className="flex flex-wrap gap-3">
              <Kpi label="Pieces (rows)" value={fmtNum(total, 0)} />
              <Kpi label="BOM weight (MT)" value={fmtNum((meta?.totalWtKg ?? 0) / 1000, 3)} />
              <Kpi label="Quoted (MT)" value={fmtNum(quotedMt, 3)} />
              <Kpi
                label="Rows with issues"
                value={fmtNum(meta?.flagged, 0)}
                tone={meta?.flagged ? 'red' : 'green'}
                active={extra.flag === 'any'}
                onClick={() => setExtra('flag', extra.flag === 'any' ? null : 'any')}
              />
              {FLAGS.map((f) => (
                <Kpi
                  key={f.key}
                  label={f.label}
                  value={fmtNum(meta?.flagCounts[f.key], 0)}
                  tone={meta?.flagCounts[f.key] ? 'red' : undefined}
                  active={extra.flag === f.key}
                  onClick={() => setExtra('flag', extra.flag === f.key ? null : f.key)}
                />
              ))}
            </div>
          )}
        />
      )}

      {importing && (
        <BomImport
          orderId={orderId}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            afterChange();
          }}
        />
      )}

      {confirming && upload && (
        <Modal title="Mark BOM as correct" onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-3 text-sm">
            {upload.flagged > 0 ? (
              <>
                <p className="font-bold text-rose-700">{upload.flagged} row(s) still have issues.</p>
                {role === 'Admin' ? (
                  <div>
                    <label className={labelCls} htmlFor="override-note">Admin override: why is the BOM correct anyway?</label>
                    <textarea id="override-note" className={fieldCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                ) : (
                  <p className="text-slate-600">Fix them first, or ask an Admin to confirm with an override note.</p>
                )}
              </>
            ) : (
              <p>No issues left. Mark this BOM as the correct one for the order? Editing will be locked until it is reopened.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button disabled={upload.flagged > 0 && (role !== 'Admin' || !note.trim())} onClick={confirm}>
                <CheckCircle2 /> Confirm
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
