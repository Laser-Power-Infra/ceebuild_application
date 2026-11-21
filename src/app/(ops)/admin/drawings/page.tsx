import { currentRole } from '@/lib/useCanEdit';
import { DrawingLibraryPage } from '@/modules/costing/ui/DrawingLibraryPage';

export const metadata = { title: 'Approved Drawing Library · Ceebuild' };

export default async function Page() {
  return <DrawingLibraryPage role={await currentRole()} />;
}
