import { currentRole } from '@/lib/useCanEdit';
import { StoreStockPage } from '@/modules/rm/ui/StoreStockPage';

export const metadata = { title: 'Store stock · Ceebuild' };

export default async function Page() {
  const role = await currentRole();
  return <StoreStockPage canEdit={role === 'Admin' || role === 'User'} />;
}
