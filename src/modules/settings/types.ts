/** Plant planning defaults (table plan_settings, single row). Client-safe type. */
export interface PlanSettingsValues {
  stdBarMm: number;
  maxCustomMm: number;
  endAllowanceMm: number;
  kerfMm: number;
  tolPlusMm: number;
  bufferPct: number;
  minOffcutMm: number;
  customMinBars: number;
  bomDueDays: number;
  galvAlertDays: number;
  diAlertDays: number;
  paymentTermsDays: number;
  workDaysPerWeek: number;
  /** M15: standard lead time (days); a PO delivery date earlier than today + this is flagged. */
  leadTimeDays: number;
  /** False until the plant signs the values off; UI shows "to confirm". */
  confirmed: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}
