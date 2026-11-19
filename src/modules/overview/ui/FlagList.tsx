'use client';

import { AlertTriangle, CircleAlert } from 'lucide-react';
import type { OrderFlag } from '../types';

const TAB_LABEL: Record<string, string> = {
  bom: 'BOM',
  receipt: 'RM Receipt',
  galv: 'Galvanising',
  di: 'DI',
  dispatch: 'Dispatch',
  billing: 'Billing',
};

/** Red flags, most severe first. Each links to its order (the tab to open is named). */
export function FlagList({ flags, showOrder = true, empty }: { flags: OrderFlag[]; showOrder?: boolean; empty: string }) {
  if (flags.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {flags.map((f, i) => (
        <li key={`${f.orderId}-${f.code}-${i}`} className="flex items-start gap-3 py-2.5">
          {f.severity === 'high' ? (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="High" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Medium" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-slate-900">{f.title}</span>
              {showOrder && (
                <a href={`/orders/${f.orderId}?tab=${f.tab}`} className="font-medium text-blue-700 hover:underline">
                  PO {f.poNumber}
                </a>
              )}
              {showOrder && f.client && <span className="truncate text-slate-500">{f.client}</span>}
            </div>
            <p className="text-slate-600">{f.detail}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-slate-500">
            {f.days !== null && f.days > 0 ? <div className="font-semibold text-slate-700">{f.days} d overdue</div> : <div>due {f.since}</div>}
            <div>{TAB_LABEL[f.tab] ?? f.tab} tab</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
