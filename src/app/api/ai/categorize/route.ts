import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { autoDetectOurItemNot } from '@/lib/classifier';

const ALLOWED_OUR_ITEM_NAMES = [
  'Stay Set - 33KV',
  'Stay Set - 11KV',
  'Rod Earthing',
  'Pipe Earthing',
  'Coil Earthing',
  'Conterpoise Earthing',
  'Fabricated Structures',
  'Danger Plate',
  'Name Plate',
  'Phase Plate',
  'Circuit Plate',
  'Anti-Climbing Device',
  'GI Pipe',
  'GI Wires',
  'Bird Guard',
  'OTHERS',
];

const ALLOWED_TYPES_OF_ITEM = ['CHANNEL', 'ROD', 'PIPE', 'NONE'];

import { getGroqApiKey, saveGroqApiKeyToDb } from '@/lib/groqHelper';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { docketNoQtnNo, itemIds, forceAll, apiKey: customApiKey } = body;

    const apiKey = await getGroqApiKey(customApiKey);
    if (customApiKey && customApiKey.startsWith('gsk_')) {
      await saveGroqApiKeyToDb(customApiKey);
    }
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Groq API Key missing. Please set GROQ_API_KEY in your .env file or provide it in the request.',
        },
        { status: 400 }
      );
    }

    let candidateItems: any[] = [];
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      candidateItems = await prisma.itemTable.findMany({
        where: { id: { in: itemIds } },
      });
    } else if (docketNoQtnNo && docketNoQtnNo.trim()) {
      candidateItems = await prisma.itemTable.findMany({
        where: { docketNoQtnNo: docketNoQtnNo.trim() },
      });
    } else {
      candidateItems = await prisma.itemTable.findMany({
        take: 500,
        orderBy: { id: 'asc' },
      });
    }

    const eligibleItems: any[] = [];
    for (const item of candidateItems) {
      const ourItemNot = (item.ourItemNot || '').trim().toUpperCase();
      // OUR ITEM/NOT automatic fill function is OFF (disabled per user request)
      const isEligibleType = ourItemNot === 'MANUFACTURING' || ourItemNot === 'TRADING';
      const currentOurItemName = (item.ourItemName || '').trim();
      const isBlankPrediction = currentOurItemName === '';

      if (isEligibleType && (isBlankPrediction || forceAll)) {
        eligibleItems.push(item);
      }
    }

    if (eligibleItems.length === 0) {
      return NextResponse.json({
        message: 'No unclassified Manufacturing/Trading items found.',
        updatedCount: 0,
        updatedItems: [],
      });
    }

    // 1. Fetch recent database items that have already been classified by users to serve as real-world exemplars
    const classifiedDbItems = await prisma.itemTable.findMany({
      where: {
        ourItemName: { not: null },
      },
      take: 40,
      orderBy: { updatedAt: 'desc' },
    });

    const validClassifiedDbItems = classifiedDbItems.filter(
      (item: any) => (item.ourItemName || '').trim() !== '' && (item.itemNameParty || '').trim() !== ''
    );

    let dbExemplarsPromptText = '';
    if (validClassifiedDbItems.length > 0) {
      const dbExamplesList = validClassifiedDbItems.map(
        (item: any) =>
          `- Description: "${item.itemNameParty}" -> TYPE OF ITEM: ${item.typeOfItem || 'NONE'} | Our item Name: ${item.ourItemName}`
      );
      dbExemplarsPromptText = `\n\n=== RECENTLY USER-CLASSIFIED DATABASE EXEMPLARS (LEARN PATTERNS FROM THESE) ===\n${dbExamplesList.join('\n')}\n=== END DATABASE EXEMPLARS ===\n`;
    }

    // 2. Fetch all explicit user rules & corrections from master-values in PostgreSQL
    const learnedRulesRecords = await prisma.masterValue.findMany({
      where: { type: 'AI_LEARNING_RULE', isActive: true },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    let learnedKnowledgePromptText = '';
    if (learnedRulesRecords.length > 0) {
      const parsedRules = learnedRulesRecords
        .map((r, index) => {
          try {
            const data = JSON.parse(r.value);
            const rawName = (data.itemNameParty || '').trim();
            const keyTokens = rawName
              .replace(/[\(\)\[\]\{\}\d+\.\,]/g, ' ')
              .split(/\s+/)
              .filter((w: string) => w.length > 2)
              .slice(0, 5)
              .join(', ');

            return `RULE ${index + 1}:
  - Reference Description: "${rawName}"
  - Key Pattern Keywords: [${keyTokens}]
  - Required Target Classification: TYPE OF ITEM = "${data.typeOfItem || 'NONE'}" | Our item Name = "${data.ourItemName}"
  - User Rule & Rationale: "${data.reason || 'Verified classification principle.'}"
  - GENERALIZATION MANDATE: Any present or future item sharing similar electrical hardware keywords (${keyTokens}), structural function, or specifications MUST be classified as "${data.ourItemName}".`;
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      if (parsedRules.length > 0) {
        learnedKnowledgePromptText = `\n\n=== HUMAN USER REVIEWED MANDATE RULES (MUST APPLY PATTERNS TO ALL SIMILAR PRESENT & FUTURE ITEMS) ===
CRITICAL INSTRUCTION: You MUST generalize the following human user rules. Do NOT restrict them to exact text matches! Apply these classification principles and pattern keywords to ALL present and future items that feature similar keywords, electrical specs, or hardware functions:

${parsedRules.join('\n\n')}
=== END MANDATE RULES ===\n`;
      }
    }

    // Process in batches of 15 to avoid context limit issues
    const BATCH_SIZE = 15;
    const updatedItemsResults: any[] = [];

    for (let i = 0; i < eligibleItems.length; i += BATCH_SIZE) {
      const batch = eligibleItems.slice(i, i + BATCH_SIZE);

      const itemsPromptText = batch
        .map(
          (item: any) =>
            `ITEM_ID: ${item.id} | ITEM NAME- PARTY: "${item.itemNameParty || 'N/A'}"`
        )
        .join('\n');

      const systemPrompt = `You are an expert data classification AI for an electrical and infrastructure company. Your task is to categorize raw item descriptions ("ITEM NAME- PARTY") into two specific internal classifications: "TYPE OF ITEM" and "Our item Name".

EXPERT BUSINESS TAXONOMY & PRODUCT CATALOG GUIDE:
1. TRADING PRODUCTS:
   - Pure GI Wires & Stay Wires across standard SWG gauges (e.g. 7/8 SWG, 6 SWG, 7/10 SWG, 10 SWG, 8 SWG) -> "Our item Name" = "GI Wires" (or "GI Pipe").

2. MANUFACTURED PRODUCTS:
   A. Fabricated Steel Structures: Custom steel assemblies, channels (base/top channels), stay clamps, M.S. angles, V-cross arms, DC cross arms, bracings -> "Our item Name" = "Fabricated Structures" (TYPE OF ITEM = "CHANNEL" or "NONE").
   B. Earthing Systems:
      - Pipe Earthing (GI Pipe Earthing, ESE LA structures) -> "Our item Name" = "Pipe Earthing" (TYPE OF ITEM = "PIPE").
      - Rod Earthing (MS Spike Earthing Rod, Pole Rod Earthing) -> "Our item Name" = "Rod Earthing" (TYPE OF ITEM = "ROD").
      - Counterpoise Earthing -> "Our item Name" = "Conterpoise Earthing".
      - Coil Earthing (GI Coil turns) -> "Our item Name" = "Coil Earthing".
   C. Safety Plates & Signage:
      - Danger Boards/Plates (11kV up to 400kV) -> "Our item Name" = "Danger Plate".
      - Name / Number / Isolator Plates -> "Our item Name" = "Name Plate".
      - Phase Plates (RYB) -> "Our item Name" = "Phase Plate".
      - Circuit Plates (C1 & C2) -> "Our item Name" = "Circuit Plate".
   D. Safety & Line Hardware:
      - Bird Guards / LED Bird Diverters -> "Our item Name" = "Bird Guard".
      - Anti-Climbing Devices (Barbed wire with clamps) -> "Our item Name" = "Anti-Climbing Device".
   E. Stay Sets:
      - 11 kV Galvanized Stay Set Complete -> "Our item Name" = "Stay Set - 11KV".
      - 33 kV Galvanized Stay Set Complete -> "Our item Name" = "Stay Set - 33KV".
   F. Heavy Duty GI Pipes: B-Class GI Pipes, ERW Pipes -> "Our item Name" = "GI Pipe" (TYPE OF ITEM = "PIPE").

${learnedKnowledgePromptText}
${dbExemplarsPromptText}

Allowed Categories for 'TYPE OF ITEM':
- CHANNEL
- ROD
- PIPE
- (If none of these apply, output "NONE" or leave blank)

Allowed Categories for 'Our item Name':
- Stay Set - 33KV
- Stay Set - 11KV
- Rod Earthing
- Pipe Earthing
- Coil Earthing
- Conterpoise Earthing
- Fabricated Structures
- Danger Plate
- Name Plate
- Phase Plate
- Circuit Plate
- Anti-Climbing Device
- GI Pipe
- GI Wires
- Bird Guard
- OTHERS

Examples to guide your classification:

Input: "33 kV Galvanized Stay Set Complete 20φX1800 mm. with 2 no. turn-buckles, anchor plate (300x300x8mm) as per scope of work in SBD [Weight: 68 KG/NO]"
Output: TYPE OF ITEM: NONE | Our item Name: Stay Set - 33KV

Input: "Stay set GI 20X1800MM"
Output: TYPE OF ITEM: ROD | Our item Name: Stay Set - 33KV

Input: "Supply and installation of Spike earthing /Earthing Rod MS (20x2500mm) as per IS 3043 complete"
Output: TYPE OF ITEM: NONE | Our item Name: Rod Earthing

Input: "33 KV V-TYPE X-ARM"
Output: TYPE OF ITEM: CHANNEL | Our item Name: Fabricated Structures

Input: "GI Pipe 150 mm dia (Medium)"
Output: TYPE OF ITEM: NONE | Our item Name: GI Pipe

Input: "ESE LA 7 Mtr high mounting structure with GI pipe (PV Field+INV station)"
Output: TYPE OF ITEM: PIPE | Our item Name: Pipe Earthing

Input: "Stay Wire 7/8 SWG [Weight: 0.52 KG/Mtr]"
Output: TYPE OF ITEM: NONE | Our item Name: GI Wires

Input: "33 kV Danger board with clamp Bolts & Nuts [Weight: 3 KG/NO]"
Output: TYPE OF ITEM: NONE | Our item Name: Danger Plate

Input: "Anti-Climbing Device (2.5mm dia (12SWG) galvanized barbed wire 3.5 m per pole)"
Output: TYPE OF ITEM: NONE | Our item Name: Anti-Climbing Device

Instructions:
1. Analyze each provided item.
2. Determine the best matching "Our item Name" strictly from the allowed list.
3. Determine if a "TYPE OF ITEM" (CHANNEL, ROD, PIPE) is explicitly mentioned or strongly implied as the core raw material shape. If not, output NONE.
4. Output the result strictly in the following format for each item without extra conversational text:
ITEM_ID: [id] | TYPE OF ITEM: [Value] | Our item Name: [Value]`;

      const userPrompt = `Classify the following items:\n\n${itemsPromptText}`;

      // Active Groq Models array in priority order
      const candidateModels = [
        'groq/compound',
        'groq/compound-mini',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.1-8b-instant',
      ];

      let groqRes: Response | null = null;
      let lastErrorText = '';

      for (const modelName of candidateModels) {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey.trim()}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0',
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.1,
              max_tokens: 1500,
            }),
          });

          if (res.ok) {
            groqRes = res;
            break;
          } else {
            lastErrorText = await res.text();
            console.warn(`Groq Model "${modelName}" failed (${res.status}):`, lastErrorText);
            if (
              lastErrorText.includes('invalid_api_key') ||
              lastErrorText.includes('do not have access to it') ||
              lastErrorText.includes('model_not_found') ||
              res.status === 401
            ) {
              console.error('❌ GROQ API KEY INVALID OR EXPIRED!');
              return NextResponse.json(
                {
                  error:
                    'Your Groq API Key is invalid or expired. Please generate a new free API key at https://console.groq.com/keys and update your GROQ_API_KEY in .env or enter it in the dashboard.',
                },
                { status: 401 }
              );
            }
          }
        } catch (e: any) {
          console.warn(`Groq Model "${modelName}" fetch error:`, e.message);
        }
      }

      if (!groqRes) {
        console.error('All Groq AI models failed. Last Error:', lastErrorText);
        return NextResponse.json(
          { error: `Groq AI API error: ${lastErrorText || 'Failed to reach Groq API'}` },
          { status: 500 }
        );
      }

      const groqData = await groqRes.json();
      const aiResponseText = groqData.choices?.[0]?.message?.content || '';

      // Parse AI output line by line
      const lines = aiResponseText.split('\n');
      for (const line of lines) {
        const match = line.match(/ITEM_ID:\s*(\d+)\s*\|\s*TYPE OF ITEM:\s*([^|]+)\s*\|\s*Our item Name:\s*(.+)/i);
        if (match) {
          const itemId = parseInt(match[1], 10);
          let rawTypeOfItem = match[2].trim().toUpperCase();
          let rawOurItemName = match[3].trim();

          // Validate and sanitize TYPE OF ITEM
          let finalTypeOfItem = ALLOWED_TYPES_OF_ITEM.includes(rawTypeOfItem)
            ? rawTypeOfItem === 'NONE'
              ? null
              : rawTypeOfItem
            : null;

          // Validate and sanitize Our item Name
          let finalOurItemName = ALLOWED_OUR_ITEM_NAMES.find(
            (name) => name.toLowerCase() === rawOurItemName.toLowerCase()
          );

          if (!finalOurItemName) {
            // Fallback fuzzy matching if AI returned slight variation
            if (rawOurItemName.toLowerCase().includes('stay set')) {
              finalOurItemName = rawOurItemName.toLowerCase().includes('33')
                ? 'Stay Set - 33KV'
                : 'Stay Set - 11KV';
            } else if (rawOurItemName.toLowerCase().includes('earthing')) {
              if (rawOurItemName.toLowerCase().includes('rod')) finalOurItemName = 'Rod Earthing';
              else if (rawOurItemName.toLowerCase().includes('pipe')) finalOurItemName = 'Pipe Earthing';
              else if (rawOurItemName.toLowerCase().includes('coil')) finalOurItemName = 'Coil Earthing';
              else finalOurItemName = 'Conterpoise Earthing';
            } else if (rawOurItemName.toLowerCase().includes('plate') || rawOurItemName.toLowerCase().includes('board')) {
              if (rawOurItemName.toLowerCase().includes('danger')) finalOurItemName = 'Danger Plate';
              else if (rawOurItemName.toLowerCase().includes('phase')) finalOurItemName = 'Phase Plate';
              else if (rawOurItemName.toLowerCase().includes('circuit')) finalOurItemName = 'Circuit Plate';
              else finalOurItemName = 'Name Plate';
            } else if (rawOurItemName.toLowerCase().includes('wire')) {
              finalOurItemName = 'GI Wires';
            } else if (rawOurItemName.toLowerCase().includes('pipe')) {
              finalOurItemName = 'GI Pipe';
            } else if (rawOurItemName.toLowerCase().includes('bird')) {
              finalOurItemName = 'Bird Guard';
            } else if (rawOurItemName.toLowerCase().includes('anti')) {
              finalOurItemName = 'Anti-Climbing Device';
            } else {
              finalOurItemName = 'Fabricated Structures';
            }
          }

          if (itemId) {
            // Update Database record
            const updatedItem = await prisma.itemTable.update({
              where: { id: itemId },
              data: {
                ourItemName: finalOurItemName,
                typeOfItem: finalTypeOfItem,
              },
            });

            // Log AI Edit
            await prisma.editLog.create({
              data: {
                tableName: 'iteam-table',
                recordId: itemId,
                fieldName: 'AI_AUTOFILL',
                oldValue: 'Blank / Unclassified',
                newValue: `Set Our item Name: "${finalOurItemName}", Type: "${finalTypeOfItem || 'N/A'}" (by Groq AI)`,
              },
            });

            updatedItemsResults.push(updatedItem);
          }
        }
      }
    }

    return NextResponse.json({
      message: `AI Autofill complete! Categorized ${updatedItemsResults.length} items.`,
      updatedCount: updatedItemsResults.length,
      updatedItems: updatedItemsResults,
    });
  } catch (error: any) {
    console.error('Error in AI categorize endpoint:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process AI categorization' },
      { status: 500 }
    );
  }
}
