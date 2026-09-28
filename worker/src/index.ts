// Signaling for online play: one Durable Object per room code relays WebRTC
// offer/answer/ICE messages between the two players. Game traffic itself goes P2P.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const m = new URL(req.url).pathname.match(/^\/room\/([A-Z0-9]{4,8})$/);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  async fetch(_req: Request): Promise<Response> {
    const others = this.ctx.getWebSockets();
    const { 0: client, 1: server } = new WebSocketPair();
    if (others.length >= 2) {
      // tell the client why instead of failing the handshake
      server.accept();
      server.send(JSON.stringify({ type: 'full' }));
      server.close(1000, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const role = others.length; // 0 = host (1P), 1 = guest (2P)
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role });
    server.send(JSON.stringify({ type: 'joined', role }));
    for (const ws of others) ws.send(JSON.stringify({ type: 'peer' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(msg);
  }

  webSocketClose(ws: WebSocket) {
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(JSON.stringify({ type: 'left' }));
    }
  }
}
