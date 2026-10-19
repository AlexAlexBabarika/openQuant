import { expect, test, type Locator, type Page } from '@playwright/test';

/** A guest workspace with market data blocked, so spot stays at the default 100. */
async function openOptions(page: Page): Promise<Locator> {
  await page.route(/\/data\//, route => route.abort());
  await page.goto('/');
  await page
    .getByRole('dialog')
    .filter({ hasText: 'Market data unavailable' })
    .getByRole('button', { name: 'Close' })
    .click();
  await page.getByRole('button', { name: 'Strategy', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Strategy views' })
    .getByRole('button', { name: 'options' })
    .click();
  const panel = page.getByRole('region', {
    name: 'Options research',
    exact: true,
  });
  await expect(status(panel)).toHaveText('Up to date');
  return panel;
}

const status = (panel: Locator) =>
  panel.locator('.panel-header').getByRole('status');

async function tops(...locators: Locator[]): Promise<number[]> {
  const ys: number[] = [];
  for (const locator of locators) ys.push((await locator.boundingBox())!.y);
  return ys;
}

const ascending = (ys: number[]) => [...ys].sort((a, b) => a - b);

test('analyzes the default by itself and redraws a template beside the legs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openOptions(page);
  await expect(
    panel.getByRole('img', { name: /P&L for Long call/ }),
  ).toContainText('Now 100');

  await panel
    .getByRole('group', { name: 'Strategy templates' })
    .getByRole('button', { name: 'Iron condor' })
    .click();
  const chart = panel.getByRole('img', { name: /P&L for Iron condor/ });
  await expect(chart).toContainText('Now 100');
  await expect(status(panel)).toHaveText('Up to date');
  const legs = panel.getByRole('region', { name: 'Options strategy legs' });
  const strikes = legs.locator('input[name$=".strike"]');
  await expect(strikes).toHaveCount(4);
  for (const [i, strike] of ['87.5', '95', '105', '112.5'].entries())
    await expect(strikes.nth(i)).toHaveValue(strike);

  const plot = (await chart.boundingBox())!;
  const editor = (await legs.boundingBox())!;
  expect(plot.x).toBeGreaterThanOrEqual(editor.x + editor.width);
  expect(plot.y).toBeLessThan(900);
});

test('opens the research tools read-only for untouched Python', async ({
  page,
}) => {
  const panel = await openOptions(page);
  await panel
    .getByRole('group', { name: 'Options authoring mode' })
    .getByRole('button', { name: 'Python' })
    .click();
  await expect(status(panel)).toHaveText('Up to date');
  await expect(
    panel.getByRole('region', { name: 'Research tools' }),
  ).toContainText('Analysis of Long call · up to date');
  const hint = panel.getByText(/Run the current Python source/);
  await expect(hint).toBeHidden();

  await panel.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# edited');
  await expect(status(panel)).toHaveText('Source changed');
  await expect(hint).toBeVisible();
});

test('puts the chart first on phones and Python source above its toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openOptions(page);
  const mode = panel.getByRole('group', { name: 'Options authoring mode' });
  const order = await tops(
    panel.getByRole('region', { name: 'Submitted options risk totals' }),
    panel.getByRole('img', { name: /P&L for/ }),
    panel.getByRole('region', { name: 'Options strategy legs' }),
    panel.getByText(/^Assumptions ·/),
    mode,
    panel.getByText('Research tools', { exact: true }),
  );
  expect(order).toEqual(ascending(order));

  await mode.getByRole('button', { name: 'Python' }).click();
  // Untouched source describes the analyzed strategy, so nothing is stale.
  await expect(status(panel)).toHaveText('Up to date');
  await expect(panel.getByText(/Run to update them/)).toBeHidden();
  const python = await tops(
    panel.getByRole('region', { name: 'Options Python editor' }),
    mode,
  );
  expect(python).toEqual(ascending(python));
});
