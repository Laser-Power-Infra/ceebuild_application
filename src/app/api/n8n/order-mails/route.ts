import { isN8nRequest } from '@/lib/n8n';
import { orderMailsForN8n } from '@/modules/orders/server/mailCheck';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * n8n "Ceebuild – Order mail check": open orders whose mails were not read in the last 6 hours, with
 * their mail threads, the files not yet on the order (Drive ids) and the Gemini request.
 * GET /api/n8n/order-mails?limit=3[&orderIds=1,2]   header x-api-key: N8N_API_KEY
 */
export async function GET(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 3, 1), 20);
  const ids = (url.searchParams.get('orderIds') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  try {
    return Response.json(await orderMailsForN8n(limit, ids.length ? ids : undefined));
  } catch (e) {
    console.error('[n8n order-mails]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
