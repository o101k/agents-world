import type { ServerMessage } from '@aw/shared';
import { useApp } from './store.ts';
import { useWorld } from './worldStore.ts';

let activeDisconnect: (() => void) | null = null;

/** Keeps a single WebSocket open to the local helper, reconnecting with backoff if it goes away. */
export function connect(): () => void {
  activeDisconnect?.();
  let retry = 0;
  let closed = false;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      if (closed || ws !== socket) return;
      retry = 0;
      useApp.getState().setConnection('online');
    };
    socket.onmessage = (ev) => {
      if (closed || ws !== socket) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          useApp.getState().setWorlds(msg.worlds, msg.activeWorldId, msg.serverVersion, true);
          break;
        case 'worlds_changed':
          useApp.getState().setWorlds(msg.worlds, msg.activeWorldId);
          break;
        case 'frame':
          useWorld.getState().applyFrame(msg.worldId, msg);
          break;
        case 'events':
          useWorld.getState().addEvents(msg.worldId, msg.events);
          break;
      }
    };
    socket.onclose = () => {
      if (closed || ws !== socket) return;
      ws = null;
      useApp.getState().setConnection('offline');
      const delay = Math.min(10_000, 500 * 2 ** retry++);
      timer = setTimeout(open, delay);
    };
  };

  const disconnect = () => {
    closed = true;
    clearTimeout(timer);
    timer = undefined;
    if (ws) {
      const s = ws;
      ws = null;
      s.close();
    }
    if (activeDisconnect === disconnect) activeDisconnect = null;
  };

  activeDisconnect = disconnect;
  open();
  return disconnect;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeDisconnect?.();
  });
}
