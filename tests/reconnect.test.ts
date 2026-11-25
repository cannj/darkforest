import { expect, test } from 'vitest';
import { Room } from '../src/server/room.ts';

test('截止从满员开始，锁定计划执行，未锁定草稿补等待，时钟独立于连接', () => {
  let now = 1000;
  const room = new Room('deadline', {}, { now: () => now, roundDurationMs: 100 });
  const a = room.join();
  expect(room.view(a)).toMatchObject({ phase: 'waiting', deadline: null });
  now = 2000;
  const b = room.join();
  expect(room.view(a)).toMatchObject({ phase: 'planning', deadline: 2100 });
  room.command(a, { kind: 'plan', round: 1, requestId: 'p', moves: [{ row: 1, col: 0 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'l' });
  room.command(b, { kind: 'plan', round: 1, requestId: 'p', moves: [{ row: 3, col: 4 }] });
  now = 2100;
  room.tick();
  expect(room.view(a)).toMatchObject({ round: 2, deadline: 2200, self: { position: { row: 1, col: 0 } } });
  expect(room.view(b)).toMatchObject({ round: 2, self: { position: { row: 3, col: 3 } }, result: 'waited' });
  now = 2300;
  room.tick();
  expect(room.view(a)).toMatchObject({ round: 4, deadline: 2400 });
});

test('同一座位同轮重发只应用一次，其他座位可使用同名请求，旧轮请求失效', () => {
  const room = new Room('retry', {}, { now: () => 0 }); const a = room.join(); const b = room.join();
  const request = { kind: 'plan', round: 1, requestId: 'same', moves: [{ row: 1, col: 0 }] };
  expect(room.command(a, request)).toEqual({ kind: 'accepted' });
  room.command(a, { kind: 'plan', round: 1, requestId: 'new', moves: [] });
  expect(room.command(a, request)).toEqual({ kind: 'accepted' });
  expect(room.view(a).plan.moves).toEqual([]);
  room.command(b, { ...request, moves: [{ row: 3, col: 4 }] });
  expect(room.view(b).plan.moves).toEqual([{ row: 3, col: 4 }]);
  const lock = { kind: 'lock', round: 1, requestId: 'lock' };
  expect(room.command(a, lock)).toEqual({ kind: 'accepted' });
  expect(room.command(a, lock)).toEqual({ kind: 'accepted' });
  room.command(b, lock);
  expect(room.command(a, request).kind).toBe('rejected');
  expect(room.view(a)).toMatchObject({ round: 2, plan: { kind: 'draft', moves: [] } });
});

test('截止竞速命令先超时，结算阶段权威可见且拒绝下一轮计划', () => {
  let now = 1000;
  const room = new Room('phase', {}, { now: () => now, roundDurationMs: 100, settlementDurationMs: 20 });
  const a = room.join(); room.join();
  now = 1100;
  expect(room.command(a, { kind: 'plan', round: 1, requestId: 'late', moves: [{ row: 1, col: 0 }] }).kind).toBe('rejected');
  expect(room.view(a)).toMatchObject({ phase: 'resolving', deadline: 1120, round: 1, self: { position: { row: 1, col: 1 } } });
  expect(room.view(a).plan.kind).toBe('locked');
  expect(room.view(a).beats.every(beat => beat.round === 1)).toBe(true);
  expect(room.command(a, { kind: 'lock', round: 2, requestId: 'early' }).kind).toBe('rejected');
  now = 1120;
  room.tick();
  expect(room.view(a)).toMatchObject({ phase: 'planning', deadline: 1220, round: 2 });
  expect(room.command(a, { kind: 'lock', round: 2, requestId: 'early' }).kind).toBe('accepted');
});

test('主机时钟大幅前跳只进行有限结算并重新安排未来截止', () => {
  let now = 0;
  const room = new Room('clock-jump', {}, { now: () => now, roundDurationMs: 100 });
  const a = room.join(); room.join();
  now = 10 ** 12;
  room.tick();
  expect(room.view(a).round).toBe(11);
  expect(room.view(a).deadline).toBe(10 ** 12 + 100);
});
