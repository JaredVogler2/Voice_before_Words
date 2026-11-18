/**
 * Choosing a voice.
 *
 * A communication aid's voice is the person's voice, so the default should be
 * the most natural one their device has, not whatever happens to be first in
 * the list. Browsers do not say how good a voice is, but the names give it
 * away, and so does whether the voice runs on the device.
 */

/** The parts of a browser voice this app uses (lets tests supply plain objects). */
export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

export type VoiceTier = 'natural' | 'good' | 'basic';

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  /** Runs on this device. Voices that do not send what is said to the browser maker's servers. */
  onDevice: boolean;
  tier: VoiceTier;
  score: number;
}

/** Joke and sound-effect voices that ship with Apple devices. Never pick these automatically. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ)\b/i;
/** Older robotic voices. */
const ROBOTIC = /\b(fred|ralph|kathy|junior|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|espeak|pico)\b/i;

export function scoreVoice(voice: VoiceLike): number {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (/natural|neural/.test(name)) score += 400;
  if (/premium/.test(name)) score += 320;
  if (/enhanced/.test(name)) score += 220;
  if (/siri/.test(name)) score += 180;
  if (/google/.test(name)) score += 120;
  if (/wavenet|studio/.test(name)) score += 150;
  if (voice.default) score += 15;
  if (ROBOTIC.test(name)) score -= 150;
  if (NOVELTY.test(name)) score -= 1000;
  if (/compact/.test(name)) score -= 30;
  return score;
}

function tierOf(score: number): VoiceTier {
  if (score >= 300) return 'natural';
  if (score >= 100) return 'good';
  return 'basic';
}

function sameLanguage(voiceLang: string, wanted: string): boolean {
  return voiceLang.toLowerCase().replace('_', '-').startsWith(wanted.toLowerCase().slice(0, 2));
}

function sameRegion(voiceLang: string, wanted: string): boolean {
  return voiceLang.toLowerCase().replace('_', '-') === wanted.toLowerCase();
}

/** Voices for a language, best first. */
export function rankVoices(voices: VoiceLike[], language: string, onDeviceOnly: boolean): VoiceInfo[] {
  return voices
    .filter((voice) => sameLanguage(voice.lang, language))
    .filter((voice) => !onDeviceOnly || voice.localService)
    .map((voice) => {
      const score = scoreVoice(voice) + (sameRegion(voice.lang, language) ? 40 : 0);
      return { uri: voice.voiceURI, name: voice.name, lang: voice.lang, onDevice: voice.localService, tier: tierOf(score), score };
    })
    .filter((voice) => voice.score > -500)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * The voice to speak with: the one the person chose if it is still available
 * and allowed, otherwise the best one for their language. If the device has no
 * on-device voice at all, any voice is better than silence.
 */
export function chooseVoice<T extends VoiceLike>(voices: T[], chosenUri: string, language: string, onDeviceOnly: boolean): T | undefined {
  if (chosenUri) {
    const chosen = voices.find((voice) => voice.voiceURI === chosenUri);
    if (chosen && (!onDeviceOnly || chosen.localService)) return chosen;
  }
  const byUri = (uri: string | undefined) => voices.find((voice) => voice.voiceURI === uri);
  return (
    byUri(rankVoices(voices, language, onDeviceOnly)[0]?.uri) ??
    byUri(rankVoices(voices, language, false)[0]?.uri) ??
    voices.find((voice) => voice.default) ??
    voices[0]
  );
}

export interface Pronunciation {
  /** The word as written. */
  word: string;
  /** How it should be said. */
  say: string;
}

/** Replace whole words with how the person wants them said ("Nguyen" -> "win"). */
export function applyPronunciations(text: string, pronunciations: Pronunciation[]): string {
  let out = text;
  for (const { word, say } of pronunciations) {
    const from = word.trim();
    if (!from || !say.trim()) continue;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu'), `$1${say.trim()}`);
  }
  return out;
}
