import { commandSchema, movementLimit, roundBeatLimit, roomIdSchema, type CommandResult, type PlayerId, type PlayerView } from '../shared/protocol.ts';
import { configVersion, digest, isolateRecordingFailure, rulesVersion, type MatchRecord, type RoundInput } from './recording.ts';
import { roomSetupSchema, type RoomSetup } from './board.ts';
import { PlayerViews } from './player-view.ts';
import { resolveRound, type CommittedBeat, type Confrontation, type PlayerState } from './rules.ts';

export type RoomRuntime = { now?: () => number; roundDurationMs?: number; settlementDurationMs?: number; record?: (entry: MatchRecord) => void };

export class Room {
  readonly id: string;
  private round = 1;
  private settledRound = 0;
  private players: PlayerState[] = [];
  private beats: CommittedBeat[] = [];
  private confrontations: Confrontation[] = [];
  private contacts = new Set<string>();

  private readonly setup: RoomSetup;
  private readonly views = new PlayerViews();

  private phase: 'waiting' | 'planning' | 'resolving' = 'waiting';
  private deadline: number | null = null;
  private requests = new Map<PlayerId, Map<string, CommandResult>>();
  private readonly now: () => number;
  private readonly roundDurationMs: number;
  private readonly settlementDurationMs: number;
  private readonly record: (entry: MatchRecord) => void;

  constructor(id: string, setup: unknown = {}, runtime: RoomRuntime = {}) {
    this.now = runtime.now ?? Date.now;
    this.record = isolateRecordingFailure(id, runtime.record ?? (() => {}));
    this.roundDurationMs = runtime.roundDurationMs ?? 30_000;
    this.settlementDurationMs = runtime.settlementDurationMs ?? 0;
    if (!Number.isFinite(this.roundDurationMs) || this.roundDurationMs <= 0 ||
        !Number.isFinite(this.settlementDurationMs) || this.settlementDurationMs < 0) throw new Error('时长必须有效');
    this.setup = roomSetupSchema.parse(setup);
    this.id = roomIdSchema.parse(id);
  }

  join(): PlayerId {
    const position = this.setup.spawns[this.players.length];
    if (!position) throw new Error('房间已满');
    const id = this.players.length === 0 ? 'p1' : this.players.length === 1 ? 'p2' : 'p3';
    this.players.push({ id, position, plan: { kind: 'draft', moves: [] }, result: 'none' });
    for (const player of this.players) this.views.capture(player.id, { setup: this.setup, players: this.players, round: this.round }, 0);
    if (this.players.length === this.setup.spawns.length) {
      this.record(structuredClone({ kind: 'header', format: 1, roomId: this.id, rulesVersion, configVersion,
        setup: this.setup, movementLimit, roundBeatLimit, initialSeats: this.players.map(({ id, position }) => ({ id, position })) }));
      this.phase = 'planning';
      this.deadline = this.now() + this.roundDurationMs;
    }
    return id;
  }

  command(identity: PlayerId, input: unknown): CommandResult {
    this.tick();
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return { kind: 'rejected', message: '命令格式不正确' };
    const command = parsed.data;
    const player = this.player(identity);
    if (command.round !== this.round) return { kind: 'rejected', message: '回合已经变化' };
    const requests = this.requests.get(identity) ?? new Map<string, CommandResult>();
    this.requests.set(identity, requests);
    const previous = requests.get(command.requestId);
    if (previous) return previous;
    if (this.phase === 'resolving') return { kind: 'rejected', message: '正在结算' };
    if (player.plan.kind === 'locked') return { kind: 'rejected', message: '计划已经锁定' };
    if (command.kind === 'plan') player.plan = { kind: 'draft', moves: command.moves };
    else player.plan = { kind: 'locked', moves: player.plan.moves };
    const result: CommandResult = { kind: 'accepted' };
    requests.set(command.requestId, result);
    if (this.players.length === this.setup.spawns.length && this.players.every((entry) => entry.plan.kind === 'locked')) this.settle(this.now());
    return result;
  }

  tick(): boolean {
    let changed = false;
    const now = this.now();
    let transitions = 0;
    while (this.deadline !== null && now >= this.deadline && transitions++ < 10) {
      const boundary = this.deadline;
      if (this.phase === 'resolving') {
        this.startNextRound(boundary);
      } else {
        this.settle(boundary);
      }
      changed = true;
    }
    if (this.deadline !== null && this.deadline <= now) {
      this.deadline = now + (this.phase === 'resolving' ? this.settlementDurationMs : this.roundDurationMs);
    }
    return changed;
  }

  private settle(at: number) {
    const inputs = this.players.map<RoundInput>(player => player.plan.kind === 'locked'
      ? { playerId: player.id, source: 'locked', moves: player.plan.moves }
      : { playerId: player.id, source: 'timeout', moves: [] });
    this.players = this.players.map(player => player.plan.kind === 'locked' ? player :
      { ...player, plan: { kind: 'locked', moves: [] } });
    this.beats = [];
    this.views.startSettlement();
    for (const outcome of resolveRound({ setup: this.setup, players: this.players, round: this.round,
      previous: { contacts: this.contacts, confrontations: this.confrontations } })) {
      this.players = outcome.players;
      this.contacts = outcome.contacts;
      this.confrontations = outcome.confrontations;
      this.beats.push({ beat: outcome.beat, players: outcome.players, results: outcome.results });
      this.views.captureBeat({ setup: this.setup, players: this.players, round: this.round }, outcome.beat);
    }
    this.settledRound = this.round;
    this.record({ kind: 'round', round: this.round, inputs,
      authority: digest({ players: this.players, terrain: this.setup.terrain, beats: this.beats, contacts: [...this.contacts].sort(), confrontations: this.confrontations }),
      observations: this.players.map(({ id }) => {
        const view = this.view(id);
        return { playerId: id, digest: digest({ playback: view.playback, memory: view.memory,
          ...(this.setup.exploration ? { mapMemory: view.mapMemory } : {}),
          terrainMemory: view.terrainMemory, observation: view.observation, confrontations: view.confrontations }) };
      }),
    });
    this.phase = 'resolving';
    this.deadline = at + this.settlementDurationMs;
    if (this.settlementDurationMs === 0) this.startNextRound(at);
  }

  private startNextRound(at: number) {
    this.players = this.players.map((entry) => ({ ...entry, plan: { kind: 'draft', moves: [] } }));
    this.round++;
    this.requests.clear();
    this.phase = 'planning';
    this.deadline = at + this.roundDurationMs;
  }

  view(identity: PlayerId): PlayerView {
    return this.views.project(identity, { setup: this.setup, players: this.players, round: this.round,
      roomId: this.id, phase: this.phase, deadline: this.deadline, serverTime: this.now(),
      beats: this.beats, settledRound: this.settledRound, confrontations: this.confrontations });
  }

  private player(identity: PlayerId): PlayerState {
    const player = this.players.find((entry) => entry.id === identity);
    if (!player) throw new Error('座位不存在');
    return player;
  }
}
