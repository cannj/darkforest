import type { Board } from '../shared/protocol.ts';
import { roomSetupSchema } from './board.ts';

const size = 10;
type Cell = Board['cells'][number];
type Edge = Board['edges'][number];
const templates: Readonly<Record<string, Pick<Cell, 'template' | 'terrain'> | undefined>> = {
  S: { template: 'stone-chamber', terrain: 'stone' },
  C: { template: 'open-court', terrain: 'moss' },
  L: { template: 'broken-corner', terrain: 'moss' },
  W: { template: 'window-ruin', terrain: 'stone' },
};

const cells = [
  'LSLWSLLSLL',
  'SCSWLWWSSS',
  'LSCSWWSLWL',
  'LWCCSSLSCW',
  'SLWSCCWSWL',
  'LWSWCCSWLS',
  'WCSLSSCCWL',
  'LWLSWWSCSL',
  'SSSWWLWSCS',
  'LLSLLSWLSL',
];

const east = [
  '.........',
  '...#..w..',
  '#..w..#.#',
  '#w....#.w',
  '.##...w.#',
  '#.w...##.',
  'w.#....w#',
  '#.#..w..#',
  '..w..#...',
  '.........',
];
const south = [
  '..#w.##.#.',
  '...#dw.#..',
  '....##..w.',
  '.#w...#...',
  '.w#....#w.',
  '...#...w#.',
  '.w..##....',
  '..#.wd#...',
  '.#.##.w#..',
];
const edgeKinds: Readonly<Record<string, Edge['kind'] | undefined>> = { '#': 'wall', d: 'door', w: 'window' };

function compileEdges(strips: string[], direction: 'east' | 'south'): Edge[] {
  const dr = direction === 'south' ? 1 : 0;
  const dc = direction === 'east' ? 1 : 0;
  if (strips.length !== size - dr || strips.some(strip => strip.length !== size - dc)) {
    throw new Error(`经典地图格边尺寸错误 (${direction})`);
  }
  return strips.flatMap((strip, row) => [...strip].flatMap((mark, col) => {
    if (mark === '.') return [];
    const kind = edgeKinds[mark];
    if (!kind) throw new Error(`经典地图格边符号无效 (${row}, ${col}, ${direction})`);
    return [{ id: `${direction}-${row}-${col}`, a: { row, col }, b: { row: row + dr, col: col + dc }, kind }];
  }));
}

export const classicRoomSetup = roomSetupSchema.parse({
  exploration: 'player-vision',
  board: {
    version: 'classic-v1',
    rows: size,
    cols: size,
    cells: cells.flatMap((strip, row) => [...strip].map((mark, col) => {
      const template = templates[mark];
      if (!template) throw new Error(`经典地图格子符号无效 (${row}, ${col})`);
      return { row, col, ...template };
    })),
    edges: [...compileEdges(east, 'east'), ...compileEdges(south, 'south')],
  },
  spawns: [{ row: 1, col: 1 }, { row: 8, col: 8 }],
});
