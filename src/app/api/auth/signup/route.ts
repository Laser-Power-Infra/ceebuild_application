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
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'Full name is required (max 100 characters).' }, { status: 400 });
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  try {
    const user = await prisma.user.create({
      // The required username column just mirrors the email for self sign-ups.
      data: { username: email, email, name, role: 'User', passwordHash: await hashPassword(password) },
    });

    if (!entry || Date.now() - entry.first > WINDOW_MS) signups.set(ip, { count: 1, first: Date.now() });
    else entry.count += 1;

    await prisma.editLog.create({
      data: {
        tableName: 'users',
        recordId: user.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ email, name, role: user.role, source: 'self sign-up' }),
        userId: user.id,
        userName: `${user.name} (${email})`,
      },
    });

    return NextResponse.json({ user: { id: user.id, email, name: user.name, role: user.role } });
  } catch (error) {
    // P2002 = unique constraint (email, or a username that equals it).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }
    console.error('Sign-up error:', error);
    return NextResponse.json({ error: 'Sign up failed.' }, { status: 500 });
  }
}
