import { currentRole } from '@/lib/useCanEdit';
import { ExecutionPage } from '@/modules/registers/ui/ExecutionPage';

export const metadata = { title: 'Execution registers · Ceebuild' };

export default async function Page() {
  return <ExecutionPage role={await currentRole()} />;
}
