import { currentRole } from '@/lib/useCanEdit';
import { MachinesPage } from '@/modules/production/ui/MachinesPage';

export const metadata = { title: 'Machines · Ceebuild' };

export default async function Page() {
  return <MachinesPage role={await currentRole()} />;
}
