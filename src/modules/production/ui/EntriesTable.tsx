'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import type { DataColumn } from '@/components/data-table/types';
import { deleteEntryAction, listEntriesAction, listEntriesFacetAction } from '@/app/actions/production';
import { entryColumns, type EntriesMeta, type EntryRow } from '../columns';
import { EntryForm } from './EntryForm';

/** Daily production entries, for one order (orderId) or across all orders. */
export function EntriesTable({ orderId, role, onChanged }: { orderId?: number; role: string; onChanged?: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const scope = useMemo(() => (orderId ? { orderId: String(orderId) } : undefined), [orderId]);

  const changed = () => {
    setReload((n) => n + 1);
    onChanged?.();
  };

  const columns = useMemo(() => {
    const cols: DataColumn<EntryRow>[] = entryColumns(!orderId).map((c) =>
      c.key === 'poNumber' ? { ...c, render: (r: EntryRow) => <a className="font-semibold text-blue-700 hover:underline" href={`/orders/${r.orderId}`}>{r.poNumber}</a> } : c,
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
              if (!window.confirm(`Delete ${r.pieces} pcs of ${r.markNo} on ${r.machineCode} (${r.entryDate})? It stays in the audit log.`)) return;
              const res = await deleteEntryAction(r.id);
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
  }, [orderId, role]);

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <div role="status" className={`rounded-lg border px-3 py-2 text-xs font-semibold ${notice.tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {notice.text}
        </div>
      )}
      <ServerTable<EntryRow, EntriesMeta>
        tableId={`production:${orderId ?? 'all'}`}
        columns={columns}
        rowId={(r) => String(r.id)}
        scope={scope}
        reloadToken={reload}
        fetchPage={listEntriesAction}
        fetchFacet={listEntriesFacetAction}
        searchPlaceholder="Search mark, machine, operator"
        header={({ meta, total }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Entries" value={fmtNum(total, 0)} />
            <Kpi label="Pieces (filtered)" value={fmtNum(meta?.pieces, 0)} />
            <Kpi label="Pieces today" value={fmtNum(meta?.piecesToday, 0)} tone="green" />
            <Kpi label="MT cut (filtered)" value={fmtNum((meta?.cutKg ?? 0) / 1000, 3)} />
          </div>
        )}
        toolbar={
          canEdit ? (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add production
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Sign in to add production</span>
          )
        }
      />
      {adding && (
        <EntryForm
          orderId={orderId}
          onClose={() => setAdding(false)}
          onSaved={(text) => {
            setAdding(false);
            setNotice({ tone: 'green', text });
            changed();
          }}
        />
      )}
    </div>
  );
}
