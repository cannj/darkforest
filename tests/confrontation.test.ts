import { expect, test } from 'vitest';
import { Room } from '../src/server/room.js';
import { type PlayerId, type Position } from '../src/shared/protocol.js';

function play(room: Room, plans: { id: PlayerId; moves: (Position | null)[] }[]) {
  const first = plans[0];
  if (!first) throw new Error('测试需要至少一名玩家');
  const round = room.view(first.id).round;
  for (const { id, moves } of plans) {
    expect(room.command(id, { kind: 'plan', round, requestId: `${id}-${round}-plan`, moves }).kind).toBe('accepted');
    expect(room.command(id, { kind: 'lock', round, requestId: `${id}-${round}-lock` }).kind).toBe('accepted');
  }
}

test('三人房间的两人新接触当轮停止，第三人继续，下一轮共享计划入口并保留对峙', () => {
  const room = new Room('three', { spawns: [{ row: 0, col: 0 }, { row: 0, col: 3 }, { row: 4, col: 4 }] });
  const a = room.join(); const b = room.join(); const c = room.join();
  play(room, [
    { id: a, moves: [{ row: 0, col: 1 }, { row: 1, col: 1 }] },
    { id: b, moves: [{ row: 0, col: 2 }, { row: 1, col: 2 }] },
    { id: c, moves: [{ row: 4, col: 3 }, { row: 4, col: 2 }] },
  ]);
  expect(room.view(a).self.position).toEqual({ row: 0, col: 1 });
  expect(room.view(b).self.position).toEqual({ row: 0, col: 2 });
  expect(room.view(c).self.position).toEqual({ row: 4, col: 2 });
  expect(room.view(a).confrontations).toEqual([{ opponent: b, round: 1, beat: 1 }]);
  expect(room.view(b).confrontations).toEqual([{ opponent: a, round: 1, beat: 1 }]);
  expect(room.view(c).confrontations).toEqual([]);
  for (const id of [a, b, c]) expect(room.view(id)).toMatchObject({ round: 2, phase: 'planning', plan: { kind: 'draft', moves: [] } });
  expect(room.view(a).playback[0]?.observation.players).toEqual([{ id: b, position: { row: 0, col: 2 } }]);
  play(room, [{ id: a, moves: [{ row: 1, col: 1 }] }, { id: b, moves: [{ row: 1, col: 2 }] }, { id: c, moves: [] }]);
  expect(room.view(a).self.position).toEqual({ row: 1, col: 1 });
  expect(room.view(b).self.position).toEqual({ row: 1, col: 2 });
  expect(room.view(a).confrontations).toEqual([{ opponent: b, round: 1, beat: 1 }]);
});

test('离开视野后再次进入会重新停止，持续对峙关系不泄漏新的隐藏位置', () => {
  const room = new Room('reentry'); const a = room.join(); const b = room.join();
  play(room, [{ id: a, moves: [] }, { id: b, moves: [{ row: 2, col: 2 }] }]);
  play(room, [{ id: a, moves: [] }, { id: b, moves: [null, { row: 3, col: 2 }] }]);
  expect(room.view(a).observation.players).toEqual([]);
  expect(room.view(a).memory).toEqual([{ id: b, position: { row: 2, col: 2 }, round: 2, beat: 1 }]);
  expect(JSON.stringify(room.view(a))).not.toContain('"position":{"row":3,"col":2}');
  play(room, [{ id: a, moves: [] }, { id: b, moves: [{ row: 2, col: 2 }, { row: 1, col: 2 }] }]);
  expect(room.view(b).self.position).toEqual({ row: 2, col: 2 });
  expect(room.view(a).confrontations).toEqual([{ opponent: b, round: 3, beat: 1 }]);
});

test('开局已互相可见时在第零拍建立对峙并停止首轮，下一轮可以行动', () => {
  const room = new Room('initial', { spawns: [{ row: 0, col: 0 }, { row: 0, col: 1 }] });
  const a = room.join(); const b = room.join();
  play(room, [{ id: a, moves: [{ row: 1, col: 0 }] }, { id: b, moves: [{ row: 1, col: 1 }] }]);
  expect(room.view(a).self.position).toEqual({ row: 0, col: 0 });
  expect(room.view(a).confrontations).toEqual([{ opponent: b, round: 1, beat: 0 }]);
  play(room, [{ id: a, moves: [{ row: 1, col: 0 }] }, { id: b, moves: [{ row: 1, col: 1 }] }]);
  expect(room.view(a).self.position).toEqual({ row: 1, col: 0 });
});

test('三人出生点仍须唯一且位于地图内，默认房间只有两个座位', () => {
  for (const third of [{ row: 0, col: 0 }, { row: 5, col: 0 }]) {
    expect(() => new Room('invalid', { spawns: [{ row: 0, col: 0 }, { row: 0, col: 2 }, third] })).toThrow();
  }
  const room = new Room('default'); room.join(); room.join();
  expect(() => room.join()).toThrow('房间已满');
});
