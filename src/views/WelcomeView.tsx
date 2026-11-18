import { useEffect, useMemo, useState } from 'react';
import { usesCamera, type AccessMethod } from '../access/controller';
import { speaker } from '../speech/speaker';
import { rankVoices, type VoiceInfo } from '../speech/voices';
import { useSettings } from '../state/settings';
import { BrandMark, Icon } from '../ui/Icon';
import { go } from '../ui/hooks';
import { METHODS } from './methods';

/** First run: what this is, how you will choose, and what you will sound like. */
export function WelcomeView() {
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);

  useEffect(() => {
    void speaker.whenVoicesReady().then((list) => setVoices(rankVoices(list, settings.voice.language, settings.voice.onDeviceOnly).slice(0, 5)));
  }, [settings.voice.language, settings.voice.onDeviceOnly]);

  const method = settings.access.method;
  const chosenVoice = useMemo(() => voices.find((voice) => voice.uri === settings.voice.voiceUri) ?? voices[0], [voices, settings.voice.voiceUri]);

  const hear = (uri: string) => {
    speaker.unlock();
    void speaker.speak('Hello. This is how I will sound.', {
      rate: settings.voice.rate,
      pitch: settings.voice.pitch,
      volume: settings.voice.volume,
      voiceUri: uri,
      language: settings.voice.language,
      onDeviceVoicesOnly: settings.voice.onDeviceOnly,
      pronunciations: [],
    });
  };

  const finish = () => {
    settings.set({ onboarded: true });
    go(method === 'gaze' || method === 'head' ? '/calibrate' : '/');
  };

  const dots = (
    <div className="steps" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <i key={index} data-on={index <= step} />
      ))}
    </div>
  );

  if (step === 0) {
    return (
      <div className="center-page">
        <BrandMark className="brand-mark" />
        <h1 className="hero">Voice Before Words</h1>
        <p className="lede">Choose pictures. Pick the sentence that says what you mean. Hear it spoken in a voice you chose.</p>
        <p className="muted">Free. No account. Works without the internet. Nothing you say leaves this device unless you decide it should.</p>
        <button type="button" className="btn primary big" onClick={() => { speaker.unlock(); setStep(1); }}>
          Get started
          <Icon name="forward" />
        </button>
        {dots}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="center-page top">
        <h1 className="hero" style={{ fontSize: 30 }}>How will you choose?</h1>
        <p className="muted">You can change this at any time in the menu.</p>
        <div className="options" role="radiogroup" aria-label="How you choose" style={{ width: '100%', textAlign: 'left' }}>
          {METHODS.map((item) => (
            <button key={item.id} type="button" className="option" role="radio" aria-checked={method === item.id} onClick={() => settings.patch('access', { method: item.id as AccessMethod })}>
              <span className="option-icon"><Icon name={item.icon} /></span>
              <span>
                <span className="row-title" style={{ display: 'block' }}>{item.title}</span>
                <span className="row-help" style={{ display: 'block' }}>{item.help}</span>
              </span>
            </button>
          ))}
        </div>
        {method === 'gaze' && Math.min(window.innerWidth, window.innerHeight) < 520 ? (
          <p className="note warn" style={{ textAlign: 'left', width: '100%' }}>
            On a phone, eye pointing can tell only a few large areas of the screen apart. It works, with big choices and two looks per word. Head pointing and scanning
            are easier on a small screen, and a tablet suits eye pointing much better.
          </p>
        ) : null}
        {usesCamera(method, settings.access) ? (
          <p className="note" style={{ textAlign: 'left', width: '100%' }}>
            This uses the front camera. The picture is analysed on this device and never recorded or sent anywhere. Each time the app is opened, someone needs to
            tap the screen once so the browser allows the camera and the voice.
          </p>
        ) : null}
        <div className="inline">
          <button type="button" className="btn quiet" onClick={() => setStep(0)}>Back</button>
          <button type="button" className="btn primary" onClick={() => setStep(2)}>Next</button>
        </div>
        {dots}
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="center-page top">
        <h1 className="hero" style={{ fontSize: 30 }}>Choose a voice</h1>
        <p className="muted">These are the most natural voices on this device. More can usually be added in the device’s own settings.</p>
        <div className="options" role="radiogroup" aria-label="Voice" style={{ width: '100%', textAlign: 'left' }}>
          {voices.length === 0 ? <p className="note warn">No voices were found yet. You can still continue and choose one later.</p> : null}
          {voices.map((voice) => (
            <button key={voice.uri} type="button" className="option" role="radio" aria-checked={chosenVoice?.uri === voice.uri} onClick={() => { settings.patch('voice', { voiceUri: voice.uri }); hear(voice.uri); }}>
              <span className="option-icon"><Icon name="speaker" /></span>
              <span>
                <span className="row-title" style={{ display: 'block' }}>{voice.name}</span>
                <span className="row-help" style={{ display: 'block' }}>
                  {voice.tier === 'natural' ? 'Most natural' : voice.tier === 'good' ? 'Natural' : 'Basic'} · {voice.lang}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="inline">
          <button type="button" className="btn quiet" onClick={() => setStep(1)}>Back</button>
          <button type="button" className="btn primary" onClick={() => setStep(3)}>Next</button>
        </div>
        {dots}
      </div>
    );
  }

  return (
    <div className="center-page">
      <span className="nav-icon" style={{ width: 64, height: 64, borderRadius: 20 }}><Icon name="spark" /></span>
      <h1 className="hero" style={{ fontSize: 30 }}>Smarter sentences, if you want them</h1>
      <p className="lede">
        The app already turns “I · go · bathroom” into “I need to go to the bathroom.” on this device. Connect an AI model with your own key and it understands
        far more of what you mean.
      </p>
      <p className="muted">It is optional, off until you turn it on, and you can add it later from the menu.</p>
      <div className="inline" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn" onClick={() => { settings.set({ onboarded: true }); go('/settings/ai'); }}>
          <Icon name="key" />
          Add a key now
        </button>
        <button type="button" className="btn primary" onClick={finish}>
          Start talking
        </button>
      </div>
      {dots}
    </div>
  );
}
