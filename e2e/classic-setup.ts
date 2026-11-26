import { expect, type Page } from '@playwright/test';

export async function approachCourtyard(first: Page, second: Page) {
  await expect(second.getByTestId('seat')).toHaveText('座位 p2');
  await Promise.all([
    advance(first, '东南 ↘'),
    advance(second, '西北 ↖'),
  ]);
  await Promise.all([first, second].map(page =>
    expect(page.getByTestId('round')).toHaveText('第 2 回合 · 计划阶段')));
}

async function advance(page: Page, name: string) {
  const direction = page.getByRole('button', { name, exact: true });
  await direction.click();
  await direction.click();
  await page.getByRole('button', { name: '提交计划', exact: true }).click();
  await page.getByRole('button', { name: '锁定计划', exact: true }).click();
}
