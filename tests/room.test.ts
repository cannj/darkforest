import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { publicBoard, type Board } from '../src/shared/protocol.js';
import { Room } from '../src/server/room.js';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

test.each(['header', 'round'])('录像 %s 写入失败后仍能开始和完成后续回合', (failure) => {
  const room = new Room('broken-recording', {}, { record: entry => {
    if (entry.kind === failure) throw new Error('unavailable sink');
  } });
  const a = room.join();
  const b = room.join();
  expect(room.view(a)).toMatchObject({ phase: 'planning', deadline: 30_000 });
  for (const round of [1, 2]) {
    room.command(a, { kind: 'lock', round, requestId: 'a' });
    room.command(b, { kind: 'lock', round, requestId: 'b' });
    expect(room.view(a)).toMatchObject({ round: round + 1, phase: 'planning', deadline: 30_000 });
  }
  vi.advanceTimersByTime(30_000);
  expect(room.tick()).toBe(true);
  expect(room.view(b)).toMatchObject({ round: 4, phase: 'planning', deadline: 60_000 });
});

test('两名玩家秘密锁定单步计划后共同进入下一回合', () => {
  const room = new Room('first-round');
  const a = room.join();
  const b = room.join();
  expect(a).not.toBe(b);
  expect(room.view(a).board).toEqual(room.view(b).board);
  expect(room.command(a, { kind: 'plan', round: 1, requestId: 'a-plan', moves: [{ row: 2, col: 1 }] })).toEqual({ kind: 'accepted' });
  expect(room.view(a).plan).toEqual({ kind: 'draft', moves: [{ row: 2, col: 1 }] });
  expect(JSON.stringify(room.view(b))).not.toContain('a-plan');
  expect(room.view(b).plan).toEqual({ kind: 'draft', moves: [] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a-lock' });
  expect(room.view(a).plan.kind).toBe('locked');
  expect(room.view(a).round).toBe(1);
  room.command(b, { kind: 'plan', round: 1, requestId: 'b-plan', moves: [{ row: 2, col: 3 }] });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b-lock' });
  expect(room.view(a)).toMatchObject({ round: 2, phase: 'planning', self: { position: { row: 2, col: 1 } }, plan: { kind: 'draft', moves: [] } });
  expect(room.view(b)).toMatchObject({ round: 2, self: { position: { row: 2, col: 3 } } });
});

test('两拍斜向移动逐拍提交并只向自己显示结果', () => {
  const room = new Room('two-beats', { spawns: [{ row: 1, col: 1 }, { row: 4, col: 4 }] });
  const a = room.join();
  const b = room.join();
  expect(room.command(a, { kind: 'plan', round: 1, requestId: 'plan', moves: [{ row: 2, col: 2 }, { row: 3, col: 2 }] })).toEqual({ kind: 'accepted' });
  room.command(a, { kind: 'lock', round: 1, requestId: 'lock-a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'lock-b' });
  expect(room.view(a).self.position).toEqual({ row: 3, col: 2 });
  expect(room.view(a).beats.slice(0, 2)).toMatchObject([
    { round: 1, beat: 1, from: { row: 1, col: 1 }, to: { row: 2, col: 2 }, result: 'moved' },
    { round: 1, beat: 2, from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, result: 'moved' },
  ]);
  expect(room.view(b).beats.every((beat) => beat.from.col === 4 && beat.to.col === 4)).toBe(true);
  expect(room.view(b).playback.every((frame) => frame.observation.players.length === 0)).toBe(true);
});

test('移动额度独立于等待拍，超额或超长计划被拒绝且不覆盖原草稿', () => {
  const room = new Room('wait-beats', { spawns: [{ row: 1, col: 1 }, { row: 4, col: 4 }] });
  const a = room.join();
  const b = room.join();
  const moves = [null, { row: 2, col: 2 }, null, { row: 2, col: 1 }];
  expect(room.command(a, { kind: 'plan', round: 1, requestId: 'valid', moves })).toEqual({ kind: 'accepted' });
  for (const invalid of [
    [{ row: 2, col: 1 }, { row: 2, col: 2 }, { row: 1, col: 2 }],
    Array(5).fill(null),
  ]) {
    expect(room.command(a, { kind: 'plan', round: 1, requestId: 'invalid', moves: invalid }).kind).toBe('rejected');
    expect(room.view(a).plan.moves).toEqual(moves);
  }
  room.command(a, { kind: 'lock', round: 1, requestId: 'a-lock' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b-lock' });
  expect(room.view(a).beats.map(({ beat, result }) => [beat, result])).toEqual([
    [1, 'waited'], [2, 'moved'], [3, 'waited'], [4, 'moved'],
  ]);
  expect(room.view(a).self.position).toEqual({ row: 2, col: 1 });
});

test('同拍争抢与提交先后无关，受阻后下一拍仍从实际位置检查', () => {
  function play(reverse: boolean) {
    const room = new Room(reverse ? 'reverse' : 'forward');
    const a = room.join();
    const b = room.join();
    const plans = [
      { id: a, moves: [{ row: 2, col: 2 }, { row: 1, col: 2 }] },
      { id: b, moves: [{ row: 2, col: 2 }, { row: 3, col: 2 }] },
    ];
    for (const { id, moves } of reverse ? plans.toReversed() : plans) {
      room.command(id, { kind: 'plan', round: 1, requestId: 'plan', moves });
      room.command(id, { kind: 'lock', round: 1, requestId: 'lock' });
    }
    return [room.view(a), room.view(b)].map(({ self, beats }) => ({ self, beats }));
  }
  const result = play(false);
  expect(play(true)).toEqual(result);
  expect(result.map(({ self }) => self.position)).toEqual([{ row: 1, col: 2 }, { row: 3, col: 2 }]);
  for (const player of result) {
    expect(player.beats.slice(0, 2).map(({ result }) => result)).toEqual(['blocked', 'moved']);
  }
  for (let beat = 0; beat < 2; beat++) {
    expect(new Set(result.map((player) => JSON.stringify(player.beats[beat]?.to))).size).toBe(2);
  }
});

test('每拍按起始占位阻止跟随和交换，后续远距离目标不会从预期位置执行', () => {
  const room = new Room('occupied');
  const a = room.join();
  const b = room.join();
  room.command(a, { kind: 'plan', round: 1, requestId: 'a', moves: [{ row: 2, col: 2 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'al' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'bl' });
  room.command(a, { kind: 'plan', round: 2, requestId: 'a2', moves: [{ row: 3, col: 3 }, { row: 4, col: 4 }] });
  room.command(b, { kind: 'plan', round: 2, requestId: 'b2', moves: [{ row: 2, col: 2 }, { row: 3, col: 4 }] });
  room.command(a, { kind: 'lock', round: 2, requestId: 'al2' });
  room.command(b, { kind: 'lock', round: 2, requestId: 'bl2' });
  expect(room.view(a).beats.slice(0, 2).map(({ result }) => result)).toEqual(['blocked', 'blocked']);
  expect(room.view(b).beats.slice(0, 2).map(({ result }) => result)).toEqual(['blocked', 'moved']);
  expect(room.view(a).self.position).toEqual({ row: 2, col: 2 });
  expect(room.view(b).self.position).toEqual({ row: 3, col: 4 });
});

test('自己的回放拍数不透露对手私密计划的长度', () => {
  function ownView(moves: unknown[]) {
    const room = new Room('fixed-beats');
    const a = room.join();
    const b = room.join();
    room.command(a, { kind: 'plan', round: 1, requestId: 'a', moves: [{ row: 2, col: 1 }] });
    expect(room.command(b, { kind: 'plan', round: 1, requestId: 'b', moves }).kind).toBe('accepted');
    room.command(a, { kind: 'lock', round: 1, requestId: 'al' });
    room.command(b, { kind: 'lock', round: 1, requestId: 'bl' });
    return room.view(a);
  }
  const short = ownView([]);
  expect(short.beats).toHaveLength(4);
  expect(ownView([null, null, null, { row: 4, col: 4 }])).toEqual(short);
});

test('身边一圈含斜角可见，圈外玩家留在迷雾中', () => {
  const room = new Room('visibility');
  const a = room.join();
  room.join();
  expect(room.view(a).observation.cells).toHaveLength(9);
  expect(room.view(a).observation.cells).toContainEqual({ row: 2, col: 2 });
  expect(room.view(a).observation.players).toEqual([]);
  expect(room.view(a).memory).toEqual([]);
});

test('短暂目击按拍授权，消失后保留时间和位置，隐藏路径不进入回放', () => {
  const room = new Room('fleeting');
  const a = room.join(); const b = room.join();
  room.command(b, { kind: 'plan', round: 1, requestId: 'bp', moves: [{ row: 2, col: 2 }, { row: 3, col: 2 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'al' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'bl' });
  room.command(b, { kind: 'plan', round: 2, requestId: 'bp2', moves: [null, { row: 3, col: 2 }] });
  room.command(a, { kind: 'lock', round: 2, requestId: 'al2' });
  room.command(b, { kind: 'lock', round: 2, requestId: 'bl2' });
  expect(room.view(a).playback.map((f) => f.observation.players)).toEqual([
    [{ id: b, position: { row: 2, col: 2 } }], [], [], [],
  ]);
  expect(room.view(a).observation.players).toEqual([]);
  expect(room.view(a).memory).toEqual([{ id: b, position: { row: 2, col: 2 }, round: 2, beat: 1 }]);
  expect(room.view(a).playback[0]?.memory).toEqual(room.view(a).memory);
  expect(JSON.stringify(room.view(a))).not.toContain('"position":{"row":3,"col":2}');
  room.command(a, { kind: 'lock', round: 3, requestId: 'al3' });
  room.command(b, { kind: 'lock', round: 3, requestId: 'bl3' });
  expect(room.view(a).memory).toEqual([{ id: b, position: { row: 2, col: 2 }, round: 2, beat: 1 }]);
});

test.each(['wall', 'door', 'window'] satisfies Board['edges'][number]['kind'][])('公开%s格边和动态状态分别决定视野与正交通行', (kind) => {
  const board: Board = { ...publicBoard, version: `edge-${kind}`, edges: [{ id: 'test-edge', a: { row: 1, col: 1 }, b: { row: 1, col: 2 }, kind }] };
  const room = new Room('edge', { board, terrain: { doors: kind === 'door' ? { 'test-edge': false } : {} }, spawns: [{ row: 1, col: 1 }, { row: 1, col: 2 }] });
  const a = room.join(); const b = room.join();
  expect(room.view(a).board.edges[0]?.kind).toBe(kind);
  expect(room.view(a).observation.players.length).toBe(kind === 'window' ? 1 : 0);
  expect(room.view(a).observation.cells.some((p) => p.row === 2 && p.col === 2)).toBe(kind === 'window');
  room.command(a, { kind: 'lock', round: 1, requestId: 'initial-a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'initial-b' });
  room.command(b, { kind: 'plan', round: 2, requestId: 'bp', moves: [{ row: 0, col: 2 }] });
  room.command(a, { kind: 'plan', round: 2, requestId: 'ap', moves: [null, { row: 1, col: 2 }] });
  room.command(a, { kind: 'lock', round: 2, requestId: 'al' });
  room.command(b, { kind: 'lock', round: 2, requestId: 'bl' });
  expect(room.view(a).self.position).toEqual(kind === 'window' ? { row: 1, col: 2 } : { row: 1, col: 1 });
});

test('透明窗允许斜角视野，但斜向翻窗不穿角', () => {
  const room = new Room('window-corner', { board: { ...publicBoard, edges: [{ id: 'w', a: { row: 1, col: 1 }, b: { row: 1, col: 2 }, kind: 'window' }] } });
  const a = room.join(); const b = room.join();
  expect(room.view(a).observation.cells).toContainEqual({ row: 2, col: 2 });
  room.command(a, { kind: 'plan', round: 1, requestId: 'p', moves: [{ row: 2, col: 2 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'al' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'bl' });
  expect(room.view(a).self.position).toEqual({ row: 1, col: 1 });
});

test('地图和视距通过房间配置，非法布局在创建时被拒绝', () => {
  const room = new Room('range', { visionRange: 2, board: { ...publicBoard, edges: [] } });
  const a = room.join(); room.join();
  expect(room.view(a).observation.players).toEqual([{ id: 'p2', position: { row: 3, col: 3 } }]);
  expect(() => new Room('bad', { board: { ...publicBoard, cells: [...publicBoard.cells, publicBoard.cells[0]] } })).toThrow();
  expect(() => new Room('bad', { board: { ...publicBoard, edges: [{ id: 'bad', kind: 'wall', a: { row: 0, col: 0 }, b: { row: 1, col: 1 } }] } })).toThrow();
  expect(() => new Room('bad', { board: { ...publicBoard, edges: [...publicBoard.edges, ...publicBoard.edges] } })).toThrow();
});

test('可见门状态留下时间记忆，雾中的动态门状态不下发', () => {
  const board: Board = { ...publicBoard, edges: [
    { id: 'near', a: { row: 1, col: 1 }, b: { row: 1, col: 2 }, kind: 'door' },
    { id: 'far', a: { row: 4, col: 3 }, b: { row: 4, col: 4 }, kind: 'door' },
  ] };
  const room = new Room('doors', { board, terrain: { doors: { near: true, far: true } } });
  const a = room.join(); room.join();
  expect(room.view(a).observation.cells).toContainEqual({ row: 1, col: 2 });
  expect(room.view(a).observation.doors).toEqual([{ id: 'near', open: true }]);
  expect(room.view(a).terrainMemory).toEqual([{ id: 'near', open: true, round: 1, beat: 0 }]);
});

test('尾部等待拍不掩盖上轮已执行的移动', () => {
  const room = new Room('summary'); const a = room.join(); const b = room.join();
  room.command(a, { kind: 'plan', round: 1, requestId: 'p', moves: [{ row: 2, col: 1 }, null] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'al' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'bl' });
  expect(room.view(a).result).toBe('moved');
  expect(room.view(a).beats[1]?.result).toBe('waited');
});

test.each([
  [{ row: 1, col: 1 }, { row: 1, col: 2 }],
  [{ row: 1, col: 2 }, { row: 2, col: 2 }],
  [{ row: 1, col: 1 }, { row: 2, col: 1 }],
  [{ row: 2, col: 1 }, { row: 2, col: 2 }],
])('任一绕角格边不透明都隐藏斜角目标 %j %j', (from, to) => {
  const room = new Room('corner', { board: { ...publicBoard, edges: [{ id: 'wall', a: from, b: to, kind: 'wall' }] }, spawns: [{ row: 1, col: 1 }, { row: 2, col: 2 }] });
  const a = room.join(); room.join();
  expect(room.view(a).observation.players).toEqual([]);
});

test('提交反馈不随未观察到的动态门状态变化', () => {
  function draft(open: boolean) {
    const room = new Room('private-feedback', { terrain: { doors: { 'north-door': open } } });
    const a = room.join(); room.join();
    const result = room.command(a, { kind: 'plan', round: 1, requestId: 'same', moves: [{ row: 0, col: 3 }] });
    return { result, view: room.view(a) };
  }
  expect(draft(true)).toEqual(draft(false));
});
