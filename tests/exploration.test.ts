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
  expect(legacy.view(l).playback[0]).not.toHaveProperty('mapMemory');
});

test('地图记忆保留初始及途经布局并与当前视野和其他座位隔离', () => {
  const room = new Room('remember', { exploration: 'player-vision', board: { ...publicBoard, cells: [...publicBoard.cells].reverse(), edges: [] }, spawns: [{ row: 0, col: 0 }, { row: 4, col: 4 }] });
  const a = room.join(); const b = room.join();
  expect(room.view(a).mapMemory?.cells.map(c => [c.row, c.col])).toEqual([[0,0],[0,1],[1,0],[1,1]]);
  room.command(a, { kind: 'plan', round: 1, requestId: 'move', moves: [{ row: 0, col: 1 }, { row: 0, col: 2 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b' });
  const remembered = playerViewSchema.parse(room.view(a));
  expect(remembered.mapMemory?.cells.map(c => [c.row, c.col])).toEqual([[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3]]);
  expect(remembered.board.cells.some(c => c.row === 0 && c.col === 0)).toBe(false);
  expect(room.view(b).mapMemory?.cells.map(c => [c.row, c.col])).toEqual([[3,3],[3,4],[4,3],[4,4]]);
  expect(room.view(a).mapMemory).toEqual(remembered.mapMemory);
});

test('记忆保留看见过的墙门窗及门状态，共享边不揭示遮挡后的格子', () => {
  const room = new Room('remember-edges', { exploration: 'player-vision', board: { ...publicBoard, edges: [
    { id: 'z-wall', a: { row: 0, col: 1 }, b: { row: 0, col: 2 }, kind: 'wall' },
    { id: 'b-window', a: { row: 1, col: 0 }, b: { row: 1, col: 1 }, kind: 'window' },
    { id: 'a-door', a: { row: 0, col: 0 }, b: { row: 0, col: 1 }, kind: 'door' },
  ] }, spawns: [{ row: 0, col: 0 }, { row: 4, col: 4 }] });
  const a = room.join(); const b = room.join();
  const initial = room.view(a);
  expect(initial.mapMemory?.edges.map(e => e.id)).toEqual(['a-door', 'b-window']);
  expect(initial.mapMemory?.cells.some(c => c.row === 0 && c.col === 1)).toBe(false);
  expect(initial.terrainMemory).toEqual([{ id: 'a-door', open: false, round: 1, beat: 0 }]);
  room.command(a, { kind: 'plan', round: 1, requestId: 'move', moves: [{ row: 1, col: 0 }, { row: 2, col: 0 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a' }); room.command(b, { kind: 'lock', round: 1, requestId: 'b' });
  const moved = room.view(a);
  expect(moved.board.edges.some(e => e.id === 'a-door')).toBe(false);
  expect(moved.mapMemory?.edges.map(e => e.id)).toEqual(['a-door', 'b-window']);
  expect(moved.terrainMemory).toEqual([{ id: 'a-door', open: false, round: 1, beat: 1 }]);
  expect(room.view(b).mapMemory?.edges).toEqual([]);
  moved.mapMemory?.cells.splice(0);
  expect(room.view(a).mapMemory?.cells.length).toBeGreaterThan(0);
  const legacy = new Room('legacy-memory'); const l = legacy.join();
  expect(legacy.view(l)).not.toHaveProperty('mapMemory');
});

test('逐拍地图记忆保留旧格边且不提前泄露后拍或另一座位的发现', () => {
  const room = new Room('beat-memory', { exploration: 'player-vision', board: { ...publicBoard, edges: [
    { id: 'old-wall', a: { row: 0, col: 1 }, b: { row: 0, col: 2 }, kind: 'wall' },
    { id: 'later-window', a: { row: 4, col: 3 }, b: { row: 4, col: 4 }, kind: 'window' },
  ] }, spawns: [{ row: 1, col: 1 }, { row: 0, col: 4 }] });
  const a = room.join(); const b = room.join();
  room.command(a, { kind: 'plan', round: 1, requestId: 'move', moves: [{ row: 2, col: 2 }, { row: 3, col: 3 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b' });
  const view = playerViewSchema.parse(room.view(a));
  expect(view.playback[0]).toMatchObject({ self: { row: 2, col: 2 }, mapMemory: {
    cells: expect.arrayContaining([expect.objectContaining({ row: 0, col: 0 })]),
    edges: [expect.objectContaining({ id: 'old-wall' })],
  } });
  expect(view.playback[0]?.mapMemory?.cells.some(c => c.row === 4 && c.col === 4)).toBe(false);
  expect(view.playback[0]?.mapMemory?.cells.some(c => c.row === 0 && c.col === 4)).toBe(false);
  expect(view.playback[1]?.mapMemory?.cells.some(c => c.row === 4 && c.col === 4)).toBe(true);
  expect(view.playback[1]?.mapMemory?.edges.map(e => e.id)).toEqual(['later-window', 'old-wall']);
  expect(view.playback[3]?.mapMemory).toEqual(view.mapMemory);
  expect(room.view(b).playback[0]?.mapMemory?.cells.some(c => c.row === 0 && c.col === 0)).toBe(false);
  view.playback[0]?.mapMemory?.cells.splice(0);
  expect(room.view(a).playback[0]?.mapMemory?.cells.some(c => c.row === 0 && c.col === 0)).toBe(true);
});
