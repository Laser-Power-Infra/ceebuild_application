import { notFound } from 'next/navigation';
import { currentRole } from '@/lib/useCanEdit';
import { ItemCostingPage } from '@/modules/costing/ui/ItemCostingPage';

export const metadata = { title: 'BOM & costing · Ceebuild' };

export default async function Page({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const n = Number(itemId);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <ItemCostingPage itemId={n} role={await currentRole()} />;
}
