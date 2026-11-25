'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { freezeQuotationAction, quotationHistoryAction } from '@/app/actions/costing';
import type { SnapshotItem, SnapshotRow } from '../server/snapshot';
import { Badge, card, cellInput, inr, td, th } from './shared';

type History = { snapshots: SnapshotRow[]; live: SnapshotItem[]; liveTotal: number };

const today = () => new Date().toISOString().slice(0, 10);

/** Rev 2 §11: frozen revisions of the quotation (never changed) and live vs quoted prices. */
export function QuotationHistory({ docketId, isAdmin }: { docketId: number; isAdmin: boolean }) {
  const [h, setH] = useState<History | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ quotedOn: today(), status: 'SENT', sentTo: '', note: '' });
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    void quotationHistoryAction(docketId).then((r) => (r.success ? setH(r.data) : setErr(r.error)));
  }, [docketId]);
  useEffect(load, [load]);

  const freeze = async () => {
    if (!confirm(`Freeze the quotation as Rev ${h?.snapshots.length ?? 0}, quoted on ${form.quotedOn}? A snapshot can never be changed.`)) return;
    setBusy(true);
    const r = await freezeQuotationAction(docketId, form);
    setBusy(false);
    if (!r.success) return setErr(r.error);
    setErr('');
    load();
  };

  const latest = h?.snapshots[0];
  const liveOf = (id: number) => h?.live.find((x) => x.itemId === id);

  return (
    <section className={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Quotation history (frozen snapshots)</h2>
        {h && <span className="text-xs text-slate-700">Live docket value Rs {inr(h.liveTotal, 0)}</span>}
      </div>
      {err && <p className="mb-2 text-xs text-rose-800">{err}</p>}
      {isAdmin && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input type="date" className={cellInput} value={form.quotedOn} onChange={(e) => setForm({ ...form, quotedOn: e.target.value })} title="Quoted on" />
          <select className={cellInput} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="SENT">Sent to the customer</option>
            <option value="APPROVED">Approved (not yet sent)</option>
          </select>
          <input className={cellInput} placeholder="Sent to (e-mail / person)" value={form.sentTo} onChange={(e) => setForm({ ...form, sentTo: e.target.value })} />
          <input className={cellInput} placeholder="Note (e.g. VA 25%, options)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button size="sm" disabled={busy} onClick={() => void freeze()}>
            <Lock /> Freeze as Rev {h?.snapshots.length ?? 0}
          </Button>
        </div>
      )}
      {!h ? (
        <p className="text-xs text-slate-700">Loading…</p>
      ) : h.snapshots.length === 0 ? (
        <p className="text-xs text-slate-700">No revision frozen yet. Freeze the quotation when it is approved or sent.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Rev</th>
              <th className={th}>Quoted on</th>
              <th className={th}>Status</th>
              <th className={th}>Sent to</th>
              <th className={th}>Note</th>
              <th className={`${th} text-right`}>Value (Rs)</th>
              <th className={th}>Frozen by</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {h.snapshots.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td className={`${td} font-semibold`}>Rev {s.rev}{s === latest ? ' (latest)' : ''}</td>
                  <td className={td}>{s.quotedOn}</td>
                  <td className={td}><Badge tone={s.status === 'SENT' ? 'green' : 'blue'}>{s.status}</Badge></td>
                  <td className={td}>{s.sentTo ?? '–'}</td>
                  <td className={td}>{s.note ?? '–'}</td>
                  <td className={`${td} text-right`}>{s.totalValue === null ? '–' : inr(s.totalValue, 0)}</td>
                  <td className={td}>{s.createdByName ?? '–'}</td>
                  <td className={td}>
                    <button className="text-xs text-blue-800 hover:underline" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide' : 'Items'}</button>
                  </td>
                </tr>
                {open === s.id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50 px-2 py-2">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className={th}>Item</th>
                            <th className={th}>HSN</th>
                            <th className={`${th} text-right`}>Qty</th>
                            <th className={`${th} text-right`}>Quoted price</th>
                            <th className={`${th} text-right`}>Live price</th>
                            <th className={`${th} text-right`}>VA % (quoted)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.map((it) => {
                            const lv = liveOf(it.itemId);
                            const changed = lv && lv.price !== it.price;
                            return (
                              <tr key={it.itemId}>
                                <td className={td}>{it.itemNameParty ?? it.ourItemName ?? '–'}</td>
                                <td className={td}>{it.hsn}</td>
                                <td className={`${td} text-right`}>{it.qty ?? '–'} {it.uom ?? ''}</td>
                                <td className={`${td} text-right`}>{it.price ? `Rs ${it.price}/${it.uomOfQtn ?? it.uom ?? ''}` : '–'}</td>
                                <td className={`${td} text-right ${changed ? 'font-semibold text-amber-800' : ''}`}>{lv?.price ? `Rs ${lv.price}` : '–'}</td>
                                <td className={`${td} text-right`}>{it.vaPct ?? '–'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="mt-1 text-xs text-slate-700">{s.rateCount} Costing Master rates in force on {s.quotedOn} are stored with this revision.</p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
