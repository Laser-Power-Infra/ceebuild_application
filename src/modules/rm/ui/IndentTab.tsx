'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Download, Play, Trash2 } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { cancelIndentAction, deleteIndentAction, exportIndentExcelAction, generateIndentAction, issueIndentAction, listOrderIndentsAction } from '@/app/actions/rm';
import { getPlanSettingsAction } from '@/app/actions/settings';
import type { PlanSettingsValues } from '@/modules/settings/types';
import type { IndentDetail } from '../columns';
import { Badge, Card, ComparisonTable, LINE_TYPE_LABEL, Notice, PatternTable, SettingsNote, SimpleTable, type Tone } from './parts';

export const STATUS_TONE: Record<string, Tone> = { DRAFT: 'amber', ISSUED: 'green', CANCELLED: 'slate' };

function downloadCsv(ind: IndentDetail) {
  const head = ['Indent no', 'Section', 'Bar length (mm)', 'Type', 'For mark', 'Pieces/bar', 'Bars', 'Buffer bars', 'Total bars', 'kg/m', 'Weight (kg)'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = ind.lines.map((l) =>
    [ind.indentNo, l.sectionLabel, l.barLengthMm, LINE_TYPE_LABEL[l.lineType], l.forMark ?? '', l.piecesPerBar ?? '', l.bars, l.bufferBars, l.bars + l.bufferBars, l.kgPerM, l.wtKg].map(esc).join(','),
  );
  const blob = new Blob([[head.map(esc).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ind.indentNo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadBase64(base64: string, fileName: string, type: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Logical RM indent of one order: generate from the ✓ Correct BOM, compare Mixed vs 6 m, issue. */
export function IndentTab({ orderId, role, onChanged }: { orderId: number; role: string; onChanged?: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [indents, setIndents] = useState<IndentDetail[] | null>(null);
  const [settings, setSettings] = useState<PlanSettingsValues | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [strategy, setStrategy] = useState<'MIXED' | 'STANDARD'>('MIXED');
  const [remarks, setRemarks] = useState('');
  const [cancelling, setCancelling] = useState<IndentDetail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([listOrderIndentsAction(orderId), getPlanSettingsAction()]);
    if (r.success) {
      setIndents(r.data);
      setSelected((cur) => (cur && r.data.some((i) => i.id === cur) ? cur : (r.data.find((i) => i.status !== 'CANCELLED') ?? r.data[0])?.id ?? null));
    } else setError(r.error);
    if (s.success) setSettings(s.data);
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.success) return setError(r.error ?? 'Failed');
    after?.();
    await load();
    onChanged?.();
  };

  if (indents === null) return <p className="text-sm text-slate-500">Loading indents…</p>;
  const ind = indents.find((i) => i.id === selected) ?? null;
  const issuedPrimary = indents.find((i) => i.kind === 'PRIMARY' && i.status === 'ISSUED');

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Logical RM indent"
        actions={
          canEdit ? (
            <Button onClick={() => setGenerating(true)} disabled={busy}>
              <Play /> Generate indent
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Sign in to generate indents</span>
          )
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          Made from the order&apos;s ✓ Correct BOM. High-volume marks get custom bars that are an exact multiple of the piece (+ end allowance); the rest is nested on 6 m bars
          (first-fit decreasing). Supply tolerance is +0/+{settings?.tolPlusMm ?? 20} mm only, so plans use the ordered length exactly.
        </p>
        {settings && <SettingsNote settings={settings} confirmed={settings.confirmed} isAdmin={role === 'Admin'} />}
        <div className="mt-3">
          <FormError error={error} />
        </div>
        {indents.length > 0 && (
          <div className="mt-3">
            <SimpleTable
              head={['Indent no', 'Kind', 'Plan', 'Status', 'Bars', 'MT', 'Created', 'Issued']}
              align={['left', 'left', 'left', 'left', 'right', 'right', 'left', 'left']}
              rows={indents.map((i) => [
                <button
                  key="n"
                  type="button"
                  onClick={() => setSelected(i.id)}
                  className={`font-semibold hover:underline ${i.id === selected ? 'text-blue-700' : 'text-slate-800'}`}
                >
                  {i.indentNo}
                </button>,
                i.kind === 'PRIMARY' ? 'Primary' : 'Supplementary',
                i.strategy === 'MIXED' ? 'Mixed' : '6 m only',
                <Badge key="s" tone={STATUS_TONE[i.status]}>
                  {i.status.toLowerCase()}
                </Badge>,
                fmtNum(i.totalBars, 0),
                fmtNum(i.totalWtKg / 1000, 3),
                `${new Date(i.createdAt).toLocaleDateString('en-IN')} · ${i.createdByName ?? '–'}`,
                i.issuedAt ? `${new Date(i.issuedAt).toLocaleDateString('en-IN')} · ${i.issuedByName ?? '–'}` : '–',
              ])}
            />
          </div>
        )}
        {indents.length === 0 && <p className="mt-3 text-sm text-slate-600">No indent yet for this order.</p>}
      </Card>

      {ind && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{ind.indentNo}</h3>
            <Badge tone={STATUS_TONE[ind.status]}>{ind.status.toLowerCase()}</Badge>
            <Badge tone="blue">{ind.kind === 'PRIMARY' ? 'Primary' : 'Supplementary'}</Badge>
            <span className="text-xs text-slate-500">{ind.strategy === 'MIXED' ? 'Mixed (custom + 6 m)' : '6 m only'}</span>
            {ind.remarks && <span className="text-xs text-slate-500">· {ind.remarks}</span>}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => downloadCsv(ind)}>
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              title="Indent workbook: INDENT, SECTION SUMMARY, CHANGES-HOLD, OFFCUT USED, NOTES"
              onClick={async () => {
                setBusy(true);
                setError('');
                const r = await exportIndentExcelAction(ind.id);
                setBusy(false);
                if (r.success) downloadBase64(r.data.base64, r.data.fileName, XLSX_MIME);
                else setError(r.error);
              }}
            >
              <Download /> Excel
            </Button>
            {canEdit && ind.status === 'DRAFT' && (
              <Button
                disabled={busy || (ind.kind === 'PRIMARY' && !!issuedPrimary)}
                title={ind.kind === 'PRIMARY' && issuedPrimary ? `Cancel ${issuedPrimary.indentNo} first` : 'Lock this indent and send it to purchase'}
                onClick={() => {
                  if (window.confirm(`Issue ${ind.indentNo}? Issued indents cannot be changed.`)) void run(() => issueIndentAction(ind.id));
                }}
              >
                <CheckCircle2 /> Issue
              </Button>
            )}
            {canEdit && ind.status !== 'CANCELLED' && (
              <Button variant="outline" disabled={busy} onClick={() => setCancelling(ind)}>
                <Ban /> Cancel
              </Button>
            )}
            {role === 'Admin' && ind.status === 'DRAFT' && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete draft ${ind.indentNo}? It stays in the audit log.`)) void run(() => deleteIndentAction(ind.id), () => setSelected(null));
                }}
              >
                <Trash2 /> Delete
              </Button>
            )}
          </div>

          {!ind.settings.confirmed && <Notice tone="amber">Made with planning settings not yet confirmed by the plant (end allowance, buffer %). Regenerate once they are confirmed.</Notice>}
          {ind.warnings.length > 0 && (
            <Notice tone="amber">
              <ul className="list-disc pl-4">
                {ind.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="flex flex-wrap gap-3">
            <Kpi label="Bars to order" value={fmtNum(ind.totalBars, 0)} />
            <Kpi label="Indent weight (MT)" value={fmtNum(ind.totalWtKg / 1000, 3)} />
            {ind.comparison && (
              <>
                <Kpi label="Yield" value={`${fmtNum((ind.strategy === 'MIXED' ? ind.comparison.mixed : ind.comparison.standard).totals.yieldPct, 1)}%`} tone="green" />
                <Kpi label="Mixed saves vs 6 m (MT)" value={fmtNum(ind.comparison.savingKg / 1000, 3)} tone={ind.comparison.savingKg > 0 ? 'green' : undefined} />
              </>
            )}
          </div>

          {ind.comparison && (
            <Card title="Mixed vs 6 m-only">
              <ComparisonTable comparison={ind.comparison} />
            </Card>
          )}

          <Card title="Indent lines">
            <SimpleTable
              head={['Section', 'Bar length (mm)', 'Type', 'For mark', 'Pcs / bar', 'Bars', 'Buffer', 'Total bars', 'kg/m', 'Weight (kg)']}
              align={['left', 'right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right']}
              rows={ind.lines.map((l) => [
                l.sectionLabel,
                fmtNum(l.barLengthMm, 0),
                LINE_TYPE_LABEL[l.lineType],
                l.forMark ?? '–',
                l.piecesPerBar ?? '–',
                fmtNum(l.bars, 0),
                fmtNum(l.bufferBars, 0),
                <strong key="t">{fmtNum(l.bars + l.bufferBars, 0)}</strong>,
                fmtNum(l.kgPerM, 3),
                fmtNum(l.wtKg, 1),
              ])}
            />
          </Card>

          <Card title="Bar cutting patterns">
            <PatternTable patterns={ind.patterns} />
          </Card>
        </>
      )}

      {generating && (
        <Modal title="Generate RM indent" onClose={() => setGenerating(false)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => generateIndentAction(orderId, strategy, remarks), () => {
                setGenerating(false);
                setRemarks('');
                setSelected(null);
              });
            }}
          >
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className={labelCls}>Plan</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="strategy" checked={strategy === 'MIXED'} onChange={() => setStrategy('MIXED')} className="mt-1" />
                <span>
                  <strong>Mixed</strong> – custom exact-multiple lengths for high-volume marks, rest on 6 m bars
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="strategy" checked={strategy === 'STANDARD'} onChange={() => setStrategy('STANDARD')} className="mt-1" />
                <span>
                  <strong>6 m only</strong> – every piece nested on standard bars
                </span>
              </label>
              <p className="text-xs text-slate-500">Both are calculated; the comparison is saved with the indent either way.</p>
            </fieldset>
            <div>
              <label className={labelCls} htmlFor="ind-remarks">
                Remarks
              </label>
              <input id="ind-remarks" className={fieldCls} value={remarks} maxLength={1000} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setGenerating(false)}>
                Close
              </Button>
              <Button type="submit" disabled={busy}>
                <Play /> {busy ? 'Planning…' : 'Generate draft'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {cancelling && (
        <Modal title={`Cancel ${cancelling.indentNo}`} onClose={() => setCancelling(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => cancelIndentAction(cancelling.id, reason), () => {
                setCancelling(null);
                setReason('');
              });
            }}
          >
            <div>
              <label className={labelCls} htmlFor="cancel-reason">
                Reason
              </label>
              <textarea id="cancel-reason" required className={fieldCls} rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setCancelling(null)}>
                Back
              </Button>
              <Button variant="destructive" type="submit" disabled={busy || !reason.trim()}>
                <Ban /> Cancel indent
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
