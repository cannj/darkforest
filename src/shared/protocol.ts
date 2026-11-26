import { z } from 'zod';

export const roomIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,32}$/);
export const playerIdSchema = z.enum(['p1', 'p2', 'p3']);
export type PlayerId = z.infer<typeof playerIdSchema>;
export const positionSchema = z.object({ row: z.int().nonnegative(), col: z.int().nonnegative() }).strict();
export type Position = z.infer<typeof positionSchema>;
export const cellSchema = positionSchema.extend({ terrain: z.enum(['stone', 'moss']), template: z.enum(['stone-chamber', 'open-court', 'broken-corner', 'window-ruin']).optional() }).strict();
export const edgeSchema = z.object({
  id: z.string().min(1), a: positionSchema, b: positionSchema,
  kind: z.enum(['wall', 'door', 'window']),
}).strict();
export const boardProjectionSchema = z.object({
  version: z.string().min(1), rows: z.int().positive(), cols: z.int().positive(),
  cells: z.array(cellSchema), edges: z.array(edgeSchema),
}).strict().superRefine((board, ctx) => {
  const key = (p: Position) => `${p.row},${p.col}`;
  const inside = (p: Position) => p.row < board.rows && p.col < board.cols;
  const cells = new Set(board.cells.map(key));
  const edges = new Set(board.edges.map((e) => [key(e.a), key(e.b)].sort().join(':')));
  if (board.cells.length !== cells.size || board.cells.some((c) => !inside(c)))
    ctx.addIssue({ code: 'custom', message: '地图格子必须在界内且不重复' });
  if (edges.size !== board.edges.length || new Set(board.edges.map((e) => e.id)).size !== board.edges.length ||
      board.edges.some((e) => !inside(e.a) || !inside(e.b) || Math.abs(e.a.row - e.b.row) + Math.abs(e.a.col - e.b.col) !== 1))
    ctx.addIssue({ code: 'custom', message: '格边必须唯一且连接界内正交相邻格' });
});
export type BoardProjection = z.infer<typeof boardProjectionSchema>;
export const boardSchema = boardProjectionSchema.superRefine((board, ctx) => {
  if (board.cells.length !== board.rows * board.cols) ctx.addIssue({ code: 'custom', message: '权威地图必须完整声明格子' });
});
export type Board = z.infer<typeof boardSchema>;
export const publicBoard: Board = boardSchema.parse({
  version: 'stone-room-v1', rows: 5, cols: 5,
  cells: Array.from({ length: 25 }, (_, i) => ({ row: Math.floor(i / 5), col: i % 5, terrain: i % 3 ? 'stone' : 'moss' })),
  edges: [
    { id: 'west-wall', a: { row: 4, col: 0 }, b: { row: 4, col: 1 }, kind: 'wall' },
    { id: 'north-door', a: { row: 0, col: 3 }, b: { row: 1, col: 3 }, kind: 'door' },
    { id: 'east-window', a: { row: 2, col: 3 }, b: { row: 2, col: 4 }, kind: 'window' },
  ],
});

export const movementLimit = 2;
export const roundBeatLimit = 4;
const movesSchema = z.array(positionSchema.nullable()).max(roundBeatLimit)
  .refine((moves) => moves.filter((move) => move !== null).length <= movementLimit);
export const beatResultSchema = z.object({
  round: z.int().positive(), beat: z.int().positive(),
  from: positionSchema, to: positionSchema, result: z.enum(['moved', 'blocked', 'waited']),
}).strict();
export type BeatResult = z.infer<typeof beatResultSchema>;

const commandFields = { round: z.int().positive(), requestId: z.string().min(1).max(80) };
export const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), ...commandFields, moves: movesSchema }).strict(),
  z.object({ kind: z.literal('lock'), ...commandFields }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const planSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft'), moves: movesSchema }).strict(),
  z.object({ kind: z.literal('locked'), moves: movesSchema }).strict(),
]);
export type Plan = z.infer<typeof planSchema>;
export const observedPlayerSchema = z.object({ id: playerIdSchema, position: positionSchema }).strict();
export const observationSchema = z.object({
  cells: z.array(positionSchema), players: z.array(observedPlayerSchema),
  doors: z.array(z.object({ id: z.string(), open: z.boolean() }).strict()),
}).strict();
export type Observation = z.infer<typeof observationSchema>;
export const sightingSchema = observedPlayerSchema.extend({ round: z.int().positive(), beat: z.int().nonnegative() }).strict();
export type Sighting = z.infer<typeof sightingSchema>;
export const terrainMemorySchema = z.object({ id: z.string(), open: z.boolean(), round: z.int().positive(), beat: z.int().nonnegative() }).strict();
export type TerrainMemory = z.infer<typeof terrainMemorySchema>;
export const confrontationSchema = z.object({ opponent: playerIdSchema, round: z.int().positive(), beat: z.int().nonnegative() }).strict();
export type Confrontation = z.infer<typeof confrontationSchema>;
export const playbackSchema = z.object({
  round: z.int().positive(), beat: z.int().positive(), self: positionSchema,
  observation: observationSchema, memory: z.array(sightingSchema), terrainMemory: z.array(terrainMemorySchema),
  board: boardProjectionSchema.optional(),
}).strict();
export type Playback = z.infer<typeof playbackSchema>;
export const playerViewSchema = z.object({
  roomId: roomIdSchema,
  board: boardProjectionSchema,
  exploration: z.literal('player-vision').optional(),
  round: z.int().positive(),
  phase: z.enum(['waiting', 'planning', 'resolving']),
  deadline: z.number().nonnegative().nullable(),
  serverTime: z.number().nonnegative(),
  seats: z.int().nonnegative(),
  confrontations: z.array(confrontationSchema),
  self: z.object({ id: playerIdSchema, position: positionSchema }).strict(),
  plan: planSchema,
  result: z.enum(['none', 'moved', 'blocked', 'waited']),
  beats: z.array(beatResultSchema),
  observation: observationSchema, memory: z.array(sightingSchema), terrainMemory: z.array(terrainMemorySchema), playback: z.array(playbackSchema),
}).strict();
export type PlayerView = z.infer<typeof playerViewSchema>;
export const serverMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), credential: z.string().min(32).max(128) }).strict(),
  z.object({ kind: z.literal('view'), view: playerViewSchema }).strict(),
  z.object({ kind: z.literal('error'), message: z.string() }).strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type CommandResult = { kind: 'accepted' } | { kind: 'rejected'; message: string };
