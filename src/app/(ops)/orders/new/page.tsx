import { currentRole } from '@/lib/useCanEdit';
import { getIntakeReview } from '@/modules/poIntake/server/intake';
import { PoIntakePage } from '@/modules/poIntake/ui/PoIntakePage';
import type { IntakeReview } from '@/modules/poIntake/types';

export const metadata = { title: 'Add order · Ceebuild' };

export default async function Page({ searchParams }: { searchParams: Promise<{ intake?: string }> }) {
  const [{ intake }, role] = await Promise.all([searchParams, currentRole()]);
  if (role !== 'Admin' && role !== 'User') {
    return <p className="text-sm text-slate-600">Sign in with an editor account to add orders.</p>;
  }
  let review: IntakeReview | null = null;
  const id = Number(intake);
  if (Number.isInteger(id) && id > 0) {
    try {
      review = await getIntakeReview(id);
    } catch {
      review = null;
    }
  }
  return <PoIntakePage initialReview={review} />;
}
