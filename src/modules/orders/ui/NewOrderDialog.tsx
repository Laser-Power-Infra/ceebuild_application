'use client';

import { useEffect, useState } from 'react';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { createOrderAction, searchDocketsAction } from '@/app/actions/orders';

type DocketHit = { id: number; docketNo: string | null; party: string | null; utility: string | null; orders: number };

export function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DocketHit[]>([]);
  const [docket, setDocket] = useState<DocketHit | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState('');
  const [client, setClient] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (docket) return;
    const t = setTimeout(async () => {
      const r = await searchDocketsAction(q);
      if (r.success) setHits(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, docket]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docket) return setError('Choose the docket (offer) this PO is for.');
    setSaving(true);
    setError('');
    const r = await createOrderAction({ docketId: docket.id, poNumber, poDate, client, remarks });
    setSaving(false);
    if (r.success) onCreated(r.data.id);
    else setError(r.error);
  };

  return (
    <Modal title="New order from PO" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className={labelCls} htmlFor="docket-q">Docket (offer)</label>
          {docket ? (
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <span>
                <strong>{docket.docketNo}</strong> · {docket.party} {docket.utility ? `· ${docket.utility}` : ''}
              </span>
              <button type="button" className="text-xs font-bold text-blue-700 hover:underline" onClick={() => setDocket(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input id="docket-q" className={fieldCls} placeholder="Docket no, party or utility" value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200" aria-label="Matching dockets">
                {hits.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No dockets found</li>}
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDocket(h);
                        if (!client) setClient(h.party ?? '');
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <strong>{h.docketNo}</strong> · {h.party} {h.utility ? `· ${h.utility}` : ''}
                      {h.orders > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{h.orders} order(s)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="po-no">PO number</label>
            <input id="po-no" required maxLength={100} className={fieldCls} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="po-date">PO date</label>
            <input id="po-date" type="date" required className={fieldCls} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="client">Client (on the PO)</label>
          <input id="client" maxLength={200} className={fieldCls} value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="remarks">Remarks</label>
          <textarea id="remarks" maxLength={1000} rows={2} className={fieldCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <p className="text-[11px] text-slate-500">The docket&apos;s quotation lines are copied into the order as they are now.</p>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create order'}</Button>
        </div>
      </form>
    </Modal>
  );
}
