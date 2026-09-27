import type { WebSocket } from 'ws';
import type { ServerMessage } from '@aw/shared';

/** Tracks connected browser tabs and pushes messages to all of them. */
export class Hub {
  private readonly sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
  }

  get size(): number {
    return this.sockets.size;
  }

  send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const s of this.sockets) if (s.readyState === s.OPEN) s.send(data);
  }

  closeAll(): void {
    for (const s of this.sockets) s.close(1001, 'Server shutting down');
    this.sockets.clear();
  }
}
