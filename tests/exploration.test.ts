import { expect, test } from 'vitest';
import { Room } from '../src/server/room.js';
import { boardSchema, playerViewSchema, publicBoard } from '../src/shared/protocol.js';

test('探索房间只公开当前视野格和可见格共享的格边，权威棋盘仍要求完整', () => {
  const room = new Room('explore', { exploration: 'player-vision', spawns: [{ row: 4, col: 0 }, { row: 0, col: 4 }] });
  const a = room.join();
  const view = room.view(a);
  expect(view.board).toMatchObject({ rows: 5, cols: 5, version: 'stone-room-v1' });
  expect(view.board.cells).toEqual(publicBoard.cells.filter(c => [[3,0],[4,0]].some(([r,k]) => c.row === r && c.col === k)));
  expect(view.board.edges.map(e => e.id)).toEqual(['west-wall']);
  expect(playerViewSchema.safeParse(view).success).toBe(true);
  expect(boardSchema.safeParse(view.board).success).toBe(false);
  expect(() => new Room('partial', { board: view.board })).toThrow();
});

test('逐拍布局不含后拍才看到的格，旧房间保留完整地图和原播放格式', () => {
  const room = new Room('beat-layout', { exploration: 'player-vision', board: { ...publicBoard, edges: [] }, spawns: [{ row: 1, col: 1 }, { row: 4, col: 4 }] });
  const a = room.join(); const b = room.join();
  room.command(a, { kind: 'plan', round: 1, requestId: 'move', moves: [{ row: 1, col: 2 }, { row: 1, col: 3 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b' });
  const view = playerViewSchema.parse(room.view(a));
  const first = view.playback[0]; const second = view.playback[1];
  expect(first?.board?.cells.some(c => c.col === 4)).toBe(false);
  expect(second?.board?.cells.some(c => c.col === 4)).toBe(true);
  expect(first?.board?.cells.map(({ row, col }) => ({ row, col }))).toEqual(first?.observation.cells);
  const legacy = new Room('legacy'); const l = legacy.join(); const other = legacy.join();
  legacy.command(l, { kind: 'lock', round: 1, requestId: 'l' });
  legacy.command(other, { kind: 'lock', round: 1, requestId: 'o' });
  expect(legacy.view(l).board).toEqual(publicBoard);
  expect(legacy.view(l)).not.toHaveProperty('exploration');
  expect(legacy.view(l).playback[0]).not.toHaveProperty('board');
});
