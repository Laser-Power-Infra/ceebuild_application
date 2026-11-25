'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { autoCreateOrdersAction, receivedPosAction } from '@/app/actions/poIntake';

type Row = { intakeId: number; subject: string | null; customer: string | null; poNumber: string | null; poDate: string | null; totalValue: string | null; reason: string };
type Made = { intakeId: number; created: boolean; orderId?: number; docketNo?: string | null; reason?: string; discarded?: boolean };

/**
 * POs that parties sent us by mail (read by n8n) and that are not orders yet. Orders are made from
 * them automatically every 15 minutes where a matching docket is found; the rest wait here.
 */
export function ReceivedPos({ canEdit, onCreated }: { canEdit: boolean; onCreated: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await receivedPosAction();
    setRows(r.success ? (r.data as Row[]) : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const makeNow = async () => {
    setBusy(true);
    setMsg('');
    const r = await autoCreateOrdersAction();
    setBusy(false);
    if (!r.success) return setMsg(r.error);
    const made = (r.data as Made[]).filter((m) => m.created);
    const dropped = (r.data as Made[]).filter((m) => m.discarded);
    setMsg(`${made.length} order(s) made${dropped.length ? `, ${dropped.length} mail(s) were our own POs to suppliers and are left out` : ''}.`);
    void load();
    if (made.length) onCreated();
  };

  if (!rows || rows.length === 0) return msg ? <p className="text-xs text-slate-600">{msg}</p> : null;
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-3" aria-label="Received POs not yet orders">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
          <Bot className="h-3.5 w-3.5" /> POs received by mail – not orders yet ({rows.length})
        </p>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={makeNow} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} Make orders now
          </Button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-600">
        Only POs a party sent to us (our own POs to suppliers are left out). Orders are made from them automatically when the docket matches; open one to finish it.
      </p>
      {msg && <p className="mt-1 text-[11px] font-semibold text-blue-900">{msg}</p>}
      <ul className="mt-2 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.intakeId}>
            <a href={`/orders/new?intake=${r.intakeId}`} className="block rounded-lg border border-blue-100 bg-white px-3 py-2 hover:border-blue-400">
              <span className="block text-sm font-semibold text-slate-900">
                {r.customer ?? 'Customer not read'} · PO {r.poNumber ?? '?'}
                {r.poDate ? <span className="font-normal text-slate-500"> · {r.poDate}</span> : null}
                {r.totalValue ? <span className="font-normal text-slate-500"> · Rs {r.totalValue}</span> : null}
              </span>
              <span className="block truncate text-[11px] text-amber-800">{r.reason}</span>
              <span className="block truncate text-[11px] text-slate-500">{r.subject}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
