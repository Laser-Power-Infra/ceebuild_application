'use server';

import { read, write, cleanQuery, toId } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { deleteSection, importSections, listSections, listSectionsFacet, updateSectionField, upsertSection } from '@/modules/sections/server';
import { fileBytes } from '@/modules/bom/server/workbook';

// The GTP section master drives the BOM checks, so changes are Admin only.

export async function listSectionsAction(query: unknown) {
  return read(() => listSections(cleanQuery(query)));
}

export async function listSectionsFacetAction(key: unknown, query: unknown) {
  return read(() => listSectionsFacet(String(key), cleanQuery(query)));
}

export async function upsertSectionAction(input: unknown) {
  return write((user) => upsertSection((input && typeof input === 'object' ? input : {}) as Record<string, unknown>, user), { roles: ADMIN_ROLES });
}

export async function updateSectionFieldAction(id: unknown, field: unknown, value: unknown) {
  return write((user) => updateSectionField(toId(id, 'section'), String(field), String(value ?? ''), user), { roles: ADMIN_ROLES });
}

export async function deleteSectionAction(id: unknown) {
  return write((user) => deleteSection(toId(id, 'section'), user), { roles: ADMIN_ROLES });
}

export async function importSectionsAction(form: FormData) {
  return write(async (user) => {
    const file = await fileBytes(form.get('file'));
    return importSections(file.buffer, file.name, user);
  }, { roles: ADMIN_ROLES, fallback: 'Import failed' });
}
