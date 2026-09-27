import { create } from 'zustand';
import type { SettingsResponse } from '@aw/shared';
import { api } from './api.ts';

interface SettingsState {
  settings: SettingsResponse | null;
  open: boolean;
  load: () => Promise<void>;
  set: (s: SettingsResponse) => void;
  setOpen: (open: boolean) => void;
}

/** Global app settings (providers, prices). Loaded once, refreshed after edits. */
export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  open: false,
  load: async () => set({ settings: await api.settings() }),
  set: (settings) => set({ settings }),
  setOpen: (open) => set({ open }),
}));
