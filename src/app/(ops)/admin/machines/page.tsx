import { currentRole } from '@/lib/useCanEdit';
import { MasterVersionsPanel } from '@/modules/masterVersions/ui/MasterVersionsPanel';
import { MachinesPage } from '@/modules/production/ui/MachinesPage';

export const metadata = { title: 'Machines · Ceebuild' };

export default async function Page() {
  const role = await currentRole();
  return (
    <div className="flex flex-col gap-4">
      <MachinesPage role={role} />
      {/* Rev 2 §6: values from a date + history */}
      <MasterVersionsPanel table="machines" role={role} />
    </div>
  );
}
