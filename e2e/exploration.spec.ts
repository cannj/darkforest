import { expect, test } from '@playwright/test';
import { serverMessageSchema, type PlayerView } from '../src/shared/protocol.ts';

test('经典探索只传当前授权布局，移动、回放和恢复按座位呈现', async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  const first = await a.newPage(); const second = await b.newPage();
  const views: PlayerView[][] = [[], []]; const errors: string[] = [];
  for (const [index, page] of [first, second].entries()) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('THREE.WebGLProgram')) errors.push(message.text()); });
    page.on('websocket', socket => { if (new URL(socket.url()).pathname !== '/room') return; socket.on('framereceived', ({ payload }) => {
      const parsed = serverMessageSchema.parse(JSON.parse(payload.toString()));
      if (parsed.kind === 'view') views[index]?.push(parsed.view);
    }); });
  }
  const room = `exploration-${Date.now()}`;
  try {
    await first.goto(`http://127.0.0.1:5174/?room=${room}`);
    await second.goto(`http://127.0.0.1:5174/?room=${room}`);
    await expect(first.locator('#room')).toHaveAttribute('data-map-view', 'classic');
    await expect(second.getByTestId('seat')).toHaveText('座位 p2');
    await expect(first.getByTestId('board-summary')).toHaveText('棋盘外框 10 × 10');
    await expect(first.locator('#room')).toHaveAttribute('data-camera-mode', 'follow');
    const initial = views[0]?.at(-1); const other = views[1]?.at(-1);
    expect(initial?.board.cells.length).toBe(7);
    expect(initial?.board.cells.some(c => c.row === 8 && c.col === 8)).toBe(false);
    expect(other?.board.cells.some(c => c.row === 1 && c.col === 1)).toBe(false);
    await first.screenshot({ path: 'artifacts/exploration-initial.png', fullPage: true });
    await first.getByRole('button', { name: '东南 ↘', exact: true }).click();
    await first.getByRole('button', { name: '东南 ↘', exact: true }).click();
    await first.getByRole('button', { name: '提交计划', exact: true }).click();
    await first.getByRole('button', { name: '锁定计划', exact: true }).click();
    await second.getByRole('button', { name: '锁定计划', exact: true }).click();
    await expect(first.getByTestId('round')).toContainText('第 2 回合');
    await expect(first.locator('#room')).toHaveAttribute('data-position', '3,3');
    const moved = views[0]?.at(-1);
    expect(moved?.board.cells.some(c => c.row === 4 && c.col === 4)).toBe(true);
    await expect(first.locator('#room')).toHaveAttribute('data-remembered-cells', /1,1/);
    expect(moved?.mapMemory?.cells.some(c => c.row === 1 && c.col === 1)).toBe(true);
    expect(views[1]?.at(-1)?.mapMemory?.cells.some(c => c.row === 1 && c.col === 1)).toBe(false);
    await first.getByRole('button', { name: '全图', exact: true }).click();
    await expect(first.locator('#room')).toHaveAttribute('data-camera-mode', 'overview');
    const knownCells = await first.locator('#room').getAttribute('data-memory-cells');
    const beforeRotate = (await first.locator('#room').screenshot()).toString('base64');
    await first.locator('#room').focus(); await first.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await first.locator('#room').screenshot()).toString('base64')).not.toBe(beforeRotate);
    await first.locator('#room').hover(); await first.mouse.wheel(0, -250);
    const bounds = await first.locator('#room').boundingBox();
    if (!bounds) throw new Error('棋盘未显示');
    await first.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await first.mouse.down({ button: 'right' });
    await first.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 30, { steps: 3 });
    await first.mouse.up({ button: 'right' });
    await expect(first.locator('#room')).toHaveAttribute('data-camera-mode', 'free');
    await expect(first.locator('#room')).toHaveAttribute('data-memory-cells', knownCells!);
    await first.getByRole('button', { name: '全图', exact: true }).click();
    await first.clock.install();
    await first.clock.pauseAt(new Date(Date.now() + 1000));
    await first.getByRole('button', { name: '播放上轮', exact: true }).click();
    await expect(first.locator('#room')).toHaveAttribute('data-position', '2,2');
    await expect(first.locator('#room')).not.toHaveAttribute('data-layout-cells', /4,4/);
    await expect(first.locator('#room')).not.toHaveAttribute('data-memory-cells', /4,4/);
    await first.clock.runFor(2500);
    await expect(first.locator('#room')).toHaveAttribute('data-position', '3,3');
    await first.screenshot({ path: 'artifacts/exploration-moved.png', fullPage: true });
    await first.locator('#room').focus(); await first.keyboard.press('ArrowLeft');
    await first.screenshot({ path: 'artifacts/exploration-rotated.png', fullPage: true });
    await first.reload();
    await expect(first.getByTestId('seat')).toHaveText('座位 p1');
    await expect(first.locator('#room')).toHaveAttribute('data-position', '3,3');
    await expect(first.locator('#room')).toHaveAttribute('data-remembered-cells', /1,1/);
    await expect(first.locator('#room')).toHaveAttribute('data-camera-mode', 'follow');
    expect(views[0]?.at(-1)?.mapMemory).toEqual(moved?.mapMemory);
    for (const seatViews of views) for (const view of seatViews) {
      expect(view.board.cells.map(({ row, col }) => ({ row, col }))).toEqual(view.observation.cells);
      const visible = (p: { row: number; col: number }) => view.observation.cells.some(c => c.row === p.row && c.col === p.col);
      expect(view.board.edges.every(e => visible(e.a) || visible(e.b))).toBe(true);
      for (const frame of view.playback) expect(frame.board?.cells.map(({ row, col }) => ({ row, col }))).toEqual(frame.observation.cells);
    }
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
