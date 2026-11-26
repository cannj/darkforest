import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { Room } from '../src/server/room.ts';
import { replay } from '../src/server/replay.ts';
import { createRecorder, type MatchRecord } from '../src/server/recording.ts';

test.each(['start', 'append'])('录像文件系统在 %s 不可写时房间仍可持续结算且仅诊断一次', (failure) => {
  const directory = mkdtempSync(join(tmpdir(), 'darkforest-recorder-'));
  const sink = join(directory, 'sink');
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    if (failure === 'start') writeFileSync(sink, 'regular file');
    const room = new Room('failed-sink', {}, { record: createRecorder(sink, 'failed-sink') });
    const a = room.join(); const b = room.join();
    if (failure === 'append') {
      const filename = readdirSync(sink)[0];
      if (!filename) throw new Error('missing recording header');
      const file = join(sink, filename);
      rmSync(file);
      mkdirSync(file);
    }
    for (const round of [1, 2]) {
      room.command(a, { kind: 'lock', round, requestId: 'a' });
      room.command(b, { kind: 'lock', round, requestId: 'b' });
      expect(room.view(a)).toMatchObject({ round: round + 1, phase: 'planning' });
    }
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: 'match-recording-disabled', roomId: 'failed-sink' }));
  } finally {
    diagnostic.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('实际房间记录可重跑对峙与超时补等待，并拒绝改写结果', () => {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room('recorded', {}, { now: () => now, roundDurationMs: 100, record: entry => records.push(entry) });
  const a = room.join(); const b = room.join();
  room.command(b, { kind: 'plan', round: 1, requestId: 'plan', moves: [{ row: 2, col: 2 }] });
  room.command(a, { kind: 'lock', round: 1, requestId: 'a' });
  room.command(b, { kind: 'lock', round: 1, requestId: 'b' });
  expect(room.view(a).confrontations).toEqual([{ opponent: b, round: 1, beat: 1 }]);
  room.command(a, { kind: 'lock', round: 2, requestId: 'wait' });
  room.command(b, { kind: 'plan', round: 2, requestId: 'discarded', moves: [{ row: 3, col: 2 }] });
  now = 100; room.tick();
  expect(room.view(b).self.position).toEqual({ row: 2, col: 2 });
  const log = records.map(entry => JSON.stringify(entry)).join('\n');
  expect(replay(log)).toEqual({ roomId: 'recorded', rounds: 2 });
  expect(records.at(-1)).toMatchObject({ inputs: [{ playerId: a, source: 'locked', moves: [] }, { playerId: b, source: 'timeout', moves: [] }] });
  expect(() => replay(log.replace('foundation-rules-v1', 'unknown-rules'))).toThrow();
  expect(() => replay(log.replace(/"authority":"[a-f0-9]+"/, '"authority":"' + '0'.repeat(64) + '"'))).toThrow(/结果不一致/);
  expect(() => replay(log.replace(/"digest":"[a-f0-9]+"/, '"digest":"' + '0'.repeat(64) + '"'))).toThrow(/结果不一致/);
  expect(() => replay(log.replace('"source":"timeout","moves":[]', '"source":"timeout","moves":[null]'))).toThrow();
});

test('改动前格式 1 的公开地图录像仍可核对两轮实际摘要', () => {
  expect(replay(readFileSync(new URL('./fixtures/public-map-v1.jsonl', import.meta.url), 'utf8')))
    .toEqual({ roomId: 'legacy-exploration-check', rounds: 2 });
});