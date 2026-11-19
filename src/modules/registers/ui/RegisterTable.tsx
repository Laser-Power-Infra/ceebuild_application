'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import type { DataColumn } from '@/components/data-table/types';
import { deleteRegisterEntryAction, listRegisterAction, listRegisterFacetAction, updateSecurityStatusAction } from '@/app/actions/registers';
import { REGISTER_KPIS, REGISTER_LABELS, registerColumns, type RegisterKey, type RegisterRow } from '../columns';
import { RegisterForm } from './RegisterForm';

/** One register as a server-paged table: per order (orderId) or across all orders. */
export function RegisterTable({ register, orderId, role, onChanged }: { register: RegisterKey; orderId?: number; role: string; onChanged?: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'red' | 'amber'; text: string } | null>(null);

  const scope = useMemo(() => ({ register, ...(orderId ? { orderId: String(orderId) } : {}) }), [register, orderId]);
  const changed = () => {
    setReload((n) => n + 1);
    onChanged?.();
  };

  const columns = useMemo(() => {
    const cols: DataColumn<RegisterRow>[] = registerColumns(register, !orderId).map((c) =>
      c.key === 'poNumber' ? { ...c, render: (r) => <a className="font-bold text-blue-700 hover:underline" href={`/orders/${r.orderId}`}>{r.poNumber}</a> } : c,
    );
    if (role === 'Admin') {
      cols.push({
        key: '_delete',
        label: '',
        kind: 'text',
        width: 50,
        render: (r) => (
          <button
            type="button"
            aria-label="Delete entry"
            className="rounded p-1 text-slate-400 hover:text-rose-600"
            onClick={async (e) => {
              e.stopPropagation();
              if (!window.confirm('Delete this entry? It stays in the audit log.')) return;
              const res = await deleteRegisterEntryAction(register, r.id);
              if (res.success) changed();
              else setNotice({ tone: 'red', text: res.error });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, orderId, role]);

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <div role="alert" className={`rounded-lg border px-3 py-2 text-xs font-bold ${notice.tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {notice.text}
        </div>
      )}
      <ServerTable<RegisterRow, Record<string, number>>
        tableId={`register:${register}:${orderId ?? 'all'}`}
        columns={columns}
        rowId={(r) => String(r.id)}
        scope={scope}
        reloadToken={reload}
        fetchPage={listRegisterAction}
        fetchFacet={listRegisterFacetAction}
        onEdit={
          register === 'security' && canEdit
            ? async (row, column, value) => {
                if (column.key !== 'status') return false;
                const res = await updateSecurityStatusAction(row.id, value);
                if (!res.success) setNotice({ tone: 'red', text: res.error });
                else onChanged?.();
                return res.success;
              }
            : undefined
        }
        searchPlaceholder={`Search ${REGISTER_LABELS[register].toLowerCase()}`}
        header={({ meta, total }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Entries" value={fmtNum(total, 0)} />
            {REGISTER_KPIS[register].map((k) => (
              <Kpi key={k.key} label={k.label} value={fmtNum(meta?.[k.key], k.digits ?? 2)} tone={k.tone} />
            ))}
          </div>
        )}
        toolbar={
          orderId && canEdit ? (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add {REGISTER_LABELS[register]} entry
            </Button>
          ) : orderId ? (
            <span className="text-xs text-slate-500">Sign in to add entries</span>
          ) : (
            <span className="text-xs text-slate-500">Add entries from an order&apos;s page</span>
          )
        }
      />
      {adding && orderId && (
        <RegisterForm
          register={register}
          orderId={orderId}
          onClose={() => setAdding(false)}
          onSaved={(warning) => {
            setAdding(false);
            setNotice(warning ? { tone: 'amber', text: warning } : null);
            changed();
          }}
        />
      )}
    </div>
  );
}
