import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { commandSchema, movementLimit, playerIdSchema, positionSchema, roomIdSchema, roundBeatLimit } from '../shared/protocol.ts';
import { roomSetupSchema } from './board.ts';

export const rulesVersion = 'foundation-rules-v1';
export const configVersion = 'foundation-config-v1';
export const headerSchema = z.object({
  kind: z.literal('header'), format: z.literal(1), rulesVersion: z.literal(rulesVersion), configVersion: z.literal(configVersion),
  roomId: roomIdSchema, setup: roomSetupSchema, movementLimit: z.literal(movementLimit), roundBeatLimit: z.literal(roundBeatLimit),
  initialSeats: z.array(z.object({ id: playerIdSchema, position: positionSchema }).strict()).min(2).max(3),
}).strict();
const planCommandSchema = commandSchema.options[0];
const inputSchema = z.discriminatedUnion('source', [
  z.object({ playerId: playerIdSchema, source: z.literal('locked'), moves: planCommandSchema.shape.moves }).strict(),
  z.object({ playerId: playerIdSchema, source: z.literal('timeout'), moves: z.tuple([]) }).strict(),
]);
export type RoundInput = z.infer<typeof inputSchema>;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const roundRecordSchema = z.object({
  kind: z.literal('round'), round: z.int().positive(), inputs: z.array(inputSchema).min(2).max(3),
  authority: digestSchema, observations: z.array(z.object({ playerId: playerIdSchema, digest: digestSchema }).strict()).min(2).max(3),
}).strict();
export type MatchRecord = z.infer<typeof headerSchema> | z.infer<typeof roundRecordSchema>;

export function digest(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, entry: unknown) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
    return entry;
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function isolateRecordingFailure(roomId: string, write: (entry: MatchRecord) => void): (entry: MatchRecord) => void {
  let failed = false;
  return entry => {
    if (failed) return;
    try { write(entry); }
    catch (error) {
      failed = true;
      console.error({ event: 'match-recording-disabled', roomId, error });
    }
  };
}

export function createRecorder(directory: string, roomId: string): (entry: MatchRecord) => void {
  roomIdSchema.parse(roomId);
  const path = join(directory, `${roomId}-${randomUUID()}.jsonl`);
  let started = false;
  return isolateRecordingFailure(roomId, entry => {
    const line = JSON.stringify(entry) + '\n';
    if (!started) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, line, { flag: 'wx', mode: 0o600 });
      started = true;
    }
    else appendFileSync(path, line);
  });
}
