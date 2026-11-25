'use server';

import { write, toId } from '@/lib/actionResult';
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
