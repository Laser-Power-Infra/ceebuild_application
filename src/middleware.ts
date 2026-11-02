import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from '@/lib/auth/session';

/**
 * Gatekeeper for every page and API route.
 *
 *  - No valid session cookie  -> pages redirect to /login, APIs get 401.
 *  - Cross-origin writes      -> 403 (basic CSRF protection on top of SameSite=Lax).
 *  - Viewer role              -> read-only (no POST/PUT/PATCH/DELETE).
 *  - DELETE + master-values writes -> Admin only.
 *
 * Route handlers re-validate the user against the database (see src/lib/auth/server.ts).
 */

const PUBLIC_PATHS = new Set<string>(['/login', '/api/auth/login', '/api/health']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const method = req.method.toUpperCase();

  let session: SessionPayload | null;
  try {
    session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  } catch (err) {
    // AUTH_SECRET not configured: fail closed.
    console.error('[auth] ', err);
    return isApi
      ? jsonError('Server authentication is not configured (AUTH_SECRET).', 500)
      : new NextResponse('Server authentication is not configured (AUTH_SECRET). Contact the administrator.', {
          status: 500,
        });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === '/login' && session) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (isApi) return jsonError('Not authenticated', 401);
    const loginUrl = new URL('/login', req.url);
    const next = pathname + search;
    if (next && next !== '/') loginUrl.searchParams.set('next', next);
    const res = NextResponse.redirect(loginUrl);
    // Clear an expired / tampered cookie, if any.
    if (req.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (isApi && !SAFE_METHODS.has(method)) {
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

    if (pathname !== '/api/auth/logout') {
      if (session.r === 'Viewer') return jsonError('Forbidden: your account is read-only', 403);
      if (method === 'DELETE' && session.r !== 'Admin') return jsonError('Forbidden: only Admin can delete', 403);
      if (pathname.startsWith('/api/master-values') && session.r !== 'Admin') {
        return jsonError('Forbidden: only Admin can change master dropdowns', 403);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next.js internals and static files in /public.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|ceebuild-logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)'],
};
