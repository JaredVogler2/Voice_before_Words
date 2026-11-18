import { requestJson } from './http';
import { buildUserMessage, JSON_INSTRUCTIONS, parseSentences, SYSTEM_PROMPT } from './prompt';
import { AiError, type AiRequest, type AiSentence, type AiSettings, type Provider } from './types';

/** Google Gemini through the Generative Language API. Has a free tier, which matters for a free app. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiReply {
  candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** The reply shape in Gemini's own schema dialect. */
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['want', 'say', 'now', 'past', 'future', 'ask', 'tell'] },
        },
        required: ['text', 'kind'],
      },
    },
  },
  required: ['suggestions'],
};

function headersFor(settings: AiSettings): Record<string, string> {
  const key = settings.apiKey.trim();
  if (!key) throw new AiError('config', 'Add an API key first.');
  // Sent as a header, never in the URL, so it cannot end up in history or logs.
  return { 'x-goog-api-key': key };
}

function modelPath(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

async function suggest(request: AiRequest, settings: AiSettings, signal: AbortSignal): Promise<AiSentence[]> {
  const headers = headersFor(settings);
  const model = settings.model.trim();
  if (!model) throw new AiError('config', 'Choose a model first.');
  const url = `${BASE}/${modelPath(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: `${buildUserMessage(request)}\n\n${JSON_INSTRUCTIONS}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_SCHEMA,
      maxOutputTokens: 2048,
    },
  };
  const reply = (await requestJson(url, { method: 'POST', headers, body }, signal, 'Google')) as GeminiReply;

  if (reply.promptFeedback?.blockReason) throw new AiError('refused', 'Gemini declined to rewrite this one.');
  const candidate = reply.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
  const sentences = parseSentences(text, request.max);
  if (sentences.length > 0) return sentences;
  const reason = candidate?.finishReason ?? '';
  if (/SAFETY|BLOCK|PROHIBITED|RECITATION/.test(reason)) throw new AiError('refused', 'Gemini declined to rewrite this one.');
  throw new AiError('response', reason === 'MAX_TOKENS' ? 'The reply was cut off.' : 'The reply could not be read.');
}

async function listModels(settings: AiSettings, signal: AbortSignal): Promise<string[]> {
  const headers = headersFor(settings);
  const reply = (await requestJson(`${BASE}/models?pageSize=200`, { method: 'GET', headers }, signal, 'Google')) as {
    models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
  };
  const ids: string[] = [];
  for (const model of reply.models ?? []) {
    if (typeof model.name !== 'string') continue;
    const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
    if (!methods.includes('generateContent')) continue;
    const id = model.name.replace(/^models\//, '');
    if (/(embedding|image|tts|audio|live|vision|aqa|imagen|veo|robotics|computer-use)/.test(id)) continue;
    ids.push(id);
  }
  return ids.sort(byPreference);
}

/** Quick "flash" models first, newest version first, previews after stable releases. */
function byPreference(a: string, b: string): number {
  const rank = (id: string) =>
    (/flash/.test(id) && !/lite/.test(id) ? 0 : /flash/.test(id) ? 1 : 2) + (/(preview|exp|latest)/.test(id) ? 0.5 : 0);
  return rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true });
}

export const geminiProvider: Provider = {
  id: 'google',
  label: 'Gemini (Google)',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyHint: 'From Google AI Studio',
  // Looked up from the key rather than hard-coded; see openai.ts.
  defaultModel: '',
  models: [],
  needsBaseUrl: false,
  suggest,
  listModels,
};
