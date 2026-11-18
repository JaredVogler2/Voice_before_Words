import { useCallback, useEffect, useState } from 'react';
import { access, modelKey, viewportSize } from './access/controller';
import { useSettings } from './state/settings';
import { Menu, StartGate, unlockEverything } from './ui/overlays';
import { go, useAccessStatus, useMediaQuery, useRoute } from './ui/hooks';
import { CalibrationView } from './views/CalibrationView';
import { SettingsView } from './views/SettingsView';
import { StatusPill, TalkView } from './views/TalkView';
import { WelcomeView } from './views/WelcomeView';

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const status = useAccessStatus();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [menuOpen, setMenuOpen] = useState(false);

  // Theme and motion are attributes on the page so the stylesheet can do the rest.
  const theme = settings.look.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.look.theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.colors = settings.look.colorCoding ? 'on' : 'off';
    root.dataset.motion = settings.look.reduceMotion ? 'reduced' : 'full';
    const bar = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#f4f1ea');
  }, [theme, settings.look.colorCoding, settings.look.reduceMotion]);

  // Keep the hands-free controller in step with the settings and saved calibrations.
  useEffect(() => {
    access.configure(settings.access, settings.models);
  }, [settings.access, settings.models]);

  useEffect(
    () =>
      access.on((event) => {
        if (event.type === 'menu') setMenuOpen(true);
        if (event.type === 'model') useSettings.getState().saveModel(event.key, event.model);
      }),
    [],
  );

  // The first real touch or key press of a session unlocks speech and sound.
  useEffect(() => {
    const unlock = () => unlockEverything();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  const method = settings.access.method;
  const onTalk = route === '/';

  // New here: start with the welcome screens.
  useEffect(() => {
    if (!settings.onboarded && route !== '/welcome') go('/welcome');
  }, [settings.onboarded, route]);

  // Back to touch: switch the camera and everything else off.
  useEffect(() => {
    if (method === 'touch' && status.active) access.disable();
  }, [method, status.active]);

  // Pointing with eyes or head needs a calibration for this screen first.
  useEffect(() => {
    if (!onTalk || !status.active || status.calibrating) return;
    if ((method === 'gaze' || method === 'head') && status.camera === 'running') {
      const model = settings.models[modelKey(method, viewportSize())];
      if (!model || !status.calibrated) go('/calibrate');
    }
  }, [onTalk, method, status.active, status.calibrating, status.calibrated, status.camera, settings.models]);

  // Leaving the board closes the menu; it belongs to the board.
  useEffect(() => {
    if (!onTalk) setMenuOpen(false);
  }, [onTalk]);

  const start = useCallback(() => {
    unlockEverything();
    void access.enable();
  }, []);

  const needsGate = settings.onboarded && onTalk && method !== 'touch' && !status.active;

  return (
    <div className="app">
      {route === '/welcome' ? (
        <WelcomeView />
      ) : route === '/calibrate' ? (
        <CalibrationView />
      ) : route.startsWith('/settings') ? (
        <SettingsView route={route} />
      ) : (
        <>
          <TalkView onMenu={() => setMenuOpen(true)} />
          <StatusPill status={status} />
          {menuOpen ? <Menu status={status} onClose={() => setMenuOpen(false)} /> : null}
          {needsGate ? <StartGate onStart={start} /> : null}
        </>
      )}
    </div>
  );
}
