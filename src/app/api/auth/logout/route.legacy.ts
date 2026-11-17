// LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17). Kept for reference only; not used.
// The endpoint now lives in src/app/api/auth/[...nextauth]/route.ts (see src/lib/auth/options.ts).
//
// import { NextResponse } from 'next/server';
// import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
//
// export async function POST() {
//   const res = NextResponse.json({ success: true });
//   res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
//   return res;
// }

export {};
