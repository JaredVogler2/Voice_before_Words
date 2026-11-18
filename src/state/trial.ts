import { create } from 'zustand';
import type { AccessMethod } from '../access/controller';
import { useSettings } from './settings';

/**
 * Trying a new way of choosing, with a way back.
 *
 * Someone who changes method without hands is taking a risk: if the new one
 * does not work for them, they have no means of changing it back. So a change
 * made from the hands-free menu is a trial. It has to be confirmed using the
 * new method; if it is not, the app returns to the method that worked.
 */
interface Trial {
  method: AccessMethod;
  previous: AccessMethod;
  startedAt: number;
}

interface TrialStore {
  trial: Trial | null;
  begin(method: AccessMethod): void;
  /** The new method works: keep it. */
  keep(): void;
  /** Go back to the method in use before. */
  revert(): void;
}

export const useTrial = create<TrialStore>((set, get) => ({
  trial: null,
  begin(method) {
    const previous = useSettings.getState().access.method;
    if (previous === method) return;
    set({ trial: { method, previous, startedAt: Date.now() } });
    useSettings.getState().patch('access', { method });
  },
  keep() {
    set({ trial: null });
  },
  revert() {
    const trial = get().trial;
    if (!trial) return;
    set({ trial: null });
    useSettings.getState().patch('access', { method: trial.previous });
  },
}));

/** Once the new method is ready to use, this long to confirm it. */
export const TRIAL_CONFIRM_MS = 45_000;
/** Whatever happens (a calibration that cannot finish, a camera that will not start), go back after this long. */
export const TRIAL_LIMIT_MS = 180_000;
