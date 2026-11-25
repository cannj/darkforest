import { canTraverse, sameCell, type Terrain } from './board.ts';
import { roundBeatLimit, type BeatResult, type Board, type Plan, type PlayerId, type PlayerView, type Position } from '../shared/protocol.ts';

export type PlayerState = { id: PlayerId; position: Position; plan: Plan; result: PlayerView['result'] };
export type CommittedBeat = {
  beat: number;
  players: PlayerState[];
  results: (Omit<BeatResult, 'round'> & { playerId: PlayerId })[];
};

export function* resolveRound({ board, players, terrain = { doors: {} }, stopped = new Set<PlayerId>() }: {
  board: Board; terrain?: Terrain; players: PlayerState[]; stopped?: ReadonlySet<PlayerId>;
}): Generator<CommittedBeat> {
  let current: PlayerState[] = players.map((player) => ({ ...player, result: 'waited' }));
  for (let index = 0; index < roundBeatLimit; index++) {
    const proposals: { player: PlayerState; target: Position; result: BeatResult['result'] }[] = current.map((player) => {
      const target = stopped.has(player.id) ? null : player.plan.moves[index];
      if (!target) return { player, target: player.position, result: 'waited' };
      const distance = Math.max(Math.abs(target.row - player.position.row), Math.abs(target.col - player.position.col));
      const blocked = distance !== 1 || !canTraverse(board, terrain, player.position, target) || target.row < 0 || target.col < 0 || target.row >= board.rows || target.col >= board.cols ||
        current.some((other) => other.id !== player.id && sameCell(other.position, target));
      return { player, target: blocked ? player.position : target, result: blocked ? 'blocked' : 'moved' };
    });
    const resolutions: (Omit<BeatResult, 'round'> & { playerId: PlayerId; player: PlayerState })[] = proposals.map(({ player, target, result }) => {
      const conflict = proposals.some((other) => other.player.id !== player.id && sameCell(other.target, target));
      return {
        player, playerId: player.id, beat: index + 1, from: player.position,
        to: conflict ? player.position : target, result: conflict ? 'blocked' : result,
      };
    });
    current = resolutions.map(({ player, to, result }) => ({
      ...player, position: to, result: index < player.plan.moves.length ? result : player.result,
    }));
    yield { beat: index + 1, players: current, results: resolutions.map(({ player, ...result }) => result) };
  }
}
