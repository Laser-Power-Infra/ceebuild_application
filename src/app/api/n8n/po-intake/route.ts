import { isN8nRequest } from '@/lib/n8n';
import { UserError } from '@/lib/actionResult';
import { ingestN8nIntake, type N8nIntakePayload } from '@/modules/poIntake/server/intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * n8n posts one PO mail it has read: { threadId, subject, sender, model, files: [{ name, kind,
 * mimeType, base64 | error }], gemini: { status, text } | null }. The PO then waits on /orders/new
 * for review. Same thread twice -> the existing intake is returned.
 */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: N8nIntakePayload;
  try {
    body = (await req.json()) as N8nIntakePayload;
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  try {
    return Response.json(await ingestN8nIntake(body));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[n8n po-intake]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
