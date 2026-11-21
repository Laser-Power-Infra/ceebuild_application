import { currentRole } from '@/lib/useCanEdit';
import { CostingMasterPage } from '@/modules/costing/ui/CostingMasterPage';

export const metadata = { title: 'Costing Master · Ceebuild' };

export default async function Page() {
  return <CostingMasterPage role={await currentRole()} />;
}
