import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { offerHsn } from '@/lib/po/hsn';
import type { AutoCostResult } from '@/modules/enquiry/server/autoCost';
import { card, td, th } from '@/modules/costing/ui/shared';

export const metadata = { title: 'Draft offer · Ceebuild' };
export const dynamic = 'force-dynamic';

const inr = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '–' : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('-') : '–');

/**
 * Rev 2 §2 E5: draft offer made the same day from the enquiry (draft prices: approved drawing costing,
 * else last quoted = ESTIMATE). For Puja's approval only – no Quotation No. is printed and nothing is
 * sent from here. After approval the prices are applied on the costing page and the normal offer PDF
 * is used.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const r = await prisma.enquiryIntake.findUnique({ where: { id: n } });
  if (!r) notFound();
  const e = (r.extracted ?? {}) as { party?: string; contactName?: string; contactEmail?: string; project?: string; utility?: string; deliveryLocation?: string; enquiryNo?: string; enquiryDate?: string; terms?: string; notes?: string[] };
  const ac = (r.autoCost ?? null) as AutoCostResult | null;
  const items = r.docketNo ? await prisma.itemTable.findMany({ where: { docketNoQtnNo: r.docketNo }, orderBy: { id: 'asc' } }) : [];
  const line = (itemId: number) => ac?.lines.find((l) => l.itemId === itemId);
  const assumptions = [
    ...(ac?.lines ?? []).filter((l) => l.basis !== 'APPROVED_DRAWING' || !l.ok).map((l) => `${l.description ?? 'Item'}: ${l.note}`),
    'Rates in the Costing Master marked ESTIMATE (steel, galvanising, freight) are the latest available values and will be confirmed before the offer is sent.',
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
        DRAFT – for approval only. {ac?.budgetary ? 'Budgetary offer – subject to drawing / BOM. ' : ''}No Quotation No. until approved; nothing is sent from this page.
      </div>
      <section className={card}>
        <h1 className="text-lg font-semibold text-slate-900">Draft offer – {e.party ?? r.partyName ?? 'party'}</h1>
        <div className="mt-2 grid grid-cols-1 gap-1 text-[13px] text-slate-800 sm:grid-cols-2">
          <div>Enquiry: {e.enquiryNo ?? '–'} {e.enquiryDate ? `dt ${e.enquiryDate}` : ''}</div>
          <div>Received: {fmt(r.mailDate)} · Due: {fmt(r.dueDate)}</div>
          <div>Project / utility: {[e.project, e.utility].filter(Boolean).join(' · ') || '–'}</div>
          <div>Delivery: {e.deliveryLocation ?? '–'}</div>
          <div>Kind attn.: {[e.contactName, e.contactEmail].filter(Boolean).join(' · ') || '–'}</div>
          <div>Docket: {r.docketNo ?? 'not created (backlog)'}</div>
          <div className="sm:col-span-2">Subject: {r.subject ?? '–'}</div>
        </div>
      </section>
      <section className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item (as per enquiry)</th>
              <th className={th}>HSN</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate (Rs, before GST)</th>
              <th className={`${th} text-right`}>Amount (Rs)</th>
              <th className={th}>Basis</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const l = line(it.id);
              return (
                <tr key={it.id} className={l?.basis === 'NONE' ? 'bg-rose-50' : l?.basis === 'LAST_QUOTED' ? 'bg-amber-50' : ''}>
                  <td className={td}>{i + 1}</td>
                  <td className={td}>{it.itemNameParty ?? '–'}</td>
                  <td className={td}>{offerHsn(it)}</td>
                  <td className={`${td} text-right`}>{it.qty ?? '–'} {it.uom ?? ''}</td>
                  <td className={`${td} text-right`}>{l?.rate ? `${inr(l.rate)} ${l.rateUnit === 'Rs/kg' ? '/kg' : '/set'}` : '–'}</td>
                  <td className={`${td} text-right`}>{inr(l?.total ?? null, 0)}</td>
                  <td className={`${td} text-[12px]`}>{l ? (l.basis === 'APPROVED_DRAWING' ? `Approved drawing ${l.drawing ?? ''}` : l.basis === 'LAST_QUOTED' ? 'ESTIMATE – last quoted' : 'Needs BOM / drawing') : 'Not costed yet'}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className={`${td} py-6 text-center text-slate-700`}>No items yet{r.docketNo ? '' : ' – approve the enquiry to create its docket'}.</td>
              </tr>
            )}
          </tbody>
          {ac?.total !== null && ac?.total !== undefined && (
            <tfoot>
              <tr>
                <td colSpan={5} className={`${td} font-bold`}>Total of priced lines (before GST)</td>
                <td className={`${td} text-right font-bold`}>{inr(ac.total, 0)}</td>
                <td className={td} />
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      <section className={card}>
        <h2 className="text-sm font-semibold">Terms asked</h2>
        <p className="mt-1 text-[13px] text-slate-800">{e.terms ?? '–'}</p>
        <h2 className="mt-3 text-sm font-semibold">Assumptions</h2>
        <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-800">
          {assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        {(ac?.needs.length ?? 0) > 0 && (
          <>
            <h2 className="mt-3 text-sm font-semibold">Needed from the party</h2>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-rose-800">
              {ac!.needs.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {(e.notes ?? []).length > 0 && (
          <>
            <h2 className="mt-3 text-sm font-semibold">Notes from the enquiry</h2>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-800">
              {e.notes!.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
