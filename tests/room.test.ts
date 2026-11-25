import { expect, test } from 'vitest';
import { Room } from '../src/server/room.js';

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
  const room = new Room('two-beats');
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
  expect(JSON.stringify(room.view(b))).not.toContain('"col":2');
});

test('移动额度独立于等待拍，超额或超长计划被拒绝且不覆盖原草稿', () => {
  const room = new Room('wait-beats');
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
