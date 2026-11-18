import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildUserMessage, parseSentences, SYSTEM_PROMPT } from '../src/llm/prompt';
import { AiError, aiSuggest, DEFAULT_AI_SETTINGS, isAiReady, SuggestionMemory, testConnection, type AiRequest, type AiSettings } from '../src/llm';

// ── A stand-in for the Anthropic SDK that records what it was asked to do ──
const sdk = vi.hoisted(() => {
  class APIError extends Error {
    status?: number;
    constructor(message = 'api error', status?: number) {
      super(message);
      this.status = status;
    }
  }
  class APIUserAbortError extends APIError {}
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class BadRequestError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  const state = {
    options: [] as Record<string, unknown>[],
    plain: [] as Record<string, unknown>[],
    beta: [] as Record<string, unknown>[],
    reply: null as unknown,
    failure: null as unknown,
    models: [] as string[],
  };
  class FakeAnthropic {
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static BadRequestError = BadRequestError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static NotFoundError = NotFoundError;
    static RateLimitError = RateLimitError;
    constructor(options: Record<string, unknown>) {
      state.options.push(options);
    }
    private answer(list: Record<string, unknown>[], params: Record<string, unknown>) {
      list.push(params);
      if (state.failure) return Promise.reject(state.failure);
      return Promise.resolve(state.reply);
    }
    messages = { create: (params: Record<string, unknown>) => this.answer(state.plain, params) };
    beta = { messages: { create: (params: Record<string, unknown>) => this.answer(state.beta, params) } };
    models = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          for (const id of state.models) yield { id };
        },
      }),
    };
  }
  return { state, FakeAnthropic, errors: { APIError, APIUserAbortError, APIConnectionError, APIConnectionTimeoutError, BadRequestError, AuthenticationError, NotFoundError, RateLimitError } };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.FakeAnthropic }));

const REQUEST: AiRequest = {
  words: ['I', 'go', 'bathroom'],
  history: ['I am hungry.'],
  about: 'Sam, 9, loves trains.',
  partnerSaid: '',
  max: 4,
  contractions: true,
};

const GOOD = JSON.stringify({
  suggestions: [
    { text: 'I need to go to the bathroom.', kind: 'want' },
    { text: 'I went to the bathroom.', kind: 'past' },
  ],
});

function settings(patch: Partial<AiSettings>): AiSettings {
  return { ...DEFAULT_AI_SETTINGS, enabled: true, apiKey: 'test-key', ...patch };
}

function claudeReply(text: string, stop = 'end_turn') {
  return { stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] };
}

async function failure(run: Promise<unknown>): Promise<AiError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('expected the call to fail');
}

const fetchMock = vi.fn();
function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}
function lastCall(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : {} };
}

beforeEach(() => {
  sdk.state.options.length = 0;
  sdk.state.plain.length = 0;
  sdk.state.beta.length = 0;
  sdk.state.reply = claudeReply(GOOD);
  sdk.state.failure = null;
  sdk.state.models = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the prompt', () => {
  test('tells the model to keep the meaning and never censor', () => {
    expect(SYSTEM_PROMPT).toMatch(/Keep their meaning/);
    expect(SYSTEM_PROMPT).toMatch(/Never soften, censor/);
    expect(SYSTEM_PROMPT).toMatch(/first person/);
  });

  test('sends the symbols in order with the context the person allows', () => {
    const message = buildUserMessage({ ...REQUEST, partnerSaid: 'Where are you going?' });
    expect(message).toMatch(/^Symbols: I · go · bathroom/);
    expect(message).toContain('About the person: Sam, 9, loves trains.');
    expect(message).toContain('The person said: "I am hungry."');
    expect(message).toContain('Someone just said to them: "Where are you going?"');
    expect(message).toContain('Give up to 4 suggestions.');
  });

  test('leaves out sections that are empty and keeps long context short', () => {
    const message = buildUserMessage({ ...REQUEST, history: [], about: 'x'.repeat(5000) });
    expect(message).not.toContain('Recent conversation');
    expect(message.length).toBeLessThan(900);
    expect(buildUserMessage({ ...REQUEST, contractions: false })).toContain('Do not use contractions');
  });
});

describe('reading replies', () => {
  test('accepts the expected shape', () => {
    expect(parseSentences(GOOD, 4)).toEqual([
      { text: 'I need to go to the bathroom.', kind: 'want' },
      { text: 'I went to the bathroom.', kind: 'past' },
    ]);
  });

  test('copes with code fences, chatter, bare arrays and plain strings', () => {
    expect(parseSentences('```json\n' + GOOD + '\n```', 4)).toHaveLength(2);
    expect(parseSentences('Sure! Here you go:\n' + GOOD + '\nHope that helps.', 4)).toHaveLength(2);
    expect(parseSentences('[{"text":"I am tired.","kind":"say"}]', 4)).toEqual([{ text: 'I am tired.', kind: 'say' }]);
    expect(parseSentences('{"suggestions":["I am tired."]}', 4)).toEqual([{ text: 'I am tired.', kind: 'say' }]);
  });

  test('cleans up quotes, bullets, missing full stops and unknown kinds', () => {
    const raw = JSON.stringify({ suggestions: [{ text: '  "I want  juice" ', kind: 'banana' }, { text: '1. Can I go?', kind: 'ask' }] });
    expect(parseSentences(raw, 4)).toEqual([
      { text: 'I want juice.', kind: 'say' },
      { text: 'Can I go?', kind: 'ask' },
    ]);
  });

  test('drops duplicates, empties, non-text and anything implausibly long, and respects the limit', () => {
    const raw = JSON.stringify({
      suggestions: [
        { text: 'I am tired.', kind: 'say' },
        { text: 'i am tired.', kind: 'say' },
        { text: '', kind: 'say' },
        { text: 42, kind: 'say' },
        { text: 'x'.repeat(400), kind: 'say' },
        { text: 'I feel tired.', kind: 'say' },
        { text: 'I was tired.', kind: 'past' },
      ],
    });
    expect(parseSentences(raw, 2).map((s) => s.text)).toEqual(['I am tired.', 'I feel tired.']);
  });

  test('returns nothing rather than guessing when the reply is not usable', () => {
    for (const raw of ['', 'I cannot help with that.', '{"suggestions": 7}', '{"oops": true', 'null']) {
      expect(parseSentences(raw, 4)).toEqual([]);
    }
  });
});

describe('Claude', () => {
  test('Opus goes through the fallback-enabled endpoint with low effort and a response schema', async () => {
    const out = await aiSuggest(REQUEST, settings({ provider: 'anthropic', model: 'claude-opus-5-5' }));
    expect(out).toEqual([
      { text: 'I need to go to the bathroom.', kind: 'want', source: 'ai' },
      { text: 'I went to the bathroom.', kind: 'past', source: 'ai' },
    ]);
    expect(sdk.state.plain).toHaveLength(0);
    const params = sdk.state.beta[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    // The unchanging instructions are sent as a cacheable block.
    expect(params.system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    const config = params.output_config as { effort: string; format: { type: string } };
    expect(config.effort).toBe('low');
    expect(config.format.type).toBe('json_schema');
    // Parameters the current models reject must never be sent.
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) expect(params).not.toHaveProperty(banned);
  });

  test('the default is the fast, inexpensive model', () => {
    expect(DEFAULT_AI_SETTINGS.provider).toBe('anthropic');
    expect(DEFAULT_AI_SETTINGS.model).toBe('claude-haiku-5-5');
  });

  test('Haiku has no server-side fallback, so it uses the plain endpoint', async () => {
    await aiSuggest(REQUEST, settings({ provider: 'anthropic', model: 'claude-haiku-5-5' }));
    expect(sdk.state.beta).toHaveLength(0);
    expect(sdk.state.plain[0]).not.toHaveProperty('fallbacks');
    expect(sdk.state.plain[0]).not.toHaveProperty('betas');
    expect((sdk.state.plain[0].output_config as { effort: string }).effort).toBe('low');
  });

  test('an unrecognised model id gets a plain request with the format spelled out in words', async () => {
    await aiSuggest(REQUEST, settings({ provider: 'anthropic', model: 'some-other-model' }));
    const params = sdk.state.plain[0];
    expect(params).not.toHaveProperty('output_config');
    expect(JSON.stringify(params.messages)).toContain('Reply with JSON only');
  });

  test('the client is set up for direct browser use, without retries', async () => {
    await aiSuggest(REQUEST, settings({ provider: 'anthropic', apiKey: '  sk-ant-abc  ' }));
    expect(sdk.state.options[0]).toMatchObject({ apiKey: 'sk-ant-abc', dangerouslyAllowBrowser: true, maxRetries: 0 });
  });

  test('a refusal is reported as a refusal and never read as content', async () => {
    sdk.state.reply = { stop_reason: 'refusal', content: [] };
    const error = await failure(aiSuggest(REQUEST, settings({ provider: 'anthropic' })));
    expect(error.kind).toBe('refused');
  });

  test('a cut-off or unreadable reply is an error, not an empty success', async () => {
    sdk.state.reply = claudeReply('{"suggestions":[{"text":"I nee', 'max_tokens');
    expect((await failure(aiSuggest(REQUEST, settings({ provider: 'anthropic' })))).kind).toBe('response');
  });

  test.each([
    ['AuthenticationError', 'auth'],
    ['NotFoundError', 'model'],
    ['RateLimitError', 'limit'],
    ['APIConnectionTimeoutError', 'timeout'],
    ['APIConnectionError', 'network'],
    ['BadRequestError', 'response'],
    ['APIError', 'server'],
  ] as const)('%s becomes "%s"', async (name, kind) => {
    sdk.state.failure = new sdk.errors[name]('boom', 400);
    expect((await failure(aiSuggest(REQUEST, settings({ provider: 'anthropic' })))).kind).toBe(kind);
  });

  test('no key means no call', async () => {
    const error = await failure(aiSuggest(REQUEST, settings({ provider: 'anthropic', apiKey: ' ' })));
    expect(error.kind).toBe('config');
    expect(sdk.state.options).toHaveLength(0);
  });
});

describe('OpenAI', () => {
  const openai = settings({ provider: 'openai', model: 'gpt-test', apiKey: 'sk-openai' });

  test('sends a strict schema and reads the reply', async () => {
    fetchMock.mockReturnValue(respond(200, { choices: [{ message: { content: GOOD } }] }));
    const out = await aiSuggest(REQUEST, openai);
    expect(out).toHaveLength(2);
    const { url, init, body } = lastCall();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-openai');
    expect(init.credentials).toBe('omit');
    expect(body.model).toBe('gpt-test');
    expect((body.response_format as { type: string }).type).toBe('json_schema');
    expect(body).not.toHaveProperty('temperature');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(messages[1].content).toContain('Symbols: I · go · bathroom');
  });

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'model'],
    [429, 'limit'],
    [500, 'server'],
    [400, 'response'],
  ] as const)('HTTP %i becomes "%s"', async (status, kind) => {
    fetchMock.mockReturnValue(respond(status, { error: { message: 'nope' } }));
    expect((await failure(aiSuggest(REQUEST, openai))).kind).toBe(kind);
  });

  test('a 400 that names the model is a model problem', async () => {
    fetchMock.mockReturnValue(respond(400, { error: { message: 'The model `gpt-test` does not exist' } }));
    expect((await failure(aiSuggest(REQUEST, openai))).kind).toBe('model');
  });

  test('being offline is a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await failure(aiSuggest(REQUEST, openai))).kind).toBe('network');
  });

  test('a refusal is reported as a refusal', async () => {
    fetchMock.mockReturnValue(respond(200, { choices: [{ message: { content: null, refusal: 'I cannot.' } }] }));
    expect((await failure(aiSuggest(REQUEST, openai))).kind).toBe('refused');
  });

  test('needs a model to be chosen', async () => {
    expect((await failure(aiSuggest(REQUEST, { ...openai, model: '' }))).kind).toBe('config');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('other OpenAI-compatible servers', () => {
  const local = settings({ provider: 'compatible', model: 'llama', apiKey: '', baseUrl: 'http://localhost:11434/v1/' });

  test('works with no key at all, for a model on the same device', async () => {
    fetchMock.mockReturnValue(respond(200, { choices: [{ message: { content: GOOD } }] }));
    await aiSuggest(REQUEST, local);
    const { url, init, body } = lastCall();
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('retries without the JSON flag when the server rejects it', async () => {
    fetchMock
      .mockReturnValueOnce(respond(400, { error: { message: 'response_format is not supported' } }))
      .mockReturnValueOnce(respond(200, { choices: [{ message: { content: 'Here: ' + GOOD } }] }));
    const out = await aiSuggest(REQUEST, local);
    expect(out).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastCall().body).not.toHaveProperty('response_format');
  });

  test('insists on a real address', async () => {
    expect((await failure(aiSuggest(REQUEST, { ...local, baseUrl: '' }))).kind).toBe('config');
    expect((await failure(aiSuggest(REQUEST, { ...local, baseUrl: 'localhost:1234' }))).kind).toBe('config');
  });
});

describe('Gemini', () => {
  const gemini = settings({ provider: 'google', model: 'gemini-test', apiKey: 'g-key' });

  test('keeps the key out of the URL and asks for JSON', async () => {
    fetchMock.mockReturnValue(respond(200, { candidates: [{ content: { parts: [{ text: GOOD }] }, finishReason: 'STOP' }] }));
    const out = await aiSuggest(REQUEST, gemini);
    expect(out).toHaveLength(2);
    const { url, init, body } = lastCall();
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(url).not.toContain('g-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect((body.generationConfig as { responseMimeType: string }).responseMimeType).toBe('application/json');
    expect(JSON.stringify(body.systemInstruction)).toContain('AAC communication board');
  });

  test('a blocked prompt or a safety stop is a refusal', async () => {
    fetchMock.mockReturnValue(respond(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    expect((await failure(aiSuggest(REQUEST, gemini))).kind).toBe('refused');
    fetchMock.mockReturnValue(respond(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }));
    expect((await failure(aiSuggest(REQUEST, gemini))).kind).toBe('refused');
  });
});

describe('the request wrapper', () => {
  test('context is only shared when the person allows it', async () => {
    await aiSuggest(REQUEST, settings({ provider: 'anthropic', shareHistory: false, shareProfile: false }));
    const sent = JSON.stringify(sdk.state.plain[0].messages);
    expect(sent).not.toContain('hungry');
    expect(sent).not.toContain('trains');
    expect(sent).toContain('I · go · bathroom');
  });

  test('gives up after the deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const pending = failure(aiSuggest(REQUEST, settings({ provider: 'openai', model: 'gpt-test', timeoutMs: 3000 })));
    await vi.advanceTimersByTimeAsync(3100);
    expect((await pending).kind).toBe('timeout');
  });

  test('a superseded request is cancelled quietly', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const controller = new AbortController();
    const pending = failure(aiSuggest(REQUEST, settings({ provider: 'openai', model: 'gpt-test' }), controller.signal));
    controller.abort();
    expect((await pending).kind).toBe('aborted');
  });

  test('an empty message makes no call', async () => {
    expect(await aiSuggest({ ...REQUEST, words: [] }, settings({ provider: 'openai', model: 'gpt-test' }))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('knows when there is enough set up to call anyone', () => {
    expect(isAiReady(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(isAiReady(settings({ provider: 'anthropic' }))).toBe(true);
    expect(isAiReady(settings({ provider: 'anthropic', apiKey: '' }))).toBe(false);
    expect(isAiReady(settings({ provider: 'openai', model: '' }))).toBe(false);
    expect(isAiReady(settings({ provider: 'compatible', apiKey: '', baseUrl: 'http://localhost:1/v1', model: 'm' }))).toBe(true);
  });
});

describe('testing a connection', () => {
  test('looks up a model when none is set, preferring small fast ones', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/models')) {
        return respond(200, { data: [{ id: 'gpt-9' }, { id: 'gpt-9-mini' }, { id: 'gpt-9-audio' }, { id: 'text-embedding-3' }] });
      }
      return respond(200, { choices: [{ message: { content: GOOD } }] });
    });
    const result = await testConnection(settings({ provider: 'openai', model: '' }));
    expect(result.ok).toBe(true);
    expect(result.model).toBe('gpt-9-mini');
    expect(result.sample).toBe('I need to go to the bathroom.');
  });

  test('explains a rejected key in plain words', async () => {
    fetchMock.mockReturnValue(respond(401, { error: { message: 'Incorrect API key' } }));
    const result = await testConnection(settings({ provider: 'openai', model: 'gpt-test' }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/did not accept this API key/);
  });

  test('filters and ranks Gemini models', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/models?')) {
        return respond(200, {
          models: [
            { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-9-flash-lite', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-9-flash-image', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      }
      return respond(200, { candidates: [{ content: { parts: [{ text: GOOD }] } }] });
    });
    const result = await testConnection(settings({ provider: 'google', model: '' }));
    expect(result.model).toBe('gemini-9-flash');
  });
});

describe('phrase memory', () => {
  const ai = (text: string) => ({ text, kind: 'say' as const, source: 'ai' as const });

  test('remembers suggestions for a set of symbols, whatever the letter case', () => {
    const memory = new SuggestionMemory();
    memory.set(['I', 'go', 'bathroom'], [ai('I need to go to the bathroom.')]);
    expect(memory.get(['i', 'GO', 'bathroom'])).toEqual([{ text: 'I need to go to the bathroom.', kind: 'say', source: 'memory' }]);
    expect(memory.get(['i', 'go'])).toBeUndefined();
  });

  test('forgets the least recently used phrase first, and survives being saved', () => {
    const memory = new SuggestionMemory(2);
    memory.set(['a'], [ai('A.')]);
    memory.set(['b'], [ai('B.')]);
    memory.get(['a']);
    memory.set(['c'], [ai('C.')]);
    expect(memory.get(['b'])).toBeUndefined();
    expect(memory.get(['a'])).toBeDefined();
    const restored = new SuggestionMemory(2, JSON.parse(JSON.stringify(memory)));
    expect(restored.size).toBe(2);
    expect(restored.get(['c'])?.[0].text).toBe('C.');
  });

  test('does not remember an empty answer', () => {
    const memory = new SuggestionMemory();
    memory.set(['a'], []);
    expect(memory.size).toBe(0);
  });
});
