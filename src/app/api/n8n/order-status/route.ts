import { isN8nRequest } from '@/lib/n8n';
import { UserError } from '@/lib/actionResult';
import { saveOrderMailStatus } from '@/modules/orders/server/mailCheck';

export const dynamic = 'force-dynamic';

/** n8n posts what Gemini read from one order's mails: { orderId, threads, model, gemini: { status, text } | null }. */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await saveOrderMailStatus(await req.json()));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[n8n order-status]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
