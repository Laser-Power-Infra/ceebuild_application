import Link from 'next/link';
import { enquiryTracker } from '@/modules/enquiry/server/intake';
import { Badge, card, td, th } from '@/modules/costing/ui/shared';
import { currentRole } from '@/lib/useCanEdit';
import { EnquiryActions } from '@/modules/enquiry/ui/EnquiryActions';

export const metadata = { title: 'Enquiries · Ceebuild' };
export const dynamic = 'force-dynamic';

const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '–');

/** Rev 2 §2 E6: every enquiry read from info@ and where it stands (received -> docket -> BOM -> costed -> offer -> sent -> PO). */
export default async function Page() {
  const [rows, role] = await Promise.all([enquiryTracker(), currentRole()]);
  const isAdmin = role === 'Admin';
  const open = rows.filter((r) => !r.outcome && !r.ordered && !r.sentOn);
  const late = open.filter((r) => r.daysToDue !== null && r.daysToDue <= 2);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Enquiries</h1>
        <p className="text-xs text-slate-700">
          Read automatically from info@ceebuildcompany.com (n8n + Gemini, every 15 min). {rows.length} enquiries · {open.length} without an offer sent
          {late.length ? ` · ${late.length} due within 2 days` : ''}. Every enquiry must get an offer; the only other exit is a Regret approved by Puja.
        </p>
      </div>
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Received</th>
              <th className={th}>Party</th>
              <th className={th}>Subject</th>
              <th className={th}>Enquiry no.</th>
              <th className={th}>Due</th>
              <th className={th}>Docket</th>
              <th className={`${th} text-right`}>Items · BOM · costed</th>
              <th className={th}>Offer</th>
              <th className={th}>Stage</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className={`${td} py-6 text-center text-slate-700`}>No enquiry read yet. The n8n workflow &quot;Ceebuild – Read enquiry mails&quot; fills this list.</td>
              </tr>
            )}
            {rows.map((r) => {
              const urgent = !r.sentOn && !r.ordered && !r.outcome && r.daysToDue !== null && r.daysToDue <= 2;
              return (
                <tr key={r.id} className={urgent ? 'bg-rose-50' : ''}>
                  <td className={td}>{fmt(r.mailDate)}</td>
                  <td className={`${td} font-semibold`}>{r.partyName ?? '–'}</td>
                  <td className={td} title={r.sender ?? ''}>{r.subject ?? '–'}</td>
                  <td className={td}>{r.enquiryNo ?? '–'}</td>
                  <td className={`${td} ${urgent ? 'font-bold text-rose-800' : ''}`}>
                    {fmt(r.dueDate)}
                    {r.daysToDue !== null && !r.sentOn && !r.ordered ? ` (${r.daysToDue < 0 ? `${-r.daysToDue} d late` : `${r.daysToDue} d`})` : ''}
                  </td>
                  <td className={td}>
                    {r.docketId ? (
                      <Link className="text-blue-800 hover:underline" href={`/costing/docket/${r.docketId}`}>
                        {r.docketNo}
                      </Link>
                    ) : (
                      '–'
                    )}
                    {r.status === 'LINKED' && (
                      <span className="ml-1">
                        <Badge tone="slate">linked</Badge>
                      </span>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {r.items} · {r.bomReady} · {r.costed}
                  </td>
                  <td className={td}>
                    {r.sentOn ? `Sent ${fmt(r.sentOn)}` : r.quoted ? `Approved ${fmt(r.quoted)}` : r.draftTotal !== null ? `Draft Rs ${Math.round(r.draftTotal).toLocaleString('en-IN')}` : '–'}
                    {!r.sentOn && r.budgetary && <div className="text-[11px] text-amber-800">Budgetary – subject to drawing / BOM</div>}
                    {r.needs.length > 0 && <div className="text-[11px] text-rose-800" title={r.needs.join('; ')}>Needs: {r.needs.length} BOM / drawing</div>}
                  </td>
                  <td className={td}>
                    <Badge tone={r.ordered ? 'green' : r.sentOn ? 'blue' : urgent ? 'red' : 'amber'}>{r.stage}</Badge>
                  </td>
                  <td className={td}>
                    <Link className="mb-1 block text-[11px] text-blue-800 hover:underline" href={`/costing/enquiries/${r.id}/offer`}>
                      Draft offer
                    </Link>
                    {isAdmin && <EnquiryActions id={r.id} status={r.status} outcome={r.outcome} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
