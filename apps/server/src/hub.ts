import type { WebSocket } from 'ws';
import type { ServerMessage } from '@aw/shared';

const MAX_CONNECTIONS = 50;
const DROP_BUFFER_BYTES = 1_048_576;
const TERMINATE_BUFFER_BYTES = 16_777_216;

/** Tracks connected browser tabs and pushes messages to all of them. */
export class Hub {
  private readonly sockets = new Set<WebSocket>();

  /** Registers a socket; returns false (and closes with 1013) if the connection cap is reached. */
  add(socket: WebSocket): boolean {
    if (this.sockets.size >= MAX_CONNECTIONS) {
      try {
        socket.close(1013, 'Too many connections');
      } catch {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }
      return false;
    }
    this.sockets.add(socket);
    const remove = () => this.sockets.delete(socket);
    socket.on('close', remove);
    socket.on('error', remove);
    return true;
  }

  get size(): number {
    return this.sockets.size;
  }

  send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    this.sendRaw(socket, JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    if (this.sockets.size === 0) return;
    const data = JSON.stringify(msg);
    const isFrame = msg.type === 'frame';
    for (const s of [...this.sockets]) {
      if (s.readyState !== s.OPEN) continue;
      if (s.bufferedAmount > TERMINATE_BUFFER_BYTES) {
        this.sockets.delete(s);
        try {
          s.terminate();
        } catch {
          // ignore
        }
        continue;
      }
      if (isFrame && s.bufferedAmount > DROP_BUFFER_BYTES) continue;
      this.sendRaw(s, data);
    }
  }

  closeAll(): void {
    for (const s of [...this.sockets]) {
      try {
        if (s.readyState === s.OPEN) s.close(1001, 'Server shutting down');
        else s.terminate();
      } catch {
        // ignore errors on already-closing sockets
      }
    }
    this.sockets.clear();
  }

  private sendRaw(socket: WebSocket, data: string): void {
    try {
      socket.send(data, (err) => {
        if (err) {
          this.sockets.delete(socket);
          try {
            socket.terminate();
          } catch {
            // ignore
          }
        }
      });
    } catch {
      this.sockets.delete(socket);
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    }
  }
}
