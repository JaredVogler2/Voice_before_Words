import type { SuggestionKind } from '../language/types';

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'compatible';

/** What the person has entered on the "Smart sentences" settings page. */
export interface AiSettings {
  enabled: boolean;
  provider: ProviderId;
  /** Kept only in this browser. Sent only to the chosen provider. */
  apiKey: string;
  model: string;
  /** Only used by the "compatible" provider (OpenRouter, Ollama, LM Studio ...). */
  baseUrl: string;
  /** Include the last few things said, so the model can pick a tense or resolve "it". */
  shareHistory: boolean;
  /** Include the "About me" notes. */
  shareProfile: boolean;
  /** Give up and keep the on-device suggestions after this long. */
  timeoutMs: number;
}

export interface AiRequest {
  /** The chosen symbols as words, in order. */
  words: string[];
  /** Recent utterances, oldest first. */
  history: string[];
  /** Free-text notes the person or their supporter wrote about themselves. */
  about: string;
  /** What the other person just said, if someone typed it in. */
  partnerSaid: string;
  /** How many suggestions to ask for. */
  max: number;
  contractions: boolean;
}

export interface AiSentence {
  text: string;
  kind: SuggestionKind;
}

export type AiErrorKind =
  | 'config' // nothing to call: no key, no model
  | 'auth' // the provider rejected the key
  | 'model' // the model name is not available to this key
  | 'limit' // rate limit or out of credit
  | 'refused' // the provider declined to answer
  | 'network' // offline, blocked, or the provider is unreachable
  | 'timeout'
  | 'aborted' // superseded by a newer request; not shown to anyone
  | 'response' // the provider answered with something unusable
  | 'server';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** Where someone gets a key. */
  keyUrl: string;
  keyHint: string;
  defaultModel: string;
  /** Suggestions for the model field. People can always type another id. */
  models: ModelOption[];
  needsBaseUrl: boolean;
  /** Ask for sentence suggestions. Rejects with an `AiError`. */
  suggest(request: AiRequest, settings: AiSettings, signal: AbortSignal): Promise<AiSentence[]>;
  /** Models this key can use, for the model picker. May be unsupported. */
  listModels?(settings: AiSettings, signal: AbortSignal): Promise<string[]>;
}
