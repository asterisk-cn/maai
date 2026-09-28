// Online connection: a room-code WebSocket on the signaling Worker brokers a
// WebRTC peer connection, then all game traffic runs over two data channels:
//   game — unordered, no retransmits (UDP-like) for per-frame inputs
//   ctl  — reliable, ordered for session messages (rematch etc.)

// production: the same Worker serves the game and the signaling endpoint
export const SIGNAL_URL: string = import.meta.env.DEV
  ? 'ws://localhost:8787'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const newRoomCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export interface Peer {
  role: 0 | 1; // 0 = host (1P), 1 = guest (2P)
  sendGame(msg: unknown): void;
  sendCtl(msg: unknown): void;
  close(): void;
}

export interface Handlers {
  onOpen(peer: Peer): void;
  onGame(msg: unknown): void;
  onCtl(msg: unknown): void;
  onClose(reason: 'full' | 'unreachable' | 'left' | 'failed'): void;
}

export function connect(code: string, h: Handlers): () => void {
  const ws = new WebSocket(`${SIGNAL_URL}/room/${code}`);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  let role: 0 | 1 | null = null;
  let game: RTCDataChannel | null = null;
  let ctl: RTCDataChannel | null = null;
  let open = false;
  let closed = false;
  const pendingIce: RTCIceCandidateInit[] = [];

  const signal = (m: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const finish = (reason: Parameters<Handlers['onClose']>[0]) => {
    if (closed) return;
    closed = true;
    ws.close();
    pc.close();
    h.onClose(reason);
  };

  const wire = (ch: RTCDataChannel) => {
    if (ch.label === 'game') game = ch;
    else ctl = ch;
    ch.onmessage = (e) => (ch.label === 'game' ? h.onGame : h.onCtl)(JSON.parse(e.data));
    ch.onopen = () => {
      if (open || game?.readyState !== 'open' || ctl?.readyState !== 'open') return;
      open = true;
      ws.close(); // signaling done; frees the room
      h.onOpen({
        role: role!,
        sendGame: (m) => game?.readyState === 'open' && game.send(JSON.stringify(m)),
        sendCtl: (m) => ctl?.readyState === 'open' && ctl.send(JSON.stringify(m)),
        close: () => finish('left'),
      });
    };
    ch.onclose = () => open && finish('left');
  };

  pc.onicecandidate = (e) => e.candidate && signal({ type: 'ice', c: e.candidate.toJSON() });
  pc.ondatachannel = (e) => wire(e.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') finish('failed');
    if (pc.connectionState === 'disconnected' && open) finish('left');
  };

  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') {
      role = m.role;
    } else if (m.type === 'peer' && role === 0) {
      // host opens the channels and makes the offer
      wire(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
      wire(pc.createDataChannel('ctl'));
      await pc.setLocalDescription(await pc.createOffer());
      signal({ type: 'sdp', d: pc.localDescription });
    } else if (m.type === 'sdp') {
      await pc.setRemoteDescription(m.d);
      for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c);
      if (m.d.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        signal({ type: 'sdp', d: pc.localDescription });
      }
    } else if (m.type === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(m.c);
      else pendingIce.push(m.c);
    } else if (m.type === 'full') {
      finish('full');
    } else if (m.type === 'left' && !open) {
      finish('left');
    }
  };
  ws.onclose = () => !open && finish(role === null ? 'unreachable' : 'left');
  ws.onerror = () => !open && finish(role === null ? 'unreachable' : 'left');

  return () => finish('left');
}
