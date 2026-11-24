// Mail-archive thread body -> the messages in date order, quoted replies removed, for the AI.
// Pure (tests/po.test.ts).
//
// The mail sync stores a thread as "--- Message 1 From: X ---\n<body>\n\n--- Message 2 From: Y ---..."
// in Gmail order (oldest first). Newer rows also carry "| Date: ..." in the marker; for older rows the
// date of message k is taken from the quote header in message k+1 ("On Mon, 28 Sept 2026 at 13:23, X
// wrote:"), and the last message gets the thread date. The latest message decides the status, so when
// the text has to be shortened the OLDEST messages are cut, never the newest.

export interface ThreadMessage {
  no: number;
  from: string;
  /** yyyy-mm-dd or null when it could not be worked out. */
  date: string | null;
  text: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** "Mon, 28 Sept 2026", "Sep 26, 2026", "Monday, 28 September 2026", "16/11/2026", "2026-11-16" -> yyyy-mm-dd. */
export function looseDate(s: string): string | null {
  const t = s.toLowerCase();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})\b/);
  if (m && MONTHS[m[2].slice(0, 3)]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3)])}-${pad(+m[1])}`;
  m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3)]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3)])}-${pad(+m[2])}`;
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

// Where the quoted earlier mail starts inside a reply.
const QUOTE_START = [
  /^\s*On .{6,160}wrote:\s*$/i,
  /^\s*On .{6,160}$/i, // Gmail wraps "On ..., X <x@y>" / "wrote:" onto two lines
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  /^\s*From:\s.+$/i,
  /^\s*Sent from my /i,
];

/** The reply's own text: everything before the first quote header / quoted block. */
export function ownText(body: string): { text: string; quotedDate: string | null } {
  const lines = body.split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) {
      cut = i;
      break;
    }
    const isOn = QUOTE_START[1].test(l) && (/wrote:\s*$/i.test(l) || /^\s*wrote:\s*$/i.test(lines[i + 1] ?? '')) && looseDate(l);
    if (QUOTE_START[0].test(l) || isOn || QUOTE_START[2].test(l) || QUOTE_START[3].test(l) || (QUOTE_START[4].test(l) && /^\s*(Sent|Date):/i.test(lines[i + 1] ?? '') && i > 0)) {
      cut = i;
      break;
    }
  }
  // Date of the mail this one replies to (first quote header).
  let quotedDate: string | null = null;
  for (let i = cut; i < Math.min(lines.length, cut + 6); i++) {
    const d = /\bOn\b|Date:|Sent:/i.test(lines[i]) ? looseDate(lines[i]) : null;
    if (d) {
      quotedDate = d;
      break;
    }
  }
  const text = lines
    .slice(0, cut)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, quotedDate };
}

const MARKER = /^--- Message (\d+) From: (.*?)(?: \| Date: (.*?))? ---\s*$/gm;

/** Split the stored thread body into messages (oldest first) with a date each where it can be found. */
export function splitThread(body: string, threadDate: string | null, msgCount?: number | null): ThreadMessage[] {
  const marks = [...body.matchAll(MARKER)];
  if (!marks.length) {
    const { text } = ownText(body);
    return text ? [{ no: 1, from: '', date: threadDate ? threadDate.slice(0, 10) : null, text }] : [];
  }
  const raw = marks.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index ?? body.length : body.length;
    const own = ownText(body.slice(start, end));
    return { no: +m[1], from: m[2].trim(), markerDate: m[3] ? looseDate(m[3]) : null, ...own };
  });
  const lastNo = msgCount ?? raw[raw.length - 1].no;
  return raw.map((r, i) => ({
    no: r.no,
    from: r.from,
    // own marker date > date quoted by the next reply > thread date (only for the real last message)
    date: r.markerDate ?? raw[i + 1]?.quotedDate ?? (r.no === lastNo && threadDate ? threadDate.slice(0, 10) : null),
    text: r.text,
  }));
}

const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : 'date unknown');

// Our own letterhead lines in signatures: no information for the AI, only length.
const NOISE_LINE = /head office|factory\s*:|visit us at|^\W*<?https?:\/\/\S+>?\W*$|^\W*<[^>]+@[^>]+>\W*$/i;

/**
 * The thread as the AI should read it: oldest -> newest, each message dated, quoted text removed,
 * at most `budget` characters. When too long, the oldest messages are dropped (and said so).
 */
export function threadForAi(body: string, threadDate: string | null, msgCount?: number | null, budget = 5600): string {
  const msgs = splitThread(body, threadDate, msgCount).filter((m) => m.text);
  if (!msgs.length) return '';
  const total = Math.max(msgCount ?? 0, msgs[msgs.length - 1].no, msgs.length);
  const blocks = msgs.map((m) => {
    const latest = m.no === total;
    const head = `### Message ${m.no} of ${total}${latest ? ' (LATEST)' : ''} – ${fmt(m.date)} – from ${m.from || 'unknown'}`;
    const text = m.text
      .split('\n')
      .filter((l) => !NOISE_LINE.test(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return `${head}\n${text.slice(0, 1800)}`;
  });
  // Keep the newest blocks that fit; the oldest go first.
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (used + b.length + 2 > budget && kept.length) break;
    kept.unshift(b.slice(0, budget));
    used += b.length + 2;
  }
  const missing = total - kept.length;
  const intro = `Mail thread, ${total} message(s), in date order (oldest first). The LATEST message decides the current status; an older statement that a later message changed is history, not a current issue.${missing ? ` ${missing} older message(s) are not included (oldest, or cut from a long thread).` : ''}`;
  return `${intro}\n\n${kept.join('\n\n')}`.slice(0, budget + 300);
}
