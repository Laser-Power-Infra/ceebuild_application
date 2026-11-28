'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/Modal';
import type { DataColumn } from '@/components/data-table/types';
import { opsActions } from '@/lib/opsSlice';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { initialTable } from '@/lib/opsSlice';
import { listFlagsAction, listOverviewAction, listOverviewFacetAction, overviewStatsAction } from '@/app/actions/overview';
import type { OrderFlag, OverviewMeta, OverviewRow, OverviewStats } from '../types';
import { FlagList } from './FlagList';

const TABLE_ID = 'overview';

const COLUMNS: DataColumn<OverviewRow>[] = [
  { key: 'poNumber', label: 'PO no', kind: 'text', sortable: true, sticky: true, width: 150 },
  { key: 'client', label: 'Client', kind: 'text', sortable: true, filter: true, width: 200 },
  { key: 'status', label: 'Stage', kind: 'text', sortable: true, filter: true, width: 140 },
  { key: 'flags', label: 'Flags', kind: 'number', sortable: true, align: 'right', width: 80 },
  { key: 'daysSincePo', label: 'Days since PO', kind: 'number', sortable: true, align: 'right', width: 110 },
  { key: 'deliveryDue', label: 'Delivery due', kind: 'date', sortable: true, width: 120 },
  { key: 'daysLate', label: 'Days late', kind: 'number', sortable: true, align: 'right', width: 90 },
  { key: 'orderedMt', label: 'Ordered MT', kind: 'number', sortable: true, align: 'right', width: 110 },
  { key: 'cutMt', label: 'Cut MT', kind: 'number', sortable: true, align: 'right', width: 90 },
  { key: 'galvanisedMt', label: 'Galv MT', kind: 'number', sortable: true, align: 'right', width: 90 },
  { key: 'inspectedMt', label: 'Inspected MT', kind: 'number', sortable: true, align: 'right', width: 110 },
  { key: 'dispatchedMt', label: 'Dispatched MT', kind: 'number', sortable: true, align: 'right', width: 120 },
  { key: 'bottleneck', label: 'Bottleneck', kind: 'text', width: 150 },
  { key: 'billedRs', label: 'Billed (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
  { key: 'collectedRs', label: 'Collected (Rs)', kind: 'number', sortable: true, align: 'right', width: 130 },
  { key: 'outstandingRs', label: 'Outstanding (Rs)', kind: 'number', sortable: true, align: 'right', width: 140 },
  { key: 'docketNo', label: 'Docket', kind: 'text', sortable: true, filter: true, width: 130 },
];

/** M14 home: every open order, its stage, its MT pipeline, money and red flags. */
export function OverviewPage() {
  const dispatch = useAppDispatch();
  const st = useAppSelector((s) => s.ops.tables[TABLE_ID]) ?? initialTable;
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [flags, setFlags] = useState<OrderFlag[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    const [s, f] = await Promise.all([overviewStatsAction(), listFlagsAction()]);
    if (s.success) setStats(s.data);
    if (f.success) setFlags(f.data);
    setError(!s.success ? s.error : !f.success ? f.error : '');
  }, []);
  useEffect(() => {
    void load();
  }, [load, reload]);

  const columns = useMemo(
    () =>
      COLUMNS.map((c) => {
        if (c.key === 'poNumber') return { ...c, render: (r: OverviewRow) => <a href={`/orders/${r.id}`} className="font-semibold text-blue-700 hover:underline">{r.poNumber}</a> };
        if (c.key === 'flags')
          return {
            ...c,
            render: (r: OverviewRow) =>
              r.flags ? (
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${r.highFlags ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{r.flags}</span>
              ) : (
                <span className="text-slate-300">0</span>
              ),
          };
        if (c.key === 'bottleneck')
          return { ...c, render: (r: OverviewRow) => (r.bottleneck ? `${r.bottleneck.toLowerCase()} · ${fmtNum(r.bottleneckDays, 1)} d` : '–') };
        if (c.key === 'daysLate') return { ...c, render: (r: OverviewRow) => (r.daysLate ? <span className="font-semibold text-rose-700">{r.daysLate}</span> : '') };
        return c;
      }),
    [],
  );

  const activeStage = st.filters.status?.length === 1 ? st.filters.status[0] : null;
  const showClosed = st.extra.closed === '1';
  const funnel = stats?.funnel.filter((f) => showClosed || !['Closed', 'Cancelled', 'Superseded'].includes(f.status)) ?? [];
  const maxOrders = Math.max(1, ...funnel.map((f) => f.orders));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Control Tower</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Every open order from PO to collection: stage, tonnage, money and what is overdue.</p>
        </div>
        <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      <FormError error={error} />

      <div className="flex flex-wrap gap-3">
        <Kpi label="Open orders" value={stats ? fmtNum(stats.openOrders, 0) : '–'} />
        <Kpi label="MT in pipeline" value={stats ? fmtNum(stats.pipelineMt, 1) : '–'} />
        <Kpi label="MT dispatched this month" value={stats ? fmtNum(stats.dispatchedThisMonthMt, 1) : '–'} tone="green" />
        <Kpi label="Billed (Rs)" value={stats ? fmtNum(stats.billedRs, 0) : '–'} />
        <Kpi label="Collected (Rs)" value={stats ? fmtNum(stats.collectedRs, 0) : '–'} tone="green" />
        <Kpi label="Outstanding (Rs)" value={stats ? fmtNum(stats.outstandingRs, 0) : '–'} tone="amber" />
        <Kpi label="Overdue (Rs)" value={stats ? fmtNum(stats.overdueRs, 0) : '–'} tone={stats?.overdueRs ? 'red' : undefined} />
        <Kpi
          label="Red flags"
          value={stats ? `${fmtNum(stats.flags, 0)}${stats.highFlags ? ` · ${stats.highFlags} high` : ''}` : '–'}
          tone={stats?.highFlags ? 'red' : stats?.flags ? 'amber' : undefined}
          active={st.extra.flagged === '1'}
          onClick={() => dispatch(opsActions.setExtra({ id: TABLE_ID, key: 'flagged', value: st.extra.flagged === '1' ? null : '1' }))}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Orders by stage</h2>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => dispatch(opsActions.setExtra({ id: TABLE_ID, key: 'closed', value: e.target.checked ? '1' : null }))}
            />
            Include closed orders
          </label>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-8">
          {funnel.map((f) => {
            const active = activeStage === f.status;
            return (
              <button
                key={f.status}
                type="button"
                aria-pressed={active}
                disabled={f.orders === 0 && !active}
                onClick={() => dispatch(opsActions.setFilter({ id: TABLE_ID, key: 'status', values: active ? [] : [f.status] }))}
                className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${
                  active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'
                }`}
              >
                <div className="truncate text-[11px] font-medium text-slate-500">{f.status}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-semibold tabular-nums text-slate-900">{f.orders}</span>
                  {f.mt > 0 && <span className="text-[11px] tabular-nums text-slate-500">{fmtNum(f.mt, 1)} MT</span>}
                </div>
                <div className="mt-1 h-1 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${(f.orders / maxOrders) * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <ServerTable<OverviewRow, OverviewMeta>
        tableId={TABLE_ID}
        columns={columns}
        rowId={(r) => String(r.id)}
        fetchPage={listOverviewAction}
        fetchFacet={listOverviewFacetAction}
        reloadToken={reload}
        rowClassName={(r) => (r.highFlags ? 'bg-rose-50/40' : undefined)}
        searchPlaceholder="Search PO, client, docket, stage"
        header={({ meta, total }) => (
          <p className="text-xs text-slate-500">
            {fmtNum(total, 0)} {showClosed ? 'orders' : 'open orders'} · {fmtNum(meta?.orderedMt, 1)} MT ordered · {fmtNum(meta?.dispatchedMt, 1)} MT dispatched ·
            Rs {fmtNum(meta?.outstandingRs, 0)} outstanding
          </p>
        )}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Red flags</h2>
        <p className="mb-2 text-xs text-slate-500">Thresholds are set on Planning Settings. The same list is sent by the daily alert.</p>
        {flags ? <FlagList flags={flags} empty="Nothing is overdue." /> : <p className="text-sm text-slate-500">Loading…</p>}
      </section>
    </div>
  );
}
