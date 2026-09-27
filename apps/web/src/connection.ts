import type { ServerMessage } from '@aw/shared';
import { useApp } from './store.ts';

/** Keeps a WebSocket open to the local helper, reconnecting with backoff if it goes away. */
export function connect(): void {
  let retry = 0;
  const open = () => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      useApp.getState().setConnection('online');
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      switch (msg.type) {
        case 'hello':
          useApp.getState().setWorlds(msg.worlds, msg.activeWorldId, msg.serverVersion);
          break;
        case 'worlds_changed':
          useApp.getState().setWorlds(msg.worlds, msg.activeWorldId);
          break;
      }
    };
    ws.onclose = () => {
      useApp.getState().setConnection('offline');
      const delay = Math.min(10_000, 500 * 2 ** retry++);
      setTimeout(open, delay);
    };
  };
  open();
}
