'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { FormError, fieldCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { updateDrawingStandardAction } from '@/app/actions/fabdrawings';
import { STANDARD_KINDS, STANDARD_KIND_LABELS } from '@/lib/fabdrawing/standards';
import type { DrawingStandardRow } from '../server/standards';

type Draft = { numValue: string; textValue: string; note: string; active: boolean };
const toDraft = (r: DrawingStandardRow): Draft => ({ numValue: r.numValue === null ? '' : String(r.numValue), textValue: r.textValue ?? '', note: r.note ?? '', active: r.active });

/** Admin master of the rules used on fabrication drawings when the BOM has no geometry. */
export function DrawingStandardsPage({ initial }: { initial: DrawingStandardRow[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(initial.map((r) => [r.id, toDraft(r)])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const dirty = (r: DrawingStandardRow) => JSON.stringify(drafts[r.id]) !== JSON.stringify(toDraft(r));
  const set = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const save = async (r: DrawingStandardRow) => {
    setBusy(r.id);
    setError('');
    const d = drafts[r.id];
    const res = await updateDrawingStandardAction(r.id, r.numValue !== null || r.textValue === null ? { numValue: d.numValue, note: d.note, active: d.active } : { textValue: d.textValue, note: d.note, active: d.active });
    setBusy(null);
    if (!res.success) return setError(`${r.kind} ${r.key}: ${res.error}`);
    setRows((rs) => rs.map((x) => (x.id === r.id ? res.data : x)));
    setDrafts((ds) => ({ ...ds, [r.id]: toDraft(res.data) }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Drawing Standards</h1>
        <p className="text-xs text-slate-500">
          Rules for fabrication drawings where the BOM / approved drawing gives no geometry: hole = bolt dia + clearance, IS SP:6 gauge by angle leg, edge distance, weld and
          finish notes. Each use is printed on the drawing as a design decision for production to confirm. Every change is written to the audit log.
        </p>
      </div>
      <FormError error={error} />
      {STANDARD_KINDS.map((kind) => {
        const list = rows.filter((r) => r.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900">{STANDARD_KIND_LABELS[kind]}</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Last changed</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const d = drafts[r.id];
                  const numeric = r.numValue !== null || r.textValue === null;
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.key}</td>
                      <td className="px-3 py-2">
                        {numeric ? (
                          <input aria-label={`${r.key} value`} className={`${fieldCls} w-28`} inputMode="decimal" value={d.numValue} onChange={(e) => set(r.id, { numValue: e.target.value })} />
                        ) : (
                          <textarea aria-label={`${r.key} text`} className={`${fieldCls} min-w-[22rem]`} rows={2} maxLength={1000} value={d.textValue} onChange={(e) => set(r.id, { textValue: e.target.value })} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{r.unit ?? '–'}</td>
                      <td className="px-3 py-2">
                        <input aria-label={`${r.key} note`} className={`${fieldCls} min-w-[16rem]`} maxLength={500} value={d.note} onChange={(e) => set(r.id, { note: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`${r.key} active`} className="h-4 w-4 accent-blue-600" checked={d.active} onChange={(e) => set(r.id, { active: e.target.checked })} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                        {r.updatedByName ? `${r.updatedByName}, ${new Date(r.updatedAt).toLocaleDateString('en-IN')}` : 'seed'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" disabled={!dirty(r) || busy === r.id} onClick={() => void save(r)}>
                          <Save /> {busy === r.id ? 'Saving…' : 'Save'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
