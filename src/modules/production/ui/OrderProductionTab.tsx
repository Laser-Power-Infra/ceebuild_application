'use client';

import { useState } from 'react';
import { EntriesTable } from './EntriesTable';
import { MachinePlanView } from './MachinePlanView';
import { ProgressView } from './ProgressView';
import { RoutingEditor } from './RoutingEditor';

type Sub = 'progress' | 'routing' | 'plan' | 'entries';
const SUBS: { key: Sub; label: string }[] = [
  { key: 'progress', label: 'Progress' },
  { key: 'routing', label: 'Routing' },
  { key: 'plan', label: 'Machine plan' },
  { key: 'entries', label: 'Daily entries' },
];

/** Production for one order: progress by mark, routing, machine load/bottleneck and daily entries. */
export function OrderProductionTab({ orderId, role, onChanged }: { orderId: number; role: string; onChanged?: () => void }) {
  const [sub, setSub] = useState<Sub>('progress');
  // Routing or entries change the progress and the plan.
  const [token, setToken] = useState(0);
  const bump = () => {
    setToken((n) => n + 1);
    onChanged?.();
  };
  const canEdit = role === 'Admin' || role === 'User';

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Production" className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {SUBS.map((s) => (
          <button
            key={s.key}
            role="tab"
            type="button"
            aria-selected={sub === s.key}
            onClick={() => setSub(s.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${sub === s.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {sub === 'progress' && <ProgressView orderId={orderId} reloadToken={token} />}
        {sub === 'routing' && <RoutingEditor orderId={orderId} canEdit={canEdit} onSaved={bump} />}
        {sub === 'plan' && <MachinePlanView orderId={orderId} reloadToken={token} />}
        {sub === 'entries' && <EntriesTable orderId={orderId} role={role} onChanged={bump} />}
      </div>
    </div>
  );
}
