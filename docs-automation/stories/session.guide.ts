import { test, expect } from '@playwright/test';
import { clearHighlights, highlightAndReady } from '../helpers/highlight.ts';
import {
  loginWithPin,
  openAdminPage,
  openAdminTab,
  resetSession,
} from '../helpers/auth.ts';
import { captureLocator, capturePage } from '../helpers/screenshot.ts';

test.describe.configure({ mode: 'serial' });

test('capture lock and locked login', async ({ page }) => {
  test.setTimeout(360_000);
  await resetSession(page);
  await loginWithPin(page);

  // Sidebar session controls
  await expect(page.getByTestId('nav-lock')).toBeVisible({ timeout: 30_000 });
  await highlightAndReady(page, [
    page.getByTestId('nav-settings'),
    page.getByTestId('nav-lock'),
    page.getByTestId('nav-logout'),
  ]);
  await capturePage(page, 'session-sidebar-controls', { fullPage: false });
  await clearHighlights(page);

  // Ensure we are logged in before lock shot
  if (await page.getByTestId('login-page').isVisible().catch(() => false)) {
    await loginWithPin(page);
  }

  await page.goto('/menu').catch(() => undefined);
  await page.waitForTimeout(800);
  if (!(await page.getByTestId('nav-lock').isVisible().catch(() => false))) {
    await loginWithPin(page);
  }

  await page.getByTestId('nav-lock').click();
  await expect(page.getByTestId('login-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('login-locked-banner')).toBeVisible({ timeout: 15_000 });
  await highlightAndReady(page, page.getByTestId('login-locked-banner'));
  await capturePage(page, 'session-locked', { fullPage: false });
  await clearHighlights(page);

  // Unlock with same PIN (loginWithPin works while locked for same user)
  await page.getByTestId('login-method-pin').click();
  const pin = process.env.DOCS_LOGIN_PIN || '5555';
  for (const digit of pin.slice(0, 4)) {
    await page.getByTestId('login-pin-pad').getByRole('button', { name: digit, exact: true }).click();
  }
  await page.waitForURL(/\/(menu|settings|orders|admin)/, { timeout: 60_000 });

  // Session security (idle lock/logout), set once for every user under Manage > General settings
  await openAdminPage(page);
  await openAdminTab(page, 'general_settings');
  const card = page.getByTestId('settings-card-session-security');
  await expect(card).toBeVisible();
  await highlightAndReady(page, card);
  await captureLocator(card, 'session-idle-settings');
  await clearHighlights(page);
});
