import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { roomIdSchema, type PlayerId, type ServerMessage } from '../shared/protocol.ts';
import { Room } from './room.ts';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.ROOM_PORT ?? 8788);
const roundDurationMs = z.coerce.number().int().min(100).parse(process.env.ROUND_DURATION_MS ?? 30_000);
const settlementDurationMs = z.coerce.number().int().min(0).parse(process.env.SETTLEMENT_DURATION_MS ?? 1000);
const server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 16384 });
const rooms = new Map<string, Room>();
type Session = { room: Room; identity: PlayerId; socket: WebSocket };
const sessions = new Map<string, Session>();
const connections = new Map<WebSocket, Session>();

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: Room) {
  for (const [socket, connection] of connections) {
    if (connection.room === room) send(socket, { kind: 'view', view: room.view(connection.identity) });
  }
}

const timer = setInterval(() => {
  for (const room of rooms.values()) if (room.tick()) broadcast(room);
}, 50);

server.on('connection', (socket, request) => {
  const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
  const parsed = roomIdSchema.safeParse(params.get('room'));
  if (!parsed.success) {
    send(socket, { kind: 'error', message: '房间名仅可使用 1–32 个字母、数字或连字符' });
    socket.close(1008);
    return;
  }
  const resume = params.get('resume');
  let session: Session;
  let credential: string;
  if (resume !== null) {
    const previous = sessions.get(resume);
    if (!previous || previous.room.id !== parsed.data) {
      send(socket, { kind: 'error', message: '座位恢复凭证无效' });
      socket.close(1008);
      return;
    }
    connections.delete(previous.socket);
    previous.socket.close(1000, '座位已在新连接恢复');
    credential = resume;
    session = { ...previous, socket };
  } else {
    const room = rooms.get(parsed.data) ?? new Room(parsed.data, {}, { now: Date.now, roundDurationMs, settlementDurationMs });
    try {
      session = { room, identity: room.join(), socket };
    } catch {
      send(socket, { kind: 'error', message: '房间已满，请换一个房间名' });
      socket.close(1008);
      return;
    }
    rooms.set(parsed.data, room);
    credential = randomBytes(32).toString('base64url');
  }
  sessions.set(credential, session);
  connections.set(socket, session);
  const { room, identity } = session;
  send(socket, { kind: 'session', credential });
  const advanced = room.tick();
  if (resume === null || advanced) broadcast(room);
  else send(socket, { kind: 'view', view: room.view(identity) });
  socket.on('message', (data, isBinary) => {
    if (sessions.get(credential)?.socket !== socket) return;
    let input: unknown;
    try {
      if (isBinary) throw new Error('binary');
      input = JSON.parse(data.toString());
    } catch {
      send(socket, { kind: 'error', message: '消息必须是 JSON' });
      return;
    }
    const previous = room.view(identity);
    const result = room.command(identity, input);
    const view = room.view(identity);
    if (result.kind === 'rejected') send(socket, { kind: 'error', message: result.message });
    if (view.round !== previous.round || view.phase !== previous.phase) broadcast(room);
    else if (result.kind === 'accepted') send(socket, { kind: 'view', view });
  });
  socket.on('close', () => connections.delete(socket));
  socket.on('error', () => socket.close());
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer);
    for (const socket of connections.keys()) socket.close(1001);
    server.close();
  });
}
