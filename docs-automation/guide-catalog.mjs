/**
 * POSR Documentation catalog — single source of truth for multi-guide structure.
 * Used by assemble.mjs and print-pdf.mjs on every docs build.
 *
 * Tree:
 *   POSR Documentation
 *   ├── Server Guide (floor staff)
 *   ├── Cashier and Manager Guide
 *   ├── Screens Guide (station, order display)
 *   ├── Administrator Guide
 *   └── Accounts Guide
 *
 * Chapters with key present map to locales/{lang}/{key}.json when the file exists.
 * Planned keys without a locale file render as “Coming soon” in the guide PDF/HTML.
 */

/** App language codes → locale/image folder. */
export const LANGS = [
  { code: 'en', folder: 'en', dir: 'ltr' },
  { code: 'es', folder: 'es', dir: 'ltr' },
  { code: 'tr', folder: 'tr', dir: 'ltr' },
  { code: 'pt-BR', folder: 'pt-br', dir: 'ltr' },
  { code: 'fr', folder: 'fr', dir: 'ltr' },
  { code: 'nl', folder: 'nl', dir: 'ltr' },
  { code: 'de', folder: 'de', dir: 'ltr' },
  { code: 'it', folder: 'it', dir: 'ltr' },
  { code: 'ar', folder: 'ar', dir: 'rtl' },
  { code: 'ru', folder: 'ru', dir: 'ltr' },
];

/**
 * @typedef {{ key: string, plannedTitle?: string }} ChapterRef
 * @typedef {{
 *   id: string,
 *   emoji: string,
 *   folder: string,
 *   pdfName: string,
 *   defaultTitle: string,
 *   defaultIntro: string,
 *   chapters: ChapterRef[],
 * }} GuideDef
 */

/** @type {GuideDef[]} */
export const GUIDES = [
  {
    id: 'server',
    emoji: '📘',
    folder: 'server',
    pdfName: 'posr-server-guide.pdf',
    defaultTitle: 'Server Guide',
    defaultIntro:
      'Floor staff on the tablet: sign in, find the guest or the table, take and send the order, follow it until it is ready, and settle the bill.',
    chapters: [
      { key: 'server-start', plannedTitle: 'Getting started' },
      { key: 'server-guest-table', plannedTitle: 'Guest, room or table' },
      { key: 'server-ordering', plannedTitle: 'Taking the order' },
      { key: 'server-cart', plannedTitle: 'Cart and sending' },
      { key: 'server-orders', plannedTitle: 'Following orders' },
      { key: 'server-edit', plannedTitle: 'Changing a sent order' },
      { key: 'server-bill', plannedTitle: 'Bill, split and payment' },
      { key: 'server-duo', plannedTitle: 'Working as a DUO' },
    ],
  },
  {
    id: 'manager',
    emoji: '📗',
    folder: 'manager',
    pdfName: 'posr-manager-guide.pdf',
    defaultTitle: 'Cashier and Manager Guide',
    defaultIntro:
      'Cashing, approvals and shift leadership: payment, sent-order approvals, refunds, closing, summary and reports.',
    chapters: [
      { key: 'manager-cashier', plannedTitle: 'Cashing and authorizations' },
      { key: 'manager-approvals', plannedTitle: 'Approving changes to sent orders' },
      { key: 'summary' },
      { key: 'closing' },
      { key: 'reports-ops' },
      { key: 'tip-distribution' },
      { key: 'delivery' },
    ],
  },
  {
    id: 'display',
    emoji: '📺',
    folder: 'display',
    pdfName: 'posr-display-guide.pdf',
    defaultTitle: 'Screens Guide',
    defaultIntro:
      'Wall and counter screens: the preparation station (kitchen, bar) and the order display that tells the floor what is ready.',
    chapters: [
      { key: 'display-setup', plannedTitle: 'Setting up a screen' },
      { key: 'display-station', plannedTitle: 'Preparation station' },
      { key: 'display-orders', plannedTitle: 'Order display' },
    ],
  },
  {
    id: 'admin',
    emoji: '📓',
    folder: 'admin',
    pdfName: 'posr-administrator-guide.pdf',
    defaultTitle: 'Administrator Guide',
    defaultIntro:
      'Venue configuration: Manage (menus, floors, users, taxes…), integrations, and advanced settings.',
    chapters: [
      { key: 'admin-overview' },
      { key: 'admin-users' },
      { key: 'admin-roles-rights', plannedTitle: 'Role rights that change the floor' },
      { key: 'admin-menus' },
      { key: 'admin-outlets', plannedTitle: 'Points of sale' },
      { key: 'admin-floors' },
      { key: 'admin-kitchen' },
      { key: 'admin-printing' },
      { key: 'admin-payments' },
      { key: 'admin-promotions' },
      { key: 'admin-customers', plannedTitle: 'Customers' },
      { key: 'settings-advanced' },
      { key: 'settings' },
      { key: 'integrations' },
    ],
  },
  {
    id: 'accounts',
    emoji: '📕',
    folder: 'accounts',
    pdfName: 'posr-accounts-guide.pdf',
    defaultTitle: 'Accounts Guide',
    defaultIntro: 'Financial ledgers, expenses, and accounting-related POS tools.',
    chapters: [
      { key: 'accounts-overview' },
      { key: 'accounts-expenses' },
      { key: 'accounts-ledgers' },
    ],
  },
];

/** Flat list of every chapter key that can have a locale JSON file (for browse copies). */
export function allChapterKeys() {
  const keys = new Set();
  for (const g of GUIDES) {
    for (const ch of g.chapters) keys.add(ch.key);
  }
  return [...keys];
}

/** Chapter keys that are currently expected to exist for Employee (shipping content). */
export function shippedChapterKeys() {
  return GUIDES.flatMap((g) =>
    g.chapters
      .filter((c) => !c.plannedTitle || c.key.match(/^(login|settings|menu|cart|payment|orders|session)$/))
      .map((c) => c.key)
  );
}

export function getGuideById(id) {
  return GUIDES.find((g) => g.id === id);
}
