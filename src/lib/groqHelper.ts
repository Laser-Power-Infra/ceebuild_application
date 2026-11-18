import 'server-only';

/**
 * The Groq API key comes from the server environment (GROQ_API_KEY in .env) only.
 * It is never read from or written to the database and never accepted from a request,
 * so it cannot leak through an API response or be replaced by a non-Admin user.
 */
export function getGroqApiKey(): string {
  return (process.env.GROQ_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

/** master_values types that hold secrets/settings and must never be returned by the public API. */
export const SECRET_MASTER_VALUE_TYPES = ['GROQ_API_KEY', 'SETTING'];
