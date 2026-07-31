import { test, expect } from './fixtures';

// Spec §3.7: extension loads, popup renders. The third smoke item — a
// bundled static-only scenario running green against a local demo page —
// lands once the runner + a demo target exist (Phase 2 / examples/demo-*).

test('extension loads: manifest is valid and the background service worker starts', async ({
  extensionId,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('popup renders the Build/Run/Settings shell, defaulting to Run', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.getByRole('heading', { name: 'Aitomate', exact: true })).toBeVisible();

  // Dismiss the first-run onboarding wizard (T4.4)
  const skipBtn = page.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible()) await skipBtn.click();

  const runTab = page.getByRole('button', { name: 'Run' });
  const buildTab = page.getByRole('button', { name: 'Build' });
  const settingsTab = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(runTab).toBeVisible();
  await expect(buildTab).toBeVisible();
  await expect(settingsTab).toBeVisible();
  await expect(runTab).toHaveAttribute('aria-current', 'page');

  await expect(page.getByText('Import a scenario and run it')).toBeVisible();

  await buildTab.click();
  await expect(buildTab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Simple' })).toBeVisible();

  await settingsTab.click();
  await expect(settingsTab).toHaveAttribute('aria-current', 'page');
});
