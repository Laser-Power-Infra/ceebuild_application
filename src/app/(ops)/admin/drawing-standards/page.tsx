import { currentRole } from '@/lib/useCanEdit';
import { listDrawingStandards } from '@/modules/fabdrawings/server/standards';
import { DrawingStandardsPage } from '@/modules/fabdrawings/ui/DrawingStandardsPage';

export const metadata = { title: 'Drawing Standards · Ceebuild' };

export default async function Page() {
  const role = await currentRole();
  if (role !== 'Admin') {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Drawing Standards</h1>
        <p className="text-sm text-slate-600">Only an Admin can view and change the drawing standards.</p>
      </div>
    );
  }
  return <DrawingStandardsPage initial={await listDrawingStandards()} />;
}
