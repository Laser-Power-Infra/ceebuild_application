import 'server-only';
import { UserError } from '@/lib/actionResult';
import { callN8n, n8nConfigured } from '@/lib/n8n';

/**
 * Google Gemini (generateContent REST API), used for OCR + extraction of PO copies (M15).
 * The key comes from the server environment only (GEMINI_API_KEY), never from the database or
 * the browser, same rule as GROQ_API_KEY. GEMINI_MODEL picks the model.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
/** Inline request limit is ~20 MB after base64; keep the raw files under this. */
export const GEMINI_MAX_INLINE_BYTES = 14 * 1024 * 1024;
export const N8N_MAX_INLINE_BYTES = 11 * 1024 * 1024;

const clean = (v: string | undefined) => (v || '').replace(/^["']|["']$/g, '').trim();
export const getGeminiApiKey = () => clean(process.env.GEMINI_API_KEY);
export const getGeminiModel = () => clean(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
/**
 * Without a key on this server, Gemini is called through n8n ("Ceebuild – Gemini proxy" workflow),
 * which holds the paid Gemini credential. n8nConfigured() = N8N_WEBHOOK_URL + N8N_WEBHOOK_KEY set.
 */
export const geminiVia = (): 'key' | 'n8n' | null => (getGeminiApiKey() ? 'key' : n8nConfigured() ? 'n8n' : null);
export const geminiConfigured = () => geminiVia() !== null;

export interface GeminiFile {
  mimeType: string;
  data: Buffer;
  name: string;
}

/** MIME types Gemini reads directly (PDF incl. scanned pages, images). */
export const GEMINI_DOC_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
export const geminiMimeOf = (fileName: string) => GEMINI_DOC_TYPES[(fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()] ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON answer from Gemini for the given files + prompt, shaped by `schema` (OpenAPI subset).
 * Retries twice on 429 / 5xx. Errors become UserErrors with a readable reason.
 */
export async function geminiJson<T>(opts: { files: GeminiFile[]; prompt: string; schema: object; timeoutMs?: number; maxOutputTokens?: number }): Promise<{ data: T; model: string }> {
  const key = getGeminiApiKey();
  const via = geminiVia();
  if (!via) throw new UserError('PO reading is not set up: set GEMINI_API_KEY, or N8N_WEBHOOK_URL + N8N_WEBHOOK_KEY (Gemini through n8n).');
  const model = getGeminiModel();
  const total = opts.files.reduce((s, f) => s + f.data.length, 0);
  // n8n Cloud accepts ~16 MB per webhook call, i.e. ~11 MB of files once base64-encoded.
  const limit = via === 'n8n' ? N8N_MAX_INLINE_BYTES : GEMINI_MAX_INLINE_BYTES;
  if (total > limit) {
    throw new UserError(`The attached files are ${(total / 1048576).toFixed(1)} MB; the limit for reading is ${limit / 1048576} MB. Attach a smaller scan (e.g. 150-200 dpi).`);
  }
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          ...opts.files.flatMap((f, i) => [{ text: `Document ${i + 1}: ${f.name}` }, { inline_data: { mime_type: f.mimeType, data: f.data.toString('base64') } }]),
          { text: opts.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens ?? 65536,
    },
  };

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(2000 * attempt);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);
    let res: { ok: boolean; status: number; text: string };
    try {
      if (via === 'key') {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        res = { ok: r.ok, status: r.status, text: await r.text() };
      } else {
        // n8n answers { status, text } = Gemini's own status code and response body.
        const r = await callN8n<{ status?: number; text?: string }>('ceebuild-gemini', { model, body }, ctrl.signal);
        const status = Number(r.status) || 502;
        res = { ok: status >= 200 && status < 300, status, text: String(r.text ?? '') };
      }
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof UserError) throw e;
      lastError = (e as Error).name === 'AbortError' ? 'Gemini took too long to answer' : `Gemini could not be reached (${(e as Error).message})`;
      continue;
    }
    clearTimeout(timer);
    const text = res.text;
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        /* not JSON */
      }
      lastError = `Gemini error ${res.status}: ${msg}`;
      if (res.status === 429 || res.status >= 500) continue;
      if (res.status === 400 && /api key/i.test(msg)) throw new UserError(via === 'key' ? 'Gemini rejected the API key (GEMINI_API_KEY). Check the key on the server.' : 'Gemini rejected the API key of the n8n "PAID API" credential.');
      if (res.status === 404) throw new UserError(`Gemini model "${model}" was not found. Set GEMINI_MODEL to a current model.`);
      throw new UserError(lastError);
    }
    const parsed = JSON.parse(text) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (parsed.promptFeedback?.blockReason) throw new UserError(`Gemini refused the document (${parsed.promptFeedback.blockReason}).`);
    const cand = parsed.candidates?.[0];
    const out = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!out) {
      lastError = `Gemini returned no answer (${cand?.finishReason ?? 'unknown reason'})`;
      continue;
    }
    try {
      return { data: JSON.parse(out) as T, model };
    } catch {
      lastError = cand?.finishReason === 'MAX_TOKENS' ? 'The answer was cut off (document too long). Attach the PO pages only.' : 'Gemini returned invalid JSON';
      if (cand?.finishReason === 'MAX_TOKENS') throw new UserError(lastError);
    }
  }
  throw new UserError(lastError || 'Gemini failed.');
}

/**
 * Parse a raw generateContent answer (status + body text) into the JSON the schema asked for.
 * Used for answers n8n got from Gemini on its own (PO mails read by the n8n workflow).
 */
export function parseGeminiAnswer<T>(status: number, text: string): T {
  if (status < 200 || status >= 300) {
    let msg = text.slice(0, 300);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new UserError(`Gemini error ${status}: ${msg}`);
  }
  let parsed: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UserError('Gemini answer was not JSON.');
  }
  if (parsed.promptFeedback?.blockReason) throw new UserError(`Gemini refused the document (${parsed.promptFeedback.blockReason}).`);
  const cand = parsed.candidates?.[0];
  const out = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!out) throw new UserError(`Gemini returned no answer (${cand?.finishReason ?? 'unknown reason'}).`);
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new UserError(cand?.finishReason === 'MAX_TOKENS' ? 'The answer was cut off (document too long).' : 'Gemini returned invalid JSON.');
  }
}
