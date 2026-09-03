import { prisma } from '@/lib/prisma';

export const DEFAULT_KEYWORD_RULES: { [key in 'NO' | 'MANUFACTURING' | 'TRADING']: string[] } = {
  NO: [
    "copper", "jumper", "dropper", "feeder wire ending", "lug", "flexible al bond",
    "pg clamp", "pg connector", "wedge", "piercing connector", "sleeve", 
    "compression joint", "t-connector", "insulator", "arrestor", "arrester", 
    "lightning", "disc fitting", "isolator", "ab switch", "fuse", "iron clad switch", 
    "damper", "spacer", "suspension string", "tension string", 
    "suspension clamp assembly", "tension clamp assembly", "cable tray", 
    "perforated tray", "smc board"
  ],
  MANUFACTURING: [
    "channel", "angle", "flat", "strip", "stay set", "bracing", "v-cross", 
    "v-type", "anti-climbing", "earthmat", "earth mat", "earthing rod", 
    "earth rod", "ms rod", "spike earthing", "chemical earthing", 
    "compound filled earthing", "bolt", "nut", "washer", "rivet", "clamp", "anchor"
  ],
  TRADING: [
    "gi wire", "g.i. wire", "earth wire", "swg", "stay wire", "name plate", 
    "number plate", "phase plate", "circuit plate", "danger plate", 
    "danger board", "gi pipe", "g.i. pipe", "gi erw pipe"
  ]
};

export interface CustomKeywordRule {
  keyword: string;
  category: 'NO' | 'MANUFACTURING' | 'TRADING';
}

export function extractKeyPhrases(description: string): string[] {
  if (!description || !description.trim()) return [];
  const clean = description
    .replace(/[\(\)\[\]\{\}\d+\.\,\:\;\/\-\\\|\=\@\#\$\%\^\&\*\+\_\<\>]/g, ' ')
    .toLowerCase();

  const stopWords = new Set(['with', 'for', 'and', 'the', 'per', 'set', 'nos', 'kg', 'mtr', 'mm', 'kv', 'swg', 'scope', 'work', 'sbd', 'drw', 'complete', 'all', 'type', 'dias']);
  const words = clean.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));

  if (words.length === 0) return [];

  const phrases: string[] = [];

  // Generate 2-word and 3-word n-grams for phrase matching
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
    if (i < words.length - 2) {
      phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  // Also include single key words
  for (const w of words) {
    phrases.push(w);
  }

  // Deduplicate and return longest meaningful phrases first
  return Array.from(new Set(phrases)).sort((a, b) => b.length - a.length);
}

export function autoDetectOurItemNotSync(
  description: string,
  customRules: CustomKeywordRule[] = []
): 'TRADING' | 'MANUFACTURING' | 'NO' {
  if (!description || !description.trim()) return 'MANUFACTURING';
  const desc = description.toLowerCase();

  // 1. Check custom user-learned rules first (highest priority)
  if (Array.isArray(customRules)) {
    for (const rule of customRules) {
      if (rule.keyword && desc.includes(rule.keyword.toLowerCase())) {
        return rule.category;
      }
    }
  }

  // 2. Check NO keywords
  for (const kw of DEFAULT_KEYWORD_RULES.NO) {
    if (desc.includes(kw.toLowerCase())) {
      return 'NO';
    }
  }

  // 3. Check TRADING keywords
  for (const kw of DEFAULT_KEYWORD_RULES.TRADING) {
    if (desc.includes(kw.toLowerCase())) {
      return 'TRADING';
    }
  }

  // 4. Check MANUFACTURING keywords
  for (const kw of DEFAULT_KEYWORD_RULES.MANUFACTURING) {
    if (desc.includes(kw.toLowerCase())) {
      return 'MANUFACTURING';
    }
  }

  return 'MANUFACTURING';
}

export async function autoDetectOurItemNotAsync(description: string): Promise<'TRADING' | 'MANUFACTURING' | 'NO'> {
  if (!description || !description.trim()) return 'MANUFACTURING';
  const desc = description.trim();
  const descLower = desc.toLowerCase();

  // 1. Prioritize direct database matches from user's previously edited items!
  try {
    const existingMatch = await prisma.itemTable.findFirst({
      where: {
        itemNameParty: { contains: desc.slice(0, 30), mode: 'insensitive' },
        ourItemNot: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { ourItemNot: true },
    });

    if (existingMatch && existingMatch.ourItemNot) {
      const cat = existingMatch.ourItemNot.trim().toUpperCase();
      if (cat === 'MANUFACTURING' || cat === 'TRADING' || cat === 'NO') {
        return cat as any;
      }
    }
  } catch (err) {
    console.error('Error finding DB match:', err);
  }

  // 2. Check custom keyword rules in master-values
  let customRules: CustomKeywordRule[] = [];
  try {
    const rules = await prisma.masterValue.findMany({
      where: { type: 'KEYWORD_CLASSIFICATION_RULE', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    for (const r of rules) {
      if (r.value) {
        try {
          const parsed = JSON.parse(r.value);
          if (parsed.keyword && parsed.category) {
            customRules.push({
              keyword: parsed.keyword,
              category: parsed.category.toUpperCase() as any,
            });
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('Error reading custom rules:', err);
  }

  return autoDetectOurItemNotSync(description, customRules);
}

export const autoDetectOurItemNot = autoDetectOurItemNotSync;
