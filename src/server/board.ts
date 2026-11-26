import { z } from 'zod';
import { boardSchema, positionSchema, publicBoard, type Board, type Position } from '../shared/protocol.ts';

export const terrainSchema = z.object({ doors: z.record(z.string(), z.boolean()) }).strict();
export type Terrain = z.infer<typeof terrainSchema>;
export const roomSetupSchema = z.object({
  board: boardSchema.default(publicBoard),
  exploration: z.literal('player-vision').optional(),
  terrain: terrainSchema.default({ doors: {} }),
  spawns: z.tuple([positionSchema, positionSchema], positionSchema).refine((spawns) => spawns.length <= 3).default([{ row: 1, col: 1 }, { row: 3, col: 3 }]),
  visionRange: z.int().min(1).max(32).default(1),
}).strict().superRefine((setup, ctx) => {
  if (setup.spawns.some((p) => p.row >= setup.board.rows || p.col >= setup.board.cols) || new Set(setup.spawns.map((p) => `${p.row},${p.col}`)).size !== setup.spawns.length)
    ctx.addIssue({ code: 'custom', message: '出生点必须在界内且不同格' });
  if (Object.keys(setup.terrain.doors).some((id) => !setup.board.edges.some((e) => e.id === id && e.kind === 'door')))
    ctx.addIssue({ code: 'custom', message: '动态门状态必须引用地图上的门' });
});
export type RoomSetup = z.infer<typeof roomSetupSchema>;
export function sameCell(a: Position, b: Position): boolean { return a.row === b.row && a.col === b.col; }

function edgeClear(board: Board, terrain: Terrain, a: Position, b: Position): boolean {
  const edge = board.edges.find((e) => sameCell(e.a, a) && sameCell(e.b, b) || sameCell(e.b, a) && sameCell(e.a, b));
  return !edge || edge.kind === 'window' || edge.kind === 'door' && terrain.doors[edge.id] === true;
}

function adjacentClear(board: Board, terrain: Terrain, a: Position, b: Position, sight: boolean): boolean {
  if (a.row === b.row || a.col === b.col) return edgeClear(board, terrain, a, b);
  const c = { row: a.row, col: b.col };
  const d = { row: b.row, col: a.col };
  const clear = (x: Position, y: Position) => edgeClear(board, terrain, x, y) &&
    (sight || !board.edges.some((e) => e.kind === 'window' && (sameCell(e.a, x) && sameCell(e.b, y) || sameCell(e.b, x) && sameCell(e.a, y))));
  return clear(a, c) && clear(c, b) && clear(a, d) && clear(d, b);
}

export function canTraverse(board: Board, terrain: Terrain, from: Position, to: Position): boolean {
  return adjacentClear(board, terrain, from, to, false);
}
export function canSee(board: Board, terrain: Terrain, from: Position, to: Position, range = 1): boolean {
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > range) return false;
  let current = from;
  let x = dx === 0 ? Infinity : 0.5 / Math.abs(dx);
  let y = dy === 0 ? Infinity : 0.5 / Math.abs(dy);
  while (!sameCell(current, to)) {
    const tie = Math.abs(x - y) < 1e-9;
    const next = { row: current.row + (y < x || tie ? Math.sign(dy) : 0), col: current.col + (x < y || tie ? Math.sign(dx) : 0) };
    if (!adjacentClear(board, terrain, current, next, true)) return false;
    if (next.col !== current.col) x += 1 / Math.abs(dx);
    if (next.row !== current.row) y += 1 / Math.abs(dy);
    current = next;
  }
  return true;
}
