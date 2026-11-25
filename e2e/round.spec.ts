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
      expect(Object.keys(message.view).sort()).toEqual(['board', 'phase', 'plan', 'result', 'roomId', 'round', 'seats', 'self']);
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
