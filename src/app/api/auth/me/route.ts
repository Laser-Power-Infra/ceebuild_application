import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  return NextResponse.json({ user: auth.user });
}
