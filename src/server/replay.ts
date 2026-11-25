import { isDeepStrictEqual } from 'node:util';
import { headerSchema, roundRecordSchema, type MatchRecord } from './recording.ts';
import { Room } from './room.ts';

export function replay(jsonl: string): { roomId: string; rounds: number } {
  const lines = jsonl.trim().split('\n');
  const header = headerSchema.parse(JSON.parse(lines.shift() ?? ''));
  let now = 0;
  let actual: MatchRecord | undefined;
  const room = new Room(header.roomId, header.setup, { now: () => now, roundDurationMs: 100, record: entry => { actual = entry; } });
  for (const _seat of header.initialSeats) room.join();
  if (!isDeepStrictEqual(actual, header)) throw new Error('初始状态不一致');
  let rounds = 0;
  for (const line of lines) {
    const expected = roundRecordSchema.parse(JSON.parse(line));
    if (expected.round !== rounds + 1 || expected.inputs.length !== header.initialSeats.length ||
        expected.inputs.some((input, i) => input.playerId !== header.initialSeats[i]?.id)) throw new Error('回合输入不完整或顺序错误');
    actual = undefined;
    for (const input of expected.inputs) {
      if (input.source === 'timeout') continue;
      for (const command of [
        { kind: 'plan', moves: input.moves, round: expected.round, requestId: 'replay-plan' },
        { kind: 'lock', round: expected.round, requestId: 'replay-lock' },
      ]) if (room.command(input.playerId, command).kind !== 'accepted') throw new Error('复盘输入被拒绝');
    }
    if (expected.inputs.some(input => input.source === 'timeout')) { now += 100; room.tick(); }
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`第 ${expected.round} 回合结果不一致`);
    rounds++;
  }
  if (rounds === 0) throw new Error('记录尚无已结算回合');
  return { roomId: header.roomId, rounds };
}
