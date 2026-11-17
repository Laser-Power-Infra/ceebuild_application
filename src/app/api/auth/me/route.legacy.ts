// LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17). Kept for reference only; not used.
// The endpoint now lives in src/app/api/auth/[...nextauth]/route.ts (see src/lib/auth/options.ts).
//
// import { NextResponse } from 'next/server';
// import { requireUser } from '@/lib/auth/server';
//
// export const dynamic = 'force-dynamic';
//
// export async function GET() {
//   const auth = await requireUser();
//   if (auth.error) return auth.error;
//   return NextResponse.json({ user: auth.user });
// }

export {};
