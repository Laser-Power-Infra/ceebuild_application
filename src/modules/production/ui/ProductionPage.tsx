'use client';

import { EntriesTable } from './EntriesTable';

/** Daily production across all orders; entries can be added here (order picker) or on an order's page. */
export function ProductionPage({ role }: { role: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Daily production</h1>
        <p className="text-xs text-slate-500">Pieces produced by mark and machine, all orders. Filter by date, machine, operation, PO or mark.</p>
      </div>
      <EntriesTable role={role} />
    </div>
  );
}
