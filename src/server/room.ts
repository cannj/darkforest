import { commandSchema, publicBoard, roomIdSchema, type CommandResult, type PlayerId, type PlayerView } from '../shared/protocol.ts';
import { resolveRound, type CommittedBeat, type PlayerState } from './rules.ts';

export class Room {
  readonly id: string;
  private round = 1;
  private players: PlayerState[] = [];
  private beats: CommittedBeat[] = [];

  constructor(id: string) {
    this.id = roomIdSchema.parse(id);
  }

  join(): PlayerId {
    if (this.players.length >= 2) throw new Error('房间已满');
    const id = this.players.length === 0 ? 'p1' : 'p2';
    this.players.push({ id, position: id === 'p1' ? { row: 1, col: 1 } : { row: 3, col: 3 }, plan: { kind: 'draft', moves: [] }, result: 'none' });
    return id;
  }

  command(identity: PlayerId, input: unknown): CommandResult {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return { kind: 'rejected', message: '命令格式不正确' };
    const command = parsed.data;
    const player = this.player(identity);
    if (command.round !== this.round) return { kind: 'rejected', message: '回合已经变化' };
    if (player.plan.kind === 'locked') return { kind: 'rejected', message: '计划已经锁定' };
    if (command.kind === 'plan') player.plan = { kind: 'draft', moves: command.moves };
    else player.plan = { kind: 'locked', moves: player.plan.moves };
    if (this.players.length === 2 && this.players.every((entry) => entry.plan.kind === 'locked')) {
      this.beats = [];
      for (const beat of resolveRound({ board: publicBoard, players: this.players })) {
        this.players = beat.players;
        this.beats.push(beat);
      }
      this.players = this.players.map((entry) => ({ ...entry, plan: { kind: 'draft', moves: [] } }));
      this.round++;
    }
    return { kind: 'accepted' };
  }

  view(identity: PlayerId): PlayerView {
    const player = this.player(identity);
    return structuredClone({
      roomId: this.id, board: publicBoard, round: this.round, phase: 'planning', seats: this.players.length,
      self: { id: player.id, position: player.position }, plan: player.plan, result: player.result,
      beats: this.beats.flatMap((beat) => beat.results.filter((result) => result.playerId === identity)
        .map(({ playerId, ...result }) => ({ round: this.round - 1, ...result }))),
    });
  }

  private player(identity: PlayerId): PlayerState {
    const player = this.players.find((entry) => entry.id === identity);
    if (!player) throw new Error('座位不存在');
    return player;
  }
}
