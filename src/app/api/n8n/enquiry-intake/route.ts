import { isN8nRequest } from '@/lib/n8n';
import { UserError } from '@/lib/actionResult';
import { ingestEnquiry, type N8nEnquiryPayload } from '@/modules/enquiry/server/intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * n8n posts one mail it read: { threadId, subject, sender, date, files: [{ name, kind, link }],
 * gemini: { status, text } | null, model }. ENQUIRY -> new docket with its items (or linked to the
 * existing one); anything else is recorded. Same thread twice -> the existing row is returned.
 */
export async function POST(req: Request) {
  if (!isN8nRequest(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: N8nEnquiryPayload;
  try {
    body = (await req.json()) as N8nEnquiryPayload;
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  try {
    return Response.json(await ingestEnquiry(body));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[n8n enquiry-intake]', e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
