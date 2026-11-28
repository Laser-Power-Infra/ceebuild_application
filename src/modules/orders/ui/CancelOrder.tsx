'use client';

import { useState } from 'react';
import { Ban, Loader2, RotateCcw, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls } from '@/components/Modal';
import { cancelOrderAction, reopenOrderAction, setCancelledMtAction } from '@/app/actions/orders';
import type { OrderDetail } from '../server/query';

const REASONS: [string, string][] = [
  ['CLIENT_CANCELLED', 'Cancelled by client'],
  ['SUPERSEDED', 'Superseded by new PO'],
  ['DUPLICATE', 'Duplicate entry'],
];
const today = () => new Date().toISOString().slice(0, 10);

/** Admin: cancel / supersede, partial cancellation (MT) and reopen. Every change is in the audit log. */
export function CancelOrder({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const [mode, setMode] = useState<'cancel' | 'partial' | 'reopen' | null>(null);
  const [reason, setReason] = useState('CLIENT_CANCELLED');
  const [replacedBy, setReplacedBy] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mt, setMt] = useState(order.cancelledMt ? String(order.cancelledMt) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setMode(null);
    setError('');
  };
  const run = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.success) return setError(r.error ?? 'Failed');
    close();
    onChanged();
  };

  const cancel = () =>
    run(() => {
      const fd = new FormData();
      fd.set('reason', reason);
      fd.set('replacedByPo', replacedBy);
      fd.set('cancelDate', date);
      fd.set('note', note);
      if (file) fd.set('file', file);
      return cancelOrderAction(order.id, fd);
    });

  return (
    <>
      {order.cancelStatus ? (
        <Button variant="outline" onClick={() => setMode('reopen')}>
          <RotateCcw /> Reopen order
        </Button>
      ) : (
        <>
          <Button variant="outline" onClick={() => setMode('partial')}>
            <Scissors /> Reduce qty
          </Button>
          <Button variant="outline" className="border-red-300 text-red-700" onClick={() => setMode('cancel')}>
            <Ban /> Cancel order
          </Button>
        </>
      )}

      {mode === 'cancel' && (
        <Modal title={`Cancel order PO ${order.poNumber}`} onClose={close}>
          <div className="grid gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Reason
              <select className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Replaced by PO {reason === 'SUPERSEDED' ? '(required)' : '(optional)'}
              <input className={fieldCls} value={replacedBy} onChange={(e) => setReplacedBy(e.target.value)} placeholder="PO no. of the new order" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Cancellation date
              <input type="date" className={fieldCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Note (optional)
              <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client mail of dd-mm-yyyy" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Client cancellation mail / letter (optional)
              <input type="file" className={fieldCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <p className="text-xs text-slate-600">
              The order leaves open orders, pipeline MT, red flags and the daily alert, and stays visible under &quot;Include closed orders&quot;. Draft indents are voided; issued
              indents are flagged for transfer to another order.
            </p>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                Back
              </Button>
              <Button variant="destructive" disabled={busy} onClick={cancel}>
                {busy ? <Loader2 className="animate-spin" /> : <Ban />} {reason === 'SUPERSEDED' || replacedBy.trim() ? 'Mark superseded' : 'Cancel order'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {mode === 'partial' && (
        <Modal title={`Reduce quantity – PO ${order.poNumber}`} onClose={close}>
          <div className="grid gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Cancelled MT (taken off the order; 0 clears it)
              <input className={fieldCls} inputMode="decimal" value={mt} onChange={(e) => setMt(e.target.value)} placeholder="e.g. 5.5" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Reason (logged)
              <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client reduced the quantity, mail of dd-mm-yyyy" />
            </label>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => run(() => setCancelledMtAction(order.id, mt, note))}>
                {busy ? <Loader2 className="animate-spin" /> : <Scissors />} Save
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {mode === 'reopen' && (
        <Modal title={`Reopen order PO ${order.poNumber}`} onClose={close}>
          <div className="grid gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Why (logged)
              <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="text-xs text-slate-600">Voided draft indents stay voided; generate a new indent if needed.</p>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => run(() => reopenOrderAction(order.id, note))}>
                {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reopen
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
