import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

// Self-service sign up with full name, email and password. New accounts get the User role
// (view, create, edit; no delete) and are active immediately. Admins can demote or disable them
// with `npm run users -- set-role|disable`.
// This static route takes precedence over the [...nextauth] catch-all next to it.

// Simple in-memory throttle: max 5 sign-ups per IP per hour. Single-instance LAN deployment; resets on restart.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS = 5;
const signups = new Map<string, { count: number; first: number }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

export async function POST(req: Request) {
  // proxy.ts lets /api/auth/* through, so the cross-origin check lives here.
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* invalid origin header */
    }
    if (!host || originHost !== host) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
  }

  const ip = clientIp(req);
  const entry = signups.get(ip);
  if (entry && Date.now() - entry.first <= WINDOW_MS && entry.count >= MAX_SIGNUPS) {
    return NextResponse.json({ error: 'Too many sign-ups from this network. Try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  // "User ID" can be any name ("tanmoy") or an email. Login lower-cases what is typed, so it is stored lower-case.
  const login = (typeof body.username === 'string' ? body.username : typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const name = (typeof body.name === 'string' ? body.name.trim() : '') || login;
  const password = typeof body.password === 'string' ? body.password : '';
  const isEmail = login.includes('@');

  if (!login || login.length > 100 || /\s/.test(login)) {
    return NextResponse.json({ error: 'Enter a user ID (no spaces, max 100 characters).' }, { status: 400 });
  }
  if (isEmail && !EMAIL_RE.test(login)) {
    return NextResponse.json({ error: 'Enter a valid email address, or a user ID without "@".' }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: 'Name is too long (max 100 characters).' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    return NextResponse.json({ error: 'Enter a password.' }, { status: 400 });
  }
  const email = isEmail ? login : null;

  try {
    const user = await prisma.user.create({
      data: { username: login, email, name, role: 'User', passwordHash: await hashPassword(password) },
    });

    if (!entry || Date.now() - entry.first > WINDOW_MS) signups.set(ip, { count: 1, first: Date.now() });
    else entry.count += 1;

    await prisma.editLog.create({
      data: {
        tableName: 'users',
        recordId: user.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ username: login, email, name, role: user.role, source: 'self sign-up' }),
        userId: user.id,
        userName: `${user.name} (${login})`,
      },
    });

    return NextResponse.json({ user: { id: user.id, username: login, email, name: user.name, role: user.role } });
  } catch (error) {
    // P2002 = unique constraint (email, or a username that equals it).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'This user ID is already taken.' }, { status: 409 });
    }
    console.error('Sign-up error:', error);
    return NextResponse.json({ error: 'Sign up failed.' }, { status: 500 });
  }
}
