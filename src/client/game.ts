import { movementLimit, roundBeatLimit, serverMessageSchema, type Command, type PlayerView, type Position } from '../shared/protocol.js';

function element(id: string): HTMLElement {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing element ${id}`);
  return target;
}

function selectElement(id: string): HTMLSelectElement {
  const target = element(id);
  if (!(target instanceof HTMLSelectElement)) throw new Error(`Missing selector ${id}`);
  return target;
}

export function mountGame(render: (view: PlayerView) => void) {
  let view: PlayerView | undefined;
  let selected: (Position | null)[] = [];
  const directionOrigin = selectElement('direction-origin');
  let playbackTimer: ReturnType<typeof setTimeout> | undefined;
  const resultLabels = { moved: '移动成功', blocked: '移动受阻', waited: '等待' };
  function planText(moves: (Position | null)[]) {
    if (moves.length === 0) return ' · 等待';
    if (moves.length === 1 && moves[0]) return ` → (${moves[0].row}, ${moves[0].col})`;
    return moves.map((move, i) => `第${i + 1}拍${move ? ` → (${move.row}, ${move.col})` : ' · 等待'}`).join(' / ');
  }
  function select(move: Position | null) {
    if (selected.length >= roundBeatLimit || (move && selected.filter(Boolean).length >= movementLimit)) {
      element('selection').textContent = '每轮最多两次移动、四拍。请清空重排';
      return;
    }
    selected.push(move);
    element('selection').textContent = `待提交${planText(selected)}`;
  }
  function display(snapshot: PlayerView) {
    const sightings = snapshot.memory.map((sighting) => {
      const current = snapshot.observation.players.find((p) => p.id === sighting.id);
      const item = document.createElement('li');
      item.textContent = current
        ? `${current.id} · 当前 (${current.position.row}, ${current.position.col})`
        : `${sighting.id} · 旧目击 (${sighting.position.row}, ${sighting.position.col}) · 第${sighting.round}回合第${sighting.beat}拍`;
      return item;
    });
    const doors = snapshot.terrainMemory.map((door) => {
      const current = snapshot.observation.doors.some((d) => d.id === door.id);
      const item = document.createElement('li');
      item.textContent = `门 ${door.id} · ${door.open ? '开启' : '关闭'} · ${current ? '当前' : `第${door.round}回合第${door.beat}拍记忆`}`;
      return item;
    });
    element('sightings').replaceChildren(...sightings, ...doors);
    element('confrontations').textContent = snapshot.confrontations.map((entry) => `与 ${entry.opponent} 对峙 · 第${entry.round}回合第${entry.beat}拍接触`).join(' / ');
    render(snapshot);
  }
  const roomId = new URL(location.href).searchParams.get('room') ?? 'stone-room';
  element('room-name').textContent = `房间 ${roomId}`;
  const address = new URL('/room', location.href);
  address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  address.searchParams.set('room', roomId);
  const storageKey = `darkforest-seat:${roomId}`;
  let socket: WebSocket;
  let fatal = false;
  let restoring = true;
  let serverOffset = 0;
  function countdown() {
    if (!view) return;
    const phase = { waiting: '等待入座', planning: '计划阶段', resolving: '结算阶段' }[view.phase];
    element('round').textContent = `第 ${view.round} 回合 · ${phase}`;
    const target = document.getElementById('countdown');
    if (target) target.textContent = view.deadline === null ? '等待满员后开始计时' :
      `剩余 ${Math.max(0, Math.ceil((view.deadline - (Date.now() + serverOffset)) / 1000))} 秒`;
  }
  setInterval(countdown, 100);
  function connect() {
    restoring = true;
    const credential = sessionStorage.getItem(storageKey);
    if (credential) address.searchParams.set('resume', credential);
    socket = new WebSocket(address);
    socket.addEventListener('message', receive);
    socket.addEventListener('close', (event) => {
      if (event.reason === '座位已在新连接恢复') fatal = true;
      element('connection').textContent = fatal ? '座位已失效，请在新标签页加入' : '连接已断开 · 正在重连';
      for (const button of buttons) button.disabled = true;
      if (!fatal) setTimeout(connect, 500);
    });
    socket.addEventListener('error', () => { element('connection').textContent = '连接失败 · 正在重连'; });
  }
  const buttons = document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('#game button, #game select');
  function send(command: Command) {
    if (socket.readyState !== WebSocket.OPEN || view?.phase === 'resolving') return;
    socket.send(JSON.stringify(command));
  }
  function receive(event: MessageEvent<string>) {
    let input: unknown;
    try { input = JSON.parse(event.data); } catch { return; }
    const parsed = serverMessageSchema.safeParse(input);
    if (!parsed.success) {
      element('connection').textContent = '收到无法读取的房间消息';
      return;
    }
    if (parsed.data.kind === 'session') {
      sessionStorage.setItem(storageKey, parsed.data.credential);
      return;
    }
    if (parsed.data.kind === 'error') {
      if (parsed.data.message === '座位恢复凭证无效') fatal = true;
      element('connection').textContent = parsed.data.message;
      return;
    }
    const next = parsed.data.view;
    if (restoring || view?.round !== next.round) {
      selected = [...next.plan.moves];
      directionOrigin.value = 'planned';
      element('selection').textContent = `待提交${planText(selected)}`;
      restoring = false;
    }
    if (view?.beats[0]?.round !== next.beats[0]?.round) clearTimeout(playbackTimer);
    view = next;
    serverOffset = next.serverTime - Date.now();
    countdown();
    element('connection').textContent = next.seats < 2 ? '已连接 · 等待另一名玩家' : '两名玩家已入座';
    element('seat').textContent = `座位 ${next.self.id}`;

    element('board-summary').textContent = `公开地图 ${next.board.rows} × ${next.board.cols}`;
    element('position').textContent = `当前位置 (${next.self.position.row}, ${next.self.position.col})`;
    element('plan').textContent = `${next.plan.kind === 'locked' ? '已锁定' : '草稿'}${planText(next.plan.moves)}`;
    element('beat-results').replaceChildren(...next.beats.map((beat) => {
      const item = document.createElement('li');
      item.textContent = `第${beat.beat}拍 · ${resultLabels[beat.result]} · (${beat.from.row}, ${beat.from.col}) → (${beat.to.row}, ${beat.to.col})`;
      return item;
    }));
    element('result').textContent = { none: '选择方向，提交后锁定计划', moved: '上轮移动成功', blocked: '上轮移动受阻', waited: '上轮等待' }[next.result];
    for (const button of buttons) button.disabled = next.plan.kind === 'locked' || next.phase === 'resolving';
    const replay = document.getElementById('replay');
    if (replay instanceof HTMLButtonElement) replay.disabled = next.beats.length === 0;
    display(next);
  }
  connect();
  window.addEventListener('offline', () => socket.close());
  document.querySelectorAll<HTMLButtonElement>('[data-dr]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!view || view.plan.kind === 'locked') return;
      const origin = directionOrigin.value === 'current' ? view.self.position :
        selected.findLast((move) => move !== null) ?? view.self.position;
      const position = { row: origin.row + Number(button.dataset.dr), col: origin.col + Number(button.dataset.dc) };
      if (position.row < 0 || position.col < 0 || position.row >= view.board.rows || position.col >= view.board.cols) {
        element('selection').textContent = '目标超出棋盘，请重新选择';
        return;
      }
      select(position);
    });
  });
  element('wait').addEventListener('click', () => select(null));
  element('clear-plan').addEventListener('click', () => {
    selected = [];
    directionOrigin.value = 'planned';
    element('selection').textContent = '待提交 · 等待';
  });
  element('replay').addEventListener('click', () => {
    if (!view || view.beats.length === 0) return;
    clearTimeout(playbackTimer);
    const snapshot = view;
    let index = 0;
    function advance() {
      const beat = snapshot.beats[index++];
      if (!beat) {
        element('playback').textContent = `播放完成 · 第${snapshot.beats[0]?.round ?? snapshot.round}回合`;
        display(view ?? snapshot);
        return;
      }
      element('playback').textContent = `第${beat.beat}拍 · ${resultLabels[beat.result]}`;
      const frame = snapshot.playback.find((f) => f.beat === beat.beat);
      if (frame) display({ ...snapshot, self: { ...snapshot.self, position: frame.self }, observation: frame.observation, memory: frame.memory, terrainMemory: frame.terrainMemory });
      playbackTimer = setTimeout(advance, 500);
    }
    advance();
  });
  element('submit-plan').addEventListener('click', () => {
    if (view) send({ kind: 'plan', round: view.round, requestId: crypto.randomUUID(), moves: selected });
  });
  element('lock-plan').addEventListener('click', () => {
    if (view) send({ kind: 'lock', round: view.round, requestId: crypto.randomUUID() });
  });
}
