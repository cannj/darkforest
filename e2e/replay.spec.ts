import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serverMessageSchema, type PlayerView } from '../src/shared/protocol.ts';
import { digest, roundRecordSchema } from '../src/server/recording.ts';

test('隔离浏览器真实对局记录对峙和超时，开发入口重跑并核对实际下发观察', async ({ browser }) => {
  test.setTimeout(65_000);
  const a = await browser.newContext(); const b = await browser.newContext();
  const first = await a.newPage(); const second = await b.newPage();
  const firstViews: PlayerView[] = []; const secondViews: PlayerView[] = [];
  for (const { page, views } of [{ page: first, views: firstViews }, { page: second, views: secondViews }]) {
    page.on('websocket', socket => {
      if (new URL(socket.url()).pathname !== '/room') return;
      socket.on('framereceived', ({ payload }) => {
        const message = serverMessageSchema.parse(JSON.parse(payload.toString()));
        if (message.kind === 'view') views.push(message.view);
      });
    });
  }
  const roomId = `replay-${Date.now()}`;
  const url = `http://127.0.0.1:5174/?room=${roomId}`;
  try {
    await first.goto(url); await second.goto(url);
    await expect(second.getByTestId('seat')).toHaveText('座位 p2');
    await second.getByRole('button', { name: '西北 ↖', exact: true }).click();
    await second.getByRole('button', { name: '提交计划', exact: true }).click();
    await first.getByRole('button', { name: '锁定计划', exact: true }).click();
    await second.getByRole('button', { name: '锁定计划', exact: true }).click();
    await expect(first.getByTestId('round')).toContainText('第 2 回合');
    await expect(first.getByTestId('confrontations')).toContainText('与 p2 对峙');
    await first.getByRole('button', { name: '锁定计划', exact: true }).click();
    await second.getByRole('button', { name: '南 ↓', exact: true }).click();
    await second.getByRole('button', { name: '提交计划', exact: true }).click();
    await expect(second.getByTestId('plan')).toContainText('(3, 2)');
    await expect(first.getByTestId('round')).toContainText('第 3 回合', { timeout: 35_000 });
    await expect(second.getByTestId('position')).toHaveText('当前位置 (2, 2)');
    const directory = process.env.MATCH_LOG_DIR ?? 'artifacts/matches';
    const file = readdirSync(directory).find(file => file.startsWith(`${roomId}-`));
    expect(file).toBeDefined();
    const path = join(directory, file ?? 'missing');
    const records = readFileSync(path, 'utf8').trim().split('\n').slice(1).map(line => roundRecordSchema.parse(JSON.parse(line)));
    expect(records).toHaveLength(2);
    expect(records[1]?.inputs).toEqual([{ playerId: 'p1', source: 'locked', moves: [] }, { playerId: 'p2', source: 'timeout', moves: [] }]);
    for (const record of records) for (const views of [firstViews, secondViews]) {
      const view = views.find(view => view.round === record.round && view.phase === 'resolving');
      expect(view).toBeDefined();
      if (!view) throw new Error('missing live settlement');
      expect(record.observations.find(entry => entry.playerId === view.self.id)?.digest).toBe(digest({
        playback: view.playback, memory: view.memory, terrainMemory: view.terrainMemory,
        observation: view.observation, confrontations: view.confrontations,
      }));
    }
    const result = execFileSync(process.execPath, ['--experimental-strip-types', 'src/server/replay-cli.ts', path], { encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual({ roomId, rounds: 2 });
    await test.info().attach('recorded-match', { path, contentType: 'application/x-ndjson' });
  } finally { await a.close(); await b.close(); }
});
