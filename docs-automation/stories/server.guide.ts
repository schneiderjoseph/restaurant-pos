import { test, expect, type Page } from '@playwright/test';
import { clearHighlights, highlightAndReady } from '../helpers/highlight.ts';
import {
  addFirstPlainDish,
  closeAllModals,
  loginWithPin,
  openKitchenPage,
  openOrderDisplayPage,
  openOrdersPage,
  openPaymentScreen,
  resetSession,
  waitForDishes,
} from '../helpers/auth.ts';
import { captureLocator, capturePage } from '../helpers/screenshot.ts';

/**
 * Server and Screens guides (srv-*, display-*).
 *
 * Read-only by default: nothing is sent to a kitchen and nothing is saved, so it can run
 * against a live venue. DOCS_ALLOW_ORDERS=1 also captures the screens that need a sent
 * order (payment), which prints kitchen tickets and leaves an open order behind.
 *
 * DOCS_GUEST_QUERY: a search term for the guest screen (use a test guest, the shot is published).
 * DOCS_WALKIN_NAME: a name that matches nobody, for the walk-in registration shot.
 */

test.describe.configure({ mode: 'serial' });

const allowOrders = process.env.DOCS_ALLOW_ORDERS === '1';
const guestQuery = process.env.DOCS_GUEST_QUERY || '';
const walkInName = process.env.DOCS_WALKIN_NAME || 'Zoé Exemple-Guide';

async function openGuestLookup(page: Page): Promise<void> {
  await closeAllModals(page);
  await page.goto('/menu');
  await expect(page.getByTestId('guest-lookup')).toBeVisible({ timeout: 45_000 });
}

/** Leaves the menu with an empty cart so no half-built order survives the run. */
async function clearCart(page: Page): Promise<void> {
  const clear = page.getByTestId('menu-cart').getByRole('button', { name: /effacer|clear/i });
  if (await clear.first().isVisible().catch(() => false)) {
    await clear.first().click();
    await page.waitForTimeout(400);
  }
}

test('login screen', async ({ page }) => {
  await resetSession(page);
  await expect(page.getByTestId('login-pin-pad')).toBeVisible();
  await capturePage(page, 'srv-login', { fullPage: false });
});

test('guest screen: search and walk-in registration', async ({ page }) => {
  await loginWithPin(page);
  await openGuestLookup(page);

  if (guestQuery) {
    await page.getByTestId('guest-search').fill(guestQuery);
    await expect(page.getByTestId('guest-search-results')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
  }
  await capturePage(page, 'srv-guest-search', { fullPage: false });

  await page.getByTestId('guest-search').fill(walkInName);
  const register = page.getByTestId('guest-register-from-search');
  await expect(register).toBeVisible({ timeout: 15_000 });
  await highlightAndReady(page, register);
  await capturePage(page, 'srv-guest-register', { fullPage: false });
  await clearHighlights(page);
  await page.getByTestId('guest-search').fill('');
});

test('floor, menu, options and cart (nothing sent)', async ({ page }) => {
  await loginWithPin(page);
  await openGuestLookup(page);

  await page.getByTestId('guest-open-floor').click();
  await expect(page.getByTestId('menu-floor')).toBeVisible({ timeout: 45_000 });
  await capturePage(page, 'srv-floor', { fullPage: false });

  await page.getByTestId('floor-table').first().click({ force: true });
  const persons = page.getByTestId('menu-persons');
  if (await persons.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await persons.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
  }
  await expect(page.getByTestId('menu-page')).toBeVisible({ timeout: 30_000 });
  await waitForDishes(page);
  await capturePage(page, 'srv-menu', { fullPage: false });

  // First dish that opens its options window.
  const dishes = page.getByTestId('menu-dish');
  const count = Math.min(await dishes.count(), 30);
  for (let i = 0; i < count; i++) {
    await dishes.nth(i).click();
    await page.waitForTimeout(400);
    if (await page.getByTestId('modifiers-confirm').isVisible().catch(() => false)) {
      await capturePage(page, 'srv-modifiers', { fullPage: false });
      await closeAllModals(page);
      break;
    }
  }
  await clearCart(page);

  await addFirstPlainDish(page);
  await addFirstPlainDish(page);
  await captureLocator(page.getByTestId('menu-cart'), 'srv-cart');
  await clearCart(page);
});

test('orders screen', async ({ page }) => {
  await loginWithPin(page);
  await openOrdersPage(page);
  await page.waitForTimeout(1_500);
  await capturePage(page, 'srv-orders', { fullPage: false });
});

test('DUO window', async ({ page }) => {
  await loginWithPin(page);
  await page.getByTestId('nav-duo').click();
  await page.waitForTimeout(1_500);
  await capturePage(page, 'srv-duo', { fullPage: false });
  await closeAllModals(page);
});

test('preparation station', async ({ page }) => {
  await loginWithPin(page);
  await openKitchenPage(page);
  await page.waitForTimeout(2_000);
  await capturePage(page, 'display-station', { fullPage: false });
});

test('order display', async ({ page }) => {
  await loginWithPin(page);
  await openOrderDisplayPage(page);
  await page.waitForTimeout(2_000);
  await capturePage(page, 'display-orders', { fullPage: false });
});

test('payment screen (sends a real order)', async ({ page }) => {
  test.skip(!allowOrders, 'DOCS_ALLOW_ORDERS=1 required: this sends an order to the kitchen');
  await loginWithPin(page);
  await openPaymentScreen(page);
  await capturePage(page, 'srv-payment', { fullPage: false });
});
