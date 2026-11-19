'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/components/ServerTable';
import { billingAgeingAction } from '@/app/actions/overview';
import type { AgeingBucket } from '@/modules/overview/types';

const TONE: Record<string, string> = {
  'Not due': 'text-slate-900',
  '1-30 days': 'text-amber-700',
  '31-60 days': 'text-amber-700',
  '61-90 days': 'text-rose-700',
  '>90 days': 'text-rose-700',
};

/** Outstanding (excl. retention) by days past due date. */
export function AgeingStrip({ orderId, reloadToken }: { orderId?: number; reloadToken?: number }) {
  const [rows, setRows] = useState<AgeingBucket[] | null>(null);
  useEffect(() => {
    void billingAgeingAction(orderId).then((r) => r.success && setRows(r.data));
  }, [orderId, reloadToken]);
  const total = rows?.reduce((a, r) => a + r.amount, 0) ?? 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Outstanding ageing">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Outstanding by days past due</h2>
        <span className="text-xs text-slate-500">Total Rs {fmtNum(total, 0)} · retention shown separately</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(rows ?? []).map((r) => (
          <div key={r.bucket} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-[11px] font-medium text-slate-500">{r.bucket}</div>
            <div className={`text-base font-semibold tabular-nums ${r.amount > 0 ? TONE[r.bucket] : 'text-slate-300'}`}>Rs {fmtNum(r.amount, 0)}</div>
            <div className="text-[11px] text-slate-500">{r.invoices} invoice{r.invoices === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
