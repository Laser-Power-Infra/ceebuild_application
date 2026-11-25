'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { FormError, fieldCls, labelCls } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { updatePlanSettingsAction } from '@/app/actions/settings';
import type { PlanSettingsValues } from '@/modules/settings/types';
import { Card, Notice } from './parts';

type Key = Exclude<keyof PlanSettingsValues, 'confirmed' | 'updatedByName' | 'updatedAt'>;
type Field = { key: Key; label: string; unit: string; help: string; placeholder?: boolean; step?: string };

const CUTTING: Field[] = [
  { key: 'stdBarMm', label: 'Standard bar length', unit: 'mm', help: 'Mill standard length used for nesting.' },
  { key: 'maxCustomMm', label: 'Max custom length', unit: 'mm', help: 'Longest custom bar by default; a GTP section can allow more (e.g. ISMC 100x50 up to 6600).' },
  { key: 'endAllowanceMm', label: 'End allowance per bar', unit: 'mm', help: 'Trim per bar (both ends together), added to k × piece length. Plant to confirm.', placeholder: true },
  { key: 'kerfMm', label: 'Kerf per cut', unit: 'mm', help: 'Material lost per cut. 0 for shearing / cropping.', placeholder: true },
  { key: 'tolPlusMm', label: 'Supply tolerance', unit: '+mm', help: 'Supply tolerance is +0 / +this. No negative tolerance: shorter bars are short.' },
  { key: 'bufferPct', label: 'Buffer', unit: '%', help: 'Extra bars per indent line, rounded up. Plant to confirm.', placeholder: true, step: '0.01' },
  { key: 'customMinBars', label: 'Custom length from', unit: 'bars', help: 'A mark gets its own exact-multiple length only if it fills at least this many bars.', placeholder: true },
  { key: 'customMinMetres', label: 'Custom length (Rev 2 rule) from', unit: 'm', help: 'Rev 2 rule: all marks of one piece length together get a custom bar when they need at least this many metres and 2+ pieces fit (Puja: 300). 0 = per-mark rule above.' },
  { key: 'minOffcutMm', label: 'Usable offcut from', unit: 'mm', help: 'Offcuts at least this long are listed for reuse.' },
];
const ALERTS: Field[] = [
  { key: 'bomDueDays', label: 'BOM due after PO', unit: 'days', help: 'Flag an order with no ✓ Correct BOM this long after the PO date.' },
  { key: 'galvAlertDays', label: 'Galvanising alert', unit: 'days', help: 'Flag pieces still at the galvaniser this long after the challan out.' },
  { key: 'diAlertDays', label: 'DI alert after MC', unit: 'days', help: 'Flag an inspected order with no DI this long after the MC.' },
  { key: 'paymentTermsDays', label: 'Payment terms', unit: 'days', help: 'Default invoice due date = invoice date + this.' },
  { key: 'workDaysPerWeek', label: 'Working days per week', unit: 'days', help: 'Used to turn machine load into calendar days.' },
  { key: 'leadTimeDays', label: 'Standard lead time', unit: 'days', help: 'New PO check: a delivery date earlier than today + this is flagged.' },
];

/** Admin form for plan_settings; read-only for everyone else. */
export function PlanningSettingsForm({ initial, role }: { initial: PlanSettingsValues; role: string }) {
  const isAdmin = role === 'Admin';
  const [values, setValues] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries([...CUTTING, ...ALERTS].map((f) => [f.key, String(initial[f.key])])));
  const [confirmed, setConfirmed] = useState(initial.confirmed);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    const r = await updatePlanSettingsAction({ ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])), confirmed });
    setSaving(false);
    if (!r.success) return setError(r.error);
    setValues(r.data);
    setSaved(true);
  };

  const renderFields = (fields: Field[]) => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {fields.map((f) => (
        <div key={f.key}>
          <label className={labelCls} htmlFor={`ps-${f.key}`}>
            {f.label} <span className="font-normal text-slate-400">({f.unit})</span>
            {f.placeholder && !values.confirmed && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">to confirm</span>}
          </label>
          <input
            id={`ps-${f.key}`}
            type="number"
            step={f.step ?? '1'}
            min={0}
            required
            disabled={!isAdmin}
            className={fieldCls}
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
          />
          <p className="mt-1 text-[11px] text-slate-500">{f.help}</p>
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Planning Settings</h1>
        <p className="text-xs text-slate-500">
          Plant defaults used by the RM indent, re-plan and alerts. Every change is written to the audit log. Indents keep the settings they were made with.
        </p>
      </div>
      {!values.confirmed && (
        <Notice tone="amber">
          These values are placeholders until the plant confirms them (end allowance, kerf, buffer %, custom-length threshold). Indents made meanwhile are marked &quot;settings not
          confirmed&quot;.
        </Notice>
      )}
      <Card title="Cutting and RM indent">{renderFields(CUTTING)}</Card>
      <Card title="Alerts and calendar">{renderFields(ALERTS)}</Card>
      <Card>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!isAdmin} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            <strong>Confirmed by the plant</strong> – the values above are signed off
          </span>
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Last changed {values.updatedAt ? new Date(values.updatedAt).toLocaleString('en-IN') : '–'} by {values.updatedByName ?? '–'}.
        </p>
      </Card>
      <FormError error={error} />
      {saved && <Notice tone="green">Saved.</Notice>}
      {isAdmin ? (
        <div>
          <Button type="submit" disabled={saving}>
            <Save /> {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Only an Admin can change these settings.</p>
      )}
    </form>
  );
}
