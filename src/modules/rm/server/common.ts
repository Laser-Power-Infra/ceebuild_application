import 'server-only';
import { Prisma } from '@prisma/client';
import { UserError } from '@/lib/actionResult';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { getPlanSettings, type PlanSettingsValues } from '@/modules/settings/server';
import type { CutSettings, PlanPiece, SectionInfo } from '@/lib/planning/cutting';

export type Tx = Prisma.TransactionClient;
const sql = Prisma.sql;

/** Lock the order row for the rest of the transaction (throws when it does not exist). */
export async function lockOrder(tx: Tx, orderId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
  if (rows.length === 0) throw new UserError('Order not found.');
}

export function audit(tx: Tx, user: AuthUser, tableName: string, recordId: number, fieldName: string, oldValue: unknown, newValue: unknown) {
  const s = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));
  return tx.editLog.create({ data: { tableName, recordId, fieldName, oldValue: s(oldValue), newValue: s(newValue), ...auditUser(user) } });
}

export function cutSettingsOf(s: PlanSettingsValues): CutSettings {
  return {
    stdBarMm: s.stdBarMm,
    maxCustomMm: s.maxCustomMm,
    endAllowanceMm: s.endAllowanceMm,
    kerfMm: s.kerfMm,
    tolPlusMm: s.tolPlusMm,
    bufferPct: s.bufferPct,
    minOffcutMm: s.minOffcutMm,
    customMinBars: s.customMinBars,
    // Rev 2 §10 (Puja's Rev 3 indent): custom bar per piece length; 0 keeps the per-mark rule.
    customMinMetres: s.customMinMetres > 0 ? s.customMinMetres : undefined,
  };
}

export interface PlanningInput {
  uploadId: number;
  pieces: PlanPiece[];
  sections: Record<string, SectionInfo>;
  settings: CutSettings;
  /** Plant has not signed the settings off yet. */
  settingsConfirmed: boolean;
  warnings: string[];
}

const toInt = (v: Prisma.Decimal | number | null) => (v === null ? null : typeof v === 'number' ? v : v.toNumber());

/**
 * Pieces of the order's current BOM (latest upload, must be "✓ Correct"), section kg/m (GTP section
 * master first, else the BOM's own kg/m) and the plant settings. Every gap is a UserError naming
 * the rows to fix, so a plan is never made on guessed data.
 */
export async function loadPlanningInput(tx: Tx | typeof import('@/lib/prisma').prisma, orderId: number): Promise<PlanningInput> {
  const upload = await tx.bomUpload.findFirst({ where: { orderId }, orderBy: { id: 'desc' }, select: { id: true, status: true } });
  if (!upload) throw new UserError('This order has no BOM yet. Upload the client BOM first.');
  if (upload.status !== 'CORRECT') throw new UserError('The BOM is still a draft. Clear its flags and mark it "✓ Correct BOM" before planning RM.');

  const rows = await tx.bomPiece.findMany({
    where: { uploadId: upload.id },
    orderBy: { rowNo: 'asc' },
    select: { rowNo: true, markNo: true, section: true, sectionKey: true, lengthMm: true, totalQty: true, kgPerM: true },
  });
  if (rows.length === 0) throw new UserError('The BOM has no pieces.');

  const keys = [...new Set(rows.map((r) => r.sectionKey).filter((k): k is string => !!k))];
  const masters = await tx.sectionMaster.findMany({ where: { sectionKey: { in: keys } }, select: { sectionKey: true, label: true, kgPerM: true, maxBarMm: true } });
  const master = new Map(masters.map((m) => [m.sectionKey, m]));

  const problems: string[] = [];
  const warnings: string[] = [];
  const pieces: PlanPiece[] = [];
  const bomKgm = new Map<string, Set<number>>();
  const labels = new Map<string, string>();
  for (const r of rows) {
    const mark = r.markNo?.trim() || `ROW ${r.rowNo}`;
    const qty = toInt(r.totalQty);
    if (!r.sectionKey) problems.push(`row ${r.rowNo} (${mark}): no section`);
    else if (!r.lengthMm || r.lengthMm <= 0) problems.push(`row ${r.rowNo} (${mark}): no length`);
    else if (qty === null) problems.push(`row ${r.rowNo} (${mark}): no total qty`);
    else if (!Number.isInteger(qty)) problems.push(`row ${r.rowNo} (${mark}): total qty ${qty} is not a whole number`);
    else {
      if (qty > 0) pieces.push({ markNo: mark.toUpperCase(), sectionKey: r.sectionKey, lengthMm: r.lengthMm, qty });
      if (!labels.has(r.sectionKey)) labels.set(r.sectionKey, r.section?.trim() || r.sectionKey);
      const k = toInt(r.kgPerM);
      if (k !== null && k > 0) bomKgm.set(r.sectionKey, (bomKgm.get(r.sectionKey) ?? new Set()).add(k));
    }
  }
  if (problems.length) throw new UserError(`Fix these BOM rows first: ${problems.slice(0, 12).join('; ')}${problems.length > 12 ? ` and ${problems.length - 12} more` : ''}.`);
  if (pieces.length === 0) throw new UserError('Every BOM row has qty 0: nothing to plan.');

  const sections: Record<string, SectionInfo> = {};
  const noKgm: string[] = [];
  for (const key of new Set(pieces.map((p) => p.sectionKey))) {
    const m = master.get(key);
    if (m) {
      sections[key] = { label: m.label, kgPerM: m.kgPerM.toNumber(), maxBarMm: m.maxBarMm };
      continue;
    }
    const vals = [...(bomKgm.get(key) ?? [])];
    if (vals.length === 0) {
      noKgm.push(labels.get(key) ?? key);
      continue;
    }
    const kgm = Math.max(...vals);
    if (vals.length > 1) warnings.push(`${labels.get(key)}: BOM rows give different kg/m (${vals.join(', ')}); ${kgm} used. Add the section to the GTP list to fix it.`);
    else warnings.push(`${labels.get(key)}: not in the GTP section list; BOM kg/m ${kgm} used.`);
    sections[key] = { label: labels.get(key) ?? key, kgPerM: kgm, maxBarMm: null };
  }
  if (noKgm.length) throw new UserError(`No kg/m for ${noKgm.join(', ')}. Add them under GTP Sections or fill kg/m in the BOM.`);

  const settings = await getPlanSettings();
  return { uploadId: upload.id, pieces, sections, settings: cutSettingsOf(settings), settingsConfirmed: settings.confirmed, warnings };
}

/** Next indent number for the order: IND-<orderId>-<n>, n = highest used + 1. */
export async function nextIndentNo(tx: Tx, orderId: number) {
  const rows = await tx.rmIndent.findMany({ where: { orderId }, select: { indentNo: true } });
  const prefix = `IND-${orderId}-`;
  const max = rows.reduce((m, r) => {
    const n = r.indentNo.startsWith(prefix) ? Number(r.indentNo.slice(prefix.length)) : 0;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${max + 1}`;
}
