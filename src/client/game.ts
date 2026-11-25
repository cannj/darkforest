import { serverMessageSchema, type Command, type PlayerView, type Position } from '../shared/protocol.js';

function element(id: string): HTMLElement {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing element ${id}`);
  return target;
}

export function mountGame(render: (view: PlayerView) => void) {
  let view: PlayerView | undefined;
  let selected: Position | undefined;
  const roomId = new URL(location.href).searchParams.get('room') ?? 'stone-room';
  element('room-name').textContent = `房间 ${roomId}`;
  const address = new URL('/room', location.href);
  address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  address.searchParams.set('room', roomId);
  const socket = new WebSocket(address);
  const buttons = document.querySelectorAll<HTMLButtonElement>('#game button');
  function send(command: Command) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(command));
  }
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    let input: unknown;
    try { input = JSON.parse(event.data); } catch { return; }
    const parsed = serverMessageSchema.safeParse(input);
    if (!parsed.success) {
      element('connection').textContent = '收到无法读取的房间消息';
      return;
    }
    if (parsed.data.kind === 'error') {
      element('connection').textContent = parsed.data.message;
      return;
    }
    const next = parsed.data.view;
    if (view?.round !== next.round) {
      selected = undefined;
      element('selection').textContent = '待提交 · 等待';
    }
    view = next;
    element('connection').textContent = next.seats < 2 ? '已连接 · 等待另一名玩家' : '两名玩家已入座';
    element('seat').textContent = `座位 ${next.self.id}`;
    element('round').textContent = `第 ${next.round} 回合 · 计划阶段`;
    element('board-summary').textContent = `公开地图 ${next.board.rows} × ${next.board.cols}`;
    element('position').textContent = `当前位置 (${next.self.position.row}, ${next.self.position.col})`;
    const target = next.plan.moves[0];
    element('plan').textContent = `${next.plan.kind === 'locked' ? '已锁定' : '草稿'}${target ? ` → (${target.row}, ${target.col})` : ' · 等待'}`;
    element('result').textContent = { none: '选择方向，提交后锁定计划', moved: '上轮移动成功', blocked: '上轮移动受阻', waited: '上轮等待' }[next.result];
    for (const button of buttons) button.disabled = next.plan.kind === 'locked';
    render(next);
  });
  socket.addEventListener('close', () => {
    element('connection').textContent = '连接已断开';
    for (const button of buttons) button.disabled = true;
  });
  socket.addEventListener('error', () => { element('connection').textContent = '连接失败，请检查房间服务'; });
  document.querySelectorAll<HTMLButtonElement>('[data-dr]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!view || view.plan.kind === 'locked') return;
      const position = { row: view.self.position.row + Number(button.dataset.dr), col: view.self.position.col + Number(button.dataset.dc) };
      if (position.row < 0 || position.col < 0 || position.row >= view.board.rows || position.col >= view.board.cols) {
        element('selection').textContent = '目标超出棋盘，请重新选择';
        selected = undefined;
        return;
      }
      selected = position;
      element('selection').textContent = `待提交 → (${position.row}, ${position.col})`;
    });
  });
  element('wait').addEventListener('click', () => {
    selected = undefined;
    element('selection').textContent = '待提交 · 等待';
  });
  element('submit-plan').addEventListener('click', () => {
    if (view) send({ kind: 'plan', round: view.round, requestId: crypto.randomUUID(), moves: selected ? [selected] : [] });
  });
  element('lock-plan').addEventListener('click', () => {
    if (view) send({ kind: 'lock', round: view.round, requestId: crypto.randomUUID() });
  });
}
