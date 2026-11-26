'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { orderNeedsAction, requestOrderMailCheckAction } from '@/app/actions/orderMail';
import type { OrderNeedsRow } from '@/modules/orders/server/mailCheck';

const FROM_TONE: Record<string, string> = {
  Customer: 'bg-amber-100 text-amber-900',
  'Puja (Admin)': 'bg-rose-100 text-rose-900',
  'Drawing team': 'bg-violet-100 text-violet-900',
  Production: 'bg-sky-100 text-sky-900',
  Dashboard: 'bg-slate-100 text-slate-700',
};
const fmt = (iso: string | null) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)} ${iso.slice(11, 16)}` : 'not yet');

function OrderCard({ r, showTitle }: { r: OrderNeedsRow; showTitle: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {showTitle && (
        <a href={`/orders/${r.orderId}`} className="block text-sm font-semibold text-blue-700 hover:underline">
          #{r.orderId} {r.client} · PO {r.poNumber} · {r.docketNo}
          {r.project ? <span className="font-normal text-slate-500"> · {r.project}</span> : null}
        </a>
      )}
      <p className="text-[11px] text-slate-500">
        Mails checked {fmt(r.checkedAt)} ({r.threads} thread{r.threads === 1 ? '' : 's'}){r.latest ? ` · ${r.latest}` : ''}
      </p>
      {r.have.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
          {r.have.map((h) => (
            <span key={h} className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> {h}
            </span>
          ))}
        </p>
      )}
      {r.needs.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {r.needs.map((n, i) => (
            <li key={i} className="text-xs text-slate-800">
              <span className={`mr-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${FROM_TONE[n.from] ?? ''}`}>{n.from}</span>
              <strong>{n.item}</strong> – {n.note}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs font-semibold text-emerald-700">Nothing more needed.</p>
      )}
    </div>
  );
}

/** What each order still needs, from whom (orders page), or for one order (order summary). */
export function OrderNeeds({ orderId, canEdit }: { orderId?: number; canEdit: boolean }) {
  const [rows, setRows] = useState<OrderNeedsRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(!!orderId);

  const load = useCallback(async () => {
    const r = await orderNeedsAction(orderId ? [orderId] : undefined);
    setRows(r.success ? r.data : []);
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    if (!rows?.length) return;
    setBusy(true);
    setMsg('');
    const r = await requestOrderMailCheckAction(rows.map((x) => x.orderId));
    setBusy(false);
    setMsg(r.success ? 'n8n is reading the mails (about a minute per order); reload the page after that.' : r.error);
  };

  if (!rows || rows.length === 0) return null;
  const open_ = rows.reduce((s, r) => s + r.needs.length, 0);
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3" aria-label="What the orders still need">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
          <ClipboardList className="h-3.5 w-3.5" /> {orderId ? 'What this order still needs' : `What the orders still need (${open_} open points, ${rows.length} orders)`} {orderId ? '' : open ? '▲' : '▼'}
        </button>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={check} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Mail />} Check mails now
          </Button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-600">From the PO, the dashboard and the order&apos;s mail threads (n8n reads them every hour and attaches MC, drawings, BOM and dispatch instructions to the order).</p>
      {msg && <p className="mt-1 text-[11px] font-semibold text-amber-900">{msg}</p>}
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((r) => (
            <OrderCard key={r.orderId} r={r} showTitle={!orderId} />
          ))}
        </div>
      )}
    </section>
  );
}
