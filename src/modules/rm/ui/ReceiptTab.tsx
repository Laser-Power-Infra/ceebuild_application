'use client';

import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import {
  addReceiptAction,
  createSupplementaryIndentAction,
  deleteReceiptAction,
  latestCuttingPlanAction,
  listOrderReceiptsAction,
  receiptOptionsAction,
  runReplanAction,
  updateLotAction,
} from '@/app/actions/rm';
import { DECISION_LABELS, LENGTH_STATUS_LABELS, LOT_DECISIONS, type CuttingPlanView, type LotDecision, type ReceiptLotView, type ReceiptOptions, type ReceiptView } from '../columns';
import { Badge, Card, Notice, PatternTable, SimpleTable, type Tone } from './parts';

const today = () => new Date().toISOString().slice(0, 10);
const LEN_TONE: Record<string, Tone> = { OK: 'green', SHORT: 'red', OVER_TOL: 'amber' };
const DEC_TONE: Record<LotDecision, Tone> = { ACCEPTED: 'green', REJECTED: 'red', DEBIT_NOTE: 'amber' };

type LotDraft = { section: string; orderedLengthMm: string; measuredLengthMm: string; nos: string; wtKg: string; heatNo: string };
const emptyLot = (): LotDraft => ({ section: '', orderedLengthMm: '', measuredLengthMm: '', nos: '', wtKg: '', heatNo: '' });

function previewStatus(l: LotDraft, tol: number): 'OK' | 'SHORT' | 'OVER_TOL' | null {
  const o = Number(l.orderedLengthMm);
  const m = Number(l.measuredLengthMm);
  if (!Number.isInteger(o) || !Number.isInteger(m) || o <= 0 || m <= 0) return null;
  return m < o ? 'SHORT' : m > o + tol ? 'OVER_TOL' : 'OK';
}

/** RM received (measured lengths) + re-plan of the order on what actually arrived. */
export function ReceiptTab({ orderId, role, onChanged }: { orderId: number; role: string; onChanged?: () => void }) {
  const canEdit = role === 'Admin' || role === 'User';
  const [receipts, setReceipts] = useState<ReceiptView[] | null>(null);
  const [plan, setPlan] = useState<CuttingPlanView | null>(null);
  const [opts, setOpts] = useState<ReceiptOptions | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editLot, setEditLot] = useState<ReceiptLotView | null>(null);

  const load = useCallback(async () => {
    const [r, p, o] = await Promise.all([listOrderReceiptsAction(orderId), latestCuttingPlanAction(orderId), receiptOptionsAction(orderId)]);
    if (r.success) setReceipts(r.data);
    else setError(r.error);
    if (p.success) setPlan(p.data);
    if (o.success) setOpts(o.data);
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, ok?: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    const r = await fn();
    setBusy(false);
    if (!r.success) return setError(r.error ?? 'Failed');
    if (ok) setNotice(ok);
    await load();
    onChanged?.();
  };

  if (receipts === null) return <p className="text-sm text-slate-500">Loading receipts…</p>;

  const allLots = receipts.flatMap((r) => r.lots);
  const usable = allLots.filter((l) => l.decision !== 'REJECTED');
  const res = plan?.result;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Kpi label="Receipts" value={fmtNum(receipts.length, 0)} />
        <Kpi label="Bars received" value={fmtNum(allLots.reduce((a, l) => a + l.nos, 0), 0)} />
        <Kpi label="Usable bars" value={fmtNum(usable.reduce((a, l) => a + l.nos, 0), 0)} tone="green" />
        <Kpi label="Short lots" value={fmtNum(allLots.filter((l) => l.lengthStatus === 'SHORT').length, 0)} tone={allLots.some((l) => l.lengthStatus === 'SHORT') ? 'red' : undefined} />
        <Kpi label="Wt received (MT)" value={fmtNum(usable.reduce((a, l) => a + (l.wtKg ?? 0), 0) / 1000, 3)} />
      </div>

      <FormError error={error} />
      {notice && <Notice tone="amber">{notice}</Notice>}

      <Card
        title="RM receipts"
        actions={
          canEdit ? (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add receipt
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Sign in to add receipts</span>
          )
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          Enter the actual measured length and nos of every lot. A lot below the ordered length is short (no negative tolerance): reject it, or accept it on a debit note.
          Rejected lots are not used in the re-plan.
        </p>
        {receipts.length === 0 && <p className="text-sm text-slate-600">No RM received yet.</p>}
        <div className="flex flex-col gap-4">
          {receipts.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <strong className="text-sm text-slate-900">{r.receiptNo}</strong>
                <span className="text-slate-600">{new Date(r.receiptDate).toLocaleDateString('en-IN')}</span>
                {r.supplier && <span className="text-slate-600">· {r.supplier}</span>}
                {r.invoiceNo && <span className="text-slate-600">· inv {r.invoiceNo}</span>}
                {r.indentNo && <span className="text-slate-600">· against {r.indentNo}</span>}
                {r.remarks && <span className="text-slate-500">· {r.remarks}</span>}
                <div className="flex-1" />
                {role === 'Admin' && (
                  <button
                    type="button"
                    aria-label={`Delete receipt ${r.receiptNo}`}
                    className="rounded p-1 text-slate-400 hover:text-rose-600"
                    onClick={() => {
                      if (window.confirm(`Delete receipt ${r.receiptNo} and its lots? It stays in the audit log.`)) void run(() => deleteReceiptAction(r.id));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <SimpleTable
                head={['Section', 'Ordered (mm)', 'Measured (mm)', 'Diff', 'Nos', 'Wt (kg)', 'Heat no', 'Length', 'Decision', '']}
                align={['left', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'left', 'left']}
                rows={r.lots.map((l) => [
                  l.sectionLabel ?? l.sectionKey,
                  fmtNum(l.orderedLengthMm, 0),
                  fmtNum(l.measuredLengthMm, 0),
                  <span key="d" className={l.measuredLengthMm < l.orderedLengthMm ? 'font-semibold text-rose-700' : ''}>
                    {l.measuredLengthMm - l.orderedLengthMm > 0 ? '+' : ''}
                    {l.measuredLengthMm - l.orderedLengthMm}
                  </span>,
                  fmtNum(l.nos, 0),
                  fmtNum(l.wtKg, 1),
                  l.heatNo ?? '–',
                  <Badge key="s" tone={LEN_TONE[l.lengthStatus]}>
                    {LENGTH_STATUS_LABELS[l.lengthStatus]}
                  </Badge>,
                  <span key="c" className="flex flex-wrap items-center gap-1">
                    <Badge tone={DEC_TONE[l.decision]}>{DECISION_LABELS[l.decision]}</Badge>
                    {l.debitNoteNo && <span className="text-xs text-slate-500">DN {l.debitNoteNo}</span>}
                  </span>,
                  canEdit ? (
                    <button key="e" type="button" aria-label="Change decision" className="rounded p-1 text-slate-400 hover:text-blue-700" onClick={() => setEditLot(l)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  ) : null,
                ])}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Cutting plan on RM received (re-plan)"
        actions={
          canEdit ? (
            <Button disabled={busy || usable.length === 0} onClick={() => void run(() => runReplanAction(orderId))}>
              <RefreshCw /> {busy ? 'Planning…' : 'Re-plan'}
            </Button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          Whole bars are first cut to exact multiples of a mark; the rest is placed by best fit (longest pieces first, on the bar that leaves the least). Pieces that still
          cannot be cut are the shortfall for a supplementary indent.
        </p>
        {!plan && <p className="text-sm text-slate-600">No cutting plan yet. {usable.length === 0 ? 'Add an RM receipt first.' : 'Click Re-plan.'}</p>}
        {plan && res && (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-slate-500">
              Plan #{plan.id} · {new Date(plan.createdAt).toLocaleString('en-IN')} · by {plan.createdByName ?? '–'}
            </div>
            {plan.stale && <Notice tone="amber">Receipts, lot decisions or the BOM changed after this plan. Click Re-plan to update it.</Notice>}
            {res.warnings.length > 0 && (
              <Notice tone="amber">
                <ul className="list-disc pl-4">
                  {res.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
            )}
            <div className="flex flex-wrap gap-3">
              <Kpi label="Pieces required" value={fmtNum(res.marks.reduce((a, m) => a + m.required, 0), 0)} />
              <Kpi label="Pieces cuttable" value={fmtNum(res.piecesPlanned, 0)} tone="green" />
              <Kpi label="Pieces short" value={fmtNum(res.piecesShort, 0)} tone={res.piecesShort ? 'red' : 'green'} />
              <Kpi label={`Offcuts ≥ ${plan.settings.minOffcutMm} mm`} value={fmtNum(res.offcuts.reduce((a, o) => a + o.count, 0), 0)} />
            </div>

            {res.piecesShort > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
                <span className="text-rose-800">
                  {res.piecesShort} pieces cannot be cut from the RM received
                  {res.supplementary ? ` → supplementary indent: ${res.supplementary.totals.bars + res.supplementary.totals.bufferBars} bars, ${fmtNum(res.supplementary.totals.wtKg / 1000, 3)} MT.` : '.'}
                </span>
                <div className="flex-1" />
                {plan.supplementaryIndentNo ? (
                  <span className="text-xs font-semibold text-slate-700">Indent {plan.supplementaryIndentNo} made (see RM Indent tab)</span>
                ) : (
                  canEdit &&
                  res.supplementary &&
                  !plan.stale && (
                    <Button disabled={busy} onClick={() => void run(() => createSupplementaryIndentAction(plan.id), 'Supplementary indent created as a draft on the RM Indent tab.')}>
                      <FilePlus2 /> Create supplementary indent
                    </Button>
                  )
                )}
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned vs required per mark</h4>
              <SimpleTable
                head={['Section', 'Mark', 'Length (mm)', 'Required', 'Cuttable', 'Short']}
                align={['left', 'left', 'right', 'right', 'right', 'right']}
                rows={res.marks.map((m) => [
                  m.sectionLabel,
                  m.markNo,
                  fmtNum(m.lengthMm, 0),
                  fmtNum(m.required, 0),
                  fmtNum(m.planned, 0),
                  <span key="s" className={m.short ? 'font-semibold text-rose-700' : 'text-emerald-700'}>
                    {fmtNum(m.short, 0)}
                  </span>,
                ])}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Offcuts ≥ {plan.settings.minOffcutMm} mm (keep for reuse)</h4>
                <SimpleTable
                  head={['Section', 'Length (mm)', 'Pieces']}
                  align={['left', 'right', 'right']}
                  empty="No usable offcuts."
                  rows={res.offcuts.map((o) => [o.sectionLabel, fmtNum(o.lengthMm, 0), fmtNum(o.count, 0)])}
                />
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bars not needed by this order</h4>
                <SimpleTable
                  head={['Section', 'Length (mm)', 'Bars']}
                  align={['left', 'right', 'right']}
                  empty="Every received bar is used."
                  rows={res.unusedBars.map((u) => [u.sectionLabel, fmtNum(u.lengthMm, 0), fmtNum(u.count, 0)])}
                />
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Cutting patterns</h4>
              <PatternTable patterns={res.patterns} source />
            </div>
          </div>
        )}
      </Card>

      {adding && opts && (
        <AddReceiptModal
          orderId={orderId}
          opts={opts}
          onClose={() => setAdding(false)}
          onSaved={(warning) => {
            setAdding(false);
            setNotice(warning ?? '');
            void load();
            onChanged?.();
          }}
        />
      )}

      {editLot && (
        <LotDecisionModal
          lot={editLot}
          onClose={() => setEditLot(null)}
          onSaved={() => {
            setEditLot(null);
            void load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function AddReceiptModal({ orderId, opts, onClose, onSaved }: { orderId: number; opts: ReceiptOptions; onClose: () => void; onSaved: (warning: string | null) => void }) {
  const [v, setV] = useState({ receiptNo: '', date: today(), supplier: '', invoiceNo: '', indentId: opts.indents.find((i) => i.status === 'ISSUED')?.id ? String(opts.indents.find((i) => i.status === 'ISSUED')!.id) : '', remarks: '' });
  const [lots, setLots] = useState<LotDraft[]>([emptyLot()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setLot = (i: number, k: keyof LotDraft, value: string) => setLots((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: value } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const r = await addReceiptAction(orderId, { ...v, lots });
    setSaving(false);
    if (r.success) onSaved(r.data.warning);
    else setError(r.error);
  };

  return (
    <Modal title="Add RM receipt" onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="rc-no">Receipt / GRN no</label>
            <input id="rc-no" required maxLength={100} className={fieldCls} value={v.receiptNo} onChange={set('receiptNo')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-date">Receipt date</label>
            <input id="rc-date" type="date" required className={fieldCls} value={v.date} onChange={set('date')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-sup">Supplier</label>
            <input id="rc-sup" maxLength={200} className={fieldCls} value={v.supplier} onChange={set('supplier')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-inv">Supplier invoice no</label>
            <input id="rc-inv" maxLength={100} className={fieldCls} value={v.invoiceNo} onChange={set('invoiceNo')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-ind">Against indent</label>
            <select id="rc-ind" className={fieldCls} value={v.indentId} onChange={set('indentId')}>
              <option value="">–</option>
              {opts.indents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.indentNo} ({i.kind.toLowerCase()}, {i.status.toLowerCase()})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rc-rem">Remarks</label>
            <input id="rc-rem" maxLength={1000} className={fieldCls} value={v.remarks} onChange={set('remarks')} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={labelCls}>Lots (one row per section + length)</span>
            <span className="text-[11px] text-slate-500">Tolerance +0 / +{opts.tolPlusMm} mm</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  {['Section', 'Ordered (mm)', 'Measured (mm)', 'Nos', 'Wt (kg)', 'Heat no', 'Length', ''].map((h) => (
                    <th key={h} className="px-1 pb-1 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((l, i) => {
                  const st = previewStatus(l, opts.tolPlusMm);
                  const lengths = opts.orderedLengths.filter((o) => o.sectionKey === l.section);
                  return (
                    <tr key={i}>
                      <td className="px-1 py-1">
                        <select aria-label={`Lot ${i + 1} section`} className={fieldCls} value={l.section} onChange={(e) => setLot(i, 'section', e.target.value)}>
                          <option value="">Choose…</option>
                          {opts.sections.map((s) => (
                            <option key={s.sectionKey} value={s.sectionKey}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Lot ${i + 1} ordered length`} list={`ord-${i}`} inputMode="numeric" className={`${fieldCls} w-28`} value={l.orderedLengthMm} onChange={(e) => setLot(i, 'orderedLengthMm', e.target.value)} />
                        <datalist id={`ord-${i}`}>
                          {lengths.map((o) => (
                            <option key={o.barLengthMm} value={o.barLengthMm} />
                          ))}
                        </datalist>
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Lot ${i + 1} measured length`} inputMode="numeric" className={`${fieldCls} w-28`} value={l.measuredLengthMm} onChange={(e) => setLot(i, 'measuredLengthMm', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Lot ${i + 1} nos`} inputMode="numeric" className={`${fieldCls} w-20`} value={l.nos} onChange={(e) => setLot(i, 'nos', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Lot ${i + 1} weight`} inputMode="decimal" className={`${fieldCls} w-24`} value={l.wtKg} onChange={(e) => setLot(i, 'wtKg', e.target.value)} />
                      </td>
                      <td className="px-1 py-1">
                        <input aria-label={`Lot ${i + 1} heat no`} maxLength={50} className={`${fieldCls} w-24`} value={l.heatNo} onChange={(e) => setLot(i, 'heatNo', e.target.value)} />
                      </td>
                      <td className="px-1 py-1 whitespace-nowrap">{st ? <Badge tone={LEN_TONE[st]}>{LENGTH_STATUS_LABELS[st]}</Badge> : <span className="text-xs text-slate-400">–</span>}</td>
                      <td className="px-1 py-1">
                        {lots.length > 1 && (
                          <button type="button" aria-label={`Remove lot ${i + 1}`} className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => setLots((ls) => ls.filter((_, j) => j !== i))}>
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" className="mt-2" onClick={() => setLots((ls) => [...ls, emptyLot()])}>
            <Plus /> Add lot
          </Button>
          {lots.some((l) => previewStatus(l, opts.tolPlusMm) === 'SHORT') && (
            <p className="mt-2 text-xs font-medium text-rose-700">Short lots are saved as Rejected; change them to "Accepted on debit note" afterwards if you keep the bars.</p>
          )}
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save receipt'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function LotDecisionModal({ lot, onClose, onSaved }: { lot: ReceiptLotView; onClose: () => void; onSaved: () => void }) {
  const [decision, setDecision] = useState<LotDecision>(lot.decision);
  const [dn, setDn] = useState(lot.debitNoteNo ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const shortLot = lot.lengthStatus === 'SHORT';
  return (
    <Modal title={`Lot: ${lot.sectionLabel ?? lot.sectionKey} · ${lot.measuredLengthMm}/${lot.orderedLengthMm} mm · ${lot.nos} nos`} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const r = await updateLotAction(lot.id, { decision, debitNoteNo: dn });
          setSaving(false);
          if (r.success) onSaved();
          else setError(r.error);
        }}
      >
        <div>
          <label className={labelCls} htmlFor="lot-dec">Decision</label>
          <select id="lot-dec" className={fieldCls} value={decision} onChange={(e) => setDecision(e.target.value as LotDecision)}>
            {LOT_DECISIONS.map((d) => (
              <option key={d} value={d} disabled={shortLot && d === 'ACCEPTED'}>
                {DECISION_LABELS[d]}
                {shortLot && d === 'ACCEPTED' ? ' (not allowed: short)' : ''}
              </option>
            ))}
          </select>
        </div>
        {decision === 'DEBIT_NOTE' && (
          <div>
            <label className={labelCls} htmlFor="lot-dn">Debit note no</label>
            <input id="lot-dn" maxLength={100} className={fieldCls} value={dn} onChange={(e) => setDn(e.target.value)} />
          </div>
        )}
        <p className="text-xs text-slate-500">Accepted and debit-note lots are used in the re-plan; rejected lots are not.</p>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
