import { useEffect, useMemo, useRef, useState } from 'react';
import { access, modelKey, viewportSize, type AccessMethod } from '../access/controller';
import { gradeCalibration } from '../access/gazeModel';
import type { GestureKind } from '../access/gestures';
import { speaker } from '../speech/speaker';
import { rankVoices, type VoiceInfo } from '../speech/voices';
import { usePwa } from '../state/pwa';
import { DEFAULT_SETTINGS, exportSettings, importSettings, useSettings, type CustomKind, type Theme, type TileSize } from '../state/settings';
import { useTalk } from '../state/talk';
import { buildVocabulary, colorOf } from '../state/words';
import { NavRow, PageHeader, Row, Segmented, Stepper, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Tile } from '../ui/Tile';
import { go, useAccessStatus } from '../ui/hooks';
import { requestKeptStorage, storageIsKept } from '../ui/overlays';
import { categoryBoards } from '../vocab/boards';
import { AiSettingsPage } from './SettingsAi';
import { ListenSettingsPage } from './SettingsListen';
import { METHODS } from './methods';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function speakSample(text: string): void {
  const voice = useSettings.getState().voice;
  speaker.unlock();
  void speaker.speak(text, {
    rate: voice.rate,
    pitch: voice.pitch,
    volume: voice.volume,
    voiceUri: voice.voiceUri,
    language: voice.language,
    onDeviceVoicesOnly: voice.onDeviceOnly,
    pronunciations: voice.pronunciations,
  });
}

// ─────────────────────────────────────────────────────────────── index ──

function Index() {
  const settings = useSettings();
  const method = METHODS.find((item) => item.id === settings.access.method)!;
  return (
    <>
      <PageHeader title="Settings" onBack={() => go('/')} />
      <div className="page-body">
        <div className="card">
          <NavRow id="access" icon={method.icon} title="How you choose" help={method.title} onClick={() => go('/settings/access')} />
          <NavRow id="voice" icon="speaker" title="Voice" help="Which voice, how fast, how loud" onClick={() => go('/settings/voice')} />
          <NavRow id="ai" icon="spark" title="Smart sentences" help={settings.ai.enabled ? 'AI is on' : 'On-device only'} onClick={() => go('/settings/ai')} />
          <NavRow id="listen" icon="mic" title="Listen for replies" help={settings.listen.enabled ? 'The microphone is on' : 'Off'} onClick={() => go('/settings/listen')} />
          <NavRow id="look" icon="palette" title="Look and layout" help="Theme, tile size, suggestions" onClick={() => go('/settings/look')} />
          <NavRow id="words" icon="book" title="Words" help="Add your own, hide ones you don’t use" onClick={() => go('/settings/words')} />
          <NavRow id="data" icon="shield" title="Privacy and your data" help="What is kept, backup, reset" onClick={() => go('/settings/data')} />
          <NavRow id="about" icon="info" title="About" onClick={() => go('/settings/about')} />
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── access ──

const GESTURES: { value: GestureKind | 'none'; label: string }[] = [
  { value: 'blink', label: 'Slow blink' },
  { value: 'brows', label: 'Eyebrows up' },
  { value: 'mouth', label: 'Open mouth' },
  { value: 'smile', label: 'Smile' },
  { value: 'none', label: 'None' },
];

function AccessPage() {
  const settings = useSettings();
  const status = useAccessStatus();
  const a = settings.access;
  const set = (change: Partial<typeof a>) => settings.patch('access', change);
  const camera = a.method === 'gaze' || a.method === 'head';
  const model = camera ? settings.models[modelKey(a.method === 'head' ? 'head' : 'gaze', viewportSize())] : undefined;
  const grade = model ? gradeCalibration(model.errorPx, viewportSize(), model.pxPerDegree) : null;

  return (
    <>
      <PageHeader title="How you choose" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="options" role="radiogroup" aria-label="How you choose">
          {METHODS.map((item) => (
            <button key={item.id} type="button" className="option" role="radio" aria-checked={a.method === item.id} data-access={`method:${item.id}`} onClick={() => set({ method: item.id as AccessMethod })}>
              <span className="option-icon"><Icon name={item.icon} /></span>
              <span>
                <span className="row-title" style={{ display: 'block' }}>{item.title}</span>
                <span className="row-help" style={{ display: 'block' }}>{item.help}</span>
              </span>
            </button>
          ))}
        </div>

        {camera ? (
          <div className="card pad stack">
            <div>
              <div className="row-title">Calibration</div>
              <div className="row-help">
                {model
                  ? `${grade === 'good' ? 'Good' : grade === 'fair' ? 'Usable' : 'Not accurate yet'}: ${model.pxPerDegree ? `roughly ${(Math.round((model.errorPx / model.pxPerDegree) * 2) / 2).toFixed(1)} degrees` : `about ${Math.round(model.errorPx)} pixels`} of error. Calibrate again after moving the device or changing how you sit.`
                  : 'Needed before you can point. It takes about half a minute and needs no hands.'}
              </div>
            </div>
            <button type="button" className="btn primary" data-access="access:calibrate" onClick={() => go('/calibrate')}>
              <Icon name="target" />
              {model ? 'Calibrate again' : 'Calibrate now'}
            </button>
            {status.camera === 'error' && status.cameraError ? <p className="note bad" role="alert">{status.cameraError.message}</p> : null}
            <p className="note">
              <strong>What to expect.</strong> A phone or tablet camera can tell roughly where you are looking, not exactly: in good conditions to about the width of two fingers held
              at arm’s length. So the board switches to a few large targets, a tablet works much better than a phone, and the head needs to stay where it was during calibration.
              Head pointing is several times steadier. A dedicated eye tracker is more precise than either: if you have one, choose “Pointer dwell”.
            </p>
          </div>
        ) : null}

        {a.method === 'gaze' || a.method === 'head' || a.method === 'dwell' ? (
          <div className="card">
            <h2>Choosing by resting</h2>
            <Row title="Rest time" help="How long to stay on something to choose it.">
              <Stepper id="dwell" label="Rest time" value={a.dwellMs} min={400} max={3000} step={100} format={seconds} onChange={(dwellMs) => set({ dwellMs })} />
            </Row>
            {camera ? (
              <>
                <Row title="Choosing words" help="In two steps you look at a group of four words, then at the word. Targets stay large, and four times as many words fit on a page." column>
                  <Segmented
                    id="two-step"
                    label="Choosing words"
                    value={a.twoStep ?? 'auto'}
                    choices={[
                      { value: 'auto', label: 'Auto' },
                      { value: 'on', label: 'Two steps' },
                      { value: 'off', label: 'One step' },
                    ]}
                    onChange={(twoStep) => set({ twoStep })}
                  />
                </Row>
                <Row title="Steadiness" help="Higher is steadier but slower to follow.">
                  <Stepper id="smooth" label="Steadiness" value={a.smoothing} min={1} max={10} step={1} format={(v) => `${v} of 10`} onChange={(smoothing) => set({ smoothing })} />
                </Row>
                <Toggle id="pointer" title="Show where I am pointing" help="A small circle follows your eyes or head." value={a.showPointer} onChange={(showPointer) => set({ showPointer })} />
                <Toggle
                  id="learn"
                  title="Keep learning as I use it"
                  help="Uses each choice you make to stay accurate as you move. Experimental: turn it off if pointing gets worse."
                  value={a.learnFromUse}
                  onChange={(learnFromUse) => set({ learnFromUse })}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {a.method === 'scan' ? (
          <div className="card">
            <h2>Scanning</h2>
            <Row title="Speed" help="How long each choice stays lit.">
              <Stepper id="scan-speed" label="Scanning speed" value={a.scanIntervalMs} min={500} max={4000} step={100} format={seconds} onChange={(scanIntervalMs) => set({ scanIntervalMs })} />
            </Row>
            <Row title="Order" column>
              <Segmented
                id="scan-pattern"
                label="Scanning order"
                value={a.scanPattern}
                choices={[
                  { value: 'group', label: 'Rows first, then items' },
                  { value: 'linear', label: 'One at a time' },
                ]}
                onChange={(scanPattern) => set({ scanPattern })}
              />
            </Row>
            <Row title="Face switch" help="A movement the camera watches for. It has to be held for a moment, so ordinary blinking does not count." column>
              <Segmented id="gesture" label="Face switch" wrap value={a.switchGesture} choices={GESTURES} onChange={(switchGesture) => set({ switchGesture })} />
            </Row>
            {a.switchGesture !== 'none' ? (
              <>
                <Row title="How strong" help="Lower picks up smaller movements.">
                  <Stepper id="gesture-strength" label="Gesture strength" value={a.gestureThreshold} min={0.3} max={0.8} step={0.05} format={percent} onChange={(gestureThreshold) => set({ gestureThreshold })} />
                </Row>
                <Row title="Hold for" help="How long to hold it.">
                  <Stepper id="gesture-hold" label="Hold time" value={a.gestureHoldMs} min={200} max={1000} step={50} format={seconds} onChange={(gestureHoldMs) => set({ gestureHoldMs })} />
                </Row>
              </>
            ) : null}
            <Toggle id="keys" title="Keyboard or Bluetooth switch" help="Space or Enter picks the lit choice. Most switch adapters send one of these." value={a.switchKeys} onChange={(switchKeys) => set({ switchKeys })} />
            <Toggle id="tap" title="Tap anywhere" help="Any touch on the screen picks the lit choice." value={a.switchTap} onChange={(switchTap) => set({ switchTap })} />
          </div>
        ) : null}

        {a.method !== 'touch' ? (
          <div className="card">
            <h2>Always there</h2>
            <Toggle
              id="long-close"
              title="Close eyes to open the menu"
              help="Hold your eyes closed for two seconds to open the menu, where you can delete, pause, calibrate again or change how you choose. Needs the camera."
              value={a.longCloseMenu}
              onChange={(longCloseMenu) => set({ longCloseMenu })}
            />
            {camera ? (
              <>
                <Row
                  title="After closing eyes to open the menu, choose by"
                  help="Opened from its button, the menu is used by pointing. Opened by closing the eyes, it uses a face switch, which works even when pointing has drifted. Change this to pointing only if none of the face movements is possible."
                  column
                >
                  <Segmented
                    id="menu-by"
                    label="How the menu is used"
                    value={a.menuBy ?? 'switch'}
                    choices={[
                      { value: 'switch', label: 'Face switch' },
                      { value: 'point', label: 'Pointing' },
                    ]}
                    onChange={(menuBy) => set({ menuBy })}
                  />
                </Row>
                {(a.menuBy ?? 'switch') === 'switch' ? (
                  <Row title="Face switch" help="The choices light up in turn; this movement picks the lit one. It has to be held for a moment, so ordinary blinking does not count." column>
                    <Segmented
                      id="menu-gesture"
                      label="Face switch for the menu"
                      wrap
                      value={a.switchGesture === 'none' ? 'blink' : a.switchGesture}
                      choices={GESTURES.filter((item) => item.value !== 'none')}
                      onChange={(switchGesture) => set({ switchGesture })}
                    />
                  </Row>
                ) : null}
              </>
            ) : null}
            <Row title="Feedback sounds" help="A soft tick when something is chosen.">
              <Stepper id="cue" label="Feedback sound volume" value={a.cueVolume} min={0} max={1} step={0.2} format={(v) => (v === 0 ? 'Off' : percent(v))} onChange={(cueVolume) => set({ cueVolume })} />
            </Row>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── voice ──

function VoicePage() {
  const settings = useSettings();
  const v = settings.voice;
  const set = (change: Partial<typeof v>) => settings.patch('voice', change);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [looked, setLooked] = useState(false);
  const [word, setWord] = useState('');
  const [say, setSay] = useState('');

  useEffect(() => {
    void speaker.whenVoicesReady().then((list) => {
      setVoices(rankVoices(list, v.language, v.onDeviceOnly));
      setLooked(true);
    });
  }, [v.language, v.onDeviceOnly]);

  const current = voices.find((voice) => voice.uri === v.voiceUri) ?? voices[0];

  return (
    <>
      <PageHeader title="Voice" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="card pad stack">
          <button type="button" className="btn primary" data-access="voice:hear" onClick={() => speakSample('Hello. This is my voice.')}>
            <Icon name="speaker" />
            Hear this voice
          </button>
          {!speaker.supported ? <p className="note bad">This browser cannot speak aloud. Try Safari, Chrome or Edge.</p> : null}
        </div>

        <div className="card">
          <h2>Voice</h2>
          {voices.length === 0 ? (
            <div className="row">
              <span className="muted">
                {!looked
                  ? 'Looking for voices on this device…'
                  : v.onDeviceOnly
                    ? 'No English voice stored on this device was found. Install one in the device’s settings, or turn off “Only voices on this device” below.'
                    : 'This browser has no English voice. Install a text-to-speech voice in the device’s settings, or try another browser.'}
              </span>
            </div>
          ) : null}
          <div className="options" role="radiogroup" aria-label="Voice" style={{ padding: '8px 0 12px' }}>
            {voices.slice(0, 12).map((voice) => (
              <button key={voice.uri} type="button" className="option" role="radio" aria-checked={current?.uri === voice.uri} data-access={`voice:${voice.uri}`} onClick={() => { set({ voiceUri: voice.uri }); window.setTimeout(() => speakSample('Hello. This is my voice.'), 30); }}>
                <span className="option-icon"><Icon name="speaker" /></span>
                <span>
                  <span className="row-title" style={{ display: 'block' }}>{voice.name}</span>
                  <span className="row-help" style={{ display: 'block' }}>
                    {voice.tier === 'natural' ? 'Most natural' : voice.tier === 'good' ? 'Natural' : 'Basic'} · {voice.lang}
                    {voice.onDevice ? '' : ' · uses the internet'}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="small" style={{ paddingBottom: 12 }}>
            Better voices are often free to download in the device’s own settings (on iPhone and iPad: Accessibility, Spoken Content, Voices). They appear here afterwards.
          </p>
        </div>

        <div className="card">
          <h2>How it sounds</h2>
          <Row title="Speed">
            <Stepper id="rate" label="Speaking speed" value={v.rate} min={0.5} max={1.6} step={0.1} format={(x) => `${x.toFixed(1)}×`} onChange={(rate) => set({ rate })} />
          </Row>
          <Row title="Pitch">
            <Stepper id="pitch" label="Pitch" value={v.pitch} min={0.5} max={1.6} step={0.1} format={(x) => x.toFixed(1)} onChange={(pitch) => set({ pitch })} />
          </Row>
          <Row title="Volume">
            <Stepper id="volume" label="Volume" value={v.volume} min={0.2} max={1} step={0.1} format={percent} onChange={(volume) => set({ volume })} />
          </Row>
          <Toggle id="speak-words" title="Say each word as I choose it" help="Helps connect a picture with its word." value={v.speakWords} onChange={(speakWords) => set({ speakWords })} />
          <Toggle
            id="on-device"
            title="Only voices on this device"
            help="Some browser voices are made on the browser maker’s servers, which means what you say is sent to them. With this on, those voices are never used."
            value={v.onDeviceOnly}
            onChange={(onDeviceOnly) => set({ onDeviceOnly })}
          />
        </div>

        <div className="card pad stack">
          <div>
            <div className="row-title">Say a word differently</div>
            <div className="row-help">For names and words the voice gets wrong. Write it the way it sounds.</div>
          </div>
          {v.pronunciations.map((item, index) => (
            <div key={`${item.word}-${index}`} className="inline" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{item.word}</strong> is said “{item.say}”
              </span>
              <button type="button" className="btn quiet" onClick={() => set({ pronunciations: v.pronunciations.filter((_, i) => i !== index) })}>
                Remove
              </button>
            </div>
          ))}
          <div className="field-row">
            <input className="field" value={word} onChange={(event) => setWord(event.target.value)} placeholder="Word" aria-label="Word as written" />
            <input className="field" value={say} onChange={(event) => setSay(event.target.value)} placeholder="Sounds like" aria-label="How it sounds" />
          </div>
          <div className="inline">
            <button type="button" className="btn" disabled={!say.trim()} onClick={() => speakSample(say)}>
              <Icon name="speaker" />
              Try it
            </button>
            <button type="button" className="btn primary" disabled={!word.trim() || !say.trim()} onClick={() => { set({ pronunciations: [...v.pronunciations, { word: word.trim(), say: say.trim() }] }); setWord(''); setSay(''); }}>
              Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────── look ──

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
];

const SIZES: { value: TileSize; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
  { value: 'xl', label: 'Huge' },
];

function LookPage() {
  const settings = useSettings();
  const look = settings.look;
  const sentences = settings.sentences;
  return (
    <>
      <PageHeader title="Look and layout" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="card">
          <h2>Appearance</h2>
          <Row title="Theme" column>
            <Segmented id="theme" label="Theme" wrap value={look.theme} choices={THEMES} onChange={(theme) => settings.patch('look', { theme })} />
          </Row>
          <Row title="Tile size" help="Auto fits the screen and how you choose. Larger tiles mean fewer per page. With eye or head pointing, sizes are relative to what calibration found." column>
            <Segmented id="tile-size" label="Tile size" wrap value={look.tileSize} choices={SIZES} onChange={(tileSize) => settings.patch('look', { tileSize })} />
          </Row>
          <Toggle id="labels" title="Show the word under each picture" value={look.showLabels} onChange={(showLabels) => settings.patch('look', { showLabels })} />
          <Toggle
            id="colors"
            title="Colour tiles by word type"
            help="People yellow, actions green, describing words blue, things orange. The scheme speech therapists use."
            value={look.colorCoding}
            onChange={(colorCoding) => settings.patch('look', { colorCoding })}
          />
          <Toggle id="motion" title="Reduce movement" help="Turns off animations." value={look.reduceMotion} onChange={(reduceMotion) => settings.patch('look', { reduceMotion })} />
        </div>
        <div className="card">
          <h2>Sentences</h2>
          <Row title="Suggestions shown" help="How many ways to say it are offered, besides your exact words.">
            <Stepper id="count" label="Number of suggestions" value={sentences.count} min={1} max={4} step={1} format={String} onChange={(count) => { settings.patch('sentences', { count }); useTalk.getState().refresh(); }} />
          </Row>
          <Toggle id="predict" title="Suggest the next word" help="A row of likely next words above the board. It learns from what you say, on this device only." value={sentences.predictions} onChange={(predictions) => settings.patch('sentences', { predictions })} />
          <Toggle id="contractions" title="Use short forms" help="“I’m” and “don’t” rather than “I am” and “do not”." value={sentences.contractions} onChange={(contractions) => { settings.patch('sentences', { contractions }); useTalk.getState().refresh(); }} />
          <Toggle id="auto-home" title="Return to Home after a word" help="After choosing from a category, go back to the main board." value={sentences.autoHome} onChange={(autoHome) => settings.patch('sentences', { autoHome })} />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── words ──

const KINDS: { value: CustomKind; label: string }[] = [
  { value: 'thing', label: 'Thing' },
  { value: 'person', label: 'Person' },
  { value: 'action', label: 'Action' },
  { value: 'describe', label: 'Describing' },
  { value: 'phrase', label: 'Whole phrase' },
];

const KIND_BOARD: Record<CustomKind, string> = { thing: 'things', person: 'people', action: 'actions', describe: 'describe', phrase: 'chat' };

/** Shrink a chosen photo to a small square so it can live in this browser's storage. */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

function WordsPage() {
  const settings = useSettings();
  const talk = useTalk();
  const [phrase, setPhrase] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CustomKind>('thing');
  const [image, setImage] = useState<string | undefined>();
  const [boardId, setBoardId] = useState('food');
  const [problem, setProblem] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Hidden words stay visible here (dimmed) so they can be brought back.
  const vocabulary = useMemo(() => buildVocabulary({ hiddenWords: [], customWords: settings.customWords }), [settings.customWords]);
  const board = vocabulary.board(boardId);

  const add = () => {
    const text = label.trim();
    if (!text) return;
    if (settings.customWords.length >= 150) {
      setProblem('That is the most words this browser can keep. Remove one first.');
      return;
    }
    settings.addCustomWord({ id: `my-${Date.now().toString(36)}`, label: text, kind, board: KIND_BOARD[kind], image });
    setLabel('');
    setImage(undefined);
    setProblem('');
  };

  return (
    <>
      <PageHeader title="Words" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="card pad stack">
          <div>
            <div className="row-title">Add a word of your own</div>
            <div className="row-help">A name, a favourite food, a place, a saying. It appears first on its board.</div>
          </div>
          <input className="field" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="The word or phrase" aria-label="The word or phrase" />
          <Segmented id="kind" label="What kind of word" wrap value={kind} choices={KINDS} onChange={setKind} />
          <div className="inline">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                shrinkImage(file).then(setImage).catch(() => setProblem('That picture could not be used.'));
                event.target.value = '';
              }}
            />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="camera" />
              {image ? 'Change picture' : 'Add a picture'}
            </button>
            {image ? <img src={image} alt="" width={52} height={52} style={{ borderRadius: 10, background: '#fff' }} /> : null}
            <button type="button" className="btn primary" disabled={!label.trim()} onClick={add}>
              Add
            </button>
          </div>
          {problem ? <p className="note bad" role="alert">{problem}</p> : null}
          <p className="small">Pictures you add stay in this browser. They are not uploaded.</p>
        </div>

        {settings.customWords.length > 0 ? (
          <div className="card">
            <h2>Your words</h2>
            {settings.customWords.map((word) => (
              <div key={word.id} className="row">
                {word.image ? <img src={word.image} alt="" width={44} height={44} style={{ borderRadius: 8, background: '#fff' }} /> : null}
                <div className="row-text">
                  <div className="row-title">{word.label}</div>
                  <div className="row-help">{KINDS.find((item) => item.value === word.kind)?.label}</div>
                </div>
                <button type="button" className="btn quiet" onClick={() => settings.removeCustomWord(word.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="card pad stack">
          <div>
            <div className="row-title">Favourite phrases</div>
            <div className="row-help">Whole sentences kept for good: a name, an address, “I need the toilet”. They are offered at the top of the board whenever the message is empty and come first on “My phrases”. A sentence that was just said can also be saved from the menu.</div>
          </div>
          {talk.saved.map((text) => (
            <div key={text} className="inline" style={{ justifyContent: 'space-between' }}>
              <span>{text}</span>
              <button type="button" className="btn quiet" onClick={() => talk.toggleSaved(text)}>
                Remove
              </button>
            </div>
          ))}
          <div className="field-row">
            <input className="field" value={phrase} maxLength={160} onChange={(event) => setPhrase(event.target.value)} placeholder="My name is…" aria-label="A quick phrase" />
            <button
              type="button"
              className="btn primary"
              disabled={!phrase.trim() || talk.saved.includes(phrase.trim())}
              onClick={() => {
                talk.toggleSaved(phrase.trim());
                setPhrase('');
              }}
            >
              Add
            </button>
          </div>
        </div>

        <div className="card pad stack">
          <div>
            <div className="row-title">Hide words you don’t use</div>
            <div className="row-help">Tap a word to hide it or bring it back. Fewer words can make a board easier to scan. {settings.hiddenWords.length} hidden.</div>
          </div>
          <select className="field" value={boardId} onChange={(event) => setBoardId(event.target.value)} aria-label="Board">
            <option value="home">Home</option>
            {categoryBoards().map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <div className="word-list">
            {(board?.items ?? []).map((item) => {
              if (item.kind !== 'word') return null;
              const word = vocabulary.word(item.id);
              if (!word) return null;
              const hidden = settings.hiddenWords.includes(item.id);
              return (
                <Tile key={item.id} accessId={`hide:${item.id}`} group="words" label={word.label} image={vocabulary.image(item.id)} color={colorOf(word)} dimmed={hidden} hint={`${word.label}: ${hidden ? 'hidden, tap to show' : 'shown, tap to hide'}`} onSelect={() => settings.toggleHidden(item.id)} />
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────── data ──

function DataPage() {
  const settings = useSettings();
  const talk = useTalk();
  const [message, setMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** Whether the browser has promised not to clear this site's data by itself. */
  const [kept, setKept] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    void storageIsKept().then(setKept);
  }, []);

  const download = () => {
    const blob = new Blob([JSON.stringify({ app: 'voice-before-words', version: 1, settings: exportSettings(), favourites: talk.saved }, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'voice-before-words-backup.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    setMessage('Backup saved. It does not include your API key.');
  };

  return (
    <>
      <PageHeader title="Privacy and your data" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="note ok">
          <strong>Everything stays on this device unless you turn on AI or listening.</strong>
          <ul>
            <li>No account, no adverts, no tracking, no analytics.</li>
            <li>Words, history, settings and calibration are kept in this browser only.</li>
            <li>The camera picture is analysed on the device and never recorded or sent.</li>
            <li>
              {settings.ai.enabled
                ? 'AI is on: the symbols you choose, and the context you allow, are sent to the provider you chose so it can suggest sentences.'
                : 'AI is off: sentences are made on the device.'}
            </li>
            <li>
              {settings.listen.enabled
                ? 'Listening is on: while the screen says “Listening”, the browser sends the sound from the microphone to its maker (Google, Apple or Microsoft) to be turned into words. The other person’s words are not saved.'
                : 'Listening is off: the microphone is never used.'}
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Backup</h2>
          <Row title="Save a backup" help="Settings, your own words, favourite phrases and calibration, as a file. Your API key is never included.">
            <button type="button" className="btn" onClick={download}>
              <Icon name="download" />
              Save
            </button>
          </Row>
          <Row title="Restore a backup" help="Replaces the settings on this device.">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                file
                  .text()
                  .then((text) => {
                    const data = JSON.parse(text) as { settings?: unknown; favourites?: unknown };
                    const ok = importSettings(data.settings);
                    if (ok && data.favourites !== undefined) talk.setSaved(data.favourites);
                    setMessage(ok ? 'Backup restored.' : 'That file is not a backup from this app.');
                  })
                  .catch(() => setMessage('That file could not be read.'));
              }}
            />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              Restore
            </button>
          </Row>
          <Row
            title="Keep what is saved here"
            help={
              kept
                ? 'The browser has agreed not to clear this app’s words, favourites and settings by itself.'
                : 'Browsers sometimes clear a site’s saved data when space is short or the site has not been opened for a while. Ask this one not to. Adding the app to the home screen helps too.'
            }
          >
            {kept ? (
              <span className="muted">On</span>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void requestKeptStorage().then((ok) => {
                    setKept(ok);
                    setMessage(ok ? 'The browser will keep this app’s data.' : 'The browser did not agree. Add the app to the home screen, and save a backup now and then.');
                  });
                }}
              >
                <Icon name="shield" />
                Ask
              </button>
            )}
          </Row>
          {message ? <p className="note" role="status" style={{ marginBottom: 12 }}>{message}</p> : null}
        </div>

        <div className="card">
          <h2>Clear</h2>
          <Row title="What I have said" help={`${talk.history.length} sentences, the word habits learned from them, and remembered AI answers. Favourites are kept.`}>
            <button type="button" className="btn danger" onClick={() => { talk.forgetHistory(); setMessage('History cleared.'); }}>
              Clear
            </button>
          </Row>
          <Row title="Calibrations" help="Forget how the camera was calibrated.">
            <button type="button" className="btn danger" onClick={() => { settings.forgetModels(); access.configure(useSettings.getState().access, {}); setMessage('Calibrations forgotten.'); }}>
              Forget
            </button>
          </Row>
          <Row title="Everything" help="Back to how the app was the first time, including removing the API key.">
            {confirmReset ? (
              <button type="button" className="btn danger" onClick={() => { talk.forgetHistory(); talk.setSaved([]); settings.reset(); settings.set({ ...DEFAULT_SETTINGS }); go('/welcome'); }}>
                Yes, reset
              </button>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmReset(true)}>
                Reset
              </button>
            )}
          </Row>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── about ──

function AboutPage() {
  const pwa = usePwa();
  return (
    <>
      <PageHeader title="About" onBack={() => go('/settings')} />
      <div className="page-body">
        <div className="card pad stack">
          <div className="row-title">Voice Before Words</div>
          <p className="muted">
            A free communication board for people who cannot rely on speech. Choose symbols, pick the sentence that says what you mean, and it is spoken aloud. Works by touch, eyes, head
            movement, a single switch or a pointer.
          </p>
          <p className="muted">
            This is an aid, not a medical device, and it has not been clinically evaluated. A speech and language therapist can help choose and set up the right system for a person.
          </p>
          {pwa.updateReady ? (
            <button type="button" className="btn primary" onClick={() => pwa.applyUpdate()}>
              A new version is ready. Update now
            </button>
          ) : null}
          {pwa.offlineReady ? <p className="note ok">Saved on this device. The board works without the internet.</p> : null}
        </div>
        <div className="card pad stack">
          <div className="row-title">Thanks</div>
          <p className="muted">
            Symbols: <a href="https://mulberrysymbols.org" target="_blank" rel="noreferrer">Mulberry Symbols</a> by Steve Lee and the Otsimo symbol set, both under the Creative Commons BY-SA 4.0 licence.
          </p>
          <p className="muted">
            Face tracking: MediaPipe Face Landmarker by Google, Apache 2.0 licence, running entirely on this device. Typeface: Atkinson Hyperlegible Next by the Braille Institute.
          </p>
          <p className="muted">The app’s own code is open source under the MIT licence.</p>
        </div>
      </div>
    </>
  );
}

export function SettingsView({ route }: { route: string }) {
  const section = route.split('/')[2] ?? '';
  return (
    <div className="page">
      {section === 'access' ? <AccessPage /> : null}
      {section === 'voice' ? <VoicePage /> : null}
      {section === 'ai' ? <AiSettingsPage /> : null}
      {section === 'listen' ? <ListenSettingsPage /> : null}
      {section === 'look' ? <LookPage /> : null}
      {section === 'words' ? <WordsPage /> : null}
      {section === 'data' ? <DataPage /> : null}
      {section === 'about' ? <AboutPage /> : null}
      {!['access', 'voice', 'ai', 'listen', 'look', 'words', 'data', 'about'].includes(section) ? <Index /> : null}
    </div>
  );
}
