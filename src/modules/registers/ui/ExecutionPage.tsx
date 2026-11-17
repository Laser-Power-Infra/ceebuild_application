'use client';

import { opsActions } from '@/lib/opsSlice';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { REGISTER_KEYS, REGISTER_LABELS } from '../columns';
import { RegisterTable } from './RegisterTable';

/** All orders' after-fabrication registers in one place; entries are added from each order's page. */
export function ExecutionPage({ role }: { role: string }) {
  const dispatch = useAppDispatch();
  const tab = useAppSelector((s) => s.ops.executionTab);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Execution registers</h1>
        <p className="text-xs text-slate-500">Galvanising, inspection/MC, DI and dispatch across all orders.</p>
      </div>
      <div role="tablist" aria-label="Registers" className="flex flex-wrap gap-1 border-b border-slate-200">
        {REGISTER_KEYS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => dispatch(opsActions.setExecutionTab(k))}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-xs font-bold ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
          >
            {REGISTER_LABELS[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <RegisterTable key={tab} register={tab} role={role} />
      </div>
    </div>
  );
}
