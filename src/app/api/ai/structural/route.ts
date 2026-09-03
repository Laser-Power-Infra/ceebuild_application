import { NextResponse } from 'next/server';

const GROQ_MODELS = [
  'groq/compound',
  'groq/compound-mini',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

function extractStructuralOptionsFromAiText(text: string) {
  const options: any[] = [];
  if (!text || typeof text !== 'string') return options;

  // 1. Try parsing JSON directly or within markdown ```json ... ``` blocks
  try {
    let cleanJsonText = text.trim();
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonBlockMatch) {
      cleanJsonText = jsonBlockMatch[1].trim();
    }

    const parsed = JSON.parse(cleanJsonText);
    const rawList = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.options)
      ? parsed.options
      : [];

    for (const item of rawList) {
      if (item && (item.sectionCode || item['Section Code'] || item.code)) {
        const secCode = (
          item.sectionCode ||
          item['Section Code'] ||
          item.code ||
          ''
        )
          .toString()
          .trim();
        const secWt = (
          item.sectionalWtKgMtr ||
          item['Sectional Wt. (Kg/Mtr.)'] ||
          item.sectionalWt ||
          item.wt ||
          ''
        )
          .toString()
          .trim();
        const len = (
          item.lengthMtr ||
          item['Length (Mtr.)'] ||
          item.length ||
          ''
        )
          .toString()
          .trim();
        const numSecWt = parseFloat(secWt) || 0;
        const numLen = parseFloat(len) || 0;
        const unitWt = (
          item.unitWtKg ||
          item.unitWt ||
          (numSecWt * numLen).toFixed(2)
        )
          .toString()
          .trim();

        if (secCode) {
          options.push({
            sectionCode: secCode,
            sectionalWtKgMtr: secWt,
            lengthMtr: len,
            unitWtKg: unitWt,
          });
        }
      }
    }
    if (options.length > 0) return options;
  } catch (e) {
    // Continue to table parser if JSON parse fails
  }

  // 2. Try parsing Markdown Table lines
  const lines = text.split('\n');
  for (const line of lines) {
    if (
      line.includes('|') &&
      !line.includes('---') &&
      !line.toLowerCase().includes('section code')
    ) {
      const parts = line
        .split('|')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length >= 3) {
        const secCode = parts[0];
        const secWt = parts[1];
        const len = parts[2];
        const numSecWt = parseFloat(secWt) || 0;
        const numLen = parseFloat(len) || 0;
        const unitWt = (numSecWt * numLen).toFixed(2);

        if (secCode && !secCode.toLowerCase().includes('section')) {
          options.push({
            sectionCode: secCode,
            sectionalWtKgMtr: secWt,
            lengthMtr: len,
            unitWtKg: unitWt,
          });
        }
      }
    }
  }

  return options;
}

export async function POST(req: Request) {
  let rawDescription = '';
  try {
    const body = await req.json();
    const { itemNameParty, apiKey: customApiKey } = body;

    if (!itemNameParty || !itemNameParty.trim()) {
      return NextResponse.json(
        { error: 'Item Description is required' },
        { status: 400 }
      );
    }

    rawDescription = itemNameParty.trim();
    const apiKey = (customApiKey || process.env.GROQ_API_KEY || '')
      .replace(/^["']|["']$/g, '')
      .trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Groq API Key is missing. Please set GROQ_API_KEY or enter your API key in Settings.' },
        { status: 400 }
      );
    }

    const systemPrompt = `Act as an Expert Indian Substation Structural Engineer and Draftsman familiar with standard REC, PFC, and State Utility structural drawings (11kV/33kV DP structures, AIS/GIS gantries).

For every "Item Description" I provide:
1. Identify primary structural members commonly used in Indian utility designs (MUST evaluate and include MS Flat / ISF alongside ISA angles, ISMC channels, etc.).
2. For each applicable member, calculate the Sectional Weight strictly as per IS 808.
3. Assume standard REC/utility cut lengths.
4. Output multiple valid standard options in a clean table containing EXACTLY these three columns:
   - Section Code
   - Sectional Wt. (Kg/Mtr.)
   - Length (Mtr.)

Rules:
- Output ONLY the requested 3 columns in Markdown table format.
- Do NOT break down into sub-components, cleats, or plates (Single main line item per row option).
- Format Section Code strictly as [PROFILE].[DIMENSIONS] (e.g., FL.50X8, AN.50X50X6, CH.75X40). Do NOT append sectional weights or cut lengths inside the Section Code string itself to prevent decimal parsing errors.
- Always include at least one MS Flat (FL) option for clamps, brackets, tie pieces, cable supports, pipe supports, and earthing components.
- Keep Sectional Weight (e.g., 3.14) and Length (e.g., 0.687) strictly isolated inside their respective table columns so they align directly with system UI input fields.
- Provide all standard and alternative structural section options commonly used for the given description.`;

    const promptMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'assistant', content: 'Master Prompt Activated. Please provide your first Item Description.' },
      { role: 'user', content: rawDescription },
    ];

    let lastErrorText = '';
    let aiResponseText = '';

    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0',
          },
          body: JSON.stringify({
            model: model,
            messages: promptMessages,
            temperature: 0.1,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          aiResponseText = data.choices?.[0]?.message?.content || '';
          if (aiResponseText) break;
        } else {
          lastErrorText = await res.text();
          console.warn(`Groq Model ${model} failed (${res.status}): ${lastErrorText}`);
          if (
            lastErrorText.includes('invalid_api_key') ||
            lastErrorText.includes('do not have access to it') ||
            lastErrorText.includes('model_not_found') ||
            res.status === 401
          ) {
            console.error('❌ GROQ API KEY INVALID OR EXPIRED! Key sent:', apiKey.substring(0, 10) + '...');
            return NextResponse.json(
              {
                error:
                  'Your Groq API Key is invalid or expired. Please generate a new free API key at https://console.groq.com/keys and update GROQ_API_KEY in your .env file or enter it in the dashboard popup.',
              },
              { status: 401 }
            );
          }
        }
      } catch (err: any) {
        console.warn(`Fetch error for model ${model}:`, err.message);
      }
    }

    if (!aiResponseText) {
      return NextResponse.json(
        {
          error: `Groq AI Call Failed. ${lastErrorText}`,
        },
        { status: 500 }
      );
    }

    const options = extractStructuralOptionsFromAiText(aiResponseText);

    return NextResponse.json({
      itemNameParty: rawDescription,
      rawAiText: aiResponseText,
      options: options,
    });
  } catch (error: any) {
    console.error('Error in AI Structural calculation API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute Groq AI calculation' },
      { status: 500 }
    );
  }
}
