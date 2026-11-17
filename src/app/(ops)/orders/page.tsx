import { currentRole } from '@/lib/useCanEdit';
import { OrdersPage } from '@/modules/orders/ui/OrdersPage';

export const metadata = { title: 'Orders · Ceebuild' };

export default async function Page() {
  return <OrdersPage role={await currentRole()} />;
}
