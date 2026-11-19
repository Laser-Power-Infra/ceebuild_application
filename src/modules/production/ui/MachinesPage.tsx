'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Kpi, fmtNum } from '@/components/ServerTable';
import { Modal, FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OPERATIONS, OPERATION_LABELS, OP_UNIT, type Operation } from '@/lib/planning/machines';
import { createMachineAction, deleteMachineAction, listMachinesAction, updateMachineAction } from '@/app/actions/production';
import { RATE_UNITS, type MachineRow } from '../columns';

type Form = {
  code: string;
  name: string;
  operation: Operation;
  units: string;
  ratePerHour: string;
  rateUnit: string;
  shiftsPerDay: string;
  hoursPerShift: string;
  utilisationPct: string;
  sortOrder: string;
  rateConfirmed: boolean;
  active: boolean;
  remarks: string;
};

const blank: Form = {
  code: '',
  name: '',
  operation: 'PUNCHING',
  units: '1',
  ratePerHour: '',
  rateUnit: 'holes',
  shiftsPerDay: '1',
  hoursPerShift: '8',
  utilisationPct: '75',
  sortOrder: '100',
  rateConfirmed: false,
  active: true,
  remarks: '',
};

const toForm = (m: MachineRow): Form => ({
  code: m.code,
  name: m.name,
  operation: m.operation,
  units: String(m.units),
  ratePerHour: String(m.ratePerHour),
  rateUnit: m.rateUnit,
  shiftsPerDay: String(m.shiftsPerDay),
  hoursPerShift: String(m.hoursPerShift),
  utilisationPct: String(m.utilisationPct),
  sortOrder: String(m.sortOrder),
  rateConfirmed: m.rateConfirmed,
  active: m.active,
  remarks: m.remarks ?? '',
});

/** Ceebuild List of Machinery with editable rates, shifts and utilisation (Admin edits). */
export function MachinesPage({ role }: { role: string }) {
  const isAdmin = role === 'Admin';
  const [rows, setRows] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await listMachinesAction();
    if (r.success) setRows(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError('');
    const { code, ...rest } = editing.form;
    const r = editing.id ? await updateMachineAction(editing.id, rest) : await createMachineAction({ code, ...rest });
    setSaving(false);
    if (!r.success) return setFormError(r.error);
    setEditing(null);
    void load();
  };

  const remove = async (m: MachineRow) => {
    if (!window.confirm(`Delete machine ${m.code}? It stays in the audit log.`)) return;
    const r = await deleteMachineAction(m.id);
    if (r.success) void load();
    else setError(r.error);
  };

  const unconfirmed = rows?.filter((m) => m.active && !m.rateConfirmed).length ?? 0;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value } } : s));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Machines</h1>
          <p className="text-xs text-slate-500">Ceebuild List of Machinery. Capacity per day = rate × units × shifts × hours per shift × utilisation.</p>
        </div>
        <div className="flex-1" />
        {isAdmin ? (
          <Button onClick={() => { setFormError(''); setEditing({ id: null, form: blank }); }}>
            <Plus /> Add machine
          </Button>
        ) : (
          <span className="text-xs text-slate-500">Only Admin can change machines</span>
        )}
      </div>
      <FormError error={error} />
      {unconfirmed > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{unconfirmed} active machine{unconfirmed === 1 ? ' has a' : 's have'} placeholder rates. Plans stay indicative until the plant confirms them (tick &quot;Rate confirmed&quot; when entering the real rate).</span>
        </div>
      )}
      {rows && (
        <div className="flex flex-wrap gap-3">
          <Kpi label="Machines" value={fmtNum(rows.length, 0)} />
          <Kpi label="Active" value={fmtNum(rows.filter((m) => m.active).length, 0)} tone="green" />
          <Kpi label="Rates to confirm" value={fmtNum(unconfirmed, 0)} tone={unconfirmed ? 'amber' : undefined} />
        </div>
      )}
      {!rows ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">Rate / h</th>
                <th className="px-3 py-2 text-right">Shifts × h</th>
                <th className="px-3 py-2 text-right">Utilisation</th>
                <th className="px-3 py-2 text-right">Capacity / day</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Entries</th>
                {isAdmin && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {OPERATIONS.flatMap((op) =>
                rows
                  .filter((m) => m.operation === op)
                  .map((m, i) => (
                    <tr key={m.id} className={`border-t ${i === 0 ? 'border-slate-200' : 'border-slate-100'} ${m.active ? '' : 'text-slate-400'}`}>
                      <td className="px-3 py-2 font-semibold">{m.code}</td>
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="px-3 py-2">{OPERATION_LABELS[m.operation]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.ratePerHour, 2)} {m.rateUnit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.shiftsPerDay} × {fmtNum(m.hoursPerShift, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.utilisationPct, 1)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.capacityPerDay, 0)} {m.rateUnit}</td>
                      <td className="px-3 py-2 text-xs">
                        {m.rateConfirmed ? <span className="font-semibold text-emerald-700">Confirmed</span> : <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">To confirm</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">{m.active ? 'Active' : 'Inactive'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.entries}</td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <button type="button" aria-label={`Edit ${m.code}`} className="rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => { setFormError(''); setEditing({ id: m.id, form: toForm(m) }); }}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          {m.entries === 0 && (
                            <button type="button" aria-label={`Delete ${m.code}`} className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => void remove(m)}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? `Edit machine ${editing.form.code}` : 'Add machine'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="m-code">Code</label>
                <input id="m-code" className={fieldCls} required disabled={!!editing.id} maxLength={20} value={editing.form.code} onChange={set('code')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-op">Operation</label>
                <select
                  id="m-op"
                  className={fieldCls}
                  value={editing.form.operation}
                  disabled={!!editing.id && (rows?.find((r) => r.id === editing.id)?.entries ?? 0) > 0}
                  onChange={(e) => {
                    const op = e.target.value as Operation;
                    setEditing((s) => (s ? { ...s, form: { ...s.form, operation: op, rateUnit: OP_UNIT[op] } } : s));
                  }}
                >
                  {OPERATIONS.map((op) => (
                    <option key={op} value={op}>{OPERATION_LABELS[op]}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls} htmlFor="m-name">Name</label>
                <input id="m-name" className={fieldCls} required maxLength={120} value={editing.form.name} onChange={set('name')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-rate">Rate per hour</label>
                <input id="m-rate" className={fieldCls} required inputMode="decimal" value={editing.form.ratePerHour} onChange={set('ratePerHour')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-unit">Rate unit</label>
                <select id="m-unit" className={fieldCls} value={editing.form.rateUnit} onChange={set('rateUnit')}>
                  {RATE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="m-units">Identical units</label>
                <input id="m-units" className={fieldCls} required inputMode="numeric" value={editing.form.units} onChange={set('units')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-shifts">Shifts per day (0-3)</label>
                <input id="m-shifts" className={fieldCls} required inputMode="numeric" value={editing.form.shiftsPerDay} onChange={set('shiftsPerDay')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-hours">Hours per shift</label>
                <input id="m-hours" className={fieldCls} required inputMode="decimal" value={editing.form.hoursPerShift} onChange={set('hoursPerShift')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-util">Utilisation %</label>
                <input id="m-util" className={fieldCls} required inputMode="decimal" value={editing.form.utilisationPct} onChange={set('utilisationPct')} />
              </div>
              <div>
                <label className={labelCls} htmlFor="m-sort">Sort order</label>
                <input id="m-sort" className={fieldCls} inputMode="numeric" value={editing.form.sortOrder} onChange={set('sortOrder')} />
              </div>
              <div className="flex flex-col justify-end gap-2 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={editing.form.rateConfirmed} onChange={set('rateConfirmed')} /> Rate confirmed by plant
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={editing.form.active} onChange={set('active')} /> Active
                </label>
              </div>
              <div className="col-span-2">
                <label className={labelCls} htmlFor="m-remarks">Remarks</label>
                <input id="m-remarks" className={fieldCls} maxLength={500} value={editing.form.remarks} onChange={set('remarks')} />
              </div>
            </div>
            <FormError error={formError} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
