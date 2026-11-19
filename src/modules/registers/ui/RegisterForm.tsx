'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { addRegisterEntryAction, registerOptionsAction } from '@/app/actions/registers';
import { COLLECTION_MODES, REGISTER_LABELS, SECURITY_KINDS, SECURITY_STATUSES, STAGE_NAMES, type RegisterKey } from '../columns';

type Opts = {
  marks: { mark: string; qty: number }[];
  dis: { id: number; diNo: string }[];
  dispatches: { id: number; label: string; wtKg: number | null }[];
  invoices: { id: number; invoiceNo: string; outstanding: number }[];
};

const DEFAULTS: Partial<Record<RegisterKey, Record<string, string>>> = {
  galv: { direction: 'OUT' },
  stage: { stage: STAGE_NAMES[STAGE_NAMES.length - 1] },
  collection: { mode: 'RTGS' },
  security: { kind: 'PBG', status: 'ACTIVE' },
};

const today = () => new Date().toISOString().slice(0, 10);

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Add one entry to a register of an order. */
export function RegisterForm({ register, orderId, onClose, onSaved }: { register: RegisterKey; orderId: number; onClose: () => void; onSaved: (warning: string | null) => void }) {
  const [v, setV] = useState<Record<string, string>>({ date: today(), ...DEFAULTS[register] });
  const [lines, setLines] = useState<{ markNo: string; pieces: string }[]>([{ markNo: '', pieces: '' }]);
  const [opts, setOpts] = useState<Opts>({ marks: [], dis: [], dispatches: [], invoices: [] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void registerOptionsAction(orderId).then((r) => r.success && setOpts(r.data));
  }, [orderId]);

  const input = (key: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`f-${key}`} className={fieldCls} value={v[key] ?? ''} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} {...props} />
  );
  const select = (key: string, options: readonly { value: string; label: string }[], blank?: string) => (
    <select id={`f-${key}`} className={fieldCls} value={v[key] ?? ''} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
  const plain = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));
  const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = register === 'galv' ? { ...v, lines } : v;
    const r = await addRegisterEntryAction(register, orderId, payload);
    setSaving(false);
    if (r.success) onSaved(r.data.warning);
    else setError(r.error);
  };

  return (
    <Modal title={`Add ${REGISTER_LABELS[register]} entry`} onClose={onClose} wide={register === 'galv'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {register === 'galv' && (
            <>
              <Field id="f-challanNo" label="Challan no">{input('challanNo', { required: true, maxLength: 100 })}</Field>
              <Field id="f-direction" label="Out / In">
                <select id="f-direction" className={fieldCls} value={v.direction} onChange={(e) => setV((s) => ({ ...s, direction: e.target.value }))}>
                  <option value="OUT">Out to galvaniser</option>
                  <option value="IN">Back in (galvanised)</option>
                </select>
              </Field>
              <Field id="f-date" label="Challan date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-jobWorker" label="Galvaniser (job worker)">{input('jobWorker', { maxLength: 200 })}</Field>
              <Field id="f-blackWtKg" label="Black wt (kg)">{input('blackWtKg', { inputMode: 'decimal' })}</Field>
              <Field id="f-galvWtKg" label="Galvanised wt (kg)">{input('galvWtKg', { inputMode: 'decimal' })}</Field>
            </>
          )}
          {register === 'inspection' && (
            <>
              <Field id="f-inspectionNo" label="Inspection no">{input('inspectionNo', { required: true, maxLength: 100 })}</Field>
              <Field id="f-mcNo" label="MC no">{input('mcNo', { maxLength: 100 })}</Field>
              <Field id="f-date" label="Date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-piecesCleared" label="Pieces cleared">{input('piecesCleared', { inputMode: 'numeric' })}</Field>
              <Field id="f-wtClearedKg" label="Wt cleared (kg)">{input('wtClearedKg', { inputMode: 'decimal' })}</Field>
            </>
          )}
          {register === 'di' && (
            <>
              <Field id="f-diNo" label="DI no">{input('diNo', { required: true, maxLength: 100 })}</Field>
              <Field id="f-date" label="DI date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-pieces" label="Pieces">{input('pieces', { inputMode: 'numeric' })}</Field>
              <Field id="f-wtKg" label="Wt (kg)">{input('wtKg', { inputMode: 'decimal' })}</Field>
            </>
          )}
          {register === 'dispatch' && (
            <>
              <Field id="f-date" label="Dispatch date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-diId" label="Against DI">
                <select id="f-diId" className={fieldCls} value={v.diId ?? ''} onChange={(e) => setV((s) => ({ ...s, diId: e.target.value }))}>
                  <option value="">— none —</option>
                  {opts.dis.map((d) => (
                    <option key={d.id} value={d.id}>{d.diNo}</option>
                  ))}
                </select>
              </Field>
              <Field id="f-invoiceNo" label="Invoice no">{input('invoiceNo', { maxLength: 100 })}</Field>
              <Field id="f-ewayBillNo" label="E-way bill no">{input('ewayBillNo', { maxLength: 50 })}</Field>
              <Field id="f-lrNo" label="LR no">{input('lrNo', { maxLength: 100 })}</Field>
              <Field id="f-vehicleNo" label="Vehicle no">{input('vehicleNo', { maxLength: 50 })}</Field>
              <Field id="f-pieces" label="Pieces">{input('pieces', { inputMode: 'numeric' })}</Field>
              <Field id="f-wtKg" label="Wt (kg)">{input('wtKg', { inputMode: 'decimal' })}</Field>
            </>
          )}
          {register === 'stage' && (
            <>
              <Field id="f-date" label="Date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-stage" label="Stage">{select('stage', plain(STAGE_NAMES))}</Field>
              <Field id="f-markNo" label="Mark no (optional)">{input('markNo', { list: 'bom-marks', maxLength: 100 })}</Field>
              <Field id="f-piecesOffered" label="Pieces offered">{input('piecesOffered', { inputMode: 'numeric', required: true })}</Field>
              <Field id="f-piecesAccepted" label="Pieces accepted">{input('piecesAccepted', { inputMode: 'numeric', required: true })}</Field>
              <Field id="f-piecesRejected" label="Pieces rejected">{input('piecesRejected', { inputMode: 'numeric' })}</Field>
              <Field id="f-inspector" label="Inspector">{input('inspector', { maxLength: 100 })}</Field>
            </>
          )}
          {register === 'invoice' && (
            <>
              <Field id="f-invoiceNo" label="Invoice no">{input('invoiceNo', { required: true, maxLength: 100 })}</Field>
              <Field id="f-date" label="Invoice date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-dispatchId" label="Against dispatch">
                {select('dispatchId', opts.dispatches.map((d) => ({ value: String(d.id), label: d.label })), '— none —')}
              </Field>
              <Field id="f-wtKg" label="Wt (kg, blank = dispatch wt)">{input('wtKg', { inputMode: 'decimal' })}</Field>
              <Field id="f-taxableAmount" label="Taxable value (Rs)">{input('taxableAmount', { inputMode: 'decimal' })}</Field>
              <Field id="f-totalAmount" label="Invoice total incl. GST (Rs)">{input('totalAmount', { inputMode: 'decimal', required: true })}</Field>
              <Field id="f-dueDate" label="Due date (blank = payment terms)">{input('dueDate', { type: 'date' })}</Field>
            </>
          )}
          {register === 'collection' && (
            <>
              <Field id="f-date" label="Receipt date">{input('date', { type: 'date', required: true })}</Field>
              <Field id="f-invoiceId" label="Against invoice">
                {select(
                  'invoiceId',
                  opts.invoices.map((x) => ({ value: String(x.id), label: `${x.invoiceNo} (outstanding ${money(x.outstanding)})` })),
                  '— on account / advance —',
                )}
              </Field>
              <Field id="f-amount" label="Amount received (Rs)">{input('amount', { inputMode: 'decimal', required: true })}</Field>
              <Field id="f-retention" label="Retention (Rs; minus = released)">{input('retention', { inputMode: 'decimal' })}</Field>
              <Field id="f-mode" label="Mode">{select('mode', plain(COLLECTION_MODES))}</Field>
              <Field id="f-reference" label="UTR / LC / cheque no">{input('reference', { maxLength: 100 })}</Field>
            </>
          )}
          {register === 'security' && (
            <>
              <Field id="f-kind" label="Type">{select('kind', plain(SECURITY_KINDS))}</Field>
              <Field id="f-refNo" label="Ref no">{input('refNo', { maxLength: 100 })}</Field>
              <Field id="f-bank" label="Bank">{input('bank', { maxLength: 100 })}</Field>
              <Field id="f-amount" label="Amount (Rs)">{input('amount', { inputMode: 'decimal', required: true })}</Field>
              <Field id="f-issueDate" label="Issue date">{input('issueDate', { type: 'date' })}</Field>
              <Field id="f-expiryDate" label="Expiry / claim date">{input('expiryDate', { type: 'date' })}</Field>
              <Field id="f-status" label="Status">{select('status', plain(SECURITY_STATUSES))}</Field>
              {v.status && v.status !== 'ACTIVE' && <Field id="f-releasedDate" label="Released date">{input('releasedDate', { type: 'date' })}</Field>}
            </>
          )}
        </div>

        {register === 'stage' && (
          <datalist id="bom-marks">
            {opts.marks.map((m) => (
              <option key={m.mark} value={m.mark}>{`BOM qty ${m.qty}`}</option>
            ))}
          </datalist>
        )}

        {register === 'galv' && (
          <div>
            <p className={labelCls}>Pieces by mark</p>
            <datalist id="bom-marks">
              {opts.marks.map((m) => (
                <option key={m.mark} value={m.mark}>{`BOM qty ${m.qty}`}</option>
              ))}
            </datalist>
            <div className="flex flex-col gap-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Mark no, line ${i + 1}`}
                    list="bom-marks"
                    placeholder="Mark no"
                    className={fieldCls}
                    value={l.markNo}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, markNo: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Pieces, line ${i + 1}`}
                    placeholder="Pieces"
                    inputMode="numeric"
                    className={`${fieldCls} w-32`}
                    value={l.pieces}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, pieces: e.target.value } : x)))}
                  />
                  <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, { markNo: '', pieces: '' }])}>
              <Plus /> Add mark
            </Button>
          </div>
        )}

        <Field id="f-remarks" label="Remarks">
          <textarea id="f-remarks" rows={2} maxLength={1000} className={fieldCls} value={v.remarks ?? ''} onChange={(e) => setV((s) => ({ ...s, remarks: e.target.value }))} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
