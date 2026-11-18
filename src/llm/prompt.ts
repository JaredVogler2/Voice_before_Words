import type { SuggestionKind } from '../language/types';
import type { AiRequest, AiSentence } from './types';

/**
 * The instructions every provider receives.
 *
 * The person using this app is the author of what gets said. The model's job is
 * narrow: turn their shorthand into the sentences they most plausibly mean and
 * hand those back as options. It must not add content, and it must not censor.
 * A communication aid that softens or refuses what someone chose to say takes
 * their voice away at exactly the moments it matters most.
 */
export const SYSTEM_PROMPT = `You turn symbol selections from an AAC communication board into sentences the person could say.

The person cannot rely on speech. They communicate by choosing symbols, which arrive as telegraphic shorthand in the order they were chosen (for example: I · go · bathroom). Reply with the complete sentences they most likely mean. They will pick one and it will be spoken aloud as their own voice.

How to write the suggestions:
- Speak as the person, in the first person. Never talk about them or to them, and never answer or comment on what they say.
- Keep their meaning. Add only the grammar that turns shorthand into a sentence: articles, pronouns, prepositions, verb endings, tense, word order. Do not add ideas, reasons, details, names, politeness or feelings they did not choose.
- When the shorthand could mean different things, give genuinely different readings: a want or need, something happening now, something that already happened, a question, a request to someone. Most likely first. Do not pad with near-duplicates or rephrasings of the same reading.
- Sound like everyday speech: short, plain, natural. Use the "About the person" notes, when given, for age, style and the names of people and things in their life.
- Say exactly what they chose, including refusals, complaints, anger, pain, body words, and reports that someone hurt or frightened them. Never soften, censor, correct, lecture or leave part out. They have the same right to say hard things as anyone who speaks.
- Use the recent conversation only to work out what they mean (to choose a tense, or decide what "it" refers to). Do not repeat it or continue it.
- If the symbols already make a correct sentence, return it with punctuation and add other readings only if they are plausible.
- One sentence per suggestion. Use two short sentences only when the symbols clearly contain two separate thoughts.

Label each suggestion with a kind:
- want: a wish or need
- say: a plain statement
- now: something happening now
- past: something that already happened
- future: something that will happen
- ask: a question
- tell: asking someone to do something`;

const KINDS: SuggestionKind[] = ['want', 'say', 'now', 'past', 'future', 'ask', 'tell'];

/** JSON Schema for the reply, used by providers that can enforce one. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One complete sentence the person could say.' },
          kind: { type: 'string', enum: KINDS },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

/** The same contract in words, for providers that cannot enforce a schema. */
export const JSON_INSTRUCTIONS = `Reply with JSON only, no other text, in exactly this shape:
{"suggestions":[{"text":"<sentence>","kind":"<want|say|now|past|future|ask|tell>"}]}`;

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/** The per-request message: the symbols plus whatever context the person allows. */
export function buildUserMessage(request: AiRequest): string {
  const lines: string[] = [`Symbols: ${request.words.map((word) => clip(word, 60)).join(' · ')}`];

  const about = clip(request.about, 600);
  if (about) lines.push('', `About the person: ${about}`);

  const partner = clip(request.partnerSaid, 300);
  const history = request.history.slice(-4).map((line) => clip(line, 160)).filter(Boolean);
  if (history.length > 0 || partner) {
    lines.push('', 'Recent conversation, oldest first:');
    for (const line of history) lines.push(`- The person said: "${line}"`);
    if (partner) lines.push(`- Someone just said to them: "${partner}"`);
  }

  lines.push(
    '',
    `Give up to ${request.max} suggestions.` +
      (request.contractions ? '' : ' Do not use contractions (write "I am", "do not").'),
  );
  return lines.join('\n');
}

function isKind(value: unknown): value is SuggestionKind {
  return typeof value === 'string' && (KINDS as string[]).includes(value);
}

/** Find the first complete JSON object in a reply that may have prose or code fences around it. */
function extractJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through to scanning
  }
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

const MAX_SENTENCE_LENGTH = 240;

/**
 * Turn a provider's reply into clean suggestions. Tolerant of the ways models
 * drift from the format; strict about what is allowed through to be spoken.
 */
export function parseSentences(raw: string, max: number): AiSentence[] {
  const data = extractJson(raw) as { suggestions?: unknown } | unknown[] | undefined;
  const list = Array.isArray(data) ? data : Array.isArray(data?.suggestions) ? data.suggestions : [];
  const seen = new Set<string>();
  const out: AiSentence[] = [];
  for (const item of list) {
    const record = (typeof item === 'string' ? { text: item } : item) as { text?: unknown; kind?: unknown } | null;
    if (!record || typeof record.text !== 'string') continue;
    let text = record.text.replace(/\s+/g, ' ').trim();
    // Models sometimes wrap the sentence in quotes or add a leading bullet.
    text = text.replace(/^[-*•\d.)\s]+(?=\S)/, '').replace(/^["“”']+|["“”']+$/g, '').trim();
    if (!text || text.length > MAX_SENTENCE_LENGTH) continue;
    if (!/[.!?…]$/.test(text)) text += '.';
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, kind: isKind(record.kind) ? record.kind : 'say' });
    if (out.length >= max) break;
  }
  return out;
}
