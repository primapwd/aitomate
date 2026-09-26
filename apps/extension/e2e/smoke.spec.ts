import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Spec §3.7: extension loads, popup renders, and a bundled static-only
// scenario runs green against a local demo page. The demo fixture is
// self-served on 8081 by playwright.config.ts's webServer
// (e2e/serve-demo.mjs, no URL rewriting).
const DEMO_SCENARIO_PATH = path.join(
  __dirname,
  '../../../examples/demo-ssr/test-ssr.aitomate.json',
);
const DEMO_URL = 'http://localhost:8081/index.html';

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

  // The 0.4.1 redesign moved the app name into the header banner (text, not
  // a heading) and the first-run wizard owns the page's only heading. Assert
  // the banner text — the shell's stable identity — instead of an exact
  // "Aitomate" heading that no longer exists.
  await expect(page.getByText('AI Test Automation', { exact: true })).toBeVisible();

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

  await expect(page.getByText('No scenario loaded yet')).toBeVisible();

  await buildTab.click();
  await expect(buildTab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Simple' })).toBeVisible();

  await settingsTab.click();
  await expect(settingsTab).toHaveAttribute('aria-current', 'page');
});

test('a bundled static-only scenario runs green against the local demo page', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // Dismiss the first-run onboarding wizard (T4.4), then seed the bundled
  // scenario into storage and reload so the Run view lists it. "Bundled"
  // per §3.7: the fixture ships with the harness; the file-picker import
  // path is already covered by import-export unit tests.
  const skipBtn = popup.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible()) await skipBtn.click();
  const scenario = JSON.parse(await readFile(DEMO_SCENARIO_PATH, 'utf8'));
  await popup.evaluate((scenario) => {
    return browser.storage.local.set({
      'aitomate:scenarios': [
        { id: 'smoke-demo-ssr', name: scenario.meta.name, scenario, importedAt: Date.now() },
      ],
    });
  }, scenario);
  await popup.reload();

  // The runner targets the browser's *active* tab (RunView queries
  // tabs.query({ active: true })), so the demo page must be active while
  // the popup's Run button is clicked. Assert that precondition so a wrong
  // active tab fails here, not as a mystery timeout.
  const demo = await context.newPage();
  await demo.goto(DEMO_URL);
  await demo.bringToFront();
  const activeTab = await popup.evaluate(() =>
    browser.tabs.query({ active: true, currentWindow: true }),
  );
  expect(activeTab[0]?.url).toContain('localhost:8081');

  const card = popup.locator('.ait-card').filter({ hasText: 'Demo SSR — Sign Up Full Flow' });
  await expect(card).toBeVisible();
  // Click in the extension page's DOM without focusing that page. A normal
  // Playwright click can activate the popup tab, causing the runner's
  // active-tab query to target the extension page instead of the demo.
  await card.getByRole('button', { name: 'Run' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  // The full run takes ~20-25s; be generous. A green report is the
  // deliverable (§3.7).
  await expect(popup.getByText('PASSED ✓', { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(popup.getByText('FAILED ✕', { exact: true })).not.toBeVisible();
});
