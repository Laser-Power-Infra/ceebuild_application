'use client';

import { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, fieldCls } from '@/components/Modal';
import { changeOrderDocketByNoAction } from '@/app/actions/orders';

/**
 * Admin, on the order's PO tab: put the order on another docket (offer). The quotation lines, the
 * quoted rates of the PO lines and a draft quotation BOM follow the new docket; the reason is logged.
 */
export function ChangeDocket({ orderId, docketNo, client, onChanged }: { orderId: number; docketNo: string | null; client: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    const r = await changeOrderDocketByNoAction(orderId, no, reason, name);
    setBusy(false);
    if (!r.success) return setError(r.error);
    setDone(`Order moved to ${r.data.docketNo} (${r.data.quotationLines} quotation line(s)${r.data.removedDraftBoms ? `, ${r.data.removedDraftBoms} draft quotation BOM removed` : ''}).`);
    setOpen(false);
    setNo('');
    setReason('');
    setName('');
    onChanged();
  };

  return (
    <section aria-label="Docket" className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">Docket (offer):</span> {docketNo ?? '—'} <span className="text-slate-500">· customer {client ?? '—'}</span>
        </p>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <ArrowRightLeft /> Change docket
          </Button>
        )}
      </div>
      {done && <p className="mt-1 text-xs font-bold text-emerald-700" role="status">{done}</p>}
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-700">
            New docket no.
            <input className={fieldCls} value={no} onChange={(e) => setNo(e.target.value)} placeholder="CEE-000527" />
          </label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
            Why (logged)
            <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PO qty / rate match this offer" />
          </label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
            Customer name (only to correct it)
            <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={client ?? ''} />
          </label>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={save} disabled={busy || !no.trim() || !reason.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          <div className="sm:col-span-3">
            <FormError error={error} />
            <p className="text-[11px] text-slate-500">The quotation lines and quoted rates are taken again from the new docket. A BOM a person confirmed is kept.</p>
          </div>
        </div>
      )}
    </section>
  );
}
