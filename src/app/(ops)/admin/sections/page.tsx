import { currentRole } from '@/lib/useCanEdit';
import { MasterVersionsPanel } from '@/modules/masterVersions/ui/MasterVersionsPanel';
import { SectionsPage } from '@/modules/sections/ui/SectionsPage';

export const metadata = { title: 'GTP sections · Ceebuild' };

export default async function Page() {
  const role = await currentRole();
  return (
    <div className="flex flex-col gap-4">
      <SectionsPage role={role} />
      {/* Rev 2 §6: values from a date + history */}
      <MasterVersionsPanel table="section_master" role={role} />
    </div>
  );
}
