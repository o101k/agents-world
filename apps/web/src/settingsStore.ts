import { create } from 'zustand';
import type { SettingsResponse } from '@aw/shared';
import { api } from './api.ts';

interface SettingsState {
  settings: SettingsResponse | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  load: () => Promise<void>;
  set: (s: SettingsResponse) => void;
  setOpen: (open: boolean) => void;
}

let inFlight: Promise<void> | null = null;
let revision = 0;

/** Global app settings (providers, prices). Loaded once, refreshed after edits. */
export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  loading: false,
  error: null,
  open: false,
  load: async () => {
    if (inFlight) return inFlight;
    const rev = revision;
    set({ loading: true, error: null });
    inFlight = api
      .settings()
      .then((settings) => {
        if (revision === rev) set({ settings, loading: false, error: null });
        else set({ loading: false });
      })
      .catch((err: Error) => {
        set({ loading: false, error: err.message || 'Could not load settings.' });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  set: (settings) => {
    revision += 1;
    set({ settings, error: null });
  },
  setOpen: (open) => set({ open }),
}));
