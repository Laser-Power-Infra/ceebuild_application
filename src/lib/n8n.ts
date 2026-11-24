import 'server-only';
import { timingSafeEqual } from 'crypto';
import { UserError } from '@/lib/actionResult';

/**
 * Link between this dashboard and n8n (M15 PO intake).
 *
 * Dashboard -> n8n: POST {N8N_WEBHOOK_URL}/<path> with header x-ceebuild-key = N8N_WEBHOOK_KEY
 *   (workflows "Ceebuild – Gemini proxy" and "Ceebuild – Read PO mail").
 * n8n -> dashboard: /api/n8n/* with header x-api-key = N8N_API_KEY (through the Cloudflare tunnel,
 *   ceebuild.gmdalui.co.in, with the "n8n-ceebuild-api" service token).
 */

const clean = (v: string | undefined) => (v || '').replace(/^["']|["']$/g, '').trim();
const webhookUrl = () => clean(process.env.N8N_WEBHOOK_URL).replace(/\/+$/, '');
export const n8nConfigured = () => !!(webhookUrl() && clean(process.env.N8N_WEBHOOK_KEY));

export async function callN8n<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  if (!n8nConfigured()) throw new UserError('n8n is not set up: N8N_WEBHOOK_URL / N8N_WEBHOOK_KEY are missing on the server.');
  const res = await fetch(`${webhookUrl()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ceebuild-key': clean(process.env.N8N_WEBHOOK_KEY) },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await res.text();
  if (res.status === 404) throw new UserError(`n8n workflow "${path}" is not active (404). Activate it in n8n.`);
  if (res.status === 401 || res.status === 403) throw new UserError('n8n refused the request: N8N_WEBHOOK_KEY does not match the workflow.');
  if (!res.ok) throw new Error(`n8n ${path} error ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`n8n ${path} returned no JSON: ${text.slice(0, 200)}`);
  }
}

/** True when the request carries the n8n API key (constant-time compare). */
export function isN8nRequest(req: Request): boolean {
  const want = clean(process.env.N8N_API_KEY);
  const got = req.headers.get('x-api-key') ?? '';
  if (!want || want.length < 16) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The audit identity for writes made on n8n's behalf. */
export const N8N_USER = { id: 0, username: 'n8n', name: 'n8n (automatic)', role: 'User' as const };
