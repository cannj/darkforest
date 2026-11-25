import type { Board, Plan, PlayerId, PlayerView, Position } from '../shared/protocol.ts';

export type PlayerState = { id: PlayerId; position: Position; plan: Plan; result: PlayerView['result'] };

export function resolveRound({ board, players }: { board: Board; players: PlayerState[] }): PlayerState[] {
  const proposals: { player: PlayerState; target: Position; result: PlayerView['result'] }[] = players.map((player) => {
    const target = player.plan.moves[0];
    if (!target) return { player, target: player.position, result: 'waited' };
    const distance = Math.max(Math.abs(target.row - player.position.row), Math.abs(target.col - player.position.col));
    const blocked = distance !== 1 || target.row >= board.rows || target.col >= board.cols ||
      players.some((other) => other.id !== player.id && other.position.row === target.row && other.position.col === target.col);
    return { player, target: blocked ? player.position : target, result: blocked ? 'blocked' : 'moved' };
  });
  return proposals.map(({ player, target, result }) => {
    const conflict = proposals.some((other) => other.player.id !== player.id && other.target.row === target.row && other.target.col === target.col);
    return {
      ...player,
      position: conflict ? player.position : target,
      result: conflict ? 'blocked' : result,
      plan: { kind: 'draft', moves: [] },
    };
  });
}
