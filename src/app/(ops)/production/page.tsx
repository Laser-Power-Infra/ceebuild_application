import { currentRole } from '@/lib/useCanEdit';
import { ProductionPage } from '@/modules/production/ui/ProductionPage';

export const metadata = { title: 'Daily production · Ceebuild' };

export default async function Page() {
  return <ProductionPage role={await currentRole()} />;
}
