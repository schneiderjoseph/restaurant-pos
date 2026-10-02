import { test, expect } from '@playwright/test';
import { clearHighlights, highlightAndReady } from '../helpers/highlight.ts';
import { loginWithPin, openAdminPage, openAdminTab, resetSession } from '../helpers/auth.ts';
import { captureLocator, capturePage } from '../helpers/screenshot.ts';

test.describe.configure({ mode: 'serial' });

/** Venue-ops cards, under Manage > General settings. */
const ADVANCED_GENERAL_CARDS: Array<{ testId: string; file: string }> = [
  { testId: 'settings-card-closing-cycle', file: 'settings-adv-closing-cycle' },
  { testId: 'settings-card-auto-check-close', file: 'settings-adv-auto-check-close' },
  { testId: 'settings-card-session-security', file: 'settings-adv-session-security' },
  { testId: 'settings-card-auto-clock-out', file: 'settings-adv-auto-clock-out' },
  { testId: 'settings-card-service-charges', file: 'settings-adv-service-charges' },
  { testId: 'settings-card-menus', file: 'settings-adv-menus' },
  { testId: 'settings-card-inventory', file: 'settings-adv-inventory' },
];

test('capture advanced general settings', async ({ page }) => {
  test.setTimeout(300_000);
  await resetSession(page);
  await loginWithPin(page);
  await openAdminPage(page);
  await openAdminTab(page, 'general_settings');
  const panel = page.getByTestId('admin-general-settings');
  await expect(panel).toBeVisible({ timeout: 30_000 });

  await highlightAndReady(page, panel);
  await capturePage(page, 'settings-adv-overview', { fullPage: true });
  await clearHighlights(page);

  for (const { testId, file } of ADVANCED_GENERAL_CARDS) {
    const card = page.getByTestId(testId);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await highlightAndReady(page, card);
    await captureLocator(card, file);
    await clearHighlights(page);
  }
});
