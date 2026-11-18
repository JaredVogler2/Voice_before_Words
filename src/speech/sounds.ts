/**
 * Short feedback sounds, generated on the device (no audio files).
 *
 * When someone selects by looking, there is no finger on glass to confirm that
 * something happened. A soft tick as a choice is made does that job.
 */

export type Cue = 'select' | 'step' | 'speak' | 'done' | 'error';

const CUES: Record<Cue, { frequency: number; to?: number; ms: number; gain: number }> = {
  select: { frequency: 660, to: 880, ms: 70, gain: 0.12 },
  step: { frequency: 440, ms: 35, gain: 0.05 },
  speak: { frequency: 520, to: 780, ms: 110, gain: 0.1 },
  done: { frequency: 523, to: 1046, ms: 220, gain: 0.12 },
  error: { frequency: 220, to: 160, ms: 180, gain: 0.12 },
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Call from a real touch or key press so later sounds are allowed to play. */
export function unlockSounds(): void {
  const ctx = audio();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

export function playCue(cue: Cue, volume = 1): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running' || volume <= 0) return;
  const spec = CUES[cue];
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;
    const end = start + spec.ms / 1000;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(spec.frequency, start);
    if (spec.to) oscillator.frequency.linearRampToValueAtTime(spec.to, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(spec.gain * volume, start + 0.008);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  } catch {
    // Feedback sounds are a nicety. Never let one break anything.
  }
}
