import { create } from 'zustand';

/**
 * Offline support and updates.
 *
 * A new version is never applied in the middle of a session: a communication
 * aid that reloads mid-sentence has failed at its one job. The update waits
 * until the app is next opened, or until someone presses "Update now".
 */
interface PwaStore {
  offlineReady: boolean;
  updateReady: boolean;
  applyUpdate(): void;
}

let update: ((reload?: boolean) => Promise<void>) | null = null;

export const usePwa = create<PwaStore>(() => ({
  offlineReady: false,
  updateReady: false,
  applyUpdate: () => void update?.(true),
}));

export async function registerOfflineSupport(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    update = registerSW({
      immediate: true,
      onNeedRefresh: () => usePwa.setState({ updateReady: true }),
      onOfflineReady: () => usePwa.setState({ offlineReady: true }),
    });
    // That callback only fires the first time. On every later visit the app is
    // already saved, which an active service worker for this page tells us.
    void navigator.serviceWorker.ready.then(() => usePwa.setState({ offlineReady: true }));
  } catch {
    // No offline support here (for example a private window). The app still works online.
  }
}
