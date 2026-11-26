'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, History, Pencil, Ruler, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls, labelCls } from '@/components/Modal';
import { FEATURE_KINDS, FEATURE_LABELS, WELD_TYPES, describeFeature, type FabFeature, type FeatureKind } from '@/lib/fabdrawing/geometry';
import {
  confirmDrawingSetAction,
  deleteFeatureAction,
  drawingSetPdfAction,
  featureEditorAction,
  issueDrawingSetAction,
  listDrawingSetsAction,
  markIssueSentAction,
  saveFeatureAction,
} from '@/app/actions/fabdrawings';
import type { FeatureEditorData } from '../server/features';
import type { DrawingSetView } from '../server/sets';

function openPdf(base64: string, fileName: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fmtDt = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Part 2 on a confirmed item BOM: geometry per mark, and the drawing revisions (issue / confirm). */
export function FabGeometryButtons({ bomId, role, onError }: { bomId: number; role: string; onError: (e: string) => void }) {
  const [open, setOpen] = useState<'geo' | 'sets' | null>(null);
  const canEdit = role === 'Admin' || role === 'User';
  return (
    <>
      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setOpen('geo')} title="Holes, slots, bends, welds and notches per mark – printed on the fabrication drawing (entered once per approved drawing)">
          <Ruler /> Holes / bends / welds
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setOpen('sets')} title="Drawing revisions: issue to production, confirmed by production (cutting gate)">
        <History /> Drawing revisions
      </Button>
      {open === 'geo' && <GeometryEditor bomId={bomId} onClose={() => setOpen(null)} />}
      {open === 'sets' && <DrawingSets bomId={bomId} role={role} onClose={() => setOpen(null)} onError={onError} />}
    </>
  );
}

type Form = Record<string, string | boolean>;
const blank = (markNo = ''): Form => ({ id: '', markNo, kind: 'HOLE', positions: '', diaMm: '', offsetMm: '', face: '', count: '', bendAngle: '', bendRadius: '', weldType: 'FILLET', weldSize: '', weldLength: '', weldPitch: '', source: 'DRAWING', toConfirm: false, note: '' });
const toForm = (f: FabFeature): Form => ({
  id: String(f.id ?? ''),
  markNo: f.markNo,
  kind: f.kind,
  positions: f.positionsMm.join(', '),
  diaMm: f.diaMm?.toString() ?? '',
  offsetMm: f.offsetMm?.toString() ?? '',
  face: f.face ?? '',
  count: f.count?.toString() ?? '',
  bendAngle: f.bendAngle?.toString() ?? '',
  bendRadius: f.bendRadius?.toString() ?? '',
  weldType: f.weldType ?? 'FILLET',
  weldSize: f.weldSize?.toString() ?? '',
  weldLength: f.weldLength?.toString() ?? '',
  weldPitch: f.weldPitch?.toString() ?? '',
  source: f.source,
  toConfirm: f.toConfirm,
  note: f.note ?? '',
});

function GeometryEditor({ bomId, onClose }: { bomId: number; onClose: () => void }) {
  const [data, setData] = useState<FeatureEditorData | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await featureEditorAction(bomId);
    if (r.success) setData(r.data);
    else setError(r.error);
  }, [bomId]);
  useEffect(() => {
    void load();
  }, [load]);

  const kind = form.kind as FeatureKind;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = async () => {
    setBusy(true);
    setError('');
    const r = await saveFeatureAction(bomId, { ...form, id: form.id || undefined });
    setBusy(false);
    if (!r.success) return setError(r.error);
    setForm(blank(String(form.markNo)));
    await load();
  };
  const del = async (id: number) => {
    const r = await deleteFeatureAction(bomId, id);
    if (!r.success) return setError(r.error);
    await load();
  };
  const field = (k: string, label: string, ph = '', cls = '') => (
    <label className={`${labelCls} ${cls}`}>
      {label}
      <input className={fieldCls} value={String(form[k] ?? '')} onChange={set(k)} placeholder={ph} />
    </label>
  );

  return (
    <Modal title="Holes, bends and welds per mark" onClose={onClose} wide>
      {!data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600">
            What the BOM does not have, taken from the approved drawing {data.drawingRef ? <b>{data.drawingRef}</b> : ''}. Printed on the member sheets and the cutting list; the drawing never changes a length.
            {data.reusedFrom && <span className="ml-1 font-semibold text-amber-700">Reused from BOM #{data.reusedFrom} (same approved drawing) – saving a row makes a copy for this BOM.</span>}
          </p>
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-6">
            <label className={`${labelCls} sm:col-span-2`}>
              Mark
              <select className={fieldCls} value={String(form.markNo)} onChange={set('markNo')}>
                <option value="">Choose…</option>
                {data.marks.map((m) => (
                  <option key={m.markNo} value={m.markNo}>
                    {m.markNo} · {m.section} · {m.lengthMm ?? '?'} mm
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Type
              <select className={fieldCls} value={kind} onChange={set('kind')}>
                {FEATURE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FEATURE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Source
              <select className={fieldCls} value={String(form.source)} onChange={set('source')}>
                <option value="DRAWING">Approved drawing</option>
                <option value="STANDARD">Standard rule</option>
                <option value="MANUAL">Entered by hand</option>
              </select>
            </label>
            {field('positions', 'Positions from end A (mm)', '50, 475, 1600', 'sm:col-span-2')}
            {(kind === 'HOLE' || kind === 'SLOT') && (
              <>
                {field('diaMm', kind === 'SLOT' ? 'Slot width (mm)' : 'Hole dia (mm, blank = standard)', '11.5')}
                {field('offsetMm', 'Gauge / from heel (mm)', '28')}
                {field('count', 'Count (if no positions)', '')}
                {field('face', 'Leg / face', 'leg A / web')}
              </>
            )}
            {kind === 'BEND' && (
              <>
                {field('bendAngle', 'Angle (°)', '90')}
                {field('bendRadius', 'Inside radius (mm)', '')}
                {field('count', 'No. of bends', '1')}
              </>
            )}
            {kind === 'WELD' && (
              <>
                <label className={labelCls}>
                  Weld type
                  <select className={fieldCls} value={String(form.weldType)} onChange={set('weldType')}>
                    {WELD_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {w.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                {field('weldSize', 'Size (mm)', '4')}
                {field('weldLength', 'Length (mm)', '50')}
                {field('weldPitch', 'Pitch c/c (mm)', '150')}
                {field('face', 'Where', 'strip to rail, both sides')}
              </>
            )}
            {field('note', 'Note', '', 'sm:col-span-3')}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={!!form.toConfirm} onChange={set('toConfirm')} /> To confirm by production
            </label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button size="sm" onClick={save} disabled={busy || !form.markNo}>
                {form.id ? 'Save change' : 'Add'}
              </Button>
              {form.id && (
                <Button size="sm" variant="outline" onClick={() => setForm(blank(String(form.markNo)))}>
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
          <FormError error={error} />
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-left text-slate-600">
                <tr>
                  <th className="px-2 py-1">Mark</th>
                  <th className="px-2 py-1">Section · length</th>
                  <th className="px-2 py-1">Geometry</th>
                </tr>
              </thead>
              <tbody>
                {data.marks.map((m) => {
                  const fs = data.features.filter((f) => f.markNo === m.markNo);
                  return (
                    <tr key={m.markNo} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1 font-semibold">{m.markNo}</td>
                      <td className="px-2 py-1">
                        {m.section} · {m.lengthMm ?? '?'} mm
                        <div className="text-slate-500">{m.description}</div>
                      </td>
                      <td className="px-2 py-1">
                        {fs.length === 0 ? (
                          <span className="text-red-700">not entered – printed "to confirm"</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {fs.map((f) => (
                              <li key={f.id} className="flex items-center gap-2">
                                <span className={f.toConfirm ? 'text-red-700' : ''}>{describeFeature(f)}</span>
                                {!data.reusedFrom && (
                                  <>
                                    <button type="button" aria-label="Edit" className="text-blue-700" onClick={() => setForm(toForm(f))}>
                                      <Pencil className="size-3.5" />
                                    </button>
                                    <button type="button" aria-label="Delete" className="text-red-700" onClick={() => f.id && void del(f.id)}>
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">After changes, press "Generate fabrication drawings" again: a draft Rev is overwritten; after an issued Rev a new Rev is made.</p>
        </div>
      )}
    </Modal>
  );
}

const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ISSUED: 'bg-blue-100 text-blue-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  SUPERSEDED: 'bg-slate-100 text-slate-500 line-through',
};

function DrawingSets({ bomId, role, onClose, onError }: { bomId: number; role: string; onClose: () => void; onError: (e: string) => void }) {
  const [sets, setSets] = useState<DrawingSetView[] | null>(null);
  const [error, setError] = useState('');
  const [issuing, setIssuing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [sent, setSent] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [remarks, setRemarks] = useState('');
  const isAdmin = role === 'Admin';
  const canEdit = isAdmin || role === 'User';

  const load = useCallback(async () => {
    const r = await listDrawingSetsAction(bomId);
    if (r.success) setSets(r.data);
    else setError(r.error);
  }, [bomId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (p: Promise<{ success: true } | { success: false; error: string }>) => {
    setError('');
    const r = await p;
    if (!r.success) return setError(r.error);
    setIssuing(null);
    setConfirming(null);
    setTicked(new Set());
    setRemarks('');
    await load();
  };
  const pdf = async (id: number) => {
    const r = await drawingSetPdfAction(id);
    if (!r.success) return onError(r.error);
    openPdf(r.data.base64, r.data.fileName);
  };

  return (
    <Modal title="Fabrication drawing revisions" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-600">
          Draft → <b>Issue</b> to production (Satya, cc management) → <b>Confirmed by production</b>. Cropping / shearing of an order on this docket is held until the latest Rev is confirmed (Admin can override with a reason).
        </p>
        <FormError error={error} />
        {sets === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : sets.length === 0 ? (
          <p className="text-sm text-slate-500">No drawing made yet: press "Generate fabrication drawings".</p>
        ) : (
          sets.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {s.drawingNo} Rev {s.rev}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CLS[s.status] ?? ''}`}>{s.status}</span>
                {s.outOfDate && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">OUT OF DATE – BOM changed</span>}
                <span className="text-slate-500">
                  {s.pageCount ?? '?'} sheets · made {fmtDt(s.createdAt)} by {s.preparedByName}
                </span>
                {s.changeNote && <span className="text-slate-600">· {s.changeNote}</span>}
                <span className="ml-auto flex gap-1">
                  {s.hasPdf && (
                    <Button size="sm" variant="outline" onClick={() => void pdf(s.id)}>
                      <FileText /> PDF
                    </Button>
                  )}
                  {isAdmin && s.status === 'DRAFT' && !s.outOfDate && (
                    <Button size="sm" variant="outline" onClick={() => setIssuing(issuing === s.id ? null : s.id)}>
                      <Send /> Issue
                    </Button>
                  )}
                  {canEdit && s.status === 'ISSUED' && !s.outOfDate && (
                    <Button size="sm" onClick={() => setConfirming(confirming === s.id ? null : s.id)}>
                      <CheckCircle2 /> Confirmed by production
                    </Button>
                  )}
                </span>
              </div>
              {s.issues.map((i, k) => (
                <p key={k} className="mt-1 text-slate-600">
                  Issued {fmtDt(i.sentAt)} to {i.sentTo}
                  {i.cc ? ` cc ${i.cc}` : ''} by {i.sentByName} – <b className={i.result === 'SENT' ? 'text-emerald-700' : 'text-amber-700'}>{i.result === 'SENT' ? 'mail sent' : 'mail to send'}</b>
                  {i.note ? ` (${i.note})` : ''}
                  {isAdmin && i.result !== 'SENT' && k === 0 && (
                    <button type="button" className="ml-2 font-semibold text-blue-700" onClick={() => void run(markIssueSentAction(s.id))}>
                      Mark sent
                    </button>
                  )}
                </p>
              ))}
              {s.confirmedAt && (
                <p className="mt-1 text-emerald-800">
                  Confirmed by {s.confirmedByName} on {fmtDt(s.confirmedAt)}
                  {s.confirmRemarks ? ` – ${s.confirmRemarks}` : ''}
                </p>
              )}
              {issuing === s.id && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className={labelCls}>
                    To (production)
                    <input className={fieldCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="satya@…" />
                  </label>
                  <label className={labelCls}>
                    Cc (management)
                    <input className={fieldCls} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="puja.agarwal@…" />
                  </label>
                  <label className="flex items-end gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} /> Mail already sent with the PDF
                  </label>
                  <div className="sm:col-span-3">
                    <Button size="sm" onClick={() => void run(issueDrawingSetAction(s.id, { to, cc, sent }))} disabled={!to.trim()}>
                      Issue Rev {s.rev}
                    </Button>
                    <span className="ml-2 text-[11px] text-slate-500">The dashboard does not send mail: download the PDF and send it from the company mail, then mark it sent.</span>
                  </div>
                </div>
              )}
              {confirming === s.id && (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold">Tick each point production has checked:</p>
                  {s.toConfirm.length === 0 && <p className="text-slate-500">No open points.</p>}
                  {s.toConfirm.map((t, i) => (
                    <label key={i} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={ticked.has(i)}
                        onChange={(e) =>
                          setTicked((p) => {
                            const n = new Set(p);
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            return n;
                          })
                        }
                      />
                      <span>{t}</span>
                    </label>
                  ))}
                  <label className={labelCls}>
                    Remarks (needed if a point is not ticked)
                    <input className={fieldCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </label>
                  <Button size="sm" onClick={() => void run(confirmDrawingSetAction(s.id, { items: [...ticked], remarks }))}>
                    Confirm Rev {s.rev} – cutting may start
                  </Button>
                </div>
              )}
              {s.confirmedItems && s.confirmedItems.some((x) => !x.ok) && (
                <p className="mt-1 text-amber-800">Not ticked: {s.confirmedItems.filter((x) => !x.ok).map((x) => x.text).join(' · ')}</p>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
