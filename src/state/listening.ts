import { create } from 'zustand';
import { listener, type ListenSnapshot } from '../speech/listener';
import { speaker } from '../speech/speaker';
import { useSettings } from './settings';

/**
 * When the app listens to the other person, and what happens to what it hears.
 *
 * Nothing here runs unless listening has been turned on in the settings. The
 * rules are simple so that the microphone is never a surprise:
 *  - it listens for one thing at a time, for a few seconds, then stops;
 *  - it never listens while the app itself is speaking;
 *  - the screen says "Listening" for exactly as long as it is on.
 */

export const useListening = create<ListenSnapshot>(() => listener.current);
listener.subscribe((snapshot) => useListening.setState(snapshot, true));

let heardHandler: (text: string) => void = () => {};

/** Where a finished sentence from the other person goes. Set once by the conversation store. */
export function onHeard(handler: (text: string) => void): void {
  heardHandler = handler;
}

function begin(byHand: boolean): void {
  const settings = useSettings.getState();
  if (!settings.listen.enabled || speaker.isSpeaking) return;
  listener.start({
    language: settings.voice.language,
    windowMs: settings.listen.seconds * 1000,
    byHand,
    onHeard: (text) => heardHandler(text),
  });
}

/** Listen now, because someone asked for it. */
export function listenNow(): void {
  begin(true);
}

export function stopListening(): void {
  listener.stop();
}

/** Called when the person has said something: listen for the answer once the voice has finished. */
export function listenAfter(spoken: Promise<void>): void {
  const settings = useSettings.getState().listen;
  if (!settings.enabled || !settings.auto) return;
  void spoken.then(() => {
    // Another sentence may have started in the meantime; its own ending will bring us back here.
    if (!speaker.isSpeaking) begin(false);
  });
}

// Out of sight, the "Listening" sign cannot be seen, so the microphone goes off.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) listener.stop();
  });
}

// The app's own voice must never be taken for the other person's.
speaker.onChange((speaking) => {
  if (speaking) listener.stop();
});
