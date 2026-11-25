import { useEffect, useState } from 'react';
import { localReplies } from '../language/replies';
import { isAiReady, PROVIDERS } from '../llm';
import { listener } from '../speech/listener';
import { stopListening, useListening } from '../state/listening';
import { useSettings } from '../state/settings';
import { useTalk } from '../state/talk';
import { PageHeader, Row, Stepper, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { go } from '../ui/hooks';

/** Which company the browser sends the sound to. Only the browser knows for certain, so this is a best reading of it. */
export function recogniserOwner(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Microsoft';
  if (/Chrome\/|CriOS\//.test(userAgent) && !/iPhone|iPad|iPod/.test(userAgent)) return 'Google';
  if (/Safari\/|iPhone|iPad|iPod/.test(userAgent)) return 'Apple';
  return 'the company that makes your browser';
}

/**
 * "Listen for replies": the microphone hears what the other person says, and
 * the app offers answers to it.
 *
 * This is the one feature that takes in someone else's voice and lets it leave
 * the device, so it cannot be switched on by accident: the page explains what
 * turning it on means, and the switch stays locked until that has been ticked.
 */
export function ListenSettingsPage() {
  const settings = useSettings();
  const listen = settings.listen;
  const listening = useListening();
  const [understood, setUnderstood] = useState(false);
  const [heard, setHeard] = useState('');
  const supported = listener.supported;
  const owner = recogniserOwner(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const aiOn = isAiReady(settings.ai);
  const provider = PROVIDERS[settings.ai.provider];

  // A test on this page is shown here and goes nowhere else: not into the conversation, and not to any AI.
  useEffect(() => stopListening, []);
  const tryIt = () => listener.start({ language: settings.voice.language, windowMs: listen.seconds * 1000, byHand: true, onHeard: setHeard });

  const turnOn = () => {
    listener.reset();
    settings.patch('listen', { enabled: true, agreedAt: Date.now() });
  };
  const turnOff = () => {
    stopListening();
    listener.reset();
    settings.patch('listen', { enabled: false });
    useTalk.getState().setPartnerSaid('');
    setUnderstood(false);
    setHeard('');
  };

  return (
    <>
      <PageHeader title="Listen for replies" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="card">
          <p className="lead">
            The microphone can listen to the person you are talking with. The app then offers answers to what they said, such as “Yes, please.” and “No, thank
            you.”, or a shortcut to the right words. You still choose what is said. Nothing is ever spoken by itself.
          </p>
          <p className="muted">
            Example: you say “I am hungry.” They ask “What do you want to eat?” The app hears the question and offers “I want …” with the food words ready
            {aiOn ? ', and with AI on, likely answers such as “I want cereal.”' : '. With an AI key added, it can also suggest likely full answers.'}
          </p>
        </div>

        {!supported ? (
          <div className="note warn" role="status">
            <strong>This browser cannot listen.</strong> Speech recognition is built into Chrome, Edge and Safari, but not Firefox. Someone can still type what was
            said: open the Menu on the talking screen.
          </div>
        ) : null}

        {!listen.enabled ? (
          <div className="card" data-testid="listen-disclaimer">
            <h2>Before you turn this on</h2>
            <p>Turning this on changes what stays private. Please read all of it.</p>
            <ul className="plain-list">
              <li>
                <strong>Another person’s voice leaves this device.</strong> The browser sends the sound from the microphone to {owner} to be turned into words. This
                app does not choose that, cannot stop it, and has no say over how {owner} handles it. Until now, nothing left this device unless you added an AI key.
              </li>
              <li>
                <strong>It hears everyone nearby,</strong> not only the person talking to you: other people in the room, a television, a phone call.
              </li>
              <li>
                <strong>The people you talk with should know.</strong> Tell them the device is listening. In some places the law requires their agreement.
              </li>
              <li>
                <strong>It listens in short turns, not all the time.</strong> It listens for up to {listen.seconds} seconds after you say something, or when the
                microphone button is pressed, and the screen shows “Listening” for as long as it is on.
              </li>
              <li>
                <strong>What it heard is shown on the screen</strong> so mistakes can be seen. It will sometimes hear wrongly, more so in a noisy room.
              </li>
              <li>
                <strong>The other person’s words are not saved.</strong> This app keeps them in memory for the conversation and forgets them when the page is closed.
                It never keeps the sound.
              </li>
              <li>
                {aiOn ? (
                  <>
                    <strong>AI is on, so the words also go to {provider.label}.</strong> What was heard, and the last few things each of you said, are sent to suggest
                    replies.
                  </>
                ) : (
                  <>
                    <strong>If you turn on AI later,</strong> what was heard and the last few things each of you said will also be sent to the AI company you chose.
                  </>
                )}
              </li>
              <li>
                <strong>It needs the internet</strong> in most browsers, and the browser will ask for permission to use the microphone.
              </li>
              <li>
                <strong>You can turn it off here at any time.</strong> Nothing else in the app depends on it.
              </li>
            </ul>
            <label className="agree">
              <input type="checkbox" checked={understood} disabled={!supported} onChange={(event) => setUnderstood(event.target.checked)} />
              <span>I have read this. I understand that other people’s voices will be sent to {owner} while listening is on, and I will tell the people I talk with.</span>
            </label>
            <button type="button" className="btn primary" disabled={!supported || !understood} onClick={turnOn}>
              <Icon name="mic" />
              Turn on listening
            </button>
          </div>
        ) : (
          <>
            <div className="note warn" role="status">
              <strong>Listening is on.</strong> While the screen says “Listening”, the sound from the microphone is sent to {owner} to be turned into words
              {aiOn ? `, and the words are sent to ${provider.label} to suggest replies` : ''}. Tell the people you talk with.
            </div>
            <div className="card">
              <Toggle
                id="listen-auto"
                title="Listen after I say something"
                help="Starts by itself when your sentence has finished, so no one has to press anything. When off, it only listens when the microphone button is pressed."
                value={listen.auto}
                onChange={(auto) => settings.patch('listen', { auto })}
              />
              <Row title="How long to listen" help="It stops sooner if the other person finishes speaking.">
                <Stepper id="listen-seconds" label="Seconds to listen" value={listen.seconds} min={4} max={30} step={2} format={(value) => `${value} s`} onChange={(seconds) => settings.patch('listen', { seconds })} />
              </Row>
              <Row
                title="Try it"
                help={
                  listening.state === 'listening'
                    ? listening.interim || 'Listening… say something.'
                    : listening.message || (heard ? `Heard: “${heard}”` : 'Press, allow the microphone if asked, then say something.')
                }
              >
                <button type="button" className="btn" onClick={() => (listening.state === 'listening' ? stopListening() : tryIt())}>
                  <Icon name="mic" />
                  {listening.state === 'listening' ? 'Stop' : 'Listen now'}
                </button>
              </Row>
              {heard ? (
                <p className="muted" data-testid="listen-sample">
                  It would offer: {localReplies(heard, { name: settings.profile.name, contractions: settings.sentences.contractions }).map((reply) => reply.text).join('  ·  ')}
                </p>
              ) : null}
            </div>
            <div className="card">
              <Row title="Turn listening off" help="The microphone is not used again until you turn this back on and agree again.">
                <button type="button" className="btn danger" onClick={turnOff}>
                  Turn off
                </button>
              </Row>
            </div>
          </>
        )}

        <div className="card">
          <h2>Without the microphone</h2>
          <p className="muted">
            Replies also work when someone types what was said: open the Menu on the talking screen and fill in “What was just said to them?”. That stays on this
            device unless AI is on.
          </p>
        </div>
      </div>
    </>
  );
}
