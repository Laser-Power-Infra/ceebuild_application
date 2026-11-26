import 'server-only';
import { waNumber, waText } from './whatsappText';

export { waNumber, waText };

/**
 * WhatsApp alerts (Rev 2 §2 escalations) through the office Evolution API (notification-service
 * repo, instance "reminder-bot", LAN :6026). The instance key comes from EVOLUTION_API_KEY on the
 * server, or from the n8n request that asks for the alert (n8n keeps it in the workflow).
 */
const clean = (v: string | undefined) => (v || '').replace(/^["']|["']$/g, '').trim();
const baseUrl = () => (clean(process.env.EVOLUTION_URL) || 'http://192.168.1.190:6026').replace(/\/+$/, '');
const instance = () => clean(process.env.EVOLUTION_INSTANCE) || 'reminder-bot';

export async function sendWhatsApp(to: string[], text: string, key?: string | null): Promise<{ to: string; ok: boolean; id?: string; error?: string }[]> {
  const apiKey = clean(process.env.EVOLUTION_API_KEY) || clean(key ?? undefined);
  if (!apiKey) throw new Error('WhatsApp is not set up: EVOLUTION_API_KEY missing.');
  const out = [];
  for (const raw of to) {
    const number = waNumber(raw);
    if (!number) {
      out.push({ to: raw, ok: false, error: 'not a mobile number' });
      continue;
    }
    try {
      const res = await fetch(`${baseUrl()}/message/sendText/${encodeURIComponent(instance())}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ number, text: waText(text) }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { key?: { id?: string }; message?: unknown };
      out.push(res.ok ? { to: number, ok: true, id: body.key?.id } : { to: number, ok: false, error: `${res.status} ${JSON.stringify(body).slice(0, 200)}` });
    } catch (e) {
      out.push({ to: number, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
