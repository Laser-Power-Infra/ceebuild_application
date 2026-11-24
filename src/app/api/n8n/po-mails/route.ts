import { isN8nRequest } from '@/lib/n8n';
import { mailDbConfigured } from '@/lib/mailDb';
import { n8nPoMails } from '@/modules/poIntake/server/intake';

export const dynamic = 'force-dynamic';

/**
 * n8n schedule ("Ceebuild – Read PO mails"): new customer-PO mails from the mail archive that have
 * not been read yet, with the Drive ids of their files and the Gemini prompt / schema / model.
 * GET /api/n8n/po-mails?days=21&limit=5   header x-api-key: N8N_API_KEY
 */
export async function GET(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!mailDbConfigured()) return Response.json({ error: 'MAIL_API_URL is not set on the dashboard (email portal API).' }, { status: 503 });
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 21, 1), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);
  try {
    return Response.json(await n8nPoMails(days, limit));
  } catch (e) {
    console.error('[n8n po-mails]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
