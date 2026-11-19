'use client';

import { useEffect, useState } from 'react';
import { FormError } from '@/components/Modal';
import { fmtNum } from '@/components/ServerTable';
import { Skeleton } from '@/components/ui/skeleton';
import { OPERATION_LABELS } from '@/lib/planning/machines';
import { shopMachinePlanAction } from '@/app/actions/production';
import type { ShopPlan } from '../columns';
import { PlanResultView } from './PlanResultView';

/** Shop load across all open orders (remaining work) and each order's own bottleneck. */
export function ShopPlanPage() {
  const [data, setData] = useState<ShopPlan | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void shopMachinePlanAction().then((r) => (r.success ? setData(r.data) : setError(r.error)));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Machine plan</h1>
        <p className="text-xs text-slate-500">
          Remaining work of every open order (BOM pieces not yet produced, per operation) loaded on the shop&apos;s machines. Order-wise plans with other bases are on each order&apos;s Production tab.
        </p>
      </div>
      <FormError error={error} />
      {!data && !error && <Skeleton className="h-64 w-full" />}
      {data && (
        <>
          <PlanResultView plan={data.plan} workDaysPerWeek={data.workDaysPerWeek} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Open orders</div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-2">PO no</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2 text-right">Pieces left (largest operation)</th>
                  <th className="px-4 py-2">Bottleneck</th>
                  <th className="px-4 py-2 text-right">Working days if run alone</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No open orders with a BOM.</td>
                  </tr>
                )}
                {data.orders.map((o) => (
                  <tr key={o.orderId} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <a href={`/orders/${o.orderId}`} className="font-semibold text-blue-700 hover:underline">{o.poNumber}</a>
                    </td>
                    <td className="px-4 py-2">{o.client ?? '–'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtNum(o.remainingPieces, 0)}</td>
                    <td className="px-4 py-2">{o.bottleneck ? OPERATION_LABELS[o.bottleneck] : '–'}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${o.days === null && o.bottleneck ? 'font-semibold text-rose-700' : ''}`}>
                      {o.days === null ? (o.bottleneck ? 'No machine' : '–') : fmtNum(o.days, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
