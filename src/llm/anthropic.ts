import type Anthropic from '@anthropic-ai/sdk';
import { buildUserMessage, JSON_INSTRUCTIONS, parseSentences, RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt';
import { AiError, type AiRequest, type AiSentence, type AiSettings, type Provider } from './types';

/**
 * Claude, called straight from the browser with the person's own key through
 * the official SDK. There is no server of ours in between: the key and the
 * words go from this device to Anthropic and nowhere else.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Models that accept `effort` and a response schema. Other ids get a plain request. */
function isCurrentFamily(model: string): boolean {
  return /^claude-(opus-5|sonnet-5|haiku-5|fable-5|mythos-5)/.test(model);
}

/**
 * Models where a declined request can be retried on another model server-side.
 * Without this a safety classifier could leave someone with no suggestion at all
 * for a sentence they have every right to say.
 */
function supportsFallback(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}

/**
 * The instructions are the same on every request, so they are marked for
 * caching: while someone is talking, each request after the first reads them
 * at a small fraction of the normal price. (A prompt too short for a given
 * model to cache is simply sent as usual.)
 */
const SYSTEM = [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }];

type AnthropicModule = typeof import('@anthropic-ai/sdk');
let sdk: Promise<AnthropicModule> | undefined;

/** The SDK is only downloaded when someone actually turns Claude on. */
function loadSdk(): Promise<AnthropicModule> {
  sdk ??= import('@anthropic-ai/sdk');
  return sdk;
}

async function createClient(settings: AiSettings): Promise<{ client: Anthropic; module: AnthropicModule }> {
  if (!settings.apiKey.trim()) throw new AiError('config', 'Add an API key first.');
  const module = await loadSdk();
  const client = new module.default({
    apiKey: settings.apiKey.trim(),
    // Deliberate: this is a bring-your-own-key app with no backend. The key is the
    // user's own, stays in their browser, and the page loads no third-party scripts.
    dangerouslyAllowBrowser: true,
    // Suggestions are latency-sensitive and the on-device engine is always there
    // as a fallback, so fail fast instead of retrying.
    maxRetries: 0,
    timeout: settings.timeoutMs,
  });
  return { client, module };
}

function toAiError(error: unknown, module: AnthropicModule): AiError {
  if (error instanceof AiError) return error;
  const Sdk = module.default;
  if (error instanceof Sdk.APIUserAbortError) return new AiError('aborted', 'Cancelled.');
  if (error instanceof Sdk.AuthenticationError || error instanceof Sdk.PermissionDeniedError) {
    return new AiError('auth', 'Anthropic did not accept this API key.', error.status);
  }
  if (error instanceof Sdk.NotFoundError) {
    return new AiError('model', 'That model is not available to this key.', error.status);
  }
  if (error instanceof Sdk.RateLimitError) {
    return new AiError('limit', 'Too many requests right now, or the account has hit its limit.', error.status);
  }
  if (error instanceof Sdk.APIConnectionTimeoutError) return new AiError('timeout', 'Claude took too long to answer.');
  if (error instanceof Sdk.APIConnectionError) {
    return new AiError('network', 'Could not reach Anthropic. Check the internet connection.');
  }
  if (error instanceof Sdk.BadRequestError) {
    // Billing problems (for example an empty credit balance) arrive here; the message says which.
    return new AiError('response', error.message, error.status);
  }
  if (error instanceof Sdk.APIError) {
    return new AiError('server', error.message || 'Anthropic had a problem. Try again shortly.', error.status);
  }
  return new AiError('network', error instanceof Error ? error.message : 'Something went wrong calling Claude.');
}

async function suggest(request: AiRequest, settings: AiSettings, signal: AbortSignal): Promise<AiSentence[]> {
  const { client, module } = await createClient(settings);
  const model = settings.model.trim() || anthropicProvider.defaultModel;
  const current = isCurrentFamily(model);
  const userText = current ? buildUserMessage(request) : `${buildUserMessage(request)}\n\n${JSON_INSTRUCTIONS}`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }];

  // Thinking stays at its default (adaptive); `effort: low` keeps this short
  // rewriting task fast. Sampling parameters are deliberately not sent.
  const outputConfig: Anthropic.OutputConfig | undefined = current
    ? { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } }
    : undefined;

  try {
    let stopReason: string | null;
    let content: { type: string; text?: string }[];
    if (supportsFallback(model)) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 2048,
          system: SYSTEM,
          messages,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          ...(outputConfig ? { output_config: outputConfig } : {}),
        },
        { signal },
      );
      stopReason = response.stop_reason;
      content = response.content;
    } else {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 2048,
          system: SYSTEM,
          messages,
          ...(outputConfig ? { output_config: outputConfig } : {}),
        },
        { signal },
      );
      stopReason = response.stop_reason;
      content = response.content;
    }

    // Always check why the model stopped before trusting the content.
    if (stopReason === 'refusal') throw new AiError('refused', 'Claude declined to rewrite this one.');
    const text = content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    const sentences = parseSentences(text, request.max);
    if (sentences.length === 0) {
      throw new AiError('response', stopReason === 'max_tokens' ? 'The reply was cut off.' : 'The reply could not be read.');
    }
    return sentences;
  } catch (error) {
    throw toAiError(error, module);
  }
}

async function listModels(settings: AiSettings, signal: AbortSignal): Promise<string[]> {
  const { client, module } = await createClient(settings);
  try {
    const ids: string[] = [];
    for await (const model of client.models.list({}, { signal })) ids.push(model.id);
    return ids;
  } catch (error) {
    throw toAiError(error, module);
  }
}

export const anthropicProvider: Provider = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  keyUrl: 'https://platform.claude.com/settings/keys',
  keyHint: 'Starts with sk-ant-',
  // The default is the fast, inexpensive model: turning shorthand into a sentence
  // is a small job, the answer is wanted within a second, and the person or their
  // family is paying for every suggestion. The larger models are one tap away.
  defaultModel: 'claude-haiku-5-5',
  models: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and by far the cheapest: a small fraction of a cent a suggestion. Plenty for most messages.' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Understands more. About twenty times the cost of Haiku.' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Understands the most. Slowest, and about forty times the cost of Haiku: roughly a cent a suggestion.' },
  ],
  needsBaseUrl: false,
  suggest,
  listModels,
};
