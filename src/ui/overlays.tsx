import { useEffect, useRef } from 'react';
import { access, type AccessStatus } from '../access/controller';
import type { GestureKind } from '../access/gestures';
import { unlockSounds } from '../speech/sounds';
import { speaker } from '../speech/speaker';
import { useSettings } from '../state/settings';
import { useTalk } from '../state/talk';
import { CATEGORIES_BOARD, HOME_BOARD } from '../vocab/boards';
import { BrandMark, Icon } from './Icon';
import { go } from './hooks';

const GESTURE_HINT: Record<GestureKind, string> = {
  blink: 'Blink slowly',
  brows: 'Raise your eyebrows',
  mouth: 'Open your mouth',
  smile: 'Smile',
};

/** The hands-free menu closes itself if nothing is chosen for this long, so it can never be a trap. */
const MENU_TIMEOUT_MS = 45000;

/**
 * Shown when a hands-free method is chosen but not yet switched on. Browsers
 * only allow the camera and speech after a real touch or key press, so this is
 * the one moment each session that needs one. The whole screen is the button.
 */
export function StartGate({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') onStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);
  return (
    <button type="button" className="gate" data-direct onClick={onStart} aria-label="Tap anywhere to start">
      <BrandMark className="brand-mark" />
      <h1>Tap anywhere to start</h1>
      <p>One tap lets the browser use the camera and the voice. After that everything can be done without hands.</p>
      <span className="pulse" aria-hidden="true"><Icon name="touch" /></span>
    </button>
  );
}

export function unlockEverything(): void {
  speaker.unlock();
  unlockSounds();
}

interface MenuProps {
  status: AccessStatus;
  onClose: () => void;
}

/**
 * The menu. When pointing with eyes or head it is worked by scanning and a face
 * gesture (unless the person chose otherwise), so it can always be reached and
 * used: hold the eyes closed for two seconds to open it, even when pointing has
 * gone wrong. It also carries the controls there was no room for on the board.
 */
export function Menu({ status, onClose }: MenuProps) {
  const talk = useTalk();
  const settings = useSettings();
  const camera = status.method === 'gaze' || status.method === 'head';
  const handsFree = camera && status.active;
  const scanning = handsFree && settings.access.menuBy !== 'point';
  const gesture = settings.access.switchGesture === 'none' ? 'blink' : settings.access.switchGesture;
  const empty = talk.tokens.length === 0 && !talk.typed;

  useEffect(() => {
    access.setMenuOpen(true);
    return () => access.setMenuOpen(false);
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!handsFree) return;
    const timer = window.setTimeout(() => closeRef.current(), MENU_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [handsFree]);

  const close = (then?: () => void) => () => {
    onClose();
    then?.();
  };

  const back = (
    <button type="button" className="menu-item primary" data-access="menu:back" onClick={close()}>
      <Icon name="back" />
      Back to talking
    </button>
  );
  const repeat = talk.lastSaid ? (
    <button type="button" className="menu-item" data-access="menu:repeat" onClick={close(() => talk.sayPhrase(talk.lastSaid))}>
      <Icon name="speaker" />
      Say it again
    </button>
  ) : null;
  const recent = (
    <button type="button" className="menu-item" data-access="menu:recent" onClick={close(() => talk.open('recent'))}>
      <Icon name="history" />
      Said before
    </button>
  );
  const pause =
    status.method !== 'touch' && status.active ? (
      <button type="button" className="menu-item" data-access="menu:pause" onClick={close(() => access.setPaused(!status.paused))}>
        <Icon name={status.paused ? 'play' : 'pause'} />
        {status.paused ? 'Carry on' : 'Pause and rest'}
      </button>
    ) : null;
  const settingsItem = (
    <button type="button" className="menu-item" data-access="menu:settings" onClick={close(() => go('/settings'))}>
      <Icon name="settings" />
      Settings
    </button>
  );

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Menu" data-access-scope onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={camera ? 'sheet wide' : 'sheet'}>
        <h2>Menu</h2>
        <p className="sheet-sub">{scanning ? `Choices light up in turn. ${GESTURE_HINT[gesture]} to pick the lit one.` : 'What would you like to do?'}</p>
        {camera ? (
          <>
            {/* Three groups, so scanning reaches anything in two steps. */}
            <div className="menu-grid" data-access-group="menu-message">
              {back}
              <button type="button" className="menu-item" disabled={empty} data-access="menu:delete" onClick={close(() => talk.backspace())}>
                <Icon name="backspace" />
                Delete last word
              </button>
              <button type="button" className="menu-item" disabled={empty} data-access="menu:clear" onClick={close(() => talk.clear())}>
                <Icon name="clear" />
                Clear message
              </button>
              {repeat}
            </div>
            <div className="menu-grid" data-access-group="menu-boards">
              <button type="button" className="menu-item" data-access="menu:home" onClick={close(() => talk.open(HOME_BOARD))}>
                <Icon name="home" />
                Home
              </button>
              <button type="button" className="menu-item" data-access="menu:words" onClick={close(() => talk.open(CATEGORIES_BOARD))}>
                <Icon name="grid" />
                All words
              </button>
              <button type="button" className="menu-item" data-access="menu:keys" onClick={close(() => talk.open('keyboard'))}>
                <Icon name="keyboard" />
                Spell
              </button>
              {recent}
            </div>
            <div className="menu-grid" data-access-group="menu-setup">
              {pause}
              <button type="button" className="menu-item" data-access="menu:calibrate" onClick={close(() => go('/calibrate'))}>
                <Icon name="target" />
                Calibrate again
              </button>
              {settingsItem}
            </div>
          </>
        ) : (
          <div className="menu-grid">
            {back}
            {pause}
            {recent}
            {repeat}
            {settingsItem}
          </div>
        )}
        {settings.ai.enabled ? (
          <label className="partner">
            <span className="row-title">What was just said to them?</span>
            <span className="row-help">Optional, for whoever is talking with them. The AI uses it to suggest answers that fit. It is sent with the next suggestions and not kept.</span>
            <span className="field-row">
              <input className="field" data-direct value={talk.partnerSaid} maxLength={300} onChange={(event) => talk.setPartnerSaid(event.target.value)} placeholder="Do you want juice or milk?" aria-label="What the other person said" />
              {talk.partnerSaid ? (
                <button type="button" className="btn" data-direct onClick={() => talk.setPartnerSaid('')}>
                  Clear
                </button>
              ) : null}
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
