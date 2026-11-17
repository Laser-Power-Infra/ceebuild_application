/**
 * NextAuth configuration (Credentials provider against the existing `users` table).
 *
 * Sessions are a signed JWT cookie (12 h). Route handlers still re-check the user in the
 * database via getSessionUser() in ./server.ts, so disabling a user or changing their
 * role/password takes effect immediately.
 */
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { verifyPassword, getDummyHash } from './password';
import { isRole, type Role } from './session';

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

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Username and password',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      // Thrown messages are shown on the login page (signIn() returns them as `error`).
      async authorize(credentials, req) {
        const username = (credentials?.username || '').trim().toLowerCase();
        const password = credentials?.password || '';
        if (!username || !password) throw new Error('Username and password are required.');

        const headers = (req?.headers || {}) as Record<string, string | undefined>;
        const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim() || headers['x-real-ip'] || 'local';
        const key = `${ip}|${username}`;
        if (isThrottled(key)) throw new Error('Too many failed attempts. Try again in 15 minutes.');

        const user = await prisma.user.findUnique({ where: { username } });
        // Always run a hash comparison so response time does not reveal whether the user exists.
        const valid = await verifyPassword(password, user?.passwordHash || (await getDummyHash()));

        if (!user || !valid || !user.isActive || !isRole(user.role)) {
          recordFailure(key);
          throw new Error('Invalid username or password.');
        }

        failures.delete(key);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return { id: String(user.id), name: user.name, username: user.username, role: user.role, sv: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
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
