/**
 * NextAuth configuration (Credentials provider against the existing `users` table).
 *
 * Sessions are a signed JWT cookie (12 h). Route handlers still re-check the user in the
 * database via getSessionUser() in ./server.ts, so disabling a user or changing their
 * role/password takes effect immediately.
 */
import type { NextAuthOptions } from 'next-auth';
import type { Provider } from 'next-auth/providers/index';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';
import { verifyPassword, getDummyHash, hashPassword, generatePassword } from './password';
import { isRole, type Role } from './session';
import { CF_ACCESS_ENABLED, verifyCloudflareAccessJwt } from './cloudflareAccess';

// "Sign in with Google" is on only when both are set (Google Cloud OAuth client, redirect URI
// <NEXTAUTH_URL>/api/auth/callback/google). Optional GOOGLE_ALLOWED_DOMAINS="a.com,b.com" limits
// which email domains may use it; empty = any verified Google email, same as the open /signup.
const GOOGLE_ENABLED = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/**
 * Finds the dashboard user for a verified Google / Cloudflare email, creating a User-role account
 * on first use (same policy as /signup). Returns null when the account exists but is disabled.
 */
async function findOrCreateGoogleUser(email: string, name: string, source = 'Google sign-in') {
  const existing =
    (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.findUnique({ where: { username: email } }));
  if (existing) return existing.isActive && isRole(existing.role) ? existing : null;

  // Google accounts get a random password nobody knows; an admin can set one with `users -- set-password`.
  const user = await prisma.user.create({
    data: { username: email, email, name: name || email, role: 'User', passwordHash: await hashPassword(generatePassword(32)) },
  });
  await prisma.editLog.create({
    data: {
      tableName: 'users',
      recordId: user.id,
      fieldName: 'ALL_FIELDS',
      oldValue: 'NONE (New Record)',
      newValue: JSON.stringify({ email, name: user.name, role: user.role, source }),
      userId: user.id,
      userName: `${user.name} (${email})`,
    },
  });
  return user;
}

declare module 'next-auth' {
  interface User {
    username: string;
    role: Role;
    sv: number;
  }
  interface Session {
    user: { id: number; username: string; name: string; role: Role; sv: number };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid: number;
    username: string;
    role: Role;
    sv: number; // users.session_version at login time
  }
}

// Simple in-memory throttle: max 10 failed attempts per (ip+username) per 15 minutes.
// Good enough for a single-instance LAN deployment; resets on restart.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

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

const providers: Provider[] = [
    CredentialsProvider({
      name: 'Username and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      // Thrown messages are shown on the login page (signIn() returns them as `error`).
      async authorize(credentials, req) {
        const email = (credentials?.email || '').trim().toLowerCase();
        const password = credentials?.password || '';
        if (!email || !password) throw new Error('Email and password are required.');

        const headers = (req?.headers || {}) as Record<string, string | undefined>;
        const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim() || headers['x-real-ip'] || 'local';
        const key = `${ip}|${email}`;
        if (isThrottled(key)) throw new Error('Too many failed attempts. Try again in 15 minutes.');

        // shortcut: accounts created before email login have no email yet, so a value without "@"
        // is looked up as the old username. Drop this once every user has an email (users -- list).
        const user = await prisma.user.findUnique({ where: email.includes('@') ? { email } : { username: email } });
        // Always run a hash comparison so response time does not reveal whether the user exists.
        const valid = await verifyPassword(password, user?.passwordHash || (await getDummyHash()));

        if (!user || !valid || !user.isActive || !isRole(user.role)) {
          recordFailure(key);
          throw new Error('Invalid email or password.');
        }

        failures.delete(key);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return { id: String(user.id), name: user.name, username: user.username, role: user.role, sv: user.sessionVersion };
      },
    }),
];

// Silent sign-in for people already logged in at Cloudflare Access (see ./cloudflareAccess.ts).
// The browser calls signIn('cloudflare-access') with no fields; the proof is the signed header.
if (CF_ACCESS_ENABLED) {
  providers.push(
    CredentialsProvider({
      id: 'cloudflare-access',
      name: 'Cloudflare Access',
      credentials: {},
      async authorize(_credentials, req) {
        const headers = (req?.headers || {}) as Record<string, string | undefined>;
        const email = await verifyCloudflareAccessJwt(headers['cf-access-jwt-assertion']).catch((err) => {
          console.error('[auth] Cloudflare Access check failed:', err);
          return null;
        });
        if (!email) return null;
        const user = await findOrCreateGoogleUser(email, email.split('@')[0], 'Cloudflare Access (Google) sign-in');
        if (!user) throw new Error('This account is disabled. Contact the administrator.');
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: String(user.id), name: user.name, username: user.username, role: user.role as Role, sv: user.sessionVersion };
      },
    })
  );
}

if (GOOGLE_ENABLED) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: { prompt: 'select_account' } },
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  providers,
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      const p = profile as { email?: string; email_verified?: boolean; name?: string } | undefined;
      const email = (p?.email || '').trim().toLowerCase();
      if (!email || p?.email_verified !== true) return '/login?error=GoogleUnverified';
      if (GOOGLE_ALLOWED_DOMAINS.length && !GOOGLE_ALLOWED_DOMAINS.includes(email.split('@')[1])) {
        return '/login?error=GoogleDomain';
      }
      const user = await findOrCreateGoogleUser(email, (p?.name || '').trim());
      if (!user) return '/login?error=AccountDisabled';
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === 'google') {
        // `user` is the Google profile here; swap in the dashboard user (signIn above made sure it exists).
        const dbUser = await prisma.user.findUnique({ where: { email: (token.email || '').toLowerCase() } });
        if (dbUser) {
          token.uid = dbUser.id;
          token.username = dbUser.username;
          token.role = dbUser.role as Role;
          token.sv = dbUser.sessionVersion;
          token.name = dbUser.name;
        }
        return token;
      }
      if (user) {
        token.uid = Number(user.id);
        token.username = user.username;
        token.role = user.role;
        token.sv = user.sv;
      }
      return token;
    },
    session({ session, token }) {
      session.user = { id: token.uid, username: token.username, name: token.name || '', role: token.role, sv: token.sv };
      return session;
    },
  },
};
