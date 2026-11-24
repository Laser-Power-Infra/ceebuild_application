// Attachment lists of the mail archive (threads.attach_names / attach_links): pair names with Drive
// links and guess what each file is. Pure (unit-tested in tests/po.test.ts).

/** OFFER = our own price offer / quotation (never read as the PO; prices come from the PO only). */
export type MailFileKind = 'PO' | 'OFFER' | 'BOM' | 'DRAWING' | 'OTHER' | 'SKIP';

export interface MailFile {
  name: string;
  link: string;
  driveId: string | null;
  kind: MailFileKind;
}


const driveIdOf = (link: string) => link.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? link.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1] ?? null;

/** Guess what an attachment is from its name (the reviewer can change it). */
export function guessKind(name: string): MailFileKind {
  const n = name.toLowerCase();
  const ext = n.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(ext)) return /bom|bill of mat|cutting|piece|fab|structure/.test(n) ? 'BOM' : 'OTHER';
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'tif', 'tiff'].includes(ext)) return 'SKIP';
  if (/^(image\d*|icon|logo|warning_triangle|outlook|signature|banner)[\w-]*\.(png|jpe?g|gif)$/.test(n)) return 'SKIP';
  if (/\bdrg\b|drawing|dwg|\bga\b|gtp|layout|sld/.test(n)) return 'DRAWING';
  // "2PO-14(A)", "PO_123", "P.O." - a PO number in the name wins over "price" ("Revised PO price.pdf" is still the PO).
  const poLike = /(?<![a-z])p\.?o(?![a-z])|purchase|order|(?<![a-z])loa(?![a-z])|award|amend|work order|(?<![a-z])wo(?![a-z])/.test(n);
  // Our offer: "AKS_Revised Price.pdf", "Quotation CEE-000419.pdf", "Techno-commercial offer.pdf".
  if (!poLike && /price|offer|quot|(?<![a-z])qtn(?![a-z])|proforma|(?<![a-z])pi(?![a-z])|techno|commercial|(?<![a-z])rates?(?![a-z])|cee-?\d{4,}/.test(n)) return 'OFFER';
  if (poLike || /revised/.test(n)) return 'PO';
  if (ext === 'pdf') return 'PO'; // an unnamed PDF on a PO mail is most often the PO itself (e.g. "42008150 - ... - 7100.pdf")
  return 'OTHER';
}

/** attach_names and attach_links are parallel comma-separated lists; names may contain ", ". */
export function pairFiles(names: string | null, links: string | null): MailFile[] {
  const ls = String(links ?? '')
    .split(/,\s*(?=https?:\/\/)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ls.length || !names || names.trim() === '[No Attachments]') return [];
  let ns = names.split(', ');
  if (ns.length !== ls.length) ns = names.split(',').map((s) => s.trim());
  if (ns.length !== ls.length) {
    // Rebuild names by extension boundaries: "a, b.pdf, c.xlsx" -> join pieces until one ends in an extension.
    const out: string[] = [];
    let cur = '';
    for (const part of names.split(', ')) {
      cur = cur ? `${cur}, ${part}` : part;
      if (/\.[a-z0-9]{2,5}$/i.test(part)) {
        out.push(cur);
        cur = '';
      }
    }
    if (cur) out.push(cur);
    ns = out;
  }
  return ls.map((link, i) => {
    const name = ns[i] ?? `file-${i + 1}`;
    return { name, link, driveId: driveIdOf(link), kind: guessKind(name) };
  });
}
