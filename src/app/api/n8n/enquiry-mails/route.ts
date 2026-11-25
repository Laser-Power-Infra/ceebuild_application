import { isN8nRequest } from '@/lib/n8n';
import { mailDbConfigured } from '@/lib/mailDb';
import { n8nEnquiryMails } from '@/modules/enquiry/server/intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * n8n "Ceebuild – Read enquiry mails" (Rev 2 §2): mails of info@ that look like enquiries and were
 * not read yet, oldest first, with the Gemini prompt / schema / model.
 * GET /api/n8n/enquiry-mails?days=7&limit=3   (backfill: days=90)   header x-api-key: N8N_API_KEY
 */
export async function GET(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!mailDbConfigured()) return Response.json({ error: 'MAIL_API_URL is not set on the dashboard (email portal API).' }, { status: 503 });
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 3, 1), 20);
  try {
    return Response.json(await n8nEnquiryMails(days, limit, url.searchParams.get('backfill') === '1'));
  } catch (e) {
    console.error('[n8n enquiry-mails]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
