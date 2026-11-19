'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { OPERATION_LABELS } from '@/lib/planning/machines';
import { addEntryAction, entryOptionsAction, searchProductionOrdersAction } from '@/app/actions/production';
import { SHIFTS, type EntryOptions } from '../columns';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type OrderHit = { id: number; poNumber: string; client: string | null; docketNo: string | null };

/** Add one daily production entry. Without `orderId` an order picker comes first (cross-order page). */
export function EntryForm({ orderId: fixedOrderId, onClose, onSaved }: { orderId?: number; onClose: () => void; onSaved: (message: string) => void }) {
  const [orderId, setOrderId] = useState<number | null>(fixedOrderId ?? null);
  const [orderQuery, setOrderQuery] = useState('');
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [picked, setPicked] = useState<OrderHit | null>(null);
  const [opts, setOpts] = useState<EntryOptions | null>(null);
  const [v, setV] = useState({ date: today(), shift: 'A', machineId: '', markNo: '', pieces: '', operatorName: '', remarks: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fixedOrderId) return;
    const t = setTimeout(() => {
      void searchProductionOrdersAction(orderQuery).then((r) => r.success && setHits(r.data));
    }, 250);
    return () => clearTimeout(t);
  }, [orderQuery, fixedOrderId]);

  useEffect(() => {
    if (!orderId) return setOpts(null);
    void entryOptionsAction(orderId).then((r) => (r.success ? setOpts(r.data) : setError(r.error)));
  }, [orderId]);

  const machine = opts?.machines.find((m) => String(m.id) === v.machineId);
  // Only marks whose routing needs the chosen machine's operation.
  const marks = useMemo(() => (opts?.marks ?? []).filter((m) => !machine || m.operations.includes(machine.operation)), [opts, machine]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId) return setError('Choose an order.');
    setSaving(true);
    setError('');
    const r = await addEntryAction(orderId, v);
    setSaving(false);
    if (r.success) onSaved(`Saved. ${r.data.remaining} pieces of ${v.markNo} left on ${machine ? OPERATION_LABELS[machine.operation] : 'this operation'}.`);
    else setError(r.error);
  };

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Modal title="Add production entry" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {!fixedOrderId && (
          <div>
            <label className={labelCls} htmlFor="pe-order">Order</label>
            {orderId ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span>PO {picked?.poNumber ?? orderId} · {picked?.client ?? ''}</span>
                <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => { setOrderId(null); setPicked(null); setV((s) => ({ ...s, markNo: '' })); }}>Change</button>
              </div>
            ) : (
              <>
                <input id="pe-order" className={fieldCls} placeholder="Search PO, client or docket" value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} />
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                  {hits.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No orders with a BOM match.</div>}
                  {hits.map((h) => (
                    <button key={h.id} type="button" onClick={() => { setPicked(h); setOrderId(h.id); }} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50">
                      <span className="font-semibold">PO {h.poNumber}</span> <span className="text-slate-500">· {h.client ?? '–'} · {h.docketNo ?? ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {orderId && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="pe-date">Date</label>
              <input id="pe-date" type="date" required max={today()} className={fieldCls} value={v.date} onChange={set('date')} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pe-shift">Shift</label>
              <select id="pe-shift" className={fieldCls} value={v.shift} onChange={set('shift')}>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>Shift {s}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls} htmlFor="pe-machine">Machine</label>
              <select id="pe-machine" required className={fieldCls} value={v.machineId} onChange={(e) => setV((s) => ({ ...s, machineId: e.target.value, markNo: '' }))}>
                <option value="">Choose…</option>
                {(opts?.machines ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.code} · {OPERATION_LABELS[m.operation]} · {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="pe-mark">Mark no</label>
              <select id="pe-mark" required className={fieldCls} value={v.markNo} onChange={set('markNo')} disabled={!machine}>
                <option value="">{machine ? (marks.length ? 'Choose…' : 'No mark needs this operation') : 'Choose a machine first'}</option>
                {marks.map((m) => (
                  <option key={m.markNo} value={m.markNo}>{m.markNo} (BOM {m.qty})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="pe-pieces">Pieces</label>
              <input id="pe-pieces" required inputMode="numeric" className={fieldCls} value={v.pieces} onChange={set('pieces')} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pe-operator">Operator</label>
              <input id="pe-operator" maxLength={100} className={fieldCls} value={v.operatorName} onChange={set('operatorName')} />
            </div>
            <div>
              <label className={labelCls} htmlFor="pe-remarks">Remarks</label>
              <input id="pe-remarks" maxLength={1000} className={fieldCls} value={v.remarks} onChange={set('remarks')} />
            </div>
          </div>
        )}
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !orderId}>{saving ? 'Saving…' : 'Save entry'}</Button>
        </div>
      </form>
    </Modal>
  );
}
