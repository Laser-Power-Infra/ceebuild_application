/**
 * Single sign-on through Cloudflare Access.
 *
 * On https://ceebuild.gmdalui.co.in staff already log in with Google at Cloudflare. Cloudflare then
 * adds a signed JWT (header `Cf-Access-Jwt-Assertion`) to every request it forwards. If that token
 * is valid for our Cloudflare team and Access app, we trust its email and sign the user in to the
 * dashboard too, so nobody has to log in twice.
 *
 * Only the signature makes this safe: on the LAN address (http://192.168.1.190:6011) anybody could
 * send that header by hand, but they cannot sign it with Cloudflare's key.
 *
 * Settings (not secret; the defaults are this company's Cloudflare team and "Laser Office Dashboards" app):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. delicate-fire-55bd.cloudflareaccess.com
 *   CF_ACCESS_AUD          Access app "Application Audience (AUD) tag", comma separated for several
 *   CF_ACCESS_AUTO_LOGIN   set to "off" to disable
 */
import { createPublicKey, verify, type JsonWebKey } from 'crypto';

const TEAM_DOMAIN = (process.env.CF_ACCESS_TEAM_DOMAIN || 'delicate-fire-55bd.cloudflareaccess.com').trim();
const AUDS = (process.env.CF_ACCESS_AUD || '3c931547f76321e6fb7e230b61a4e1c6c2fc9cdd818e7a700fb679e39cf788e2')
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);

export const CF_ACCESS_ENABLED = process.env.CF_ACCESS_AUTO_LOGIN !== 'off' && Boolean(TEAM_DOMAIN && AUDS.length);

// Cloudflare rotates its signing keys every few weeks; cache them for an hour and refetch on an unknown key id.
let keyCache: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

async function signingKeys(force = false) {
  if (!force && keyCache && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const res = await fetch(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Cloudflare Access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  keyCache = { at: Date.now(), keys: body.keys || [] };
  return keyCache.keys;
}

function b64url(part: string) {
  return Buffer.from(part, 'base64url');
}

/** Returns the verified, lower-cased email from a Cloudflare Access JWT, or null if it is not valid. */
export async function verifyCloudflareAccessJwt(token: string | undefined | null): Promise<string | null> {
  if (!CF_ACCESS_ENABLED || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; type?: string };
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys = await signingKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await signingKeys(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  const ok = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    b64url(parts[2])
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${TEAM_DOMAIN}`) return null;
  if (!aud.some((a) => a && AUDS.includes(a))) return null;
  if (!payload.exp || payload.exp < now - 30) return null;
  if (payload.nbf && payload.nbf > now + 30) return null;
  // Service tokens (n8n) have no email: they never become a dashboard user.
  const email = (payload.email || '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}
