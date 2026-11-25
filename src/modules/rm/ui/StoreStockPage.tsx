'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listStoreStockAction, saveStoreStockAction, setStoreStockActiveAction } from '@/app/actions/storeStock';
import type { StoreStockRow } from '@/modules/rm/server/storeStock';
import { Badge, card, cellInput, td, th } from '@/modules/costing/ui/shared';

const EMPTY = { section: '', lengthMm: '', qty: '', kind: 'OFFCUT', forPieceLengthMm: '', location: '', note: '' };

/**
 * Rev 2 §10: store stock used before new bars are ordered. A new indent plan takes the active rows of
 * its sections (OFFCUT USED sheet of the Excel indent); the rows are deducted when the indent is issued.
 */
export function StoreStockPage({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<StoreStockRow[] | null>(null);
  const [form, setForm] = useState<typeof EMPTY & { id?: number }>(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void listStoreStockAction().then((r) => (r.success ? setRows(r.data) : setErr(r.error)));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    const r = await saveStoreStockAction(form);
    setBusy(false);
    if (!r.success) return setErr(r.error);
    setErr('');
    setForm(EMPTY);
    load();
  };
  const toggle = async (id: number, active: boolean) => {
    const r = await setStoreStockActiveAction(id, active);
    if (!r.success) return setErr(r.error);
    load();
  };
  const f = (k: keyof typeof EMPTY, ph: string, w = '') => (
    <input className={`${cellInput} ${w}`} placeholder={ph} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Store stock (offcuts &amp; spare bars)</h1>
        <p className="text-xs text-slate-700">
          Used before any new bar is ordered: a row with a piece length goes to that length first; other rows are nested first with the 6 m pieces of the section.
          A draft indent only shows the use; the stock is deducted when the indent is issued.
        </p>
      </div>
      {err && <p className="text-xs text-rose-800">{err}</p>}
      {canEdit && (
        <section className={card}>
          <h2 className="mb-2 text-sm font-semibold">{form.id ? `Edit row #${form.id}` : 'Add stock'}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {f('section', 'Section, e.g. FLAT 50X8', 'lg:col-span-2')}
            {f('lengthMm', 'Length mm')}
            {f('qty', 'Nos')}
            <select className={cellInput} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="OFFCUT">Offcut</option>
              <option value="FULL">Full bar</option>
            </select>
            {f('forPieceLengthMm', 'For piece mm (opt.)')}
            {f('location', 'Location')}
            {f('note', 'Note')}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}>{form.id ? 'Save' : 'Add'}</Button>
            {form.id && <Button size="sm" variant="outline" onClick={() => setForm(EMPTY)}>Cancel</Button>}
          </div>
        </section>
      )}
      <section className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Section</th>
              <th className={`${th} text-right`}>Length (mm)</th>
              <th className={`${th} text-right`}>Nos</th>
              <th className={th}>Kind</th>
              <th className={`${th} text-right`}>For piece (mm)</th>
              <th className={th}>Location</th>
              <th className={th}>Note</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={9} className={`${td} py-6 text-center text-slate-700`}>No store stock entered yet.</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'text-slate-500'}>
                <td className={`${td} font-semibold`}>{r.section}</td>
                <td className={`${td} text-right`}>{r.lengthMm}</td>
                <td className={`${td} text-right`}>{r.qty}</td>
                <td className={td}>{r.kind === 'FULL' ? 'Full bar' : 'Offcut'}</td>
                <td className={`${td} text-right`}>{r.forPieceLengthMm ?? '–'}</td>
                <td className={td}>{r.location ?? '–'}</td>
                <td className={td}>{r.note ?? '–'}</td>
                <td className={td}>
                  {r.active ? <Badge tone="green">In store</Badge> : <Badge tone="slate">Used / off</Badge>}
                  {r.reservedIndentNo && <div className="text-[11px] text-slate-700">last used: {r.reservedIndentNo}</div>}
                </td>
                <td className={td}>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button
                        className="text-xs text-blue-800 hover:underline"
                        onClick={() =>
                          setForm({ id: r.id, section: r.section, lengthMm: String(r.lengthMm), qty: String(r.qty), kind: r.kind, forPieceLengthMm: r.forPieceLengthMm ? String(r.forPieceLengthMm) : '', location: r.location ?? '', note: r.note ?? '' })
                        }
                      >
                        Edit
                      </button>
                      <button className="text-xs text-blue-800 hover:underline" onClick={() => void toggle(r.id, !r.active)}>
                        {r.active ? 'Take off' : 'Put back'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
