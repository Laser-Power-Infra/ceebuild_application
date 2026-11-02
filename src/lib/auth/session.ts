/**
 * Signed session cookie helpers.
 *
 * Edge-runtime safe (Web Crypto only) so they can be used from middleware.ts
 * as well as from route handlers. The token is `base64url(json).base64url(hmac)`
 * signed with HMAC-SHA256 using AUTH_SECRET.
 *
 * The token only proves "this browser logged in as user X with role R at time T".
 * Route handlers re-check the user against the database (active flag +
 * sessionVersion) via getSessionUser() in ./server.ts.
 */

export const SESSION_COOKIE = 'ceebuild_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export const ROLES = ['Admin', 'User', 'Viewer'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface SessionPayload {
  uid: number; // users.id
  u: string; // username
  r: Role; // role at login time
  sv: number; // users.session_version at login time
  exp: number; // unix seconds
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET is missing or shorter than 32 characters. Set it in .env (see .env.example).');
  }
  return secret;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function getKey(): Promise<CryptoKey> {
  const secret = getSecret();
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  cachedKey = { secret, key };
  return key;
}

export async function createSessionToken(
  data: Omit<SessionPayload, 'exp'>,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const payload: SessionPayload = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await getKey(), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload if the signature is valid and the token has not expired, otherwise null. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const sigBytes = base64UrlDecode(sig);
    const ok = await crypto.subtle.verify(
      'HMAC',
      await getKey(),
      sigBytes as unknown as ArrayBuffer,
      encoder.encode(body)
    );
    if (!ok) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as SessionPayload;
    if (
      typeof payload.uid !== 'number' ||
      typeof payload.u !== 'string' ||
      !isRole(payload.r) ||
      typeof payload.sv !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie options shared by login/logout. Set COOKIE_SECURE=true once the app is served over HTTPS. */
export function sessionCookieOptions(maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
