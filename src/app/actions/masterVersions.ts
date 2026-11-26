'use server';

import { read, write } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { addDatedChange, listMasterVersions, versionedRecords } from '@/modules/masterVersions/server';

// Rev 2 §6: dated values of sections, machines and planning settings. Reading is open like the
// masters themselves; a dated change is Admin only and needs a reason.

export async function listMasterVersionsAction(table: unknown, recordKey: unknown) {
  return read(() => listMasterVersions(String(table), recordKey ? String(recordKey) : null));
}

export async function versionedRecordsAction(table: unknown) {
  return read(() => versionedRecords(String(table)));
}

export async function addDatedChangeAction(input: unknown) {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return write(
    (user) =>
      addDatedChange(
        { table: String(i.table ?? ''), recordKey: String(i.recordKey ?? ''), field: String(i.field ?? ''), value: i.value, validFrom: String(i.validFrom ?? ''), reason: String(i.reason ?? '') },
        user,
      ),
    { roles: ADMIN_ROLES },
  );
}
