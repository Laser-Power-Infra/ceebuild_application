'use server';

import { read, write } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { getPlanSettings, updatePlanSettings } from '@/modules/settings/server';

export async function getPlanSettingsAction() {
  return read(() => getPlanSettings());
}

export async function updatePlanSettingsAction(input: unknown) {
  return write((user) => updatePlanSettings((input && typeof input === 'object' ? input : {}) as Record<string, unknown>, user), {
    roles: ADMIN_ROLES,
  });
}
