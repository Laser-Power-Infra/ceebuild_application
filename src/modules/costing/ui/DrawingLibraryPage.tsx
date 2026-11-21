'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls, labelCls } from '@/components/Modal';
import { createDrawingAction, deleteDrawingAction, drawingLinesAction, listDrawingsAction, updateDrawingFieldAction } from '@/app/actions/costing';
import { CATEGORY_LABELS, type Category } from '@/lib/costing/calc';
import type { BomLineDraft } from '@/lib/costing/drawings';
import type { DrawingLineRow, DrawingRow } from '../server/drawings';
import { Badge, DraftLinesEditor, DrawingExtractor, card, inr, td, th } from './shared';

const empty = { utility: '', state: '', itemType: '', drawingNo: '', revision: '0', approvalLetterNo: '', approvalDate: '', fileLink: '', remarks: '', supersedePrevious: true };

export function DrawingLibraryPage({ role }: { role: string }) {
  const canEdit = role === 'Admin' || role === 'User';
  const isAdmin = role === 'Admin';
  const [rows, setRows] = useState<DrawingRow[]>([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [lines, setLines] = useState<Record<number, DrawingLineRow[]>>({});
  const [form, setForm] = useState<typeof empty | null>(null);
  const [draft, setDraft] = useState<BomLineDraft[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await listDrawingsAction();
    if (!r.success) return setError(r.error);
    setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (id: number) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!lines[id]) {
      const r = await drawingLinesAction(id);
      if (r.success) setLines((m) => ({ ...m, [id]: r.data }));
      else setError(r.error);
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(
      (d) => (showSuperseded || d.status === 'APPROVED') && (!s || [d.utility, d.state, d.itemType, d.drawingNo, d.approvalLetterNo].some((v) => String(v ?? '').toLowerCase().includes(s))),
    );
  }, [rows, q, showSuperseded]);

  const edit = async (d: DrawingRow, field: string, current: string | null, label: string) => {
    const v = window.prompt(label, current ?? '');
    if (v === null) return;
    const r = await updateDrawingFieldAction(d.id, field, v);
    if (!r.success) return setError(r.error);
    void load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Approved Drawing Library</h1>
          <p className="text-xs text-slate-700">
            Client-approved drawings with their BOM. When an enquiry comes without a drawing, the item BOM is taken from here: same utility + item → same state + item → any approved
            drawing of the item type (reference only – confirm). Add every new approval so the next enquiry can reuse it.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              setForm({ ...empty });
              setDraft([]);
              setNote('');
            }}
          >
            <Plus /> Add approved drawing
          </Button>
        )}
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <input className={`${fieldCls} max-w-sm`} placeholder="Search utility, state, item type, drawing no, letter" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded
        </label>
        <span className="text-xs text-slate-700">{filtered.length} drawing(s)</span>
      </div>

      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>Utility</th>
              <th className={th}>State</th>
              <th className={th}>Item / structure type</th>
              <th className={th}>Drawing no.</th>
              <th className={th}>Rev</th>
              <th className={th}>Approval letter</th>
              <th className={th}>Status</th>
              <th className={`${th} text-right`}>Lines</th>
              <th className={`${th} text-right`}>Set wt (kg)</th>
              <th className={`${th} text-right`}>Used</th>
              <th className={th}>File</th>
              {isAdmin && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className={`${td} py-6 text-center text-slate-700`} colSpan={13}>No drawings yet. Add the approved drawings (e.g. SBPDCL letter 2333 dt 28-07-2025) with their BOM.</td>
              </tr>
            )}
            {filtered.map((d) => (
              <Fragment key={d.id}>
                <tr className={d.status === 'SUPERSEDED' ? 'text-slate-700' : ''}>
                  <td className={td}>
                    <button type="button" aria-label="Show BOM lines" onClick={() => void toggle(d.id)} className="rounded p-0.5 hover:bg-slate-100">
                      {open === d.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className={td}>{d.utility}</td>
                  <td className={td}>{d.state ?? '–'}</td>
                  <td className={`${td} font-semibold`}>{d.itemType}</td>
                  <td className={td}>{d.drawingNo}</td>
                  <td className={td}>{d.revision}</td>
                  <td className={td}>
                    {[d.approvalLetterNo, d.approvalDate && `dt ${d.approvalDate}`].filter(Boolean).join(' ') || '–'}
                    {canEdit && (
                      <button type="button" className="ml-1 text-xs text-blue-800 hover:underline" onClick={() => void edit(d, 'approvalLetterNo', d.approvalLetterNo, 'Approval letter no.')}>
                        edit
                      </button>
                    )}
                  </td>
                  <td className={td}>
                    {d.status === 'APPROVED' ? <Badge tone="green">Approved</Badge> : <Badge tone="slate">Superseded</Badge>}
                    {canEdit && (
                      <button
                        type="button"
                        className="ml-1 text-xs text-blue-800 hover:underline"
                        onClick={async () => {
                          const r = await updateDrawingFieldAction(d.id, 'status', d.status === 'APPROVED' ? 'SUPERSEDED' : 'APPROVED');
                          if (!r.success) return setError(r.error);
                          void load();
                        }}
                      >
                        {d.status === 'APPROVED' ? 'supersede' : 'restore'}
                      </button>
                    )}
                  </td>
                  <td className={`${td} text-right`}>{d.lineCount}</td>
                  <td className={`${td} text-right`}>{inr(d.setWtKg, 3)}</td>
                  <td className={`${td} text-right`}>{d.usedBy}</td>
                  <td className={td}>
                    {d.fileLink ? (
                      <a href={d.fileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-800 hover:underline">
                        Drive <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : canEdit ? (
                      <button type="button" className="text-xs text-blue-800 hover:underline" onClick={() => void edit(d, 'fileLink', d.fileLink, 'Laser Drive link of the drawing')}>
                        add link
                      </button>
                    ) : (
                      '–'
                    )}
                  </td>
                  {isAdmin && (
                    <td className={td}>
                      <button
                        type="button"
                        aria-label={`Delete drawing ${d.drawingNo}`}
                        className="rounded p-1 text-slate-700 hover:text-rose-600"
                        onClick={async () => {
                          if (!window.confirm(`Delete drawing ${d.drawingNo} rev ${d.revision}? Item BOMs made from it keep their lines. Prefer "supersede".`)) return;
                          const r = await deleteDrawingAction(d.id);
                          if (!r.success) return setError(r.error);
                          void load();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
                {open === d.id && (
                  <tr>
                    <td colSpan={13} className="bg-slate-50 p-3">
                      {d.remarks && <p className="mb-2 text-xs text-slate-700">{d.remarks}</p>}
                      <table className="w-full border-collapse bg-white">
                        <thead>
                          <tr>
                            <th className={th}>#</th>
                            <th className={th}>Mark</th>
                            <th className={th}>Description</th>
                            <th className={th}>Section</th>
                            <th className={`${th} text-right`}>Length mm</th>
                            <th className={`${th} text-right`}>Qty / set</th>
                            <th className={`${th} text-right`}>kg / set</th>
                            <th className={th}>Category</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(lines[d.id] ?? []).map((l) => (
                            <tr key={l.id}>
                              <td className={td}>{l.rowNo}</td>
                              <td className={td}>{l.markNo ?? ''}</td>
                              <td className={td}>{l.description ?? ''}</td>
                              <td className={td}>{l.section ?? ''}</td>
                              <td className={`${td} text-right`}>{l.lengthMm ?? ''}</td>
                              <td className={`${td} text-right`}>{l.qtyPerSet ?? ''}</td>
                              <td className={`${td} text-right`}>{l.kg === null ? '–' : inr(l.kg, 3)}</td>
                              <td className={td}>{CATEGORY_LABELS[l.category as Category] ?? l.category}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title="Add approved drawing" wide onClose={() => setForm(null)}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['utility', 'Utility *', 'SBPDCL'],
                  ['state', 'State', 'Bihar'],
                  ['itemType', 'Item / structure type *', 'V Cross Arm 11 kV'],
                  ['drawingNo', 'Drawing no. *', 'SBPDCL/11KV/VCA-01'],
                  ['revision', 'Revision', '0'],
                  ['approvalLetterNo', 'Approval letter no.', 'SBPDCL letter 2333'],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k}>
                  <label className={labelCls} htmlFor={`d-${k}`}>{label}</label>
                  <input id={`d-${k}`} className={fieldCls} placeholder={ph} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className={labelCls} htmlFor="d-date">Approval date</label>
                <input id="d-date" type="date" className={fieldCls} value={form.approvalDate} onChange={(e) => setForm({ ...form, approvalDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="d-link">File link (Laser Drive)</label>
                <input id="d-link" className={fieldCls} placeholder="https://drive.google.com/…" value={form.fileLink} onChange={(e) => setForm({ ...form, fileLink: e.target.value })} />
              </div>
              <div className="col-span-2 sm:col-span-4">
                <label className={labelCls} htmlFor="d-rem">Remarks</label>
                <input id="d-rem" className={fieldCls} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-xs sm:col-span-4">
                <input type="checkbox" checked={form.supersedePrevious} onChange={(e) => setForm({ ...form, supersedePrevious: e.target.checked })} /> Mark older revisions of this drawing no. as Superseded
              </label>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">BOM lines</p>
              <DrawingExtractor
                onLines={(l, n, file) => {
                  setDraft(l);
                  setNote(n);
                  if (!form.drawingNo) setForm((f) => (f ? { ...f, drawingNo: file.name.replace(/\.[^.]+$/, '').slice(0, 100) } : f));
                }}
              />
              {note && <p className="mt-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">{note}</p>}
              <div className="mt-2">
                <DraftLinesEditor lines={draft} onChange={setDraft} />
              </div>
            </div>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const r = await createDrawingAction(form, draft);
                  setSaving(false);
                  if (!r.success) return setError(r.error);
                  setError('');
                  setForm(null);
                  void load();
                }}
              >
                {saving ? 'Saving…' : 'Save drawing'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
