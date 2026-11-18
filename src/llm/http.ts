import { AiError } from './types';

/** Shared plumbing for the providers that are called with plain `fetch`. */

function messageFrom(body: unknown, fallback: string): string {
  const record = body as { error?: { message?: unknown } | string; message?: unknown } | null;
  const nested = typeof record?.error === 'object' ? record.error?.message : record?.error;
  const message = typeof nested === 'string' ? nested : typeof record?.message === 'string' ? record.message : '';
  return message ? message.slice(0, 300) : fallback;
}

export function errorForStatus(status: number, body: unknown, who: string): AiError {
  const detail = messageFrom(body, '');
  if (status === 401 || status === 403) return new AiError('auth', `${who} did not accept this API key.`, status);
  if (status === 404) return new AiError('model', detail || 'That model was not found.', status);
  if (status === 429) {
    return new AiError('limit', detail || 'Too many requests right now, or the account has hit its limit.', status);
  }
  if (status === 400 && /model/i.test(detail) && /(not|unknown|invalid|exist|found|support)/i.test(detail)) {
    return new AiError('model', detail, status);
  }
  if (status >= 500) return new AiError('server', detail || `${who} had a problem. Try again shortly.`, status);
  return new AiError('response', detail || `${who} rejected the request (${status}).`, status);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

/** Send a JSON request and return the parsed JSON reply, or throw an `AiError`. */
export async function requestJson(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown },
  signal: AbortSignal,
  who: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? init.headers : { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
      // Never send cookies or a referrer to an AI provider.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (signal.aborted) throw new AiError('aborted', 'Cancelled.');
    throw new AiError(
      'network',
      `Could not reach ${who}. Check the internet connection${who.includes('server') ? ' and the address' : ''}.` +
        (error instanceof Error && error.message ? ` (${error.message})` : ''),
    );
  }
  const body = await readBody(response);
  if (!response.ok) throw errorForStatus(response.status, body, who);
  return body;
}

/** Join a base URL and a path without doubling or dropping the slash. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
