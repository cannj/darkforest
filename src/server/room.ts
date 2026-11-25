import { commandSchema, movementLimit, roundBeatLimit, roomIdSchema, type CommandResult, type PlayerId, type Observation, type Playback, type Sighting, type TerrainMemory, type PlayerView } from '../shared/protocol.ts';
import { configVersion, digest, rulesVersion, type MatchRecord, type RoundInput } from './recording.ts';
import { canSee, roomSetupSchema, type RoomSetup } from './board.ts';
import { resolveRound, type CommittedBeat, type PlayerState } from './rules.ts';

export type RoomRuntime = { now?: () => number; roundDurationMs?: number; settlementDurationMs?: number; record?: (entry: MatchRecord) => void };

export class Room {
  readonly id: string;
  private round = 1;
  private settledRound = 0;
  private players: PlayerState[] = [];
  private beats: CommittedBeat[] = [];
  private confrontations: { participants: [PlayerId, PlayerId]; round: number; beat: number }[] = [];
  private contacts = new Set<string>();

  private readonly setup: RoomSetup;
  private memories = new Map<PlayerId, Sighting[]>();
  private terrainMemories = new Map<PlayerId, TerrainMemory[]>();
  private playback = new Map<PlayerId, Playback[]>();

  private phase: 'waiting' | 'planning' | 'resolving' = 'waiting';
  private deadline: number | null = null;
  private requests = new Map<PlayerId, Map<string, CommandResult>>();
  private readonly now: () => number;
  private readonly roundDurationMs: number;
  private readonly settlementDurationMs: number;
  private readonly record: (entry: MatchRecord) => void;

  constructor(id: string, setup: unknown = {}, runtime: RoomRuntime = {}) {
    this.now = runtime.now ?? Date.now;
    this.record = runtime.record ?? (() => {});
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
    for (const player of this.players) this.capture(player.id, 0);
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
    this.playback.clear();
    const stopped = new Set<PlayerId>();
    this.detectConfrontations(0, stopped);
    for (const beat of resolveRound({ board: this.setup.board, terrain: this.setup.terrain, players: this.players, stopped })) {
      this.players = beat.players;
      this.detectConfrontations(beat.beat, stopped);
      this.beats.push(beat);
      for (const player of this.players) {
        const observation = this.capture(player.id, beat.beat);
        const frames = this.playback.get(player.id) ?? [];
        frames.push(structuredClone({ round: this.round, beat: beat.beat, self: player.position, observation, memory: this.memories.get(player.id) ?? [], terrainMemory: this.terrainMemories.get(player.id) ?? [] }));
        this.playback.set(player.id, frames);
      }
    }
    this.settledRound = this.round;
    this.record({ kind: 'round', round: this.round, inputs,
      authority: digest({ players: this.players, terrain: this.setup.terrain, beats: this.beats, contacts: [...this.contacts].sort(), confrontations: this.confrontations }),
      observations: this.players.map(({ id }) => ({ playerId: id, digest: digest({
        playback: this.playback.get(id), memory: this.memories.get(id), terrainMemory: this.terrainMemories.get(id),
        observation: this.observe(id), confrontations: this.view(id).confrontations,
      }) })),
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
    const player = this.player(identity);
    return structuredClone({
      roomId: this.id, board: this.setup.board, round: this.round, phase: this.phase, deadline: this.deadline, serverTime: this.now(), seats: this.players.length,
      confrontations: this.confrontations.filter((entry) => entry.participants.includes(identity)).map(({ participants, round, beat }) => ({ opponent: participants[0] === identity ? participants[1] : participants[0], round, beat })),
      self: { id: player.id, position: player.position }, plan: player.plan, result: this.beats.flatMap((beat) => beat.results).findLast((r) => r.playerId === identity && r.result !== 'waited')?.result ?? player.result,
      terrainMemory: this.terrainMemories.get(identity) ?? [],
      observation: this.observe(identity), memory: this.memories.get(identity) ?? [], playback: this.playback.get(identity) ?? [],
      beats: this.beats.flatMap((beat) => beat.results.filter((result) => result.playerId === identity)
        .map(({ playerId, ...result }) => ({ round: this.settledRound, ...result }))),
    });
  }

  private detectConfrontations(beat: number, stopped: Set<PlayerId>): void {
    const contacts = new Set<string>();
    for (const [index, first] of this.players.entries()) {
      for (const second of this.players.slice(index + 1)) {
        if (!canSee(this.setup.board, this.setup.terrain, first.position, second.position, this.setup.visionRange) ||
            !canSee(this.setup.board, this.setup.terrain, second.position, first.position, this.setup.visionRange)) continue;
        const key = `${first.id}:${second.id}`;
        contacts.add(key);
        if (this.contacts.has(key)) continue;
        stopped.add(first.id);
        stopped.add(second.id);
        const relation = this.confrontations.find((entry) => entry.participants[0] === first.id && entry.participants[1] === second.id);
        if (relation) Object.assign(relation, { round: this.round, beat });
        else this.confrontations.push({ participants: [first.id, second.id], round: this.round, beat });
      }
    }
    this.contacts = contacts;
  }

  private observe(identity: PlayerId): Observation {
    const self = this.player(identity);
    const cells = this.setup.board.cells.filter((cell) => canSee(this.setup.board, this.setup.terrain, self.position, cell, this.setup.visionRange))
      .map(({ row, col }) => ({ row, col }));
    const visible = (p: { row: number; col: number }) => cells.some((c) => c.row === p.row && c.col === p.col);
    return {
      cells, players: this.players.filter((p) => p.id !== identity && visible(p.position)).map(({ id, position }) => ({ id, position })),
      doors: this.setup.board.edges.filter((e) => e.kind === 'door' && (visible(e.a) || visible(e.b)))
        .map((e) => ({ id: e.id, open: this.setup.terrain.doors[e.id] === true })),
    };
  }

  private capture(identity: PlayerId, beat: number): Observation {
    const observation = this.observe(identity);
    const memories = this.memories.get(identity) ?? [];
    for (const player of observation.players) {
      const previous = memories.findIndex((s) => s.id === player.id);
      const sighting = { ...player, round: this.round, beat };
      if (previous < 0) memories.push(sighting);
      else memories[previous] = sighting;
    }
    this.memories.set(identity, memories);
    const terrainMemory = this.terrainMemories.get(identity) ?? [];
    for (const door of observation.doors) {
      const previous = terrainMemory.findIndex((d) => d.id === door.id);
      const memory = { ...door, round: this.round, beat };
      if (previous < 0) terrainMemory.push(memory);
      else terrainMemory[previous] = memory;
    }
    this.terrainMemories.set(identity, terrainMemory);
    return observation;
  }

  private player(identity: PlayerId): PlayerState {
    const player = this.players.find((entry) => entry.id === identity);
    if (!player) throw new Error('座位不存在');
    return player;
  }
}
