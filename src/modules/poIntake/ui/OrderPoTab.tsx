'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, fieldCls } from '@/components/Modal';
import { PO_FIELDS, needsReview, type PoFieldKey } from '@/lib/po/fields';
import { getOrderPoAction, runIndentJobAction, setHoldAction, updateOrderPoFieldAction, updatePoLineAction } from '@/app/actions/poIntake';
import type { OrderPoView } from '../types';
import { ChecksPanel, DocViewer, GROUP_LABELS, PoField, PoLinesTable } from './shared';

const JOB_LABEL: Record<string, string> = {
  ON_HOLD: 'On hold',
  BOM_NEEDED: 'Waiting for the BOM',
  BOM_FLAGS: 'BOM has flags to fix',
  DRAWING_PENDING: 'Drawing pending',
  INDENT_DRAFTED: 'Draft indent made',
  FAILED: 'Stopped',
};

/** Order tab "PO details": every field read from the PO, the PO copy, checks, hold and the indent job. */
export function OrderPoTab({ orderId, role, onChanged }: { orderId: number; role: string; onChanged: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [view, setView] = useState<OrderPoView | null>(null);
  const [values, setValues] = useState<Record<PoFieldKey, string> | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [doc, setDoc] = useState(0);

  const load = useCallback(async () => {
    const r = await getOrderPoAction(orderId);
    if (!r.success) return setError(r.error);
    setView(r.data);
    setValues(Object.fromEntries(PO_FIELDS.map((f) => [f.key, r.data.fields[f.key] ?? ''])) as Record<PoFieldKey, string>);
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view || !values) return <p className="text-sm text-slate-500">{error || 'Loading…'}</p>;

  const edited = new Set(view.edits.map((e) => e.fieldName));
  const saveField = async (key: PoFieldKey) => {
    if ((values[key] ?? '') === (view.fields[key] ?? '')) return;
    setError('');
    const r = await updateOrderPoFieldAction(orderId, key, values[key].trim() || null);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setSaved(`${PO_FIELDS.find((f) => f.key === key)?.label} saved.`);
    await load();
    onChanged();
  };
  const job = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.success) setError(r.error ?? 'Failed');
    await load();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      {view.poSource !== 'PO_COPY' && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">This order was typed in (no PO copy read). Fields can be filled here; every change is logged.</p>
      )}
      <FormError error={error} />
      {saved && <p className="text-xs font-bold text-emerald-700" role="status">{saved}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-label="Indent job" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Indent job (BOM → drawing → indent)</h2>
            {canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void job(() => runIndentJobAction(orderId))}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-run
              </Button>
            )}
          </div>
          {view.job.status ? (
            <>
              <p className={`text-xs font-bold ${view.job.status === 'INDENT_DRAFTED' ? 'text-emerald-700' : view.job.status === 'FAILED' ? 'text-rose-700' : 'text-amber-800'}`}>
                {JOB_LABEL[view.job.status] ?? view.job.status} {view.job.at ? `· ${new Date(view.job.at).toLocaleString('en-IN')}` : ''}
              </p>
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{view.job.note}</pre>
            </>
          ) : (
            <p className="text-xs text-slate-500">Not run yet.</p>
          )}
        </section>

        <section aria-label="Hold" className={`flex flex-col gap-2 rounded-xl border p-3 ${view.hold.on ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <PauseCircle className="h-4 w-4 text-amber-600" /> BOM/drawing hold
          </h2>
          {view.hold.on ? (
            <>
              <p className="text-xs font-bold text-amber-900">On hold – awaiting client confirmation: {view.hold.reason}</p>
              <p className="text-[11px] text-slate-600">
                Since {view.hold.since ? new Date(view.hold.since).toLocaleDateString('en-IN') : '–'} by {view.hold.by ?? '–'}
              </p>
              {canEdit && (
                <div>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Client has confirmed the BOM / drawing? Releasing the hold continues the indent job.')) void job(() => setHoldAction(orderId, false, ''));
                    }}
                  >
                    <PlayCircle /> Client confirmed – release hold
                  </Button>
                </div>
              )}
            </>
          ) : canEdit ? (
            <div className="flex gap-2">
              <input className={fieldCls} placeholder="What the client still has to confirm" aria-label="Hold reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busy || !holdReason.trim()} onClick={() => void job(() => setHoldAction(orderId, true, holdReason))}>
                Put on hold
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Not on hold.</p>
          )}
        </section>
      </div>

      <section aria-label="Checks" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Checks</h2>
        <ChecksPanel checks={view.checks} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-4">
          {(['header', 'commercial', 'references'] as const).map((g) => (
            <section key={g} aria-label={GROUP_LABELS[g]} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{GROUP_LABELS[g]}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {PO_FIELDS.filter((f) => f.group === g).map((f) => {
                  const read = view.extraction?.fields[f.key];
                  return (
                    <div key={f.key} onBlur={() => canEdit && void saveField(f.key)}>
                      <PoField
                        def={f}
                        value={values[f.key]}
                        read={read}
                        disabled={!canEdit}
                        highlight={!!view.extraction && needsReview(read) && !edited.has(f.key) && (values[f.key] ?? '') === (view.fields[f.key] ?? '')}
                        onChange={(v) => setValues({ ...values, [f.key]: v })}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <section aria-label="PO line items" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">PO line items</h2>
            <PoLinesTable
              lines={view.lines}
              readOnly={!canEdit}
              onCell={async (i, key, v) => {
                const r = await updatePoLineAction(view.lines[i].id, key, v);
                if (!r.success) setError(r.error);
                await load();
              }}
            />
          </section>
        </div>
        <div className="flex flex-col gap-4">
          <section aria-label="PO documents" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">PO copy and documents</h2>
            {view.documents.length ? <DocViewer docs={view.documents} active={doc} onActive={setDoc} /> : <p className="text-xs text-slate-500">No documents stored.</p>}
          </section>
          <section aria-label="Edit log" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Edit log</h2>
            <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    {['When', 'Field', 'Old', 'New', 'User'].map((h) => (
                      <th key={h} className="px-2 py-1 font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.edits.map((e, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-2 py-1">{new Date(e.at).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-1 font-semibold">{PO_FIELDS.find((f) => f.key === e.fieldName)?.label ?? e.fieldName}</td>
                      <td className="max-w-[10rem] truncate px-2 py-1" title={e.oldValue ?? ''}>{e.oldValue ?? '–'}</td>
                      <td className="max-w-[10rem] truncate px-2 py-1" title={e.newValue ?? ''}>{e.newValue ?? '–'}</td>
                      <td className="px-2 py-1">{e.userName ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
