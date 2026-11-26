import { currentRole } from '@/lib/useCanEdit';
import { MasterVersionsPanel } from '@/modules/masterVersions/ui/MasterVersionsPanel';
import { getPlanSettings } from '@/modules/settings/server';
import { PlanningSettingsForm } from '@/modules/rm/ui/PlanningSettingsForm';

export const metadata = { title: 'Planning Settings · Ceebuild' };

export default async function Page() {
  const [settings, role] = await Promise.all([getPlanSettings(), currentRole()]);
  return (
    <div className="flex flex-col gap-4">
      <PlanningSettingsForm initial={settings} role={role} />
      {/* Rev 2 §6: values from a date + history */}
      <MasterVersionsPanel table="plan_settings" role={role} />
    </div>
  );
}
