'use client';

import { ServerTable, Kpi, fmtNum } from '@/components/ServerTable';
import { listIndentsAction, listIndentsFacetAction, listLotsAction, listLotsFacetAction } from '@/app/actions/rm';
import { INDENT_COLUMNS, LOT_COLUMNS, type IndentRow, type IndentsMeta, type LotRow, type LotsMeta } from '../columns';
import { Badge, type Tone } from './parts';

const poLink = <R extends { orderId: number; poNumber: string }>(r: R) => (
  <a href={`/orders/${r.orderId}`} className="font-semibold text-blue-700 hover:underline">
    {r.poNumber}
  </a>
);
const STATUS_TONE: Record<string, Tone> = { Draft: 'amber', Issued: 'green', Cancelled: 'slate' };
const LEN_TONE: Record<string, Tone> = { OK: 'green', Short: 'red', 'Over tolerance': 'amber' };
const DEC_TONE: Record<string, Tone> = { Accepted: 'green', Rejected: 'red', 'Accepted on debit note': 'amber' };

function PageTitle({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="text-xs text-slate-500">{text}</p>
    </div>
  );
}

/** /planning/indent: every RM indent of every order. */
export function IndentsPage() {
  const columns = INDENT_COLUMNS.map((c) =>
    c.key === 'poNumber'
      ? { ...c, render: poLink<IndentRow> }
      : c.key === 'indentNo'
        ? { ...c, render: (r: IndentRow) => <a href={`/orders/${r.orderId}`} className="font-semibold text-slate-900 hover:underline">{r.indentNo}</a> }
        : c.key === 'status'
          ? { ...c, render: (r: IndentRow) => <Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status}</Badge> }
          : c,
  );
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="RM Indent" text="Logical raw-material indents of all orders. Generate, compare and issue them from each order's RM Indent tab." />
      <ServerTable<IndentRow, IndentsMeta>
        tableId="rm-indents"
        columns={columns}
        rowId={(r) => String(r.id)}
        fetchPage={listIndentsAction}
        fetchFacet={listIndentsFacetAction}
        searchPlaceholder="Search indent, PO, client"
        header={({ meta, total }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Indents" value={fmtNum(total, 0)} />
            <Kpi label="Drafts" value={fmtNum(meta?.drafts, 0)} tone={meta?.drafts ? 'amber' : undefined} />
            <Kpi label="Issued MT" value={fmtNum(meta?.issuedMt, 3)} tone="green" />
            <Kpi label="All open MT" value={fmtNum(meta?.totalMt, 3)} />
          </div>
        )}
      />
    </div>
  );
}

/** /planning/receipt: every RM lot received, with length check and decision. */
export function LotsPage() {
  const columns = LOT_COLUMNS.map((c) =>
    c.key === 'poNumber'
      ? { ...c, render: poLink<LotRow> }
      : c.key === 'lengthStatus'
        ? { ...c, render: (r: LotRow) => <Badge tone={LEN_TONE[r.lengthStatus] ?? 'slate'}>{r.lengthStatus}</Badge> }
        : c.key === 'decision'
          ? { ...c, render: (r: LotRow) => <Badge tone={DEC_TONE[r.decision] ?? 'slate'}>{r.decision}</Badge> }
          : c.key === 'diffMm'
            ? { ...c, render: (r: LotRow) => <span className={r.diffMm < 0 ? 'font-semibold text-rose-700' : ''}>{r.diffMm > 0 ? `+${r.diffMm}` : r.diffMm}</span> }
            : c,
  );
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="RM Receipt & Re-plan"
        text="Every RM lot received with its measured length. Short lots must be rejected or taken on a debit note. Add receipts and re-plan from each order's RM Receipt tab."
      />
      <ServerTable<LotRow, LotsMeta>
        tableId="rm-lots"
        columns={columns}
        rowId={(r) => String(r.id)}
        fetchPage={listLotsAction}
        fetchFacet={listLotsFacetAction}
        searchPlaceholder="Search PO, GRN, supplier, section, heat no"
        rowClassName={(r) => (r.lengthStatus === 'Short' ? 'bg-rose-50' : undefined)}
        header={({ meta, total, extra, setExtra }) => (
          <div className="flex flex-wrap gap-3">
            <Kpi label="Lots" value={fmtNum(total, 0)} />
            <Kpi label="Bars received" value={fmtNum(meta?.nos, 0)} />
            <Kpi label="Usable wt (MT)" value={fmtNum(meta?.wtMt, 3)} tone="green" />
            <Kpi
              label="Short lots"
              value={fmtNum(meta?.shortLots, 0)}
              tone={meta?.shortLots ? 'red' : undefined}
              active={extra.short === '1'}
              onClick={() => setExtra('short', extra.short === '1' ? null : '1')}
            />
            <Kpi label="Bars rejected" value={fmtNum(meta?.rejectedNos, 0)} tone={meta?.rejectedNos ? 'amber' : undefined} />
          </div>
        )}
      />
    </div>
  );
}
