'use client';

import { useState } from 'react';
import { RegisterTable } from '@/modules/registers/ui/RegisterTable';
import { BILLING_KEYS, REGISTER_LABELS, type RegisterKey } from '@/modules/registers/columns';
import { AgeingStrip } from './AgeingStrip';

/** Billing & collection for one order (order page) or all orders (/billing when orderId is omitted). */
export function BillingTab({ orderId, role, onChanged }: { orderId?: number; role: string; onChanged?: () => void }) {
  const [tab, setTab] = useState<RegisterKey>('invoice');
  const [reload, setReload] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <AgeingStrip orderId={orderId} reloadToken={reload} />
      <div role="tablist" aria-label="Billing registers" className="flex gap-1 border-b border-slate-200">
        {BILLING_KEYS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
          >
            {REGISTER_LABELS[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <RegisterTable
          key={tab}
          register={tab}
          orderId={orderId}
          role={role}
          onChanged={() => {
            setReload((n) => n + 1);
            onChanged?.();
          }}
        />
      </div>
    </div>
  );
}
