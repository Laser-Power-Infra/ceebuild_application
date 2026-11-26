import { isN8nRequest } from '@/lib/n8n';
import { sendWhatsApp } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * n8n -> WhatsApp alert through the office Evolution API (the dashboard is on the same LAN).
 * POST { to: string[] | string, text: string }   headers: x-api-key (N8N_API_KEY),
 * x-evolution-key (instance key, when EVOLUTION_API_KEY is not set on the server).
 * -> { sent, results: [{ to, ok, id?, error? }] }
 */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const b = (await req.json().catch(() => ({}))) as { to?: unknown; text?: unknown };
    const to = (Array.isArray(b.to) ? b.to : String(b.to ?? '').split(/[,;]/)).map((x) => String(x).trim()).filter(Boolean);
    const text = String(b.text ?? '').trim();
    if (!to.length || !text) return Response.json({ error: 'to and text are required' }, { status: 400 });
    const results = await sendWhatsApp(to, text, req.headers.get('x-evolution-key'));
    return Response.json({ sent: results.filter((r) => r.ok).length, results }, { status: results.some((r) => r.ok) ? 200 : 502 });
  } catch (e) {
    console.error('[n8n whatsapp]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
