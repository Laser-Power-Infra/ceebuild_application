import { currentRole } from '@/lib/useCanEdit';
import { SectionsPage } from '@/modules/sections/ui/SectionsPage';

export const metadata = { title: 'GTP sections · Ceebuild' };

export default async function Page() {
  return <SectionsPage role={await currentRole()} />;
}
