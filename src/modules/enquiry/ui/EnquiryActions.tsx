'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { approveBacklogAction, setEnquiryOutcomeAction } from '@/app/actions/enquiry';

const btn = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50';

/** Admin buttons on one tracker row: give a backlog enquiry its docket, close (PO / Lost / Regret) or reopen. */
export function EnquiryActions({ id, status, outcome }: { id: number; status: string; outcome: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setErr('');
    const r = await fn();
    setBusy(false);
    if (!r.success) setErr(r.error ?? 'Failed');
    else router.refresh();
  };
  const close = (o: 'PO' | 'LOST' | 'REGRET') => {
    const note = o === 'PO' ? '' : prompt(o === 'REGRET' ? 'Reason for the regret (approved by Puja):' : 'Why was it lost (price / delivery / other)?');
    if (o !== 'PO' && !note) return;
    void run(() => setEnquiryOutcomeAction(id, o, note ?? ''));
  };
  return (
    <div className="flex flex-wrap gap-1">
      {status === 'BACKLOG' && !outcome && (
        <button
          className={btn}
          disabled={busy}
          onClick={() => confirm('Give this enquiry a docket number (Quotation No.) and make its draft prices?') && void run(() => approveBacklogAction(id))}
        >
          Approve → docket
        </button>
      )}
      {!outcome ? (
        <>
          <button className={btn} disabled={busy} onClick={() => close('PO')}>PO</button>
          <button className={btn} disabled={busy} onClick={() => close('LOST')}>Lost</button>
          <button className={btn} disabled={busy} onClick={() => close('REGRET')}>Regret</button>
        </>
      ) : (
        <button className={btn} disabled={busy} onClick={() => void run(() => setEnquiryOutcomeAction(id, null, null))}>Reopen</button>
      )}
      {err && <span className="text-[11px] text-rose-800">{err}</span>}
    </div>
  );
}
