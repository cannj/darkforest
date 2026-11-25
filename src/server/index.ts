import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { roomIdSchema, type PlayerId, type ServerMessage } from '../shared/protocol.ts';
import { Room } from './room.ts';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.ROOM_PORT ?? 8788);
const server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 16384 });
const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, { room: Room; identity: PlayerId }>();

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: Room) {
  for (const [socket, connection] of connections) {
    if (connection.room === room) send(socket, { kind: 'view', view: room.view(connection.identity) });
  }
}

server.on('connection', (socket, request) => {
  const parsed = roomIdSchema.safeParse(new URL(request.url ?? '/', 'http://localhost').searchParams.get('room'));
  if (!parsed.success) {
    send(socket, { kind: 'error', message: '房间名仅可使用 1–32 个字母、数字或连字符' });
    socket.close(1008);
    return;
  }
  const room = rooms.get(parsed.data) ?? new Room(parsed.data);
  let identity: PlayerId;
  try {
    identity = room.join();
  } catch {
    send(socket, { kind: 'error', message: '房间已满，请换一个房间名' });
    socket.close(1008);
    return;
  }
  rooms.set(parsed.data, room);
  connections.set(socket, { room, identity });
  broadcast(room);
  socket.on('message', (data, isBinary) => {
    let input: unknown;
    try {
      if (isBinary) throw new Error('binary');
      input = JSON.parse(data.toString());
    } catch {
      send(socket, { kind: 'error', message: '消息必须是 JSON' });
      return;
    }
    const previousRound = room.view(identity).round;
    const result = room.command(identity, input);
    if (result.kind === 'rejected') send(socket, { kind: 'error', message: result.message });
    else if (room.view(identity).round !== previousRound) broadcast(room);
    else send(socket, { kind: 'view', view: room.view(identity) });
  });
  socket.on('close', () => connections.delete(socket));
  socket.on('error', () => socket.close());
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of connections.keys()) socket.close(1001);
    server.close();
  });
}
