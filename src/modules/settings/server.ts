import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import type { PlanSettingsValues } from './types';

export type { PlanSettingsValues } from './types';

const DEFAULTS: PlanSettingsValues = {
  stdBarMm: 6000,
  maxCustomMm: 6000,
  endAllowanceMm: 0,
  kerfMm: 0,
  tolPlusMm: 20,
  bufferPct: 0,
  minOffcutMm: 300,
  customMinBars: 5,
  bomDueDays: 7,
  galvAlertDays: 7,
  diAlertDays: 7,
  paymentTermsDays: 30,
  workDaysPerWeek: 6,
  leadTimeDays: 45,
  confirmed: false,
  updatedByName: null,
  updatedAt: null,
};

/** Plant planning defaults (single row id = 1; created by the migration, re-created if missing). */
export async function getPlanSettings(): Promise<PlanSettingsValues> {
  const row = await prisma.planSettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULTS;
  return {
    stdBarMm: row.stdBarMm,
    maxCustomMm: row.maxCustomMm,
    endAllowanceMm: row.endAllowanceMm,
    kerfMm: row.kerfMm,
    tolPlusMm: row.tolPlusMm,
    bufferPct: row.bufferPct.toNumber(),
    minOffcutMm: row.minOffcutMm,
    customMinBars: row.customMinBars,
    bomDueDays: row.bomDueDays,
    galvAlertDays: row.galvAlertDays,
    diAlertDays: row.diAlertDays,
    paymentTermsDays: row.paymentTermsDays,
    workDaysPerWeek: row.workDaysPerWeek,
    leadTimeDays: row.leadTimeDays,
    confirmed: row.confirmed,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const INT_FIELDS: { key: keyof PlanSettingsValues; label: string; min: number; max: number }[] = [
  { key: 'stdBarMm', label: 'Standard bar length', min: 1000, max: 20000 },
  { key: 'maxCustomMm', label: 'Max custom length', min: 1000, max: 20000 },
  { key: 'endAllowanceMm', label: 'End allowance', min: 0, max: 500 },
  { key: 'kerfMm', label: 'Kerf per cut', min: 0, max: 20 },
  { key: 'tolPlusMm', label: 'Plus tolerance', min: 0, max: 200 },
  { key: 'minOffcutMm', label: 'Minimum usable offcut', min: 0, max: 6000 },
  { key: 'customMinBars', label: 'Min bars for a custom length', min: 1, max: 10000 },
  { key: 'bomDueDays', label: 'BOM due (days after PO)', min: 1, max: 365 },
  { key: 'galvAlertDays', label: 'Galvanising alert (days)', min: 1, max: 365 },
  { key: 'diAlertDays', label: 'DI alert (days after MC)', min: 1, max: 365 },
  { key: 'paymentTermsDays', label: 'Payment terms (days)', min: 0, max: 365 },
  { key: 'workDaysPerWeek', label: 'Working days per week', min: 1, max: 7 },
  { key: 'leadTimeDays', label: 'Standard lead time (days)', min: 1, max: 365 },
];

/** Admin-only update; every changed value goes to the audit log. */
export async function updatePlanSettings(input: Record<string, unknown>, user: AuthUser): Promise<PlanSettingsValues> {
  const data: Record<string, number | boolean | string> = {};
  for (const f of INT_FIELDS) {
    if (!(f.key in input)) continue;
    const n = Number(input[f.key]);
    if (!Number.isInteger(n) || n < f.min || n > f.max) throw new UserError(`${f.label} must be a whole number from ${f.min} to ${f.max}.`);
    data[f.key] = n;
  }
  if ('bufferPct' in input) {
    const n = Number(input.bufferPct);
    if (!Number.isFinite(n) || n < 0 || n > 50) throw new UserError('Buffer % must be between 0 and 50.');
    data.bufferPct = Math.round(n * 100) / 100;
  }
  if ('confirmed' in input) data.confirmed = input.confirmed === true;
  const merged = { ...(await getPlanSettings()), ...data };
  if (merged.maxCustomMm < merged.stdBarMm) throw new UserError('Max custom length cannot be below the standard bar length.');

  const before = await getPlanSettings();
  await prisma.$transaction(async (tx) => {
    await tx.planSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data, updatedByName: user.name },
      update: { ...data, updatedByName: user.name },
    });
    const changes = Object.keys(data).filter((k) => String(before[k as keyof PlanSettingsValues]) !== String(data[k]));
    if (changes.length) {
      await tx.editLog.createMany({
        data: changes.map((k) => ({
          tableName: 'plan_settings',
          recordId: 1,
          fieldName: k,
          oldValue: String(before[k as keyof PlanSettingsValues]),
          newValue: String(data[k]),
          ...auditUser(user),
        })),
      });
    }
  });
  return getPlanSettings();
}
