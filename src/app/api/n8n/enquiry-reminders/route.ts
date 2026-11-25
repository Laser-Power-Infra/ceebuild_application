import { isN8nRequest } from '@/lib/n8n';
import { enquiryReminders } from '@/modules/enquiry/server/intake';

export const dynamic = 'force-dynamic';

/**
 * n8n "Ceebuild – Enquiry reminders" (Rev 2 §2 E5), daily: open enquiries that need action –
 * due date passed / due within 2 days (RED), draft waiting for approval (AMBER), backlog (INFO).
 * GET -> { rows, red, text }   header x-api-key: N8N_API_KEY
 */
export async function GET(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await enquiryReminders());
  } catch (e) {
    console.error('[n8n enquiry-reminders]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
