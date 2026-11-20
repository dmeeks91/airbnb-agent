import { GoogleGenAI, Type } from '@google/genai';
import type { RuleCategory } from '../../types/haven.ts';

export interface VertexDraftOutput {
  agentComment: string;
  coachNote: string;
  draftReply: string;
}

export interface VertexExtractedFact {
  topic: string;
  value: string;
  category: RuleCategory;
}

let cachedClient: GoogleGenAI | null = null;

export function getVertexModelId(): string {
  return process.env.VERTEX_MODEL_ID?.trim() || 'gemini-2.5-flash';
}

export function isVertexConfigured(): boolean {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim() || '';
  const hasRuntimeAuth = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.K_SERVICE?.trim(),
  );
  return Boolean(project && hasRuntimeAuth);
}

function getVertexClient(): GoogleGenAI | null {
  if (!isVertexConfigured()) {
    return null;
  }
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT?.trim(),
    location: process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'us-central1',
  });
  return cachedClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRuleCategory(value: unknown): RuleCategory {
  if (
    value === 'Access & Arrival' ||
    value === 'Timings & Rates' ||
    value === 'Amenities & Rules'
  ) {
    return value;
  }
  return 'Amenities & Rules';
}

export async function generateDraftWithVertex(params: {
  systemInstruction: string;
  userPrompt: string;
}): Promise<VertexDraftOutput | null> {
  const client = getVertexClient();
  if (!client) {
    return null;
  }

  const response = await client.models.generateContent({
    model: getVertexModelId(),
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          agentComment: { type: Type.STRING },
          coachNote: { type: Type.STRING },
          draftReply: { type: Type.STRING },
        },
        required: ['agentComment', 'coachNote', 'draftReply'],
      },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    return null;
  }

  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || typeof parsed.draftReply !== 'string') {
    return null;
  }

  return {
    agentComment:
      typeof parsed.agentComment === 'string'
        ? parsed.agentComment
        : 'Draft prepared from active house rules.',
    coachNote: typeof parsed.coachNote === 'string' ? parsed.coachNote : '',
    draftReply: parsed.draftReply,
  };
}

export async function extractFactsWithVertex(params: {
  propertyName: string;
  textContent?: string;
  pdfBuffer?: Buffer;
}): Promise<VertexExtractedFact[] | null> {
  const client = getVertexClient();
  if (!client) {
    return null;
  }

  const promptText = [
    `Extract structured short-term rental operational rules for property "${params.propertyName}".`,
    'Categorize each rule strictly into one of: "Access & Arrival", "Timings & Rates", or "Amenities & Rules".',
    'Keep each value concise, factual, and directly quotable by a co-host.',
    params.textContent ? `\nSource text:\n${params.textContent}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contents = params.pdfBuffer
    ? [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: params.pdfBuffer.toString('base64'),
              },
            },
          ],
        },
      ]
    : promptText;

  const response = await client.models.generateContent({
    model: getVertexModelId(),
    contents,
    config: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          rules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                value: { type: Type.STRING },
                category: {
                  type: Type.STRING,
                  enum: ['Access & Arrival', 'Timings & Rates', 'Amenities & Rules'],
                },
              },
              required: ['topic', 'value', 'category'],
            },
          },
        },
        required: ['rules'],
      },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    return null;
  }

  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
    return null;
  }

  const results: VertexExtractedFact[] = [];
  for (const item of parsed.rules) {
    if (!isRecord(item)) {
      continue;
    }
    const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
    const value = typeof item.value === 'string' ? item.value.trim() : '';
    if (!topic || !value) {
      continue;
    }
    results.push({
      topic,
      value,
      category: parseRuleCategory(item.category),
    });
  }

  return results;
}
