'use client';

import { useCallback, useState } from 'react';
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
import type { OrderDetail } from '../server/query';
import { ORDER_STATUSES } from '../columns';

const TABS: { key: OrderTab; label: string }[] = [
  { key: 'bom', label: 'BOM' },
  { key: 'galv', label: 'Galvanising' },
  { key: 'inspection', label: 'Inspection / MC' },
  { key: 'di', label: 'DI' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'quotation', label: 'Quotation lines' },
];

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

  const step = ORDER_STATUSES.indexOf(order.status as (typeof ORDER_STATUSES)[number]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <p className="text-xs font-bold text-slate-500">
            <a href="/orders" className="hover:underline">Orders</a> / PO {order.poNumber}
          </p>
          <h1 className="text-xl font-extrabold text-slate-900">
            PO {order.poNumber} <span className="text-base font-bold text-slate-500">· {order.client}</span>
          </h1>
          <p className="text-xs text-slate-500">
            PO date {order.poDate} · docket {order.docketNo ?? '–'}
            {order.utility ? ` · ${order.utility}` : ''} · created by {order.createdByName ?? '–'}
            {order.remarks ? ` · ${order.remarks}` : ''}
          </p>
        </div>
        <div className="flex-1" />
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
        {ORDER_STATUSES.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${i < step ? 'bg-emerald-100 text-emerald-800' : i === step ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}
          >
            {s}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Quoted MT" value={fmtNum(order.quotedMt, 3)} />
        <Kpi label="BOM MT" value={fmtNum(order.bomMt, 3)} />
        <Kpi label="Dispatched MT" value={fmtNum(order.dispatchedMt, 3)} tone="green" />
      </div>

      <div role="tablist" aria-label="Order sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => dispatch(opsActions.setOrderTab(t.key))}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-xs font-bold ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'bom' && <BomTab orderId={order.id} role={role} quotedMt={order.quotedMt} onChanged={reloadOrder} />}
        {(tab === 'galv' || tab === 'inspection' || tab === 'di' || tab === 'dispatch') && (
          <RegisterTable key={tab} register={tab} orderId={order.id} role={role} onChanged={reloadOrder} />
        )}
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
