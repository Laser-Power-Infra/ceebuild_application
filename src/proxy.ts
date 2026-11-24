import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Gatekeeper for API writes. Viewing is public: every page and every GET works without login.
 *
 *  - Writes (POST/PUT/PATCH/DELETE) without a NextAuth session -> 401.
 *  - Cross-origin writes      -> 403 (basic CSRF protection on top of SameSite=Lax).
 *  - Viewer role              -> read-only (no POST/PUT/PATCH/DELETE).
 *  - DELETE + master-values writes -> Admin only.
 *
 * Route handlers re-validate the user against the database (see src/lib/auth/server.ts).
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // NextAuth's own endpoints (sign-in, sign-out, session) do their own CSRF checks.
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();
  // n8n endpoints check their own API key (src/lib/n8n.ts).
  if (pathname.startsWith('/api/n8n/')) return NextResponse.next();

  const session = await getToken({ req, secret: process.env.AUTH_SECRET });

  // No redirect away from /login or /signup when a cookie exists: the cookie may be stale (user
  // disabled, password/role changed, cookie from another server), and the user must be able to
  // sign in again. Pages decide "signed in" with the database check in getSessionUser().

  // Public read access: pages and safe methods need no login.
  if (!pathname.startsWith('/api/') || SAFE_METHODS.has(method)) return NextResponse.next();

  if (!session) return jsonError('Not authenticated', 401);

  // CSRF: browsers always send Origin on cross-site POST/PUT/DELETE.
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* invalid origin header */
    }
    if (!host || originHost !== host) return jsonError('Cross-origin request blocked', 403);
  }

  if (session.role === 'Viewer') return jsonError('Forbidden: your account is read-only', 403);
  if (method === 'DELETE' && session.role !== 'Admin') return jsonError('Forbidden: only Admin can delete', 403);
  if (pathname.startsWith('/api/master-values') && session.role !== 'Admin') {
    return jsonError('Forbidden: only Admin can change master dropdowns', 403);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next.js internals and static files in /public.
  // /api/n8n/* is left out: n8n calls it with its own API key (checked in the route), and its PO
  // payloads (base64 files) are larger than the proxy body limit.
  matcher: ['/((?!api/n8n/|_next/static|_next/image|favicon\\.ico|icon\\.png|ceebuild-logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)'],
};

// LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17). Kept for reference only; not used.
// The old gate required a login for every page and API route.
//
// import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from '@/lib/auth/session';
//
// const PUBLIC_PATHS = new Set<string>(['/login', '/api/auth/login', '/api/health']);
//
// export async function middleware(req: NextRequest) {
//   const { pathname, search } = req.nextUrl;
//   const isApi = pathname.startsWith('/api/');
//   const method = req.method.toUpperCase();
//
//   let session: SessionPayload | null;
//   try {
//     session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
//   } catch (err) {
//     // AUTH_SECRET not configured: fail closed.
//     console.error('[auth] ', err);
//     return isApi
//       ? jsonError('Server authentication is not configured (AUTH_SECRET).', 500)
//       : new NextResponse('Server authentication is not configured (AUTH_SECRET). Contact the administrator.', {
//           status: 500,
//         });
//   }
//
//   if (PUBLIC_PATHS.has(pathname)) {
//     if (pathname === '/login' && session) {
//       return NextResponse.redirect(new URL('/', req.url));
//     }
//     return NextResponse.next();
//   }
//
//   if (!session) {
//     if (isApi) return jsonError('Not authenticated', 401);
//     const loginUrl = new URL('/login', req.url);
//     const next = pathname + search;
//     if (next && next !== '/') loginUrl.searchParams.set('next', next);
//     const res = NextResponse.redirect(loginUrl);
//     // Clear an expired / tampered cookie, if any.
//     if (req.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
//     return res;
//   }
//
//   if (isApi && !SAFE_METHODS.has(method)) {
//     // CSRF origin check (unchanged, see above)
//
//     if (pathname !== '/api/auth/logout') {
//       if (session.r === 'Viewer') return jsonError('Forbidden: your account is read-only', 403);
//       if (method === 'DELETE' && session.r !== 'Admin') return jsonError('Forbidden: only Admin can delete', 403);
//       if (pathname.startsWith('/api/master-values') && session.r !== 'Admin') {
//         return jsonError('Forbidden: only Admin can change master dropdowns', 403);
//       }
//     }
//   }
//
//   return NextResponse.next();
// }
