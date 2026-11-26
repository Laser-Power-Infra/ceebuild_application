'use server';

import { read, write, toId } from '@/lib/actionResult';
import { deleteFeature, featureEditorData, saveFeature } from '@/modules/fabdrawings/server/features';
import { confirmDrawingSet, drawingSetPdf, issueDrawingSet, listDrawingSets, markIssueSent } from '@/modules/fabdrawings/server/sets';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { generateFabDrawings } from '@/modules/fabdrawings/server/generate';
import { listDrawingStandards, updateDrawingStandard } from '@/modules/fabdrawings/server/standards';

const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

// Drawing standards master: Admin only (view and edit).
export async function listDrawingStandardsAction() {
  return write(() => listDrawingStandards(), { roles: ADMIN_ROLES, fallback: 'Failed to load' });
}
export async function updateDrawingStandardAction(id: unknown, input: unknown) {
  return write((user) => updateDrawingStandard(toId(id, 'standard'), obj(input), user), { roles: ADMIN_ROLES });
}

/** Fabrication drawing PDF (base64) of a confirmed item BOM; records a DRAFT drawing set revision. */
export async function generateFabDrawingsAction(bomId: unknown, opts: unknown) {
  return write((user) => generateFabDrawings(toId(bomId, 'BOM'), obj(opts), user), { fallback: 'Could not make the fabrication drawings' });
}

// ---- part 2: geometry per mark, revisions, issue, production confirmation


export async function featureEditorAction(bomId: unknown) {
  return read(() => featureEditorData(toId(bomId, 'BOM')));
}
export async function saveFeatureAction(bomId: unknown, input: unknown) {
  return write((user) => saveFeature(toId(bomId, 'BOM'), obj(input), user));
}
export async function deleteFeatureAction(bomId: unknown, id: unknown) {
  return write((user) => deleteFeature(toId(bomId, 'BOM'), toId(id, 'row'), user));
}
export async function listDrawingSetsAction(bomId: unknown) {
  return read(() => listDrawingSets({ itemBomId: toId(bomId, 'BOM') }));
}
export async function drawingSetPdfAction(setId: unknown) {
  return read(() => drawingSetPdf(toId(setId, 'drawing')));
}
/** Issue to production: Admin (management releases the drawing). */
export async function issueDrawingSetAction(setId: unknown, input: unknown) {
  return write((user) => issueDrawingSet(toId(setId, 'drawing'), obj(input), user), { roles: ADMIN_ROLES });
}
export async function markIssueSentAction(setId: unknown) {
  return write((user) => markIssueSent(toId(setId, 'drawing'), user), { roles: ADMIN_ROLES });
}
/** "Confirmed by production": any signed-in user (production logs in); the name is recorded. */
export async function confirmDrawingSetAction(setId: unknown, input: unknown) {
  return write((user) => confirmDrawingSet(toId(setId, 'drawing'), obj(input), user));
}
