// M15 - HSN item master for PO lines (our product range) and the GST rate per HSN. Pure (tests/po.test.ts).
// Used when the PO does not print an HSN: the code is filled from here and marked "from item master"
// so the reviewer sees it was not on the PO. A line no rule fits is flagged "HSN missing".
// To add or change a code, edit HSN_RULES (first match wins, so specific rules go first).

export interface HsnRule {
  hsn: string;
  label: string;
  re: RegExp;
}

// Descriptions are matched upper-case; "GL" is a common OCR slip for "GI" and is matched too.
export const HSN_RULES: HsnRule[] = [
  { hsn: '7313', label: 'Barbed wire / anti-climbing device', re: /BARBED|ANTI[\s-]*CLIMB/ },
  { hsn: '7312', label: 'Stranded wire (stay wire 7/..)', re: /STAY\s*WIRE|STRANDED|\b7\s*\/\s*\d+(\.\d+)?\s*(MM|SWG)?\b|EARTH\s*WIRE\s*\(?GSS/ },
  { hsn: '7217', label: 'GI wire', re: /\bG[IL]\b.*\bWIRE\b|\bWIRE\b.*\bG[IL]\b|\bSWG\b.*\bWIRE\b|GALVANI[SZ]ED\s+(IRON\s+|STEEL\s+)?WIRE/ },
  { hsn: '8310', label: 'Danger / sign plate', re: /DANGER\s*(BOARD|PLATE|SIGN)|SIGN\s*(PLATE|BOARD)|NUMBER\s*PLATE|CAUTION\s*BOARD/ },
  { hsn: '7318', label: 'Bolts, nuts, washers', re: /\bFASTENERS?\b|FOUNDATION\s*BOLT|^\W*(BOLTS?|NUTS?|WASHERS?)\b|\bBOLTS?\s*(&|AND)\s*NUTS?\b(?!.*\b(SET|CHANNEL|CLAMP|BRACING)\b)/ },
  // Structure words first: "base channel ... with clamps for cable GI pipe" is a structure, not a pipe.
  { hsn: '7308', label: 'Fabricated structure / structural parts', re: /STRUCTURE|CHANNEL|ANGLE|BRACING|CROSS\s*ARM|\bV[\s-]*CROSS|TOP\s*HAMPER|BELTING|STAY\s*SET|STAY\s*ROD|BASE\s*PLATE|EARTHING|EARTH\s*STRIP|\bSTRIP\b|\bFLAT\b|POLE|TOWER|GANTRY|BEAM|COLUMN|RISER|LID\s*SUPPORT|FABRICAT/ },
  { hsn: '7306', label: 'GI pipe', re: /\bPIPE\b/ },
  { hsn: '7308', label: 'Clamp / fitting (fabricated)', re: /CLAMP/ },
];

/** GST % by HSN (Schedule III, 18 % for these chapters). Default for anything else in ch. 72/73: 18. */
export const GST_BY_HSN: Record<string, number> = { '7308': 18, '7217': 18, '7312': 18, '7313': 18, '7318': 18, '7306': 18, '8310': 18, '7326': 18, '8535': 18, '8538': 18 };

export function hsnFor(description: string): { hsn: string; label: string } | null {
  const d = description.toUpperCase();
  for (const r of HSN_RULES) if (r.re.test(d)) return { hsn: r.hsn, label: r.label };
  return null;
}

/** GST % for an HSN (first 4 digits), null when not known. */
export function gstPctFor(hsn: string | null | undefined): number | null {
  if (!hsn) return null;
  const k = hsn.replace(/\D/g, '').slice(0, 4);
  if (GST_BY_HSN[k] !== undefined) return GST_BY_HSN[k];
  return /^(72|73)/.test(k) ? 18 : null;
}
