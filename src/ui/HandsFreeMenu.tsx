import { useEffect, useRef, useState } from 'react';
import { access, type AccessMethod, type AccessStatus } from '../access/controller';
import type { GestureKind } from '../access/gestures';
import { PROVIDERS } from '../llm';
import { speaker } from '../speech/speaker';
import { rankVoices, type VoiceInfo } from '../speech/voices';
import { useSettings } from '../state/settings';
import { useTalk } from '../state/talk';
import { TRIAL_CONFIRM_MS, useTrial } from '../state/trial';
import { METHODS } from '../views/methods';
import { CATEGORIES_BOARD, HOME_BOARD } from '../vocab/boards';
import { Icon } from './Icon';
import { go, useViewport } from './hooks';

/**
 * The menu for anyone not using touch. It fills the screen with a few large
 * choices, never more than six, so it can be worked by eyes, head, a resting
 * pointer or a single switch, exactly like the board. It reaches everything a
 * person set up at the start and may need to set up again: how they choose,
 * calibration, speed, the voice, and whether an AI model is used. Nothing chosen
 * during setup is a one-way door.
 *
 * Opened from the Menu button, it is worked by the method that opened it.
 * Opened by holding the eyes closed, it is worked by scanning and a face
 * gesture instead: that is the way in when pointing has drifted too far to use.
 */

const GESTURE_HINT: Record<GestureKind, string> = {
  blink: 'Blink slowly',
  brows: 'Raise your eyebrows',
  mouth: 'Open your mouth',
  smile: 'Smile',
};

/** With nothing chosen for this long the menu goes away, so it can never be a trap. */
const MENU_TIMEOUT_MS = 45_000;

type Screen = 'main' | 'boards' | 'settings' | 'more' | 'methods' | 'voice' | 'ai';

interface Cell {
  id: string;
  icon: string;
  label: string;
  detail?: string;
  primary?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

const TITLE: Record<Screen, string> = { main: 'Menu', boards: 'Boards', settings: 'Settings', more: 'More settings', methods: 'How I choose', voice: 'Voice', ai: 'Smart sentences' };
/** Where Back goes from each screen. */
const PARENT: Record<Screen, Screen> = { main: 'main', boards: 'main', settings: 'main', more: 'settings', methods: 'settings', voice: 'more', ai: 'more' };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Cells({ cells, onUse }: { cells: Cell[]; onUse?: () => void }) {
  const viewport = useViewport();
  const columns = cells.length <= 2 ? cells.length : viewport.width > viewport.height && cells.length > 4 ? 3 : 2;
  return (
    <div className="hf-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {cells.map((cell, index) => (
        <button
          key={cell.id}
          type="button"
          className={cell.primary ? 'hf-cell primary' : 'hf-cell'}
          disabled={cell.disabled}
          data-access={`menu:${cell.id}`}
          data-access-group={`menu-row-${Math.floor(index / columns) + 1}`}
          onClick={() => {
            onUse?.();
            cell.onSelect();
          }}
        >
          <Icon name={cell.icon} />
          <span>{cell.label}</span>
          {cell.detail ? <small>{cell.detail}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function HandsFreeMenu({ status, via, onClose }: { status: AccessStatus; via: 'pointer' | 'eyes'; onClose: () => void }) {
  const talk = useTalk();
  const settings = useSettings();
  const trial = useTrial();
  const [screen, setScreen] = useState<Screen>('main');
  /** Counts choices made, so the menu only closes itself after a real silence. */
  const [uses, setUses] = useState(0);
  const a = settings.access;
  const camera = a.method === 'gaze' || a.method === 'head';
  const scanning = a.method === 'scan' || (camera && via === 'eyes' && a.menuBy !== 'point');
  const gesture = a.switchGesture === 'none' ? 'blink' : a.switchGesture;
  const empty = talk.tokens.length === 0 && !talk.typed;

  // The voices this device has, best first, for stepping through without typing.
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  useEffect(() => {
    void speaker.whenVoicesReady().then((list) => setVoices(rankVoices(list, settings.voice.language, settings.voice.onDeviceOnly).slice(0, 12)));
  }, [settings.voice.language, settings.voice.onDeviceOnly]);
  const hear = (uri: string) => {
    const v = useSettings.getState().voice;
    void speaker.speak('Hello. This is my voice.', { rate: v.rate, pitch: v.pitch, volume: v.volume, voiceUri: uri, language: v.language, onDeviceVoicesOnly: v.onDeviceOnly, pronunciations: v.pronunciations });
  };

  useEffect(() => {
    access.setMenuOpen(true, via);
    return () => access.setMenuOpen(false);
  }, [via]);

  // Each new screen is new content under the pointer: give the eyes a moment.
  useEffect(() => {
    access.layoutChanged();
  }, [screen]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current(), MENU_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [screen, uses]);

  const done = (then?: () => void) => () => {
    onClose();
    then?.();
  };
  const back: Cell = { id: `back:${screen}`, icon: 'back', label: screen === 'main' ? 'Back to talking' : 'Back', primary: true, onSelect: screen === 'main' ? done() : () => setScreen(PARENT[screen]) };
  const pause: Cell = { id: 'pause', icon: status.paused ? 'play' : 'pause', label: status.paused ? 'Carry on' : 'Pause and rest', onSelect: done(() => access.setPaused(!status.paused)) };

  let cells: Cell[];
  if (screen === 'main') {
    cells = [
      back,
      { id: 'delete', icon: 'backspace', label: 'Delete last word', disabled: empty, onSelect: () => talk.backspace() },
      { id: 'clear', icon: 'clear', label: 'Clear message', disabled: empty, onSelect: done(() => talk.clear()) },
      { id: 'repeat', icon: 'speaker', label: 'Say it again', disabled: !talk.lastSaid, onSelect: done(() => talk.sayPhrase(talk.lastSaid)) },
      { id: 'boards', icon: 'grid', label: 'Boards', detail: 'Home, all words, spell', onSelect: () => setScreen('boards') },
      { id: 'settings', icon: 'settings', label: 'Settings', detail: 'How I choose, calibrate, voice, AI', onSelect: () => setScreen('settings') },
    ];
  } else if (screen === 'boards') {
    cells = [
      back,
      { id: 'home', icon: 'home', label: 'Home', onSelect: done(() => talk.open(HOME_BOARD)) },
      { id: 'words', icon: 'grid', label: 'All words', onSelect: done(() => talk.open(CATEGORIES_BOARD)) },
      { id: 'keys', icon: 'keyboard', label: 'Spell', onSelect: done(() => talk.open('keyboard')) },
      { id: 'recent', icon: 'history', label: 'Said before', onSelect: done(() => talk.open('recent')) },
    ];
  } else if (screen === 'settings') {
    // One speed control: how long to rest on something, or how long each choice stays lit.
    const scan = a.method === 'scan';
    const value = scan ? a.scanIntervalMs : a.dwellMs;
    const [least, most] = scan ? [500, 4000] : [400, 3000];
    const change = (by: number) => () => settings.patch('access', scan ? { scanIntervalMs: Math.max(least, Math.min(most, value + by)) } : { dwellMs: Math.max(least, Math.min(most, value + by)) });
    const what = scan ? 'Each choice lit for' : 'Rest to choose for';
    cells = [
      back,
      { id: 'methods', icon: METHODS.find((item) => item.id === a.method)?.icon ?? 'touch', label: 'How I choose', detail: METHODS.find((item) => item.id === a.method)?.title, onSelect: () => setScreen('methods') },
      { id: 'slower', icon: 'plus', label: 'Slower', detail: `${what} ${seconds(value)}`, disabled: value >= most, onSelect: change(200) },
      { id: 'faster', icon: 'minus', label: 'Faster', detail: `${what} ${seconds(value)}`, disabled: value <= least, onSelect: change(-200) },
      camera ? { id: 'calibrate', icon: 'target', label: 'Calibrate again', onSelect: done(() => go('/calibrate')) } : pause,
      { id: 'more', icon: 'forward', label: 'More settings', detail: 'Voice, AI, everything else', onSelect: () => setScreen('more') },
    ];
  } else if (screen === 'more') {
    cells = [
      back,
      { id: 'voice', icon: 'speaker', label: 'Voice', detail: voices.find((voice) => voice.uri === settings.voice.voiceUri)?.name ?? voices[0]?.name, onSelect: () => setScreen('voice') },
      { id: 'ai', icon: 'spark', label: 'Smart sentences', detail: settings.ai.enabled ? 'AI is on' : 'AI is off', onSelect: () => setScreen('ai') },
      ...(camera ? [pause] : []),
      { id: 'all', icon: 'settings', label: 'All settings', detail: 'These pages need touch', onSelect: done(() => go('/settings')) },
    ];
  } else if (screen === 'voice') {
    const at = Math.max(0, voices.findIndex((voice) => voice.uri === settings.voice.voiceUri));
    const step = (by: number) => () => {
      if (voices.length === 0) return;
      const next = voices[(at + by + voices.length) % voices.length];
      settings.patch('voice', { voiceUri: next.uri });
      hear(next.uri);
    };
    const current = voices[at]?.name ?? 'No voice found';
    cells = [
      back,
      { id: 'voice-next', icon: 'forward', label: 'Next voice', detail: current, disabled: voices.length < 2, onSelect: step(1) },
      { id: 'voice-prev', icon: 'back', label: 'Voice before', detail: current, disabled: voices.length < 2, onSelect: step(-1) },
      { id: 'voice-hear', icon: 'speaker', label: 'Hear it', detail: current, disabled: voices.length === 0, onSelect: () => hear(voices[at]?.uri ?? '') },
    ];
  } else if (screen === 'ai') {
    const ai = settings.ai;
    const provider = PROVIDERS[ai.provider];
    const hasKey = provider.needsBaseUrl ? !!ai.baseUrl.trim() : !!ai.apiKey.trim();
    const models = provider.models;
    const modelAt = Math.max(0, models.findIndex((model) => model.id === ai.model));
    cells = [
      back,
      {
        id: `ai-toggle:${ai.enabled ? 'on' : 'off'}`,
        icon: 'spark',
        label: ai.enabled ? 'Turn AI off' : 'Turn AI on',
        detail: hasKey ? (ai.enabled ? `Using ${provider.label}` : 'Sentences are made on this device') : 'Needs a key first',
        disabled: !hasKey && !ai.enabled,
        onSelect: () => {
          settings.patch('ai', { enabled: !ai.enabled });
          useTalk.getState().refresh();
        },
      },
      ...(models.length > 1
        ? [{ id: 'ai-model', icon: 'forward', label: 'Next model', detail: models[modelAt].label, onSelect: () => settings.patch('ai', { model: models[(modelAt + 1) % models.length].id }) }]
        : []),
      // A key is a long string of letters and numbers: it has to be typed or pasted, so this opens the page for it.
      { id: 'ai-key', icon: 'key', label: hasKey ? 'Change or remove the key' : 'Add a key', detail: 'Needs typing or pasting', onSelect: done(() => go('/settings/ai')) },
    ];
  } else {
    cells = [
      back,
      ...METHODS.map((item): Cell => ({
        id: `method:${item.id}`,
        icon: item.icon,
        label: item.title,
        detail: item.id === a.method ? 'Using this now' : undefined,
        disabled: item.id === a.method,
        // A trial, not a commitment: see state/trial.ts.
        onSelect: done(() => trial.begin(item.id as AccessMethod)),
      })),
    ];
  }

  return (
    <div className="hf-menu" role="dialog" aria-modal="true" aria-label={TITLE[screen]} data-access-scope>
      <div className="hf-head">
        <h2>{TITLE[screen]}</h2>
        <p>
          {screen === 'methods'
            ? 'Pick one to try it. You will be asked to confirm with the new way; if you don’t, this one comes back.'
            : scanning
              ? `Choices light up in turn. ${a.method === 'scan' && a.switchGesture === 'none' ? 'Press your switch' : GESTURE_HINT[gesture]} to pick the lit one.`
              : 'Rest on a choice to pick it.'}
        </p>
      </div>
      <Cells cells={cells} onUse={() => setUses((count) => count + 1)} />
    </div>
  );
}

/**
 * Shown after a method was changed from the hands-free menu, once the new
 * method is ready to use. Confirming has to be done with the new method, which
 * proves it works for this person. With no answer the old method returns.
 */
export function MethodTrial() {
  const { trial, keep, revert } = useTrial();
  const [left, setLeft] = useState(Math.ceil(TRIAL_CONFIRM_MS / 1000));
  /**
   * Keeping takes two choices in two different places. A pointer that is stuck,
   * or pointing nowhere near where the person is looking, can rest on one cell
   * by accident; it cannot then move to the other side of the screen.
   */
  const [sure, setSure] = useState(false);

  useEffect(() => {
    access.layoutChanged();
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.ceil((TRIAL_CONFIRM_MS - (Date.now() - started)) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) useTrial.getState().revert();
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    access.layoutChanged();
  }, [sure]);

  if (!trial) return null;
  const name = (id: AccessMethod) => METHODS.find((item) => item.id === id)?.title ?? id;
  const goBack: Cell = { id: 'trial:revert', icon: 'undo', label: `Go back to “${name(trial.previous)}”`, onSelect: revert };
  const cells: Cell[] = sure
    ? [goBack, { id: 'trial:confirm', icon: 'check', label: 'Yes, keep it', primary: true, onSelect: keep }]
    : [{ id: 'trial:keep', icon: 'check', label: `Keep “${name(trial.method)}”`, primary: true, onSelect: () => setSure(true) }, goBack];
  return (
    <div className="hf-menu" role="alertdialog" aria-modal="true" aria-label="Keep this way of choosing?" data-access-scope>
      <div className="hf-head">
        <h2>{sure ? 'One more, to be sure' : 'Is this working for you?'}</h2>
        <p>
          {sure
            ? `Pick “Yes, keep it”, on the other side this time.`
            : `You are now choosing with “${name(trial.method)}”. Pick Keep to stay with it.`}{' '}
          In {left} seconds it goes back to “{name(trial.previous)}” by itself.
        </p>
      </div>
      <Cells cells={cells} />
    </div>
  );
}
