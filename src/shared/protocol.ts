import { z } from 'zod';

export const roomIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,32}$/);
export const playerIdSchema = z.enum(['p1', 'p2']);
export type PlayerId = z.infer<typeof playerIdSchema>;
export const positionSchema = z.object({ row: z.int().nonnegative(), col: z.int().nonnegative() }).strict();
export type Position = z.infer<typeof positionSchema>;
export const boardSchema = z.object({
  version: z.literal('stone-room-v1'),
  rows: z.int().positive(),
  cols: z.int().positive(),
}).strict();
export type Board = z.infer<typeof boardSchema>;
export const publicBoard: Board = { version: 'stone-room-v1', rows: 5, cols: 5 };

const commandFields = { round: z.int().positive(), requestId: z.string().min(1).max(80) };
export const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), ...commandFields, moves: z.array(positionSchema).max(1) }).strict(),
  z.object({ kind: z.literal('lock'), ...commandFields }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const planSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft'), moves: z.array(positionSchema) }).strict(),
  z.object({ kind: z.literal('locked'), moves: z.array(positionSchema) }).strict(),
]);
export type Plan = z.infer<typeof planSchema>;
export const playerViewSchema = z.object({
  roomId: roomIdSchema,
  board: boardSchema,
  round: z.int().positive(),
  phase: z.literal('planning'),
  seats: z.int().nonnegative(),
  self: z.object({ id: playerIdSchema, position: positionSchema }).strict(),
  plan: planSchema,
  result: z.enum(['none', 'moved', 'blocked', 'waited']),
}).strict();
export type PlayerView = z.infer<typeof playerViewSchema>;
export const serverMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('view'), view: playerViewSchema }).strict(),
  z.object({ kind: z.literal('error'), message: z.string() }).strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type CommandResult = { kind: 'accepted' } | { kind: 'rejected'; message: string };
