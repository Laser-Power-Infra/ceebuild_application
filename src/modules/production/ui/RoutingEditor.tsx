'use client';

import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/Modal';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtNum } from '@/components/ServerTable';
import { listRoutingAction, resetRoutingAction, saveRoutingsAction } from '@/app/actions/production';
import type { CutOp } from '@/lib/planning/machines';
import type { RoutingRow } from '../columns';

type Draft = { cutOp: CutOp; holes: string; notches: string; bends: string; welds: string; threads: string; numbering: boolean };
const COUNTS = [
  { key: 'holes', label: 'Holes / pc' },
  { key: 'notches', label: 'Notches / pc' },
  { key: 'bends', label: 'Bends / pc' },
  { key: 'welds', label: 'Weld joints / pc' },
  { key: 'threads', label: 'Threads / pc' },
] as const;

const toDraft = (r: RoutingRow): Draft => ({
  cutOp: r.routing.cutOp,
  holes: String(r.routing.holes),
  notches: String(r.routing.notches),
  bends: String(r.routing.bends),
  welds: String(r.routing.welds),
  threads: String(r.routing.threads),
  numbering: r.routing.numbering,
});
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** Operations each mark needs. Defaults come from the section; saved rows override them. */
export function RoutingEditor({ orderId, canEdit, onSaved }: { orderId: number; canEdit: boolean; onSaved?: () => void }) {
  const [rows, setRows] = useState<RoutingRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [bomStatus, setBomStatus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void listRoutingAction(orderId).then((r) => {
      if (!live) return;
      if (!r.success) return setError(r.error);
      setRows(r.data.rows);
      setBomStatus(r.data.bomStatus);
      setDrafts(Object.fromEntries(r.data.rows.map((x) => [x.markNo, toDraft(x)])));
    });
    return () => {
      live = false;
    };
  }, [orderId, reload]);

  const dirty = useMemo(() => (rows ?? []).filter((r) => drafts[r.markNo] && !same(drafts[r.markNo], toDraft(r))), [rows, drafts]);

  if (error && !rows) return <FormError error={error} />;
  if (!rows) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Upload the BOM first; routings are entered per mark.</div>;

  const set = (mark: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [mark]: { ...d[mark], ...patch } }));

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    const payload = dirty.map((r) => ({ markNo: r.markNo, ...drafts[r.markNo] }));
    const res = await saveRoutingsAction(orderId, payload);
    setSaving(false);
    if (!res.success) return setError(res.error);
    setMessage(`Saved ${res.data.changed} mark${res.data.changed === 1 ? '' : 's'}.`);
    setReload((n) => n + 1);
    onSaved?.();
  };

  const reset = async (markNo: string) => {
    if (!window.confirm(`Reset mark ${markNo} to the default routing for its section?`)) return;
    const res = await resetRoutingAction(orderId, markNo);
    if (!res.success) return setError(res.error);
    setReload((n) => n + 1);
    onSaved?.();
  };

  const cell = 'w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-slate-500">
          Channels default to cropping (UP-1), angles and flats to shearing; holes, notches, bends, weld joints and threads are per piece.
          {bomStatus !== 'CORRECT' && ' BOM not yet marked correct.'}
        </p>
        <div className="flex-1" />
        {canEdit ? (
          <Button onClick={save} disabled={saving || dirty.length === 0}>
            <Save /> {saving ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'Saved'}
          </Button>
        ) : (
          <span className="text-xs text-slate-500">Sign in to edit routings</span>
        )}
      </div>
      <FormError error={error} />
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{message}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-3 py-2">Mark</th>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Cutting</th>
              {COUNTS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right">{c.label}</th>
              ))}
              <th className="px-3 py-2">Numbering</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = drafts[r.markNo];
              if (!d) return null;
              const changed = !same(d, toDraft(r));
              return (
                <tr key={r.markNo} className={`border-t border-slate-100 ${changed ? 'bg-blue-50/50' : ''}`}>
                  <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">{r.markNo}</td>
                  <td className="px-3 py-1.5 text-slate-600">{r.section ?? '–'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(r.qty, 0)}</td>
                  <td className="px-3 py-1.5">
                    <select
                      aria-label={`Cutting for ${r.markNo}`}
                      disabled={!canEdit}
                      value={d.cutOp}
                      onChange={(e) => set(r.markNo, { cutOp: e.target.value as CutOp })}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm disabled:bg-slate-50"
                    >
                      <option value="CROPPING">Cropping</option>
                      <option value="SHEARING">Shearing</option>
                      <option value="NONE">None</option>
                    </select>
                  </td>
                  {COUNTS.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 text-right">
                      <input
                        aria-label={`${c.label} for ${r.markNo}`}
                        inputMode="numeric"
                        disabled={!canEdit}
                        value={d[c.key]}
                        onChange={(e) => set(r.markNo, { [c.key]: e.target.value.replace(/[^0-9]/g, '') } as Partial<Draft>)}
                        className={cell}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Numbering for ${r.markNo}`}
                      disabled={!canEdit}
                      checked={d.numbering}
                      onChange={(e) => set(r.markNo, { numbering: e.target.checked })}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.saved ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">Saved</span>
                        {canEdit && (
                          <button type="button" title="Reset to section default" aria-label={`Reset ${r.markNo} to default`} onClick={() => void reset(r.markNo)} className="rounded p-1 text-slate-400 hover:text-slate-700">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">Default</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
