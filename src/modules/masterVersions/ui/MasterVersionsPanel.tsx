'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, fieldCls, labelCls } from '@/components/Modal';
import { VERSIONED, type VersionedTable } from '@/lib/masters/versions';
import { addDatedChangeAction, listMasterVersionsAction, versionedRecordsAction } from '@/app/actions/masterVersions';
import type { VersionView } from '../server';

const fmt = (d: string | null) => (d ? d.split('-').reverse().join('-') : '');
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const STATUS_CLS: Record<VersionView['status'], string> = {
  BASELINE: 'bg-slate-100 text-slate-600',
  PAST: 'bg-slate-100 text-slate-600',
  CURRENT: 'bg-emerald-100 text-emerald-800',
  FUTURE: 'bg-amber-100 text-amber-800',
};
const STATUS_LABEL: Record<VersionView['status'], string> = { BASELINE: 'before', PAST: 'past', CURRENT: 'in force', FUTURE: 'from date' };

/**
 * Rev 2 §6 on a master page: change a value from a chosen date (back-dated, today or future) and see
 * the dated history. The master row always shows today's value; costing "as on" a date uses the history.
 */
export function MasterVersionsPanel({ table, role, onChanged }: { table: VersionedTable; role: string; onChanged?: () => void }) {
  const spec = VERSIONED[table];
  const isAdmin = role === 'Admin';
  const single = table === 'plan_settings';
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<{ key: string; label: string }[]>([]);
  const [recordKey, setRecordKey] = useState(single ? '1' : '');
  const [field, setField] = useState(spec.fields[0].key);
  const [value, setValue] = useState('');
  const [validFrom, setValidFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<VersionView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    const r = await listMasterVersionsAction(table, recordKey || null);
    if (r.success) setRows(r.data);
    else setError(r.error);
  }, [table, recordKey]);

  useEffect(() => {
    if (!open) return;
    if (!single && records.length === 0) versionedRecordsAction(table).then((r) => r.success && setRecords(r.data));
    load();
  }, [open, load, single, records.length, table]);

  const save = async () => {
    setBusy(true);
    setError('');
    setDone('');
    const r = await addDatedChangeAction({ table, recordKey, field, value, validFrom, reason });
    setBusy(false);
    if (!r.success) return setError(r.error);
    const f = spec.fields.find((x) => x.key === field)?.label ?? field;
    setDone(r.data.future ? `${f} = ${value} saved from ${fmt(validFrom)}; it applies on that date.` : r.data.changedToday ? `${f} = ${value} applies from ${fmt(validFrom)} and is the value today.` : `${f} = ${value} saved for ${fmt(validFrom)} (a later dated value is in force today).`);
    setValue('');
    setReason('');
    await load();
    onChanged?.();
  };

  const fieldSpec = spec.fields.find((x) => x.key === field);
  return (
    <section aria-label="Dated values" className="rounded-xl border border-slate-200 bg-white">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <CalendarClock className="size-4 text-slate-500" /> Date-wise values (as on date)
        <span className="font-normal text-slate-500">· change from a date, history; costing "as on" a date uses these</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-3">
          {isAdmin && (
            <div className="grid gap-2 sm:grid-cols-6">
              {!single && (
                <label className={`${labelCls} sm:col-span-2`}>
                  {spec.recordLabel}
                  <select className={fieldCls} value={recordKey} onChange={(e) => setRecordKey(e.target.value)}>
                    <option value="">All (history only)</option>
                    {records.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={labelCls}>
                Field
                <select className={fieldCls} value={field} onChange={(e) => setField(e.target.value)}>
                  {spec.fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                New value{fieldSpec?.unit ? ` (${fieldSpec.unit})` : ''}
                {fieldSpec?.kind === 'bool' ? (
                  <select className={fieldCls} value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">–</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                ) : (
                  <input className={fieldCls} value={value} onChange={(e) => setValue(e.target.value)} inputMode={fieldSpec?.kind === 'text' ? 'text' : 'decimal'} />
                )}
              </label>
              <label className={labelCls}>
                From date
                <input type="date" className={fieldCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </label>
              <label className={`${labelCls} ${single ? 'sm:col-span-3' : 'sm:col-span-6'}`}>
                Reason (logged)
                <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. mill revised kg/m; plant moved to 2 shifts" />
              </label>
              <div className="flex items-end sm:col-span-6">
                <Button size="sm" onClick={save} disabled={busy || (!single && !recordKey) || !value.trim() || !validFrom || !reason.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : null} Save dated value
                </Button>
                <p className="ml-3 text-[11px] text-slate-500">A past date never changes a quoted offer (snapshots are frozen). A future date applies on that day.</p>
              </div>
            </div>
          )}
          <FormError error={error} />
          {done && <p className="text-xs font-bold text-emerald-700" role="status">{done}</p>}
          {rows === null ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-500">No dated changes yet. Every change from now on is kept with its date.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                  <tr>
                    {!single && <th className="px-2 py-1">{spec.recordLabel}</th>}
                    <th className="px-2 py-1">Field</th>
                    <th className="px-2 py-1">Value</th>
                    <th className="px-2 py-1">From</th>
                    <th className="px-2 py-1">To</th>
                    <th className="px-2 py-1">State</th>
                    <th className="px-2 py-1">Reason</th>
                    <th className="px-2 py-1">By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      {!single && <td className="px-2 py-1 font-semibold">{r.recordKey}</td>}
                      <td className="px-2 py-1">{r.fieldLabel}</td>
                      <td className="px-2 py-1 tabular-nums">{r.value === 'true' ? 'Yes' : r.value === 'false' ? 'No' : (r.value ?? '—')}</td>
                      <td className="px-2 py-1">{r.status === 'BASELINE' ? 'earlier' : fmt(r.validFrom)}</td>
                      <td className="px-2 py-1">{fmt(r.validTo) || '—'}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </td>
                      <td className="px-2 py-1 text-slate-600">{r.reason}</td>
                      <td className="px-2 py-1 text-slate-600">{r.changedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
