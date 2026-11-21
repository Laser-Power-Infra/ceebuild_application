import { notFound } from 'next/navigation';
import { DocketCostingPage } from '@/modules/costing/ui/DocketCostingPage';

export const metadata = { title: 'Docket costing · Ceebuild' };

export default async function Page({ params }: { params: Promise<{ docketId: string }> }) {
  const { docketId } = await params;
  const n = Number(docketId);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <DocketCostingPage docketId={n} />;
}
