import { currentRole } from '@/lib/useCanEdit';
import { getPlanSettings } from '@/modules/settings/server';
import { PlanningSettingsForm } from '@/modules/rm/ui/PlanningSettingsForm';

export const metadata = { title: 'Planning Settings · Ceebuild' };

export default async function Page() {
  const [settings, role] = await Promise.all([getPlanSettings(), currentRole()]);
  return <PlanningSettingsForm initial={settings} role={role} />;
}
