import { useEffect } from 'react';
import { access, type AccessStatus } from '../access/controller';
import { unlockSounds } from '../speech/sounds';
import { speaker } from '../speech/speaker';
import { listenNow } from '../state/listening';
import { useSettings } from '../state/settings';
import { useTalk } from '../state/talk';
import { BrandMark, Icon } from './Icon';
import { go } from './hooks';

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
    <div className="gate-wrap">
      <button type="button" className="gate" data-direct onClick={onStart} aria-label="Tap anywhere to start">
        <BrandMark className="brand-mark" />
        <h1>Tap anywhere to start</h1>
        <p>One tap lets the browser use the camera and the voice. After that everything can be done without hands.</p>
        <span className="pulse" aria-hidden="true"><Icon name="touch" /></span>
      </button>
      {/* For whoever is helping: the way to settings before anything is switched on. */}
      <button type="button" className="btn gate-settings" data-direct onClick={() => go('/settings/access')}>
        <Icon name="settings" />
        Settings
      </button>
    </div>
  );
}

export function unlockEverything(): void {
  speaker.unlock();
  unlockSounds();
  keepStorage();
}

let askedToKeep = false;
/**
 * Ask the browser not to clear what is saved here (words, favourites, history,
 * calibration) when it is short of space or the site has not been opened for a
 * while. Browsers may say no; adding the app to the home screen makes yes likely.
 *
 * Firefox answers this by showing the person a permission pop-up, which must
 * not appear out of nowhere on someone's first touch (and cannot be answered
 * without hands). There it is only asked from the button in Settings.
 */
function keepStorage(): void {
  if (askedToKeep) return;
  askedToKeep = true;
  if (/\bGecko\/\d/.test(navigator.userAgent)) return;
  void requestKeptStorage();
}

/** Ask now. Resolves to whether the browser has agreed to keep this site's data. */
export async function requestKeptStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Whether the browser has already agreed. Undefined where it cannot be told. */
export async function storageIsKept(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persisted?.();
  } catch {
    return undefined;
  }
}

interface MenuProps {
  status: AccessStatus;
  onClose: () => void;
}

/** The menu when choosing by touch. Every other method gets the large-target menu in HandsFreeMenu.tsx. */
export function Menu({ status, onClose }: MenuProps) {
  const talk = useTalk();
  const settings = useSettings();

  useEffect(() => {
    access.setMenuOpen(true);
    return () => access.setMenuOpen(false);
  }, []);

  const close = (then?: () => void) => () => {
    onClose();
    then?.();
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Menu" data-access-scope onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet">
        <h2>Menu</h2>
        <p className="sheet-sub">What would you like to do?</p>
        <div className="menu-grid">
          <button type="button" className="menu-item primary" data-access="menu:back" onClick={close()}>
            <Icon name="back" />
            Back to talking
          </button>
          {status.method !== 'touch' && status.active ? (
            <button type="button" className="menu-item" data-access="menu:pause" onClick={close(() => access.setPaused(!status.paused))}>
              <Icon name={status.paused ? 'play' : 'pause'} />
              {status.paused ? 'Carry on' : 'Pause and rest'}
            </button>
          ) : null}
          <button type="button" className="menu-item" data-access="menu:recent" onClick={close(() => talk.open('recent'))}>
            <Icon name="history" />
            My phrases
          </button>
          {talk.lastSaid ? (
            <button type="button" className="menu-item" data-access="menu:favourite" onClick={close(() => talk.toggleSaved(talk.lastSaid))}>
              <Icon name="star" />
              {talk.saved.includes(talk.lastSaid) ? 'Remove from favourites' : 'Save as a favourite'}
            </button>
          ) : null}
          {talk.lastSaid ? (
            <button type="button" className="menu-item" data-access="menu:repeat" onClick={close(() => talk.sayPhrase(talk.lastSaid))}>
              <Icon name="speaker" />
              Say it again
            </button>
          ) : null}
          {settings.listen.enabled ? (
            <button type="button" className="menu-item" data-access="menu:listen" onClick={close(() => listenNow())}>
              <Icon name="mic" />
              Listen now
            </button>
          ) : null}
          <button type="button" className="menu-item" data-access="menu:access" onClick={close(() => go('/settings/access'))}>
            <Icon name="touch" />
            How I choose
          </button>
          <button type="button" className="menu-item" data-access="menu:voice" onClick={close(() => go('/settings/voice'))}>
            <Icon name="speaker" />
            Voice
          </button>
          <button type="button" className="menu-item" data-access="menu:ai" onClick={close(() => go('/settings/ai'))}>
            <Icon name="key" />
            AI key
          </button>
          <button type="button" className="menu-item" data-access="menu:settings" onClick={close(() => go('/settings'))}>
            <Icon name="settings" />
            All settings
          </button>
        </div>
        <label className="partner">
            <span className="row-title">What was just said to them?</span>
            <span className="row-help">
              Optional, for whoever is talking with them. The app offers answers that fit. {settings.ai.enabled ? 'It is sent to the AI with the next suggestions and not kept.' : 'It stays on this device and is not kept.'}
            </span>
            <span className="field-row">
              <input className="field" data-direct value={talk.partnerSaid} maxLength={300} onChange={(event) => talk.setPartnerSaid(event.target.value)} placeholder="Do you want juice or milk?" aria-label="What the other person said" />
              {talk.partnerSaid ? (
                <button type="button" className="btn" data-direct onClick={() => talk.setPartnerSaid('')}>
                  Clear
                </button>
              ) : null}
            </span>
          </label>
      </div>
    </div>
  );
}
