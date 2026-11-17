import { notFound } from 'next/navigation';
import { currentRole } from '@/lib/useCanEdit';
import { getOrder } from '@/modules/orders/server/query';
import { OrderPage } from '@/modules/orders/ui/OrderPage';

export const metadata = { title: 'Order · Ceebuild' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const [order, role] = await Promise.all([getOrder(n), currentRole()]);
  if (!order) notFound();
  return <OrderPage initial={order} role={role} />;
}
