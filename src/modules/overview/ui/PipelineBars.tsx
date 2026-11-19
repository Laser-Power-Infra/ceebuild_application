'use client';

import { fmtNum } from '@/components/ServerTable';

export const rupees = (n: number) => `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

/** Horizontal bars: each step's MT and its share of the total. */
export function PipelineBars({ total, steps }: { total: number; steps: { label: string; kg: number }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const pct = total > 0 ? Math.min(100, (s.kg / total) * 100) : 0;
        return (
          <div key={s.label} className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-sm">
            <span className="text-slate-600">{s.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${s.label}: ${fmtNum(pct, 1)}%`}>
              <div className={`h-full rounded-full ${i === 0 ? 'bg-slate-400' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right tabular-nums text-slate-900">
              {fmtNum(s.kg / 1000, 3)} MT
              {i > 0 && <span className="ml-1.5 text-xs text-slate-500">{fmtNum(pct, 0)}%</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
