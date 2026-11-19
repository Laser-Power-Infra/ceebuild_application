import { currentRole } from '@/lib/useCanEdit';
import { BillingTab } from '@/modules/billing/ui/BillingTab';

export const metadata = { title: 'Billing & Collection · Ceebuild' };

export default async function Page() {
  const role = await currentRole();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Billing &amp; Collection</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">Invoices, receipts, retention and PBG / LC across all orders. Entries are added from each order&apos;s Billing tab.</p>
      </div>
      <BillingTab role={role} />
    </div>
  );
}
