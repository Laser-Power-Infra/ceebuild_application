import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getGroqApiKey, saveGroqApiKeyToDb } from '@/lib/groqHelper';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { itemNameParty, typeOfItem, selectedCategory, saveToKnowledge, userReason, apiKey: customApiKey } = body;

    if (!itemNameParty || !selectedCategory) {
      return NextResponse.json({ error: 'Missing itemNameParty or selectedCategory' }, { status: 400 });
    }

    // If saving user feedback/reasoning to AI Knowledge base in PostgreSQL
    if (saveToKnowledge) {
      const ruleValue = JSON.stringify({
        itemNameParty: itemNameParty.trim(),
        typeOfItem: (typeOfItem || 'NONE').trim(),
        ourItemName: selectedCategory.trim(),
        reason: (userReason || 'Manual user override classification').trim(),
      });

      const newRule = await prisma.masterValue.create({
        data: {
          type: 'AI_LEARNING_RULE',
          value: ruleValue,
          isActive: true,
        },
      });

      await prisma.editLog.create({
        data: {
          tableName: 'master-values',
          recordId: newRule.id,
          fieldName: 'TEACH_AI_RULE',
          oldValue: null,
          newValue: `Taught AI Rule for "${itemNameParty}": ${selectedCategory} (Reason: ${userReason || 'N/A'})`,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Saved to AI Knowledge Base. AI will use this rule for future categorizations!',
        ruleId: newRule.id,
      });
    }

    // Otherwise generate auto-reasoning using Groq AI
    const apiKey = await getGroqApiKey(customApiKey);
    if (customApiKey && customApiKey.startsWith('gsk_')) {
      await saveGroqApiKeyToDb(customApiKey);
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Groq API Key is missing. Please enter your Groq API key in Settings or update GROQ_API_KEY in .env.' },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an expert data classification AI for an electrical and infrastructure company.
Your task is to provide a brief, 1-2 sentence factual explanation of why the given raw item description falls under the category "${selectedCategory}".

CRITICAL INSTRUCTIONS:
1. Base your explanation strictly and only on the factual text provided in the raw description.
2. DO NOT HALLUCINATE any dimensions, specifications, materials, or details not stated in the item description.
3. If the item is categorized as "OTHERS", explain what specific electrical/infrastructure hardware or fitting it represents based on the text.
4. Keep the explanation under 40 words, objective, and professional.`;

    const userPrompt = `Item Description: "${itemNameParty}"
Type of Item: "${typeOfItem || 'N/A'}"
Assigned Category: "${selectedCategory}"

Explain the categorization reason concisely:`;

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
            max_tokens: 150,
          }),
        });

        if (res.ok) {
          groqRes = res;
          break;
        } else {
          lastErrorText = await res.text();
          console.warn(`Explain Groq Model "${modelName}" failed:`, lastErrorText);
        }
      } catch (e: any) {
        console.warn(`Explain Groq Model "${modelName}" error:`, e.message);
      }
    }

    if (!groqRes) {
      return NextResponse.json(
        { error: `Groq AI API error: ${lastErrorText || 'Failed to reach Groq API'}` },
        { status: 500 }
      );
    }

    const groqData = await groqRes.json();
    const reasoning = groqData.choices?.[0]?.message?.content?.trim() || 'Categorized based on raw item text.';

    return NextResponse.json({ reasoning });
  } catch (error: any) {
    console.error('Error in /api/ai/explain:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
