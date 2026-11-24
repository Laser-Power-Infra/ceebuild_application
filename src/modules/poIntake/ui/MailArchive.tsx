'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Mail, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, fieldCls } from '@/components/Modal';
import { intakeForThreadAction, pendingIntakesAction, requestMailReadAction, searchMailArchiveAction } from '@/app/actions/poIntake';
import type { DocKind } from '../types';

// M15 + n8n: PO mails come from the company mail archive (MySQL, attachments on Drive). n8n reads
// them (Drive download + Gemini) every 15 minutes, or at once when picked here.

type FileKind = DocKind | 'SKIP';
type ArchFile = { name: string; link: string; driveId: string | null; kind: FileKind };
type Thread = {
  threadId: string;
  date: string | null;
  sender: string | null;
  subject: string | null;
  files: ArchFile[];
  intake: { id: number; status: string; orderId: number | null } | null;
};
type Pending = { id: number; status: string; subject: string | null; error: string | null; createdAt: string; poNumber: string | null; customer: string | null; totalValue: string | null };

const KIND_LABEL: Record<DocKind, string> = { PO: 'PO copy', BOM: 'BOM', DRAWING: 'Drawing', OTHER: 'Other' };
const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

/** PO mails n8n has read (waiting for review), plus the ones it skipped and why. */
export function PendingFromMail({ onOpen, refreshKey }: { onOpen: (intakeId: number) => void; refreshKey: number }) {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  useEffect(() => {
    void pendingIntakesAction().then((r) => setRows(r.success ? (r.data as Pending[]) : []));
  }, [refreshKey]);
  if (!rows || rows.length === 0) return null;
  const ready = rows.filter((r) => r.status === 'EXTRACTED');
  const skipped = rows.filter((r) => r.status !== 'EXTRACTED');
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-3" aria-label="PO mails read by n8n">
      <p className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
        <Bot className="h-3.5 w-3.5" /> Read from mail by n8n – waiting for review ({ready.length})
      </p>
      {ready.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {ready.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.id)} className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-left hover:border-blue-400">
                <span className="block text-sm font-semibold text-slate-900">
                  {r.customer ?? 'Customer not read'} · PO {r.poNumber ?? '?'}
                  {r.totalValue ? <span className="font-normal text-slate-500"> · {r.totalValue}</span> : null}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {r.subject} · read {fmt(r.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-slate-600">Nothing waiting.</p>
      )}
      {skipped.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-[11px] font-bold text-blue-700 hover:underline" onClick={() => setShowSkipped(!showSkipped)}>
            {showSkipped ? 'Hide' : 'Show'} {skipped.length} mail(s) n8n skipped or could not read
          </button>
          {showSkipped && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {skipped.map((r) => (
                <li key={r.id} className="text-[11px] text-slate-600">
                  <span className={`font-bold ${r.status === 'FAILED' ? 'text-rose-700' : 'text-slate-500'}`}>{r.status === 'FAILED' ? 'Failed' : 'Not a PO'}</span> · {r.subject} – {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** "Pick from mail": search the archive, tick the files, n8n reads them, then the review opens. */
export function MailArchivePicker({ onReady, disabled }: { onReady: (intakeId: number) => void; disabled: boolean }) {
  const [q, setQ] = useState('');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [err, setErr] = useState('');
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<{ t: Thread; files: (ArchFile & { on: boolean; kind: DocKind })[] } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const stop = useRef(false);

  useEffect(() => () => void (stop.current = true), []);

  const search = useCallback(async () => {
    setSearching(true);
    setErr('');
    const r = await searchMailArchiveAction(q);
    setSearching(false);
    if (r.success) setThreads(r.data as Thread[]);
    else setErr(r.error);
  }, [q]);

  useEffect(() => {
    void search(); // recent PO mails on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (t: Thread) => {
    if (t.intake) return onReady(t.intake.id);
    setOpen({
      t,
      files: t.files
        .filter((f) => f.driveId)
        .map((f) => ({ ...f, kind: f.kind === 'SKIP' ? 'OTHER' : f.kind, on: f.kind === 'PO' || f.kind === 'BOM' || f.kind === 'DRAWING' })),
    });
  };

  const read = async () => {
    if (!open) return;
    setErr('');
    setWaiting(true);
    stop.current = false;
    const r = await requestMailReadAction(
      open.t.threadId,
      open.files.filter((f) => f.on).map((f) => ({ name: f.name, kind: f.kind })),
    );
    if (!r.success) {
      setWaiting(false);
      return setErr(r.error);
    }
    if (r.data.intakeId) {
      setWaiting(false);
      return onReady(r.data.intakeId);
    }
    // n8n works in the background (Drive download + Gemini, 20-120 s); poll for its result.
    const started = Date.now();
    while (!stop.current && Date.now() - started < 5 * 60_000) {
      await new Promise((res) => setTimeout(res, 4000));
      const p = await intakeForThreadAction(open.t.threadId, r.data.since);
      if (!p.success || !p.data) continue;
      setWaiting(false);
      if (p.data.status === 'EXTRACTED' || p.data.status === 'CONFIRMED') return onReady(p.data.id);
      return setErr(p.data.status === 'DISCARDED' ? `n8n says this is not a customer PO: ${p.data.error ?? ''}` : `n8n could not read it: ${p.data.error ?? 'unknown error'}`);
    }
    setWaiting(false);
    if (!stop.current) setErr('n8n has not answered in 5 minutes. Check the "Ceebuild – Read PO mails" workflow executions in n8n.');
  };

  if (waiting) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        n8n is downloading the files from Drive and reading the PO with Gemini. This takes 20–120 seconds…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className={fieldCls} placeholder="Customer, PO no. or subject (blank = recent PO mails)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Ceebuild mail" />
        <Button type="submit" variant="outline" disabled={searching}>
          {searching ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </form>
      <FormError error={err} />
      {threads && !open && (
        <ul className="flex max-h-[50vh] flex-col overflow-y-auto rounded-xl border border-slate-200">
          {threads.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">No Ceebuild mails with attachments found.</li>}
          {threads.map((t) => (
            <li key={t.threadId} className="border-b border-slate-100 last:border-0">
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => pick(t)}>
                <span className="block text-sm font-semibold text-slate-900">
                  {t.subject}
                  {t.intake && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      {t.intake.status === 'CONFIRMED' ? `order #${t.intake.orderId}` : 'already read – open'}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {t.sender} · {fmt(t.date)} · {t.files.map((f) => f.name).join(', ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{open.t.subject}</p>
              <p className="text-[11px] text-slate-500">Attachments in the whole thread. Tick the PO copy (and BOM / drawing if they are here).</p>
            </div>
            <button type="button" className="text-xs font-bold text-blue-700 hover:underline" onClick={() => setOpen(null)}>
              Back
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {open.files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs">
                <input type="checkbox" aria-label={`Use ${f.name}`} checked={f.on} onChange={(e) => setOpen({ ...open, files: open.files.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                <a href={f.link} target="_blank" rel="noreferrer" className="flex-1 truncate font-semibold text-slate-800 hover:underline">
                  {f.name}
                </a>
                <select
                  aria-label={`Type of ${f.name}`}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                  value={f.kind}
                  onChange={(e) => setOpen({ ...open, files: open.files.map((x, j) => (j === i ? { ...x, kind: e.target.value as DocKind } : x)) })}
                >
                  {(Object.keys(KIND_LABEL) as DocKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div>
            <Button disabled={disabled || !open.files.some((f) => f.on && f.kind === 'PO')} onClick={() => void read()}>
              <Mail /> Read PO (n8n)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
