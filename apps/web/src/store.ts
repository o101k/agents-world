import { create } from 'zustand';
import type { WorldMeta } from '@aw/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface AppState {
  connection: ConnectionStatus;
  /** Bumped each time a WebSocket connection opens and receives hello, so open worlds resync. */
  connectionEpoch: number;
  serverVersion: string | null;
  /** True once the helper has told us about the saved worlds. */
  loaded: boolean;
  worlds: WorldMeta[];
  activeWorldId: string | null;
  /** Local UI choice: show the worlds screen even while a world is active. */
  showWorldsScreen: boolean;

  setConnection: (c: ConnectionStatus) => void;
  setWorlds: (
    worlds: WorldMeta[],
    activeWorldId: string | null,
    serverVersion?: string,
    isHello?: boolean,
  ) => void;
  setShowWorldsScreen: (show: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  connection: 'connecting',
  connectionEpoch: 0,
  serverVersion: null,
  loaded: false,
  worlds: [],
  activeWorldId: null,
  showWorldsScreen: false,

  setConnection: (connection) => set({ connection }),
  setWorlds: (worlds, activeWorldId, serverVersion, isHello = false) =>
    set((s) => ({
      worlds,
      activeWorldId,
      loaded: true,
      connectionEpoch: isHello ? s.connectionEpoch + 1 : s.connectionEpoch,
      serverVersion: serverVersion ?? s.serverVersion,
      // Follow the active world: if it changes (here or in another tab), show it.
      showWorldsScreen:
        activeWorldId === null
          ? true
          : activeWorldId !== s.activeWorldId
            ? false
            : s.showWorldsScreen,
    })),
  setShowWorldsScreen: (showWorldsScreen) => set({ showWorldsScreen }),
}));
