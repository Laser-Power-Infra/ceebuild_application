'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Mail, Search, CheckCircle2, PauseCircle, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, fieldCls, labelCls } from '@/components/Modal';
import { PO_FIELDS, needsReview, type PoFieldKey, type PoLineDraft } from '@/lib/po/fields';
import { matchQuotedItems, runPoChecks } from '@/lib/po/checks';
import {
  checkDuplicateAction,
  confirmIntakeAction,
  discardIntakeAction,
  getIntakeReviewAction,
  intakeSetupAction,
  searchMailboxAction,
  startIntakeAction,
  startIntakeFromMailAction,
  threadMailsAction,
} from '@/app/actions/poIntake';
import { searchDocketsAction } from '@/app/actions/orders';
import type { DocKind, IntakeReview } from '../types';
import { ChecksPanel, DocViewer, GROUP_LABELS, PoField, PoLinesTable } from './shared';
import { MailArchivePicker, PendingFromMail } from './MailArchive';

type Setup = { gemini: boolean; geminiVia: 'key' | 'n8n' | null; model: string; mailbox: boolean; mailboxName: string; storage: boolean; archive: boolean };
type MailAtt = { messageId: string; fileName: string; mimeType: string; size: number };
type Mail = { id: string; threadId: string; subject: string; from: string; date: string; snippet: string; attachments: MailAtt[] };
type JobOut = { status: string; note: string; steps: string[] } | null;

const KIND_LABEL: Record<DocKind, string> = { PO: 'PO copy', BOM: 'BOM', DRAWING: 'Drawing', OTHER: 'Other' };
const guessKind = (name: string, firstDoc: boolean): DocKind =>
  /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? 'BOM' : /bom|bill of mat/i.test(name) ? 'BOM' : /drg|drawing|gtp|dwg/i.test(name) ? 'DRAWING' : firstDoc ? 'PO' : 'OTHER';
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function KindSelect({ value, onChange, label }: { value: DocKind; onChange: (k: DocKind) => void; label: string }) {
  return (
    <select aria-label={label} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold" value={value} onChange={(e) => onChange(e.target.value as DocKind)}>
      {(Object.keys(KIND_LABEL) as DocKind[]).map((k) => (
        <option key={k} value={k}>{KIND_LABEL[k]}</option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- step 1: attach

function AttachStep({
  setup,
  onRead,
  onIntake,
  busy,
}: {
  setup: Setup | null;
  onRead: (p: { files?: { file: File; kind: DocKind }[]; mail?: { messageId: string; picks: { fileName: string; kind: DocKind; messageId: string }[] } }) => void;
  onIntake: (intakeId: number) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'upload' | 'mail'>('upload');
  const [files, setFiles] = useState<{ file: File; kind: DocKind }[]>([]);
  const [q, setQ] = useState('');
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [mailErr, setMailErr] = useState('');
  const [searching, setSearching] = useState(false);
  const [thread, setThread] = useState<{ mail: Mail; atts: (MailAtt & { kind: DocKind; on: boolean })[] } | null>(null);

  const search = useCallback(async () => {
    setSearching(true);
    setMailErr('');
    const r = await searchMailboxAction(q);
    setSearching(false);
    if (r.success) setMails(r.data as Mail[]);
    else setMailErr(r.error);
  }, [q]);

  const openMail = async (m: Mail) => {
    setMailErr('');
    const r = await threadMailsAction(m.threadId);
    const all = r.success ? (r.data as Mail[]).flatMap((x) => x.attachments) : m.attachments;
    if (!r.success) setMailErr(r.error);
    let firstPo = true;
    setThread({
      mail: m,
      atts: all.map((a) => {
        const kind = guessKind(a.fileName, firstPo && a.messageId === m.id && /\.(pdf|jpe?g|png|webp)$/i.test(a.fileName));
        if (kind === 'PO') firstPo = false;
        return { ...a, kind, on: kind !== 'OTHER' };
      }),
    });
  };

  const notReady = setup && (!setup.gemini || !setup.storage);
  return (
    <div className="flex flex-col gap-4">
      {notReady && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
          {!setup.gemini && 'PO reading is not set up: set N8N_WEBHOOK_URL + N8N_WEBHOOK_KEY (Gemini through n8n) or GEMINI_API_KEY in the server .env and restart. '}
          {!setup.storage && 'File storage (S3) is not configured, so the PO copy cannot be kept.'}
        </div>
      )}
      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {[
          { k: 'upload' as const, label: 'Upload PO copy', icon: FileUp },
          { k: 'mail' as const, label: setup?.archive ? 'Pick from Ceebuild mail' : `Pick from ${setup?.mailboxName ?? 'mailbox'}`, icon: Mail },
        ].map((t) => (
          <button
            key={t.k}
            role="tab"
            type="button"
            aria-selected={mode === t.k}
            onClick={() => setMode(t.k)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${mode === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {mode === 'upload' && (
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400">
            <Paperclip className="h-6 w-6 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Attach the PO copy (PDF, scanned PDF or photo)</span>
            <span className="text-xs text-slate-500">You can add the BOM (xlsx) and drawing in the same go. Nothing needs typing.</span>
            <input
              type="file"
              multiple
              className="sr-only"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.xlsm,.xls,.csv"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                setFiles((prev) => {
                  const hasPo = prev.some((f) => f.kind === 'PO');
                  return [...prev, ...picked.map((file, i) => ({ file, kind: guessKind(file.name, !hasPo && i === 0) }))];
                });
                e.target.value = '';
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
                  <span className="flex-1 truncate font-semibold">{f.file.name}</span>
                  <span className="text-slate-500">{kb(f.file.size)}</span>
                  <KindSelect label={`Type of ${f.file.name}`} value={f.kind} onChange={(k) => setFiles(files.map((x, j) => (j === i ? { ...x, kind: k } : x)))} />
                  <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.file.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button disabled={busy || !files.some((f) => f.kind === 'PO') || !!notReady} onClick={() => onRead({ files })}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Read PO
            </Button>
          </div>
        </div>
      )}

      {mode === 'mail' && setup?.archive && <MailArchivePicker onReady={onIntake} disabled={busy || !setup.storage} />}

      {mode === 'mail' && !setup?.archive && (
        <div className="flex flex-col gap-3">
          {setup && !setup.mailbox ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              The {setup.mailboxName} mailbox is not connected yet. An Admin runs <code>npm run gmail-auth</code> once (signed in as {setup.mailboxName}) and puts the
              GMAIL_* values in the server .env. Until then, download the PO from the mail and use &quot;Upload PO copy&quot;.
            </p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <input className={fieldCls} placeholder="Customer, PO no. or subject (blank = recent PO mails)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the mailbox" />
                <Button type="submit" variant="outline" disabled={searching}>
                  {searching ? <Loader2 className="animate-spin" /> : <Search />} Search
                </Button>
              </form>
              <FormError error={mailErr} />
              {mails && !thread && (
                <ul className="flex max-h-[50vh] flex-col overflow-y-auto rounded-xl border border-slate-200">
                  {mails.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">No mails with attachments found.</li>}
                  {mails.map((m) => (
                    <li key={m.id} className="border-b border-slate-100 last:border-0">
                      <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => void openMail(m)}>
                        <span className="block text-sm font-semibold text-slate-900">{m.subject}</span>
                        <span className="block text-[11px] text-slate-500">
                          {m.from} · {m.date.slice(0, 10)} · {m.attachments.map((a) => a.fileName).join(', ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {thread && (
                <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{thread.mail.subject}</p>
                      <p className="text-[11px] text-slate-500">Attachments in the whole thread. Tick the PO copy (and BOM / drawing if they are here).</p>
                    </div>
                    <button type="button" className="text-xs font-bold text-blue-700 hover:underline" onClick={() => setThread(null)}>
                      Back
                    </button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {thread.atts.map((a, i) => (
                      <li key={`${a.messageId}-${a.fileName}-${i}`} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`Use ${a.fileName}`}
                          checked={a.on}
                          onChange={(e) => setThread({ ...thread, atts: thread.atts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })}
                        />
                        <span className="flex-1 truncate font-semibold">{a.fileName}</span>
                        <span className="text-slate-500">{kb(a.size)}</span>
                        <KindSelect label={`Type of ${a.fileName}`} value={a.kind} onChange={(k) => setThread({ ...thread, atts: thread.atts.map((x, j) => (j === i ? { ...x, kind: k } : x)) })} />
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button
                      disabled={busy || !thread.atts.some((a) => a.on && a.kind === 'PO') || !!notReady}
                      onClick={() =>
                        onRead({ mail: { messageId: thread.mail.id, picks: thread.atts.filter((a) => a.on).map((a) => ({ fileName: a.fileName, kind: a.kind, messageId: a.messageId })) } })
                      }
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Mail />} Read PO
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- step 3: review

type DocketHit = { id: number; docketNo: string | null; party: string | null; utility: string | null; orders: number };

function ReviewStep({ review, onDone, onDiscard }: { review: IntakeReview; onDone: (id: number, job: JobOut, jobError?: string) => void; onDiscard: () => void }) {
  const ex = review.extraction;
  const initial = useMemo(() => Object.fromEntries(PO_FIELDS.map((f) => [f.key, ex.fields[f.key]?.value ?? ''])) as Record<PoFieldKey, string>, [ex]);
  const [values, setValues] = useState(initial);
  const [lines, setLines] = useState<(PoLineDraft & { id: number })[]>(() => ex.lines.map((l, i) => ({ ...l, id: -(i + 1) })));
  const [docketId, setDocketId] = useState<number | null>(review.suggestedDocketId);
  const [otherDocket, setOtherDocket] = useState<DocketHit | null>(null);
  const [dq, setDq] = useState('');
  const [dHits, setDHits] = useState<DocketHit[]>([]);
  const [dup, setDup] = useState(review.duplicateOf);
  const [hold, setHold] = useState(() => ({ on: review.suggestedHold.on, reason: review.suggestedHold.on ? review.suggestedHold.reason : '' }));
  const [remarks, setRemarks] = useState('');
  const [activeDoc, setActiveDoc] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nextId = useRef(-1000);

  // Duplicate check again when the PO no. / customer is corrected.
  useEffect(() => {
    if (values.poNumber === initial.poNumber && values.customerName === initial.customerName) return;
    const t = setTimeout(async () => {
      const r = await checkDuplicateAction(values.customerName, values.poNumber);
      if (r.success) setDup(r.data);
    }, 400);
    return () => clearTimeout(t);
  }, [values.poNumber, values.customerName, initial]);

  useEffect(() => {
    if (dq.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await searchDocketsAction(dq);
      if (r.success) setDHits(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [dq]);

  const items = useMemo(() => review.dockets.find((d) => d.id === docketId)?.items ?? [], [review.dockets, docketId]);
  const priced = useMemo(() => matchQuotedItems(lines, items).map((l, i) => ({ ...l, id: lines[i].id })), [lines, items]);
  const checks = useMemo(
    () => runPoChecks({ fields: values, lines: priced, today: review.today, leadTimeDays: review.leadTimeDays, duplicateOf: dup }),
    [values, priced, review.today, review.leadTimeDays, dup],
  );
  const blocked = checks.some((c) => c.level === 'block') || !docketId;
  const toReview = PO_FIELDS.filter((f) => needsReview(ex.fields[f.key]) && values[f.key] === initial[f.key]).length;

  const confirm = async () => {
    if (!docketId) return setError('Choose the docket (offer) this PO is for.');
    setSaving(true);
    setError('');
    const r = await confirmIntakeAction(review.intakeId, {
      docketId,
      fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() || null])),
      lines: lines.filter((l) => l.description.trim()),
      hold,
      remarks,
    });
    setSaving(false);
    if (r.success) onDone(r.data.id, r.data.job, r.data.jobError);
    else setError(r.error);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="xl:sticky xl:top-2 xl:self-start">
        <DocViewer docs={review.documents} active={activeDoc} onActive={setActiveDoc} tall />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">Read by {ex.model}</span>
          {ex.documentType && ex.documentType !== 'PURCHASE_ORDER' && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">{ex.documentType.replace(/_/g, ' ').toLowerCase()}</span>}
          <span className={`rounded-full px-2 py-0.5 font-bold ${toReview ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
            {toReview ? `${toReview} field(s) to check (yellow)` : 'All fields read with confidence'}
          </span>
          {review.mailSubject && <span className="text-slate-500">Mail: {review.mailSubject}</span>}
        </div>
        {ex.warnings.length > 0 && (
          <ul className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {ex.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        )}

        <section aria-label="Checks" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Checks</h2>
          <ChecksPanel checks={checks} />
        </section>

        <section aria-label="Docket" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Docket (our offer) this PO is for</h2>
          {review.dockets.length === 0 && !otherDocket && <p className="text-xs text-amber-800">No matching docket found automatically. Search below.</p>}
          <ul className="flex flex-col gap-1">
            {[...review.dockets.map((d) => ({ ...d, reasons: d.reasons })), ...(otherDocket && !review.dockets.some((d) => d.id === otherDocket.id) ? [{ ...otherDocket, score: 0, reasons: ['picked by search'], hasBom: false, items: [] }] : [])].map((d) => (
              <li key={d.id}>
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${docketId === d.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                  <input type="radio" name="docket" checked={docketId === d.id} onChange={() => setDocketId(d.id)} className="mt-0.5" />
                  <span>
                    <strong>{d.docketNo}</strong> · {d.party} {d.utility ? `· ${d.utility}` : ''}
                    {d.orders > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{d.orders} order(s)</span>}
                    <span className="block text-[11px] text-slate-500">{d.reasons.join(' · ')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <input className={fieldCls} placeholder="Search another docket (no, party, utility)" value={dq} onChange={(e) => setDq(e.target.value)} aria-label="Search dockets" />
          {dq.trim().length >= 2 && dHits.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {dHits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                    onClick={() => {
                      setOtherDocket(h);
                      setDocketId(h.id);
                      setDq('');
                    }}
                  >
                    <strong>{h.docketNo}</strong> · {h.party} {h.utility ? `· ${h.utility}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(['header', 'commercial', 'references'] as const).map((g) => (
          <section key={g} aria-label={GROUP_LABELS[g]} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{GROUP_LABELS[g]}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {PO_FIELDS.filter((f) => f.group === g).map((f) => (
                <PoField
                  key={f.key}
                  def={f}
                  value={values[f.key]}
                  read={ex.fields[f.key]}
                  highlight={needsReview(ex.fields[f.key]) && values[f.key] === initial[f.key]}
                  onChange={(v) => setValues({ ...values, [f.key]: v })}
                />
              ))}
            </div>
            {g === 'references' && review.libraryDrawings.length > 0 && (
              <p className="text-xs text-emerald-800">
                In the Approved Drawing Library: {review.libraryDrawings.slice(0, 6).map((d) => `${d.drawingNo} R${d.revision}`).join(', ')}
                {review.libraryDrawings.length > 6 ? ` and ${review.libraryDrawings.length - 6} more` : ''}.
              </p>
            )}
            {g === 'references' && ex.bomPieces.length > 0 && (
              <p className="text-xs text-sky-800">{ex.bomPieces.length} BOM piece rows were read from the documents; they become the order BOM when no BOM file is attached.</p>
            )}
          </section>
        ))}

        <section aria-label="Line items" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Line items ({lines.length})</h2>
          <PoLinesTable
            lines={priced}
            onChange={(next) =>
              setLines(
                next.map((l) => {
                  const withId = l as PoLineDraft & { id?: number };
                  return { ...l, id: withId.id ?? nextId.current-- };
                }),
              )
            }
          />
        </section>

        <section aria-label="Hold" className={`flex flex-col gap-2 rounded-xl border p-3 ${hold.on ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={hold.on} onChange={(e) => setHold({ ...hold, on: e.target.checked })} />
            <PauseCircle className="h-4 w-4 text-amber-600" /> BOM/drawing on hold – awaiting client confirmation
          </label>
          <input className={fieldCls} aria-label="Hold reason" placeholder="What the client still has to confirm" value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} />
          <p className="text-[11px] text-slate-600">Drawing check: {review.suggestedHold.reason}</p>
          <p className="text-[11px] text-slate-500">While on hold, the indent job stops after saving the order. Release it on the order&apos;s PO tab when the client confirms.</p>
        </section>

        <div>
          <label className={labelCls} htmlFor="po-remarks">Remarks (optional)</label>
          <textarea id="po-remarks" rows={2} className={fieldCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <FormError error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={() => void confirm()} disabled={saving || blocked}>
            {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm order
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function PoIntakePage({ initialReview }: { initialReview?: IntakeReview | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [review, setReview] = useState<IntakeReview | null>(initialReview ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: number; job: JobOut; jobError?: string } | null>(null);

  useEffect(() => {
    void intakeSetupAction().then((r) => r.success && setSetup(r.data));
  }, []);

  const read = async (p: { files?: { file: File; kind: DocKind }[]; mail?: { messageId: string; picks: { fileName: string; kind: DocKind; messageId: string }[] } }) => {
    setBusy(true);
    setError('');
    let r;
    if (p.files) {
      const fd = new FormData();
      for (const f of p.files) {
        fd.append('file', f.file);
        fd.append('kind', f.kind);
      }
      r = await startIntakeAction(fd);
    } else if (p.mail) r = await startIntakeFromMailAction(p.mail.messageId, p.mail.picks);
    setBusy(false);
    if (!r) return;
    if (r.success) {
      setReview(r.data);
      window.history.replaceState(null, '', `/orders/new?intake=${r.data.intakeId}`);
    } else setError(r.error);
  };

  /** Open a PO that n8n has read (from the waiting list or the mail picker). */
  const openIntake = async (id: number) => {
    setBusy(true);
    setError('');
    const r = await getIntakeReviewAction(id);
    setBusy(false);
    if (!r.success) return setError(r.error);
    setReview(r.data);
    window.history.replaceState(null, '', `/orders/new?intake=${id}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-bold text-slate-500">
          <a href="/orders" className="hover:underline">Orders</a> / Add order
        </p>
        <h1 className="text-xl font-semibold text-slate-900">Add order from the PO copy</h1>
        <p className="text-xs text-slate-500">
          Attach the PO; it is read by OCR + AI and every field is filled. Check the yellow fields, then Confirm. The indent job (BOM → drawing → indent) starts on Confirm.
        </p>
      </div>
      <FormError error={error} />

      {done ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Order saved with the PO copy.</p>
          {done.job && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${done.job.status === 'INDENT_DRAFTED' ? 'border-emerald-300 bg-white' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <p className="font-bold">Indent job: {done.job.status.replace(/_/g, ' ').toLowerCase()}</p>
              <p>{done.job.note}</p>
              {done.job.steps.map((s, i) => (
                <p key={i} className="text-slate-600">• {s}</p>
              ))}
            </div>
          )}
          {done.jobError && <p className="text-xs font-bold text-rose-700">Indent job could not start: {done.jobError}</p>}
          <div className="flex gap-2">
            <Button onClick={() => router.push(`/orders/${done.id}?tab=po`)}>Open the order</Button>
            <Button
              variant="outline"
              onClick={() => {
                setDone(null);
                setReview(null);
                window.history.replaceState(null, '', '/orders/new');
              }}
            >
              Add another
            </Button>
          </div>
        </div>
      ) : review ? (
        review.status === 'EXTRACTED' ? (
          <ReviewStep
            review={review}
            onDone={(id, job, jobError) => setDone({ id, job, jobError })}
            onDiscard={async () => {
              if (!window.confirm('Discard this PO reading? The files stay on record.')) return;
              await discardIntakeAction(review.intakeId);
              setReview(null);
              window.history.replaceState(null, '', '/orders/new');
            }}
          />
        ) : (
          <p className="text-sm text-slate-600">This PO intake is {review.status.toLowerCase()}.</p>
        )
      ) : busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          Reading the PO with {setup?.model ?? 'Gemini'} (OCR + extraction). A scanned multi-page PO takes 20–90 seconds…
        </div>
      ) : (
        <>
          <PendingFromMail onOpen={(id) => void openIntake(id)} refreshKey={0} />
          <AttachStep setup={setup} onRead={read} onIntake={(id) => void openIntake(id)} busy={busy} />
        </>
      )}
    </div>
  );
}
