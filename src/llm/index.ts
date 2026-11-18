import type { Suggestion } from '../language/types';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { compatibleProvider, openaiProvider } from './openai';
import { AiError, type AiRequest, type AiSettings, type Provider, type ProviderId } from './types';

export { AiError } from './types';
export type { AiErrorKind, AiRequest, AiSettings, ModelOption, Provider, ProviderId } from './types';

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: geminiProvider,
  compatible: compatibleProvider,
};

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'google', 'openai', 'compatible'];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'anthropic',
  apiKey: '',
  model: anthropicProvider.defaultModel,
  baseUrl: '',
  shareHistory: true,
  shareProfile: true,
  timeoutMs: 8000,
};

/** Whether there is enough configuration to make a call at all. */
export function isAiReady(settings: AiSettings): boolean {
  if (!settings.enabled) return false;
  const provider = PROVIDERS[settings.provider];
  if (!provider) return false;
  if (provider.needsBaseUrl) return !!settings.baseUrl.trim() && !!settings.model.trim();
  return !!settings.apiKey.trim() && !!(settings.model.trim() || provider.defaultModel);
}

/**
 * Run a provider call with a deadline. The caller's signal cancels it too (a
 * newer message supersedes an older request), and the two cases are told apart
 * so that only a real timeout is ever reported.
 */
async function withDeadline<T>(
  timeoutMs: number,
  outer: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) throw new AiError('timeout', 'The AI took too long to answer.');
    if (outer?.aborted) throw new AiError('aborted', 'Cancelled.');
    if (error instanceof AiError) throw error;
    throw new AiError('network', error instanceof Error ? error.message : 'Something went wrong.');
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Ask the configured provider for sentence suggestions. Rejects with an `AiError`. */
export async function aiSuggest(request: AiRequest, settings: AiSettings, signal?: AbortSignal): Promise<Suggestion[]> {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new AiError('config', 'Unknown AI provider.');
  if (request.words.length === 0) return [];
  const filtered: AiRequest = {
    ...request,
    history: settings.shareHistory ? request.history : [],
    about: settings.shareProfile ? request.about : '',
  };
  const sentences = await withDeadline(settings.timeoutMs, signal, (inner) => provider.suggest(filtered, settings, inner));
  return sentences.map((sentence) => ({ text: sentence.text, kind: sentence.kind, source: 'ai' as const }));
}

/** Models the current key can use, best pick first. Empty when the provider cannot list them. */
export async function listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const provider = PROVIDERS[settings.provider];
  if (!provider?.listModels) return [];
  return withDeadline(Math.max(settings.timeoutMs, 10000), signal, (inner) => provider.listModels!(settings, inner));
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  /** A model chosen for the person when they had none set (or theirs was not found). */
  model?: string;
  /** What the provider made of a sample, so the person can hear the difference for themselves. */
  sample?: string;
  milliseconds?: number;
}

const SAMPLE: AiRequest = {
  words: ['I', 'go', 'bathroom'],
  history: [],
  about: '',
  partnerSaid: '',
  max: 3,
  contractions: true,
};

/**
 * Check the key by doing the real thing once: a small suggestion request.
 * If no model is set, look up what the key can use and pick a sensible one.
 */
export async function testConnection(settings: AiSettings, signal?: AbortSignal): Promise<ConnectionTest> {
  const provider = PROVIDERS[settings.provider];
  const active: AiSettings = { ...settings, enabled: true, timeoutMs: Math.max(settings.timeoutMs, 20000) };
  let chosen: string | undefined;
  try {
    if (!active.model.trim() && !provider.defaultModel) {
      const available = await listModels(active, signal);
      if (available.length === 0) {
        return { ok: false, message: 'Connected, but no usable model was found. Type a model name and try again.' };
      }
      chosen = available[0];
      active.model = chosen;
    }
    const started = Date.now();
    const suggestions = await aiSuggest(SAMPLE, active, signal);
    const milliseconds = Date.now() - started;
    return {
      ok: true,
      message: `“I · go · bathroom” came back in ${(milliseconds / 1000).toFixed(1)} seconds.`,
      model: chosen,
      sample: suggestions[0]?.text,
      milliseconds,
    };
  } catch (error) {
    const failure = error instanceof AiError ? error : new AiError('network', 'Something went wrong.');
    return { ok: false, message: describeAiError(failure), model: chosen };
  }
}

/** A sentence a person can act on, for each way a call can fail. */
export function describeAiError(error: AiError): string {
  switch (error.kind) {
    case 'config':
      return error.message;
    case 'auth':
      return `${error.message} Check that it was copied completely and is still active.`;
    case 'model':
      return `${error.message} Choose a different model.`;
    case 'limit':
      return `${error.message} Check the plan or credit on the provider's site.`;
    case 'refused':
      return error.message;
    case 'timeout':
      return 'It took too long to answer. The connection may be slow.';
    case 'network':
      return error.message;
    case 'aborted':
      return 'Cancelled.';
    default:
      return error.message || 'The provider returned something unexpected.';
  }
}

// ─────────────────────────────────────────────────────────── phrase memory ──

/**
 * A small memory of what the AI suggested for a given set of symbols.
 *
 * People say the same things many times a day. Remembering the answers makes a
 * repeated phrase appear instantly, keeps working with no connection, and stops
 * the same request being paid for twice. It lives only on this device.
 */
export class SuggestionMemory {
  private readonly entries = new Map<string, Suggestion[]>();

  constructor(
    private readonly limit = 400,
    initial?: [string, Suggestion[]][],
  ) {
    for (const [key, value] of initial ?? []) this.entries.set(key, value);
  }

  static keyFor(words: string[]): string {
    return words.map((word) => word.trim().toLowerCase()).join('|');
  }

  get(words: string[]): Suggestion[] | undefined {
    const key = SuggestionMemory.keyFor(words);
    const found = this.entries.get(key);
    if (!found) return undefined;
    // Refresh its place so that often-used phrases are the last to be dropped.
    this.entries.delete(key);
    this.entries.set(key, found);
    return found.map((suggestion) => ({ ...suggestion, source: 'memory' as const }));
  }

  set(words: string[], suggestions: Suggestion[]): void {
    if (suggestions.length === 0) return;
    const key = SuggestionMemory.keyFor(words);
    this.entries.delete(key);
    this.entries.set(key, suggestions.map((suggestion) => ({ text: suggestion.text, kind: suggestion.kind, source: 'ai' as const })));
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** For saving to storage. */
  toJSON(): [string, Suggestion[]][] {
    return Array.from(this.entries.entries());
  }
}
