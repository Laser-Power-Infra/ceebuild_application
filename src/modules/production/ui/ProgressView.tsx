'use client';

import { useEffect, useState } from 'react';
import { FormError } from '@/components/Modal';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Skeleton } from '@/components/ui/skeleton';
import { OPERATIONS, OPERATION_LABELS } from '@/lib/planning/machines';
import { orderProgressAction } from '@/app/actions/production';
import type { ProgressRow } from '../columns';

/** Per mark x operation: pieces produced against the BOM quantity. */
export function ProgressView({ orderId, reloadToken = 0 }: { orderId: number; reloadToken?: number }) {
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void orderProgressAction(orderId).then((r) => {
      if (!live) return;
      if (r.success) setRows(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [orderId, reloadToken]);

  if (error) return <FormError error={error} />;
  if (!rows) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Upload the BOM to track production by mark.</div>;

  const ops = OPERATIONS.filter((op) => rows.some((r) => op in r.ops));
  let required = 0;
  let done = 0;
  for (const r of rows) {
    for (const op of ops) {
      if (!(op in r.ops)) continue;
      required += r.qty;
      done += Math.min(r.qty, r.ops[op] ?? 0);
    }
  }
  const finished = rows.filter((r) => ops.every((op) => !(op in r.ops) || (r.ops[op] ?? 0) >= r.qty)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Kpi label="Overall progress" value={required ? `${fmtNum((done / required) * 100, 1)}%` : '–'} tone="green" />
        <Kpi label="Marks finished" value={`${finished} / ${rows.length}`} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-4 py-2">Mark</th>
              <th className="px-4 py-2">Section</th>
              <th className="px-4 py-2 text-right">BOM qty</th>
              {ops.map((op) => (
                <th key={op} className="px-4 py-2 text-right">{OPERATION_LABELS[op]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.markNo} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white px-4 py-2 font-semibold">{r.markNo}</td>
                <td className="px-4 py-2 text-slate-600">{r.section ?? '–'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.qty, 0)}</td>
                {ops.map((op) => {
                  if (!(op in r.ops)) return <td key={op} className="px-4 py-2 text-right text-slate-300">–</td>;
                  const n = r.ops[op] ?? 0;
                  const pct = r.qty ? Math.min(100, (n / r.qty) * 100) : 0;
                  return (
                    <td key={op} className="px-4 py-2 text-right">
                      <div className={`tabular-nums ${pct >= 100 ? 'font-semibold text-emerald-700' : ''}`}>{fmtNum(n, 0)}</div>
                      <div className="ml-auto mt-1 h-1 w-16 rounded-full bg-slate-100">
                        <div className={`h-1 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
