/**
 * Password hashing with Node's built-in scrypt (no extra dependency).
 * Stored format: scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * Node runtime only (route handlers and scripts), not middleware.
 * Uses a relative-import-safe module so scripts/users.ts can import it via ts-node.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, ScryptOptions } from 'crypto';

const KEY_LEN = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(16);
  const { N, r, p } = DEFAULT_PARAMS;
  const hash = await scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, nStr, rStr, pStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A dummy hash used to keep login timing similar when the username does not exist. */
let dummyHash: string | null = null;
export async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword(randomBytes(24).toString('base64'));
  return dummyHash;
}

export function generatePassword(length: number = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
