import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, getDummyHash } from '@/lib/auth/password';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions, isRole } from '@/lib/auth/session';

// Simple in-memory throttle: max 10 failed attempts per (ip+username) per 15 minutes.
// Good enough for a single-instance LAN deployment; resets on restart.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

function throttleKey(req: Request, username: string) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  return `${ip}|${username}`;
}

function isThrottled(key: string) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const key = throttleKey(req, username);
    if (isThrottled(key)) {
      return NextResponse.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    // Always run a hash comparison so response time does not reveal whether the user exists.
    const valid = await verifyPassword(password, user?.passwordHash || (await getDummyHash()));

    if (!user || !valid || !user.isActive || !isRole(user.role)) {
      recordFailure(key);
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    failures.delete(key);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = await createSessionToken({ uid: user.id, u: user.username, r: user.role, sv: user.sessionVersion });
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
