// Pure helpers of the WhatsApp alerts (numbers, length).

/** Indian mobile "88200 44755" / "+91 88200-44755" -> "918820044755"; groups ("…@g.us") kept. */
export function waNumber(v: string): string | null {
  const s = v.trim();
  if (/@g\.us$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  return null;
}

/** WhatsApp messages are cut at ~4,000 characters. */
export const waText = (t: string) => (t.length > 3900 ? `${t.slice(0, 3880)}\n… (more on the dashboard)` : t);
