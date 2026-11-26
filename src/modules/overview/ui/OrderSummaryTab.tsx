'use client';

import { useCallback, useEffect, useState } from 'react';
import { OrderNeeds } from '@/modules/orders/ui/OrderNeeds';
import { Pencil } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls, labelCls } from '@/components/Modal';
import { orderSummaryAction } from '@/app/actions/overview';
import { updateOrderTermsAction } from '@/app/actions/orders';
import type { OrderDetail } from '@/modules/orders/server/query';
import type { OrderSummary } from '../types';
import { FlagList } from './FlagList';
import { PipelineBars, rupees } from './PipelineBars';

/** Order page "Summary": weight pipeline, money, red flags, bottleneck, contract terms. */
export function OrderSummaryTab({ order, role, onChanged }: { order: OrderDetail; role: string; onChanged?: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [data, setData] = useState<OrderSummary | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const r = await orderSummaryAction(order.id);
    if (r.success) {
      setData(r.data);
      setError('');
    } else setError(r.error);
  }, [order.id]);

  useEffect(() => {
    void load();
  }, [load, order.status, order.contractValue, order.deliveryDue]);

  const p = data?.pipeline;
  const daysLate =
    order.deliveryDue && !['Dispatched', 'Billed', 'Closed'].includes(order.status)
      ? Math.floor((Date.now() - Date.parse(`${order.deliveryDue}T00:00:00`)) / 86_400_000)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <OrderNeeds orderId={order.id} canEdit={canEdit} />
      <FormError error={error} />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div>
          <span className="text-slate-500">Contract value </span>
          <span className="font-semibold tabular-nums text-slate-900">{order.contractValue === null ? '–' : rupees(order.contractValue)}</span>
        </div>
        <span className="text-slate-300">|</span>
        <div>
          <span className="text-slate-500">Delivery due </span>
          <span className="font-semibold text-slate-900">{order.deliveryDue ?? '–'}</span>
          {daysLate !== null && daysLate > 0 && <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">{daysLate} days late</span>}
        </div>
        <span className="text-slate-300">|</span>
        <div>
          <span className="text-slate-500">Bottleneck </span>
          <span className="font-semibold text-slate-900">
            {data?.bottleneck ? `${data.bottleneck.operation.toLowerCase()} · ${fmtNum(data.bottleneck.days, 1)} days` : '–'}
          </span>
        </div>
        <div className="flex-1" />
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit terms
          </Button>
        )}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Weight pipeline (MT)</h2>
        {p ? (
          <PipelineBars
            total={p.orderedKg}
            steps={[
              { label: 'Ordered (BOM)', kg: p.orderedKg },
              { label: 'Cut', kg: p.cutKg },
              { label: 'Galvanised', kg: p.galvanisedKg },
              { label: 'Inspected (MC)', kg: p.inspectedKg },
              { label: 'Dispatched', kg: p.dispatchedKg },
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Billed (Rs)" value={p ? fmtNum(p.billedRs, 0) : '–'} />
        <Kpi label="Collected (Rs)" value={p ? fmtNum(p.collectedRs, 0) : '–'} tone="green" />
        <Kpi label="Retention held (Rs)" value={p ? fmtNum(p.retentionRs, 0) : '–'} tone="amber" />
        <Kpi label="Outstanding (Rs)" value={p ? fmtNum(p.outstandingRs, 0) : '–'} tone={p && p.outstandingRs > 0 ? 'amber' : undefined} />
        <Kpi
          label="Billed vs contract"
          value={p && p.contractValue ? `${fmtNum((p.billedRs / p.contractValue) * 100, 1)}%` : '–'}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Red flags</h2>
        {data ? <FlagList flags={data.flags} showOrder={false} empty="Nothing is overdue on this order." /> : <p className="text-sm text-slate-500">Loading…</p>}
      </section>

      {editing && (
        <TermsDialog
          order={order}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged?.();
            void load();
          }}
        />
      )}
    </div>
  );
}

function TermsDialog({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(order.contractValue === null ? '' : String(order.contractValue));
  const [due, setDue] = useState(order.deliveryDue ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal title={`Contract terms · PO ${order.poNumber}`} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const r = await updateOrderTermsAction(order.id, { contractValue: value, deliveryDue: due });
          setSaving(false);
          if (r.success) onSaved();
          else setError(r.error);
        }}
      >
        <div>
          <label className={labelCls} htmlFor="t-value">Contract value incl. tax (Rs)</label>
          <input id="t-value" className={fieldCls} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="t-due">Contractual delivery date</label>
          <input id="t-due" type="date" className={fieldCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
