import type { MapMemory, PlayerId, Observation, Playback, Sighting, TerrainMemory, PlayerView } from '../shared/protocol.ts';
import { canSee, type RoomSetup } from './board.ts';
import type { CommittedBeat, Confrontation, PlayerState } from './rules.ts';

function projectBoard(setup: RoomSetup, observation: Observation) {
  if (!setup.exploration) return setup.board;
  const visible = (p: { row: number; col: number }) => observation.cells.some(c => c.row === p.row && c.col === p.col);
  return { ...setup.board, cells: setup.board.cells.filter(visible), edges: setup.board.edges.filter(e => visible(e.a) || visible(e.b)) };
}

type ViewState = { setup: RoomSetup; players: PlayerState[]; round: number };

function playerFor(players: PlayerState[], identity: PlayerId): PlayerState {
  const player = players.find(entry => entry.id === identity);
  if (!player) throw new Error('座位不存在');
  return player;
}

export class PlayerViews {
  private mapMemories = new Map<PlayerId, MapMemory>();
  private memories = new Map<PlayerId, Sighting[]>();
  private terrainMemories = new Map<PlayerId, TerrainMemory[]>();
  private playback = new Map<PlayerId, Playback[]>();

  startSettlement(): void { this.playback.clear(); }

  captureBeat(state: ViewState, beat: number): void {
    for (const player of state.players) {
      const observation = this.capture(player.id, state, beat);
      const frames = this.playback.get(player.id) ?? [];
      frames.push(structuredClone({ round: state.round, beat, self: player.position, ...(state.setup.exploration ? { board: projectBoard(state.setup, observation) } : {}), observation, memory: this.memories.get(player.id) ?? [], terrainMemory: this.terrainMemories.get(player.id) ?? [] }));
      this.playback.set(player.id, frames);
    }
  }

  project(identity: PlayerId, state: ViewState & { roomId: string; phase: PlayerView['phase']; deadline: number | null; serverTime: number; beats: CommittedBeat[]; settledRound: number; confrontations: Confrontation[] }): PlayerView {
    const player = playerFor(state.players, identity);
    const observation = this.observe(identity, state);
    return structuredClone({
      roomId: state.roomId, board: projectBoard(state.setup, observation), ...(state.setup.exploration ? { exploration: state.setup.exploration } : {}), round: state.round, phase: state.phase, deadline: state.deadline, serverTime: state.serverTime, seats: state.players.length,
      confrontations: state.confrontations.filter((entry) => entry.participants.includes(identity)).map(({ participants, round, beat }) => ({ opponent: participants[0] === identity ? participants[1] : participants[0], round, beat })),
      self: { id: player.id, position: player.position }, plan: player.plan, result: state.beats.flatMap((beat) => beat.results).findLast((r) => r.playerId === identity && r.result !== 'waited')?.result ?? player.result,
      ...(state.setup.exploration ? { mapMemory: this.mapMemories.get(identity) ?? { cells: [], edges: [] } } : {}),
      terrainMemory: this.terrainMemories.get(identity) ?? [],
      observation, memory: this.memories.get(identity) ?? [], playback: this.playback.get(identity) ?? [],
      beats: state.beats.flatMap((beat) => beat.results.filter((result) => result.playerId === identity)
        .map(({ playerId, ...result }) => ({ round: state.settledRound, ...result }))),
    });
  }

  private observe(identity: PlayerId, state: ViewState): Observation {
    const self = playerFor(state.players, identity);
    const cells = state.setup.board.cells.filter((cell) => canSee(state.setup.board, state.setup.terrain, self.position, cell, state.setup.visionRange))
      .map(({ row, col }) => ({ row, col }));
    const visible = (p: { row: number; col: number }) => cells.some((c) => c.row === p.row && c.col === p.col);
    return {
      cells, players: state.players.filter((p) => p.id !== identity && visible(p.position)).map(({ id, position }) => ({ id, position })),
      doors: state.setup.board.edges.filter((e) => e.kind === 'door' && (visible(e.a) || visible(e.b)))
        .map((e) => ({ id: e.id, open: state.setup.terrain.doors[e.id] === true })),
    };
  }

  capture(identity: PlayerId, state: ViewState, beat: number): Observation {
    const observation = this.observe(identity, state);
    if (state.setup.exploration) {
      const previous = this.mapMemories.get(identity) ?? { cells: [], edges: [] };
      const current = projectBoard(state.setup, observation);
      const cells = new Map([...previous.cells, ...current.cells].map(cell => [cell.row + ',' + cell.col, cell]));
      const edges = new Map([...previous.edges, ...current.edges].map(edge => [edge.id, edge]));
      this.mapMemories.set(identity, {
        cells: [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col),
        edges: [...edges.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      });
    }
    const memories = this.memories.get(identity) ?? [];
    for (const player of observation.players) {
      const previous = memories.findIndex((s) => s.id === player.id);
      const sighting = { ...player, round: state.round, beat };
      if (previous < 0) memories.push(sighting);
      else memories[previous] = sighting;
    }
    this.memories.set(identity, memories);
    const terrainMemory = this.terrainMemories.get(identity) ?? [];
    for (const door of observation.doors) {
      const previous = terrainMemory.findIndex((d) => d.id === door.id);
      const memory = { ...door, round: state.round, beat };
      if (previous < 0) terrainMemory.push(memory);
      else terrainMemory[previous] = memory;
    }
    this.terrainMemories.set(identity, terrainMemory);
    return observation;
  }

}
