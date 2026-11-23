'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, Modal, fieldCls, labelCls } from '@/components/Modal';
import { addRateAction, costingMasterAction, deleteRateAction, upsertPurchaseItemAction } from '@/app/actions/costing';
import { RATE_KINDS, RATE_META, isInterim, type RateKind } from '@/lib/costing/calc';
import { FAB_CATS, FAB_CAT_BY_CODE, fabCatLabel } from '@/lib/costing/fab';
import type { PurchaseItemRow, RateListRow } from '../server/master';
import { Badge, card, inr, td, th } from './shared';

const CATS = ['CHANNEL', 'ANGLE', 'FLAT', 'ROD', 'OTHER'];
const today = () => new Date().toISOString().slice(0, 10);

const GROUPS: { title: string; kinds: RateKind[] }[] = [
  { title: 'Raw material', kinds: ['RM_RATE', 'WASTAGE_PCT'] },
  { title: 'Fabrication / conversion', kinds: ['FAB_RATE'] },
  { title: 'Galvanising (GI cost master)', kinds: ['GALV_RATE', 'ZINC_PCT', 'GALV_TRANSPORT'] },
  { title: 'Freight (FOR, by destination state)', kinds: ['FREIGHT_MT'] },
  { title: 'Commercial', kinds: ['INTEREST_PCT', 'CREDIT_DAYS', 'LC_BG_PCT', 'INSPECTION', 'PACKING', 'MIN_VA_PCT'] },
  { title: 'Nuts & bolts and bought-out items (separate offer lines, own margin %)', kinds: ['NB_RATE', 'NB_MARGIN_PCT', 'BOUGHT_OUT', 'BO_MARGIN_PCT'] },
];

export function CostingMasterPage({ role }: { role: string }) {
  const isAdmin = role === 'Admin';
  const [items, setItems] = useState<PurchaseItemRow[]>([]);
  const [rates, setRates] = useState<RateListRow[]>([]);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [rateForm, setRateForm] = useState<null | { kind: RateKind; subject: string; value: string; unit: string; effectiveFrom: string; source: string }>(null);
  const [itemForm, setItemForm] = useState<null | { label: string; category: string; sortOrder: string; active: boolean }>(null);

  const load = useCallback(async () => {
    const r = await costingMasterAction();
    if (!r.success) return setError(r.error);
    setItems(r.data.purchaseItems);
    setRates(r.data.rates);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => (showHistory ? rates : rates.filter((r) => r.current || r.effectiveFrom > today())), [rates, showHistory]);
  const labelOf = (kind: string, subject: string) =>
    kind === 'RM_RATE' || kind === 'WASTAGE_PCT' ? items.find((i) => i.sectionKey === subject)?.label ?? subject : kind === 'FAB_RATE' ? fabCatLabel(subject) : subject;

  const openRate = (kind: RateKind, subject = '') => setRateForm({ kind, subject, value: '', unit: RATE_META[kind].units[0], effectiveFrom: today(), source: '' });

  const missing = useMemo(() => {
    const has = (k: string, s?: string) => rates.some((r) => r.kind === k && r.current && (s === undefined || r.subject === s));
    const out: string[] = [];
    for (const i of items.filter((x) => x.active)) {
      if (!has('RM_RATE', i.sectionKey)) out.push(`RM rate for ${i.label}`);
      if (!i.inGtp) out.push(`kg/m for ${i.label} (GTP Sections)`);
    }
    for (const f of FAB_CATS) if (!has('FAB_RATE', f.code)) out.push(`Fabrication rate – ${f.label}`);
    for (const k of ['GALV_RATE', 'ZINC_PCT', 'GALV_TRANSPORT', 'MIN_VA_PCT', 'FREIGHT_MT', 'INTEREST_PCT', 'CREDIT_DAYS', 'LC_BG_PCT', 'INSPECTION', 'PACKING', 'NB_MARGIN_PCT', 'BO_MARGIN_PCT'] as const) if (!has(k)) out.push(RATE_META[k].label);
    return out;
  }, [items, rates]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Costing Master</h1>
        <p className="text-xs text-slate-700">
          Every factor used by the BOM costing is read from here – nothing is hard-coded. Each value has an effective date and is kept as a version: a new value is a new row, so an
          old quotation always shows the rates of its date. Only Admins can change it; every change goes to the Audit Log.
        </p>
      </div>
      <FormError error={error} />
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Not set yet ({missing.length}):</b> {missing.slice(0, 12).join(' · ')}
          {missing.length > 12 ? ` · and ${missing.length - 12} more` : ''}. Lines needing these are flagged and not costed.
        </div>
      )}

      <section className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">RM purchase list</h2>
            <p className="text-xs text-slate-700">Short, fixed list of sections actually bought. A BOM line must map to one of these (one rate); any other section is flagged, not costed.</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setItemForm({ label: '', category: 'CHANNEL', sortOrder: String(items.length + 1), active: true })}>
              <Plus /> Add item
            </Button>
          )}
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Section</th>
              <th className={th}>Category</th>
              <th className={`${th} text-right`}>kg/m (GTP)</th>
              <th className={`${th} text-right`}>RM rate now (Rs/kg)</th>
              <th className={th}>Status</th>
              {isAdmin && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className={`${td} py-4 text-center text-slate-700`} colSpan={6}>No purchase items yet. Add ISMC 75x40, ISMC 100x50, the angles, flats and round bar actually bought.</td>
              </tr>
            )}
            {items.map((i) => {
              const r = rates.find((x) => x.kind === 'RM_RATE' && x.subject === i.sectionKey && x.current);
              return (
                <tr key={i.id}>
                  <td className={`${td} font-semibold`}>{i.label} <span className="font-normal text-slate-700">{i.sectionKey}</span></td>
                  <td className={td}>{i.category}</td>
                  <td className={`${td} text-right`}>{i.kgPerM ?? <Badge tone="amber">add in GTP Sections</Badge>}</td>
                  <td className={`${td} text-right`}>
                    {r ? `${inr(r.value)} from ${r.effectiveFrom}` : <Badge tone="red">no rate</Badge>}
                    {isAdmin && (
                      <button type="button" className="ml-2 text-xs font-semibold text-blue-800 hover:underline" onClick={() => openRate('RM_RATE', i.label)}>
                        new rate
                      </button>
                    )}
                  </td>
                  <td className={td}>{i.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</td>
                  {isAdmin && (
                    <td className={td}>
                      <button type="button" className="text-xs font-semibold text-blue-800 hover:underline" onClick={() => setItemForm({ label: i.label, category: i.category, sortOrder: String(i.sortOrder), active: i.active })}>
                        edit
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Rates</h2>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          <History className="h-3.5 w-3.5" /> Show all versions (history)
        </label>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} className={card}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{g.title}</h3>
            {isAdmin && (
              <div className="flex flex-wrap gap-1">
                {g.kinds.map((k) => (
                  <Button key={k} size="xs" variant="outline" onClick={() => openRate(k)}>
                    <Plus /> {RATE_META[k].label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Factor</th>
                <th className={th}>For</th>
                <th className={`${th} text-right`}>Value</th>
                <th className={th}>Unit</th>
                <th className={th}>Effective from</th>
                <th className={th}>Source / ref</th>
                <th className={th}>Entered by</th>
                {isAdmin && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {shown.filter((r) => (g.kinds as string[]).includes(r.kind)).length === 0 && (
                <tr>
                  <td className={`${td} py-3 text-center text-slate-700`} colSpan={8}>Not set</td>
                </tr>
              )}
              {shown
                .filter((r) => (g.kinds as string[]).includes(r.kind))
                .map((r) => (
                  <tr key={r.id} className={r.current ? '' : 'text-slate-700'}>
                    <td className={td}>
                      {RATE_META[r.kind as RateKind]?.label ?? r.kind}{' '}
                      {r.current ? <Badge tone="green">in force</Badge> : r.effectiveFrom > today() ? <Badge tone="blue">future</Badge> : <Badge tone="slate">old</Badge>}
                    </td>
                    <td className={td}>{labelOf(r.kind, r.subject)}</td>
                    <td className={`${td} text-right font-semibold`}>{inr(r.value, r.unit === 'days' ? 0 : 2)}</td>
                    <td className={td}>{r.unit}</td>
                    <td className={td}>{r.effectiveFrom}</td>
                    <td className={td}>{isInterim(r) && <Badge tone="amber">Interim</Badge>} {r.source ?? ''}</td>
                    <td className={td}>{r.createdByName ?? ''}</td>
                    {isAdmin && (
                      <td className={td}>
                        <div className="flex gap-1">
                          <button type="button" className="text-xs font-semibold text-blue-800 hover:underline" onClick={() => setRateForm({ kind: r.kind as RateKind, subject: r.kind === 'RM_RATE' || r.kind === 'WASTAGE_PCT' ? (r.subject === 'DEFAULT' ? '' : labelOf(r.kind, r.subject)) : r.subject === 'DEFAULT' ? '' : r.subject, value: String(r.value), unit: r.unit, effectiveFrom: today(), source: '' })}>
                            new version
                          </button>
                          <button
                            type="button"
                            aria-label="Delete this version"
                            className="rounded p-0.5 text-slate-700 hover:text-rose-600"
                            onClick={async () => {
                              if (!window.confirm('Delete this rate version? Only possible if no saved costing used it.')) return;
                              const res = await deleteRateAction(r.id);
                              if (!res.success) return setError(res.error);
                              void load();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      {!isAdmin && <p className="text-xs text-slate-700">Only Admins can change the Costing Master.</p>}

      {rateForm && (
        <Modal title={`New ${RATE_META[rateForm.kind].label}`} onClose={() => setRateForm(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const subject = rateForm.kind === 'RM_RATE' || rateForm.kind === 'WASTAGE_PCT' ? items.find((i) => i.label === rateForm.subject)?.label ?? rateForm.subject : rateForm.subject;
              const r = await addRateAction({ ...rateForm, subject });
              if (!r.success) return setError(r.error);
              setError('');
              setRateForm(null);
              void load();
            }}
          >
            {RATE_META[rateForm.kind].perSubject && (
              <div>
                <label className={labelCls} htmlFor="r-subj">For ({RATE_META[rateForm.kind].subject})</label>
                {rateForm.kind === 'RM_RATE' || rateForm.kind === 'WASTAGE_PCT' ? (
                  <select id="r-subj" className={fieldCls} value={rateForm.subject} onChange={(e) => setRateForm({ ...rateForm, subject: e.target.value })}>
                    <option value="">{rateForm.kind === 'WASTAGE_PCT' ? 'DEFAULT (all sections without a plan)' : 'Choose…'}</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.label}>{i.label}</option>
                    ))}
                  </select>
                ) : rateForm.kind === 'FAB_RATE' ? (
                  <select
                    id="r-subj"
                    className={fieldCls}
                    value={rateForm.subject}
                    onChange={(e) => setRateForm({ ...rateForm, subject: e.target.value, unit: FAB_CAT_BY_CODE[e.target.value]?.unit ?? rateForm.unit })}
                  >
                    <option value="">Choose…</option>
                    {FAB_CATS.map((f) => (
                      <option key={f.code} value={f.code}>{f.label} ({f.unit})</option>
                    ))}
                  </select>
                ) : (
                  <input id="r-subj" className={fieldCls} placeholder={rateForm.kind === 'FREIGHT_MT' ? 'Bihar (blank = DEFAULT)' : rateForm.kind === 'NB_RATE' ? 'M16X40 (blank = DEFAULT)' : 'Danger board'} value={rateForm.subject} onChange={(e) => setRateForm({ ...rateForm, subject: e.target.value })} />
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls} htmlFor="r-val">Value</label>
                <input id="r-val" required inputMode="decimal" className={fieldCls} value={rateForm.value} onChange={(e) => setRateForm({ ...rateForm, value: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="r-unit">Unit</label>
                <select id="r-unit" className={fieldCls} value={rateForm.unit} onChange={(e) => setRateForm({ ...rateForm, unit: e.target.value })}>
                  {RATE_META[rateForm.kind].units.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="r-eff">Effective from</label>
                <input id="r-eff" type="date" required className={fieldCls} value={rateForm.effectiveFrom} onChange={(e) => setRateForm({ ...rateForm, effectiveFrom: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="r-src">Source / reference</label>
              <input id="r-src" className={fieldCls} placeholder={rateForm.kind === 'RM_RATE' ? 'PO 1234 / GRN 567 dt 15-11-2026' : 'GI cost master Nov-2026'} value={rateForm.source} onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })} />
            </div>
            <p className="text-xs text-slate-700">The previous value is kept; quotations dated before the effective date keep using it.</p>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRateForm(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {itemForm && (
        <Modal title="RM purchase item" onClose={() => setItemForm(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await upsertPurchaseItemAction(itemForm);
              if (!r.success) return setError(r.error);
              setError('');
              setItemForm(null);
              void load();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls} htmlFor="p-l">Section (as bought)</label>
                <input id="p-l" required className={fieldCls} placeholder="ISMC 75x40" value={itemForm.label} onChange={(e) => setItemForm({ ...itemForm, label: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="p-c">Category</label>
                <select id="p-c" className={fieldCls} value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}>
                  {CATS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="p-s">Sort order</label>
                <input id="p-s" inputMode="numeric" className={fieldCls} value={itemForm.sortOrder} onChange={(e) => setItemForm({ ...itemForm, sortOrder: e.target.value })} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={itemForm.active} onChange={(e) => setItemForm({ ...itemForm, active: e.target.checked })} /> Active (bought now)
              </label>
            </div>
            <p className="text-xs text-slate-700">Matched to BOM lines and GTP Sections by the normalised section (spaces, “x”, “mm” ignored). Same section again = update.</p>
            <FormError error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setItemForm(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
