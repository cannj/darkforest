import { expect, test } from '@playwright/test';
import { serverMessageSchema, type PlayerView } from '../src/shared/protocol.ts';

test('真实断网后恢复原座位，锁定行动离线执行，未锁定草稿超时等待', async ({ browser }) => {
  test.setTimeout(65_000);
  const a = await browser.newContext(); const b = await browser.newContext();
  const first = await a.newPage(); const second = await b.newPage();
  const received: PlayerView[] = [];
  let credential = '';
  second.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const parsed = serverMessageSchema.safeParse(JSON.parse(payload.toString()));
    if (parsed.success && parsed.data.kind === 'view') received.push(parsed.data.view);
    if (parsed.success && parsed.data.kind === 'session') credential = parsed.data.credential;
  }));
  const url = `http://127.0.0.1:5174/?room=reconnect-${Date.now()}`;
  try {
    await first.goto(url); await second.goto(url);
    await expect(second.getByTestId('seat')).toHaveText('座位 p2');
    await expect(first.getByTestId('countdown')).toContainText('剩余');
    const initial = received.at(-1);
    expect(initial?.deadline).toBeGreaterThan(initial?.serverTime ?? 0);
    await first.getByRole('button', { name: '西 ←', exact: true }).click();
    await first.getByRole('button', { name: '提交计划', exact: true }).click();
    await expect(first.getByTestId('plan')).toHaveText('草稿 → (1, 0)');
    const count = received.length;
    await first.getByRole('button', { name: '锁定计划', exact: true }).click();
    await expect(first.getByTestId('plan')).toHaveText('已锁定 → (1, 0)');
    expect(received).toHaveLength(count);
    await second.getByRole('button', { name: '东 →', exact: true }).click();
    await second.getByRole('button', { name: '提交计划', exact: true }).click();
    await expect(second.getByTestId('plan')).toHaveText('草稿 → (3, 4)');
    await a.setOffline(true); await b.setOffline(true);
    await expect(first.locator('#connection')).toContainText('连接已断开');
    await expect(second.locator('#connection')).toContainText('连接已断开');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, (initial?.deadline ?? Date.now()) - Date.now() + 1300)));
    await a.setOffline(false); await b.setOffline(false);
    await expect(first.getByTestId('seat')).toHaveText('座位 p1');
    await expect(first.getByTestId('round')).toHaveText('第 2 回合 · 计划阶段');
    await expect(second.getByTestId('round')).toHaveText('第 2 回合 · 计划阶段');
    await expect(first.getByTestId('position')).toHaveText('当前位置 (1, 0)');
    await expect(second.getByTestId('position')).toHaveText('当前位置 (3, 3)');
    expect(received.at(-1)?.self.id).toBe('p2');
    expect(received.at(-1)?.deadline).toBeGreaterThan(initial?.deadline ?? 0);
    expect(credential).toHaveLength(43);
    await first.reload();
    await expect(first.getByTestId('seat')).toHaveText('座位 p1');
    await expect(first.getByTestId('position')).toHaveText('当前位置 (1, 0)');
  } finally { await a.close(); await b.close(); }
});
