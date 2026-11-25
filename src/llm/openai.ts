import { joinUrl, requestJson } from './http';
import { buildUserMessage, JSON_INSTRUCTIONS, parseSentences, RESPONSE_SCHEMA, systemPromptFor } from './prompt';
import { AiError, type AiRequest, type AiSentence, type AiSettings, type Provider } from './types';

/**
 * OpenAI, and anything that speaks the same Chat Completions protocol: OpenRouter,
 * Groq, Together, and models running on the person's own machine through Ollama
 * or LM Studio (which keeps every word on their own hardware).
 */

const OPENAI_BASE = 'https://api.openai.com/v1';

interface ChatReply {
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[];
}

function contentOf(reply: ChatReply): string {
  const message = reply.choices?.[0]?.message;
  if (typeof message?.refusal === 'string' && message.refusal) {
    throw new AiError('refused', 'The model declined to rewrite this one.');
  }
  const content = message?.content;
  if (typeof content === 'string') return content;
  // Some servers return content as a list of parts.
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function headersFor(settings: AiSettings): Record<string, string> {
  const key = settings.apiKey.trim();
  // A local server usually needs no key at all.
  return key ? { authorization: `Bearer ${key}` } : {};
}

function makeProvider(options: {
  id: 'openai' | 'compatible';
  label: string;
  who: string;
  strict: boolean;
}): Pick<Provider, 'suggest' | 'listModels'> {
  const baseFor = (settings: AiSettings): string => {
    if (options.id === 'openai') return OPENAI_BASE;
    const base = settings.baseUrl.trim();
    if (!base) throw new AiError('config', 'Add the server address first.');
    if (!/^https?:\/\//i.test(base)) throw new AiError('config', 'The server address must start with http:// or https://');
    return base;
  };

  async function suggest(request: AiRequest, settings: AiSettings, signal: AbortSignal): Promise<AiSentence[]> {
    if (options.id === 'openai' && !settings.apiKey.trim()) throw new AiError('config', 'Add an API key first.');
    const model = settings.model.trim();
    if (!model) throw new AiError('config', 'Choose a model first.');
    const url = joinUrl(baseFor(settings), 'chat/completions');
    const messages = [
      { role: 'system', content: systemPromptFor(request) },
      { role: 'user', content: `${buildUserMessage(request)}\n\n${JSON_INSTRUCTIONS}` },
    ];

    // OpenAI enforces the schema. Other servers vary, so they are asked for plain
    // JSON, and if even that is rejected the request is repeated without it: the
    // instructions and a tolerant parser still do the job.
    const formats: unknown[] = options.strict
      ? [{ type: 'json_schema', json_schema: { name: 'suggestions', strict: true, schema: RESPONSE_SCHEMA } }]
      : [{ type: 'json_object' }, undefined];

    let lastError: unknown;
    for (const format of formats) {
      const body: Record<string, unknown> = { model, messages };
      if (format) body.response_format = format;
      // Sampling parameters are left at the provider's defaults: several current
      // models reject anything else.
      if (options.strict) body.max_completion_tokens = 2048;
      else body.max_tokens = 1024;
      try {
        const reply = (await requestJson(url, { method: 'POST', headers: headersFor(settings), body }, signal, options.who)) as ChatReply;
        const sentences = parseSentences(contentOf(reply), request.max);
        if (sentences.length === 0) throw new AiError('response', 'The reply could not be read.');
        return sentences;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof AiError && error.kind === 'response' && error.status === 400 && format !== undefined;
        if (!retryable) throw error;
      }
    }
    throw lastError;
  }

  async function listModels(settings: AiSettings, signal: AbortSignal): Promise<string[]> {
    const url = joinUrl(baseFor(settings), 'models');
    const reply = (await requestJson(url, { method: 'GET', headers: headersFor(settings) }, signal, options.who)) as {
      data?: { id?: unknown }[];
    };
    const ids = (reply.data ?? []).map((model) => model.id).filter((id): id is string => typeof id === 'string');
    return options.id === 'openai' ? ids.filter(isChatModel).sort(byPreference) : ids.sort();
  }

  return { suggest, listModels };
}

/** OpenAI's list mixes in image, audio and embedding models; keep the text ones. */
function isChatModel(id: string): boolean {
  if (!/^(gpt-|o\d|chatgpt)/.test(id)) return false;
  return !/(audio|realtime|image|tts|transcribe|embedding|search|moderation|instruct|codex|whisper|dall)/.test(id);
}

/** Small, fast models first: this task does not need the largest one. */
function byPreference(a: string, b: string): number {
  const rank = (id: string) => (/(mini)/.test(id) ? 0 : /(nano)/.test(id) ? 1 : 2);
  return rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true });
}

export const openaiProvider: Provider = {
  id: 'openai',
  label: 'OpenAI',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'Starts with sk-',
  // Left empty on purpose: model names change often, so the app looks up what
  // the key can use and picks from that list instead of shipping a stale name.
  defaultModel: '',
  models: [],
  needsBaseUrl: false,
  ...makeProvider({ id: 'openai', label: 'OpenAI', who: 'OpenAI', strict: true }),
};

export const compatibleProvider: Provider = {
  id: 'compatible',
  label: 'Other (OpenAI-compatible)',
  keyUrl: '',
  keyHint: 'Leave empty for a model running on this device',
  defaultModel: '',
  models: [],
  needsBaseUrl: true,
  ...makeProvider({ id: 'compatible', label: 'Other', who: 'the server', strict: false }),
};
