'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calculator, FileText } from 'lucide-react';
import { FormError } from '@/components/Modal';
import { docketCostingAction } from '@/app/actions/costing';
import { MATCH_LABELS, type MatchLevel } from '@/lib/costing/drawings';
import type { DocketCostRow } from '../server/compute';
import { Badge, card, inr, td, th } from './shared';
import { QuotationHistory } from './QuotationHistory';

type Data = { docket: { id: number; docketNo: string | null; partyName: string | null; utility: string | null; state: string | null; deliveryLocation: string | null; deliveryState?: string | null }; rows: DocketCostRow[]; total: number };

export function DocketCostingPage({ docketId, isAdmin = false }: { docketId: number; isAdmin?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void docketCostingAction(docketId).then((r) => (r.success ? setData(r.data) : setError(r.error)));
  }, [docketId]);
  if (!data) return <div className="p-6 text-sm text-slate-700">{error || 'Loading…'}</div>;
  const { docket, rows } = data;
  const done = rows.filter((r) => r.costingId).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/?tab=dockets" className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Dockets
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Costing – {docket.docketNo ?? `docket #${docket.id}`}</h1>
          <p className="text-xs text-slate-700">
            {docket.partyName} · {docket.utility ?? 'no utility'} · {docket.state ?? ''}
            {docket.deliveryLocation ? ` → ${docket.deliveryLocation}` : ''}
            {docket.deliveryState && docket.deliveryState !== docket.state ? ` (delivery state ${docket.deliveryState}, freight)` : ''} · {done} of {rows.length} item(s) costed from a BOM
          </p>
        </div>
        <Link href={`/quotation/${docket.id}`} target="_blank" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700">
          <FileText className="h-4 w-4" /> Offer PDF
        </Link>
      </div>
      <FormError error={error} />
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Item (party)</th>
              <th className={th}>Our item</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={th}>BOM</th>
              <th className={th}>Drawing</th>
              <th className={`${th} text-right`}>Price on offer</th>
              <th className={`${th} text-right`}>VA %</th>
              <th className={`${th} text-right`}>Rs / set</th>
              <th className={`${th} text-right`}>N&amp;B + bought-out</th>
              <th className={`${th} text-right`}>Item total (Rs)</th>
              <th className={th}>Checks</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={`${td} py-6 text-center text-slate-700`} colSpan={12}>This docket has no items.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.itemId}>
                <td className={`${td} font-semibold`}>{r.itemNameParty ?? '–'}</td>
                <td className={td}>{r.ourItemName ?? '–'}</td>
                <td className={`${td} text-right`}>{r.qty ?? '–'} {r.uom ?? ''}</td>
                <td className={td}>{!r.bomId ? <Badge tone="red">No BOM</Badge> : r.bomStatus === 'CONFIRMED' ? <Badge tone="green">Confirmed</Badge> : <Badge tone="amber">Draft</Badge>}</td>
                <td className={td}>
                  {r.drawingRef ?? '–'}
                  {r.matchLevel && <span className="ml-1"><Badge tone={r.matchLevel === 'ANY_ITEM' ? 'amber' : 'slate'}>{MATCH_LABELS[r.matchLevel as MatchLevel]}</Badge></span>}
                </td>
                <td className={`${td} text-right`}>
                  {r.price ? `Rs ${r.price}/${r.uomOfQtn ?? r.uom ?? ''}` : '–'}
                  {!r.costingId && r.price && <div className="text-xs text-amber-700">typed, not from BOM</div>}
                </td>
                <td className={`${td} text-right`}>{r.vaPct ?? '–'}</td>
                <td className={`${td} text-right`}>{inr(r.sellPerSet)}</td>
                <td className={`${td} text-right`}>{r.costingId ? inr((r.nbSellTotal ?? 0) + (r.boSellTotal ?? 0), 0) : '–'}</td>
                <td className={`${td} text-right font-semibold`}>{r.sellTotal === null ? '–' : inr(r.sellTotal, 0)}</td>
                <td className={td}>
                  {r.flags?.belowMinVa && <Badge tone="red">below min VA</Badge>}
                  {r.flags?.variancePct !== null && r.flags?.variancePct !== undefined && (
                    <span className="ml-1"><Badge tone={Math.abs(r.flags.variancePct) > 10 ? 'amber' : 'slate'}>{r.flags.variancePct > 0 ? '+' : ''}{r.flags.variancePct}% vs last</Badge></span>
                  )}
                </td>
                <td className={td}>
                  <Link href={`/costing/${r.itemId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-800 hover:underline">
                    <Calculator className="h-3.5 w-3.5" /> {r.bomId ? 'Open' : 'Create BOM'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${td} font-bold`} colSpan={9}>Docket total (items costed from BOM, incl. N&amp;B and bought-out lines)</td>
              <td className={`${td} text-right font-bold`}>{inr(data.total, 0)}</td>
              <td className={td} colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <QuotationHistory docketId={docketId} isAdmin={isAdmin} />
    </div>
  );
}
