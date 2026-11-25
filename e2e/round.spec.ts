import { expect, test } from '@playwright/test';
import { serverMessageSchema } from '../src/shared/protocol.js';

test('两个隔离浏览器在石室完成真实联机回合', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const first = await a.newPage();
  const second = await b.newPage();
  const errors: string[] = [];
  const secondMessages: string[] = [];
  second.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/room') {
      socket.on('framereceived', ({ payload }) => secondMessages.push(payload.toString()));
    }
  });
  first.on('pageerror', (error) => errors.push(error.message));
  second.on('pageerror', (error) => errors.push(error.message));
  const url = `http://127.0.0.1:5174/?room=round-${Date.now()}`;
  await first.goto(url);
  await second.goto(url);
  await expect(first.getByTestId('seat')).toHaveText('座位 p1');
  await expect(second.getByTestId('seat')).toHaveText('座位 p2');
  await expect(first.getByTestId('board-summary')).toHaveText('公开地图 5 × 5');
  await expect(second.getByTestId('board-summary')).toHaveText('公开地图 5 × 5');
  await expect(first.locator('#room')).toHaveAttribute('tabindex', '0');
  await first.screenshot({ path: 'artifacts/first-round-initial.png', fullPage: true });
  await first.getByRole('button', { name: '南 ↓', exact: true }).click();
  await first.getByRole('button', { name: '提交计划', exact: true }).click();
  await expect(first.getByTestId('plan')).toHaveText('草稿 → (2, 1)');
  await expect(second.getByTestId('plan')).toHaveText('草稿 · 等待');
  await first.getByRole('button', { name: '锁定计划', exact: true }).click();
  await expect(first.getByTestId('plan')).toHaveText('已锁定 → (2, 1)');
  expect(secondMessages.length).toBeGreaterThan(0);
  for (const payload of secondMessages) {
    const message = serverMessageSchema.parse(JSON.parse(payload));
    expect(message.kind).toBe('view');
    if (message.kind === 'view') {
      expect(message.view.self).toEqual({ id: 'p2', position: { row: 3, col: 3 } });
      expect(message.view.plan).toEqual({ kind: 'draft', moves: [] });
      expect(Object.keys(message.view).sort()).toEqual(['beats', 'board', 'confrontations', 'memory', 'observation', 'phase', 'plan', 'playback', 'result', 'roomId', 'round', 'seats', 'self', 'terrainMemory']);
    }
  }
  await second.getByRole('button', { name: '北 ↑', exact: true }).click();
  await second.getByRole('button', { name: '提交计划', exact: true }).click();
  await expect(second.getByTestId('plan')).toHaveText('草稿 → (2, 3)');
  await second.getByRole('button', { name: '锁定计划', exact: true }).click();
  for (const page of [first, second]) {
    await expect(page.getByTestId('round')).toHaveText('第 2 回合 · 计划阶段');
    await expect(page.locator('#room')).toHaveAttribute('data-round', '2');
    await expect(page.getByTestId('result')).toHaveText('上轮移动成功');
  }
  await expect(first.getByTestId('position')).toHaveText('当前位置 (2, 1)');
  await expect(second.getByTestId('position')).toHaveText('当前位置 (2, 3)');
  await expect(first.locator('#room')).toHaveAttribute('data-position', '2,1');
  await expect(second.locator('#room')).toHaveAttribute('data-position', '2,3');
  await first.screenshot({ path: 'artifacts/first-round-p1.png', fullPage: true });
  await second.screenshot({ path: 'artifacts/first-round-p2.png', fullPage: true });
  await first.locator('#room').focus();
  await first.keyboard.press('ArrowLeft');
  await first.screenshot({ path: 'artifacts/first-round-rotated.png', fullPage: true });
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test('玩家进入对峙后本轮停止，画面显示对峙和四拍结果', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const first = await a.newPage();
  const second = await b.newPage();
  const url = `http://127.0.0.1:5174/?room=beats-${Date.now()}`;
  await first.goto(url);
  await second.goto(url);
  await expect(second.getByTestId('seat')).toHaveText('座位 p2');
  await first.getByRole('button', { name: '东南 ↘', exact: true }).click();
  await first.getByRole('button', { name: '等待', exact: true }).click();
  await first.getByRole('button', { name: '南 ↓', exact: true }).click();
  await first.getByRole('button', { name: '提交计划', exact: true }).click();
  await expect(first.getByTestId('plan')).toContainText('第3拍 → (3, 2)');
  await first.getByRole('button', { name: '锁定计划', exact: true }).click();
  await second.getByRole('button', { name: '锁定计划', exact: true }).click();
  await expect(first.getByTestId('position')).toHaveText('当前位置 (2, 2)');
  await expect(first.getByTestId('beat-results')).toContainText('第1拍 · 移动成功 · (1, 1) → (2, 2)');
  await expect(first.getByTestId('beat-results')).toContainText('第2拍 · 等待 · (2, 2) → (2, 2)');
  await expect(first.getByTestId('beat-results')).toContainText('第3拍 · 等待 · (2, 2) → (2, 2)');
  await expect(second.getByTestId('beat-results')).not.toContainText('(2, 2)');
  await expect(first.getByTestId('confrontations')).toContainText('与 p2 对峙 · 第1回合第1拍接触');
  await first.getByRole('button', { name: '播放上轮', exact: true }).click();
  await expect(first.locator('#room')).toHaveAttribute('data-position', '2,2');
  await expect(first.getByTestId('playback')).toHaveText('播放完成 · 第1回合');
  await expect(first.locator('#room')).toHaveAttribute('data-position', '2,2');
  await first.screenshot({ path: 'artifacts/two-moves-playback.png', fullPage: true });
  await a.close();
  await b.close();
});

test('短暂目击只出现在获准的拍，画面区分当前棋子和带时间的旧目击', async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  const first = await a.newPage(); const second = await b.newPage();
  const firstMessages: string[] = []; const secondMessages: string[] = [];
  for (const [page, messages] of [[first, firstMessages], [second, secondMessages]] as const) {
    page.on('websocket', (socket) => { if (new URL(socket.url()).pathname === '/room') socket.on('framereceived', ({ payload }) => messages.push(payload.toString())); });
  }
  const url = `http://127.0.0.1:5174/?room=fog-${Date.now()}`;
  await first.goto(url); await second.goto(url);
  await expect(second.getByTestId('seat')).toHaveText('座位 p2');
  await second.getByRole('button', { name: '西北 ↖', exact: true }).click();
  await second.getByRole('button', { name: '提交计划', exact: true }).click();
  await first.getByRole('button', { name: '锁定计划', exact: true }).click();
  await second.getByRole('button', { name: '锁定计划', exact: true }).click();
  await expect(first.getByTestId('round')).toContainText('第 2 回合');
  await expect(first.getByTestId('confrontations')).toContainText('与 p2 对峙');
  const before = firstMessages.length;
  await second.getByRole('button', { name: '等待', exact: true }).click();
  await second.getByRole('button', { name: '南 ↓', exact: true }).click();
  await second.getByRole('button', { name: '提交计划', exact: true }).click();
  await expect(second.getByTestId('plan')).toContainText('(3, 2)');
  await first.waitForTimeout(100);
  expect(firstMessages).toHaveLength(before);
  await first.getByRole('button', { name: '锁定计划', exact: true }).click();
  await second.getByRole('button', { name: '锁定计划', exact: true }).click();
  await expect(first.getByTestId('round')).toContainText('第 3 回合');
  await expect(first.locator('#room')).toHaveAttribute('data-visible-players', '');
  await expect(first.getByTestId('sightings')).toContainText('p2 · 旧目击 (2, 2) · 第2回合第1拍');
  const messages = firstMessages.map((p) => serverMessageSchema.parse(JSON.parse(p)));
  const settled = messages.findLast((m) => m.kind === 'view' && m.view.round === 3);
  expect(settled?.kind).toBe('view');
  if (settled?.kind === 'view') {
    expect(settled.view.playback.map((f) => f.observation.players)).toEqual([[{ id: 'p2', position: { row: 2, col: 2 } }], [], [], []]);
    expect(JSON.stringify(settled.view)).not.toContain('"position":{"row":3,"col":2}');
  }
  const otherSettled = secondMessages.map((p) => serverMessageSchema.parse(JSON.parse(p)))
    .findLast((m) => m.kind === 'view' && m.view.round === 3);
  expect(otherSettled?.kind).toBe('view');
  if (otherSettled?.kind === 'view') {
    expect(otherSettled.view.observation.players).toEqual([]);
    expect(otherSettled.view.playback.map((f) => f.observation.players)).toEqual([[{ id: 'p1', position: { row: 1, col: 1 } }], [], [], []]);
    expect(otherSettled.view.plan).toEqual({ kind: 'draft', moves: [] });
  }
  await first.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await first.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
  await first.getByRole('button', { name: '播放上轮', exact: true }).click();
  await expect(first.locator('#room')).toHaveAttribute('data-visible-players', 'p2');
  await expect(first.getByTestId('sightings')).toContainText('p2 · 当前 (2, 2)');
  await first.clock.runFor(20);
  await first.screenshot({ path: 'artifacts/fog-fleeting.png', fullPage: true });
  await first.clock.runFor(2500);
  await expect(first.getByTestId('playback')).toContainText('播放完成');
  await expect(first.locator('#room')).toHaveAttribute('data-visible-players', '');
  await first.screenshot({ path: 'artifacts/fog-memory.png', fullPage: true });
  await a.close(); await b.close();
});
