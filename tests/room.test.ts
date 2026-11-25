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
