'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/Modal';
import { opsActions, type OrderTab } from '@/lib/opsSlice';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { deleteOrderAction, getOrderAction } from '@/app/actions/orders';
import { BomTab } from '@/modules/bom/ui/BomTab';
import { RegisterTable } from '@/modules/registers/ui/RegisterTable';
import type { RegisterKey } from '@/modules/registers/columns';
import { OrderSummaryTab } from '@/modules/overview/ui/OrderSummaryTab';
import { IndentTab } from '@/modules/rm/ui/IndentTab';
import { ReceiptTab } from '@/modules/rm/ui/ReceiptTab';
import { OrderProductionTab } from '@/modules/production/ui/OrderProductionTab';
import { BillingTab } from '@/modules/billing/ui/BillingTab';
import type { OrderDetail } from '../server/query';
import { HOLD_STATUS, ORDER_STATUSES } from '../columns';
import { OrderPoTab } from '@/modules/poIntake/ui/OrderPoTab';
import { ChangeDocket } from './ChangeDocket';
import { CancelOrder } from './CancelOrder';

// Business-process order: plan -> make -> inspect/galvanise -> ship -> bill.
const TABS: { key: OrderTab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'po', label: 'PO details' },
  { key: 'bom', label: 'BOM' },
  { key: 'indent', label: 'RM Indent' },
  { key: 'receipt', label: 'RM Receipt & Re-plan' },
  { key: 'production', label: 'Production' },
  { key: 'stage', label: 'Stage inspection' },
  { key: 'galv', label: 'Galvanising' },
  { key: 'inspection', label: 'Inspection / MC' },
  { key: 'di', label: 'DI' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'billing', label: 'Billing & Collection' },
  { key: 'quotation', label: 'Quotation lines' },
];
const REGISTER_TABS: OrderTab[] = ['stage', 'galv', 'inspection', 'di', 'dispatch'];

export function OrderPage({ initial, role }: { initial: OrderDetail; role: string }) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const tab = useAppSelector((s) => s.ops.orderTab);
  const [order, setOrder] = useState(initial);
  const [error, setError] = useState('');

  // Status and totals change with BOM and register entries.
  const reloadOrder = useCallback(async () => {
    const r = await getOrderAction(order.id);
    if (r.success && r.data) setOrder(r.data);
  }, [order.id]);

  // Deep links (flags, alerts) open a tab with ?tab=<key>.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    const match = TABS.find((t) => t.key === wanted);
    if (match) dispatch(opsActions.setOrderTab(match.key));
  }, [dispatch]);

  const step = ORDER_STATUSES.indexOf(order.status as (typeof ORDER_STATUSES)[number]);
  // The hold is a pause, not a step: shown in the bar only while the order is on hold.
  const steps = ORDER_STATUSES.map((s, i) => ({ s, i })).filter(({ s }) => s !== HOLD_STATUS || order.status === HOLD_STATUS);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <p className="text-xs font-bold text-slate-500">
            <a href="/orders" className="hover:underline">Orders</a> / PO {order.poNumber}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">
            PO {order.poNumber} <span className="text-base font-bold text-slate-500">· {order.client}</span>
          </h1>
          <p className="text-xs text-slate-500">
            PO date {order.poDate} · docket {order.docketNo ?? '–'}
            {order.utility ? ` · ${order.utility}` : ''} · created by {order.createdByName ?? '–'}
            {order.remarks ? ` · ${order.remarks}` : ''}
          </p>
        </div>
        <div className="flex-1" />
        {role === 'Admin' && <CancelOrder order={order} onChanged={reloadOrder} />}
        {role === 'Admin' && (
          <Button
            variant="destructive"
            onClick={async () => {
              if (!window.confirm(`Delete order PO ${order.poNumber} with its BOM and all register entries? A snapshot stays in the audit log.`)) return;
              const r = await deleteOrderAction(order.id);
              if (r.success) router.push('/orders');
              else setError(r.error);
            }}
          >
            <Trash2 /> Delete order
          </Button>
        )}
      </div>
      <FormError error={error} />

      <ol className="flex flex-wrap gap-1" aria-label="Order status">
        {steps.map(({ s, i }) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${i < step ? 'bg-emerald-100 text-emerald-800' : i === step ? (s === HOLD_STATUS ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white') : 'bg-slate-100 text-slate-500'}`}
          >
            {s}
          </li>
        ))}
      </ol>

      {order.cancelStatus && (
        <p role="status" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
          {order.cancelStatus === 'SUPERSEDED' ? `Superseded by PO ${order.replacedByPo ?? '–'}` : 'Cancelled'} on {order.cancelDate ?? '–'}
          {order.cancelReason ? ` · ${order.cancelReason.replace(/_/g, ' ').toLowerCase()}` : ''}
          {order.cancelNote ? ` · ${order.cancelNote}` : ''} · by {order.cancelledByName ?? '–'}
        </p>
      )}
      {!order.cancelStatus && order.cancelledMt ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Partly cancelled: {order.cancelledMt} MT taken off this order (Quoted MT is the balance).</p>
      ) : null}
      {order.onHold && (
        <button
          type="button"
          onClick={() => dispatch(opsActions.setOrderTab('po'))}
          className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-left text-xs font-bold text-amber-900"
        >
          {HOLD_STATUS}{order.holdReason ? `: ${order.holdReason}` : ''} (open PO details to release)
        </button>
      )}
      {!order.onHold && order.jobStatus && order.jobStatus !== 'INDENT_DRAFTED' && (
        <button
          type="button"
          onClick={() => dispatch(opsActions.setOrderTab('po'))}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-700"
        >
          Indent job: {order.jobNote?.split(/\r?\n/)[0]}
        </button>
      )}

      <div className="flex flex-wrap gap-3">
        <Kpi label="Quoted MT" value={fmtNum(order.quotedMt, 3)} />
        <Kpi label="BOM MT" value={fmtNum(order.bomMt, 3)} />
        <Kpi label="Dispatched MT" value={fmtNum(order.dispatchedMt, 3)} tone="green" />
      </div>

      <div role="tablist" aria-label="Order sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => dispatch(opsActions.setOrderTab(t.key))}
            className={`-mb-px shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'summary' && <OrderSummaryTab order={order} role={role} onChanged={reloadOrder} />}
        {tab === 'po' && role === 'Admin' && (
          <div className="mb-3">
            <ChangeDocket orderId={order.id} docketNo={order.docketNo} client={order.client} onChanged={reloadOrder} />
          </div>
        )}
        {tab === 'po' && <OrderPoTab orderId={order.id} role={role} onChanged={reloadOrder} />}
        {tab === 'bom' && <BomTab orderId={order.id} role={role} quotedMt={order.quotedMt} onChanged={reloadOrder} />}
        {tab === 'indent' && <IndentTab orderId={order.id} role={role} onChanged={reloadOrder} />}
        {tab === 'receipt' && <ReceiptTab orderId={order.id} role={role} onChanged={reloadOrder} />}
        {tab === 'production' && <OrderProductionTab orderId={order.id} role={role} onChanged={reloadOrder} />}
        {REGISTER_TABS.includes(tab) && (
          <RegisterTable key={tab} register={tab as RegisterKey} orderId={order.id} role={role} onChanged={reloadOrder} />
        )}
        {tab === 'billing' && <BillingTab orderId={order.id} role={role} onChanged={reloadOrder} />}
        {tab === 'quotation' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <p className="px-4 pt-3 text-xs text-slate-500">Copied from docket {order.docketNo ?? '–'} when the order was created.</p>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  {['Item (party)', 'Our item', 'UOM', 'Qty', 'Price', 'Weight / piece'].map((h) => (
                    <th key={h} className="px-4 py-2 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">The docket had no item lines.</td>
                  </tr>
                )}
                {order.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 align-top">
                    <td className="max-w-md px-4 py-2">{l.itemName}</td>
                    <td className="px-4 py-2">{l.ourItemName}</td>
                    <td className="px-4 py-2">{l.uom}</td>
                    <td className="px-4 py-2 tabular-nums">{l.qty}</td>
                    <td className="px-4 py-2 tabular-nums">{l.price}</td>
                    <td className="px-4 py-2">{l.weightPerPiece}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
