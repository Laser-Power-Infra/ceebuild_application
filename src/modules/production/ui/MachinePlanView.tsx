'use client';

import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { FormError } from '@/components/Modal';
import { Skeleton } from '@/components/ui/skeleton';
import { orderMachinePlanAction } from '@/app/actions/production';
import { PLAN_BASES, type OrderMachinePlan, type PlanBasis } from '../columns';
import { PlanResultView } from './PlanResultView';

/** Machine load / days / bottleneck for one order on a chosen basis. */
export function MachinePlanView({ orderId, reloadToken = 0 }: { orderId: number; reloadToken?: number }) {
  const [basis, setBasis] = useState<PlanBasis>('FULL');
  const [data, setData] = useState<OrderMachinePlan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void orderMachinePlanAction(orderId, basis).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.success) {
        setData(r.data);
        setError('');
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [orderId, basis, reloadToken]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Plan basis" options={PLAN_BASES} value={basis} onChange={setBasis} />
        <span className="text-xs text-slate-500">{PLAN_BASES.find((b) => b.value === basis)?.hint}</span>
      </div>
      <FormError error={error} />
      {data?.note && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{data.note}</div>}
      {loading && !data ? <Skeleton className="h-48 w-full" /> : data && <PlanResultView plan={data.plan} workDaysPerWeek={data.workDaysPerWeek} />}
    </div>
  );
}
