'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import { listOrdersAction, listOrdersFacetAction } from '@/app/actions/orders';
import { ORDER_COLUMNS, type OrderRow, type OrdersMeta } from '../columns';
import { NewOrderDialog } from './NewOrderDialog';

const canEditRole = (role: string) => role === 'Admin' || role === 'User';

export function OrdersPage({ role }: { role: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const columns = ORDER_COLUMNS.map((c) =>
    c.key === 'poNumber'
      ? { ...c, render: (r: OrderRow) => <a href={`/orders/${r.id}`} className="font-bold text-blue-700 hover:underline">{r.poNumber}</a> }
      : c,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
        <p className="text-xs text-slate-500">An order starts when an offer becomes a PO. Open an order for its BOM and execution registers.</p>
      </div>
      <ServerTable<OrderRow, OrdersMeta>
        tableId="orders"
        columns={columns}
        rowId={(r) => String(r.id)}
        fetchPage={listOrdersAction}
        fetchFacet={listOrdersFacetAction}
        searchPlaceholder="Search PO, docket, client, status"
        header={({ meta, total }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Orders" value={fmtNum(total, 0)} />
            <Kpi label="Quoted MT" value={fmtNum(meta?.quotedMt, 1)} />
            <Kpi label="BOM MT" value={fmtNum(meta?.bomMt, 1)} />
            <Kpi label="Dispatched MT" value={fmtNum(meta?.dispatchedMt, 1)} tone="green" />
            <Kpi label="Billed (Rs)" value={fmtNum(meta?.billedRs, 0)} />
            <Kpi label="Outstanding (Rs)" value={fmtNum(meta?.outstandingRs, 0)} tone="amber" />
          </div>
        )}
        toolbar={
          canEditRole(role) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New order
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Sign in to create orders</span>
          )
        }
      />
      {creating && (
        <NewOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/orders/${id}`)}
        />
      )}
    </div>
  );
}
