import { User } from "@/api/model/user.ts";
import { toRecordId } from "@/lib/utils.ts";

export type AccessRuleModule = {
  label: string;
  children: string[];
};

/** Hierarchical permission IDs: section | section.resource | section.resource.action */
export const ACCESS_RULE_MODULES: Record<string, AccessRuleModule> = {
  menu: {
    label: "Menu",
    children: ["menu", "menu.change_table"],
  },
  orders: {
    label: "Orders",
    children: [
      "orders",
      "orders.cancel",
      "orders.split_by_seats",
      "orders.split_by_items",
      "orders.split_by_amount",
      "orders.merge",
      "orders.refund",
      "orders.print_final",
      "orders.print_temp",
      "orders.print_kot",
      "orders.override_print_limit",
      "orders.open_cash_drawer",
      "orders.apply_tax",
      "orders.apply_discount",
      "orders.apply_coupon",
      "orders.apply_service_charges",
      "orders.apply_tips",
      "orders.change_extras",
      "orders.complete",
      "orders.complete_payment",
      "orders.update_payment",
      "orders.move_table",
      "orders.remote_payment_create",
      "orders.remote_payment_verify",
    ],
  },
  // Its own section, not `orders.*`: every role that opens the Orders page holds `orders`,
  // and a parent id grants all of its children (`userModulesGrant`).
  order_visibility: {
    label: "Order visibility",
    children: ["order_visibility.all"],
  },
  // Its own section for the same reason: `orders` would grant it to every server.
  payments: {
    label: "Payments",
    children: ["payments.receive"],
  },
  // Its own section for the same reason. Holders of `sent_items` change sent lines directly;
  // everyone else sends a request, which holders of `approve` accept or refuse.
  order_edit: {
    label: "Editing sent orders",
    children: ["order_edit.sent_items", "order_edit.approve"],
  },
  summary: {
    label: "Summary",
    children: [
      "summary",
      "summary.print",
      "summary.product_mix",
      "summary.server_sales",
    ],
  },
  reports: {
    label: "Reports",
    children: [
      "reports",
      "reports.delivery_density",
      "reports.cash_closing",
      "reports.sales_dashboard",
      "reports.sales_hourly_labour",
      "reports.sales_hourly_labour_weekly",
      "reports.server_sales",
      "reports.sales_summary",
      "reports.sales_summary_2",
      "reports.sales_weekly",
      "reports.tips",
      "reports.advanced_sales",
      "reports.discount",
      "reports.tax",
      "reports.coupon",
      "reports.voids",
      "reports.merge_orders",
      "reports.split_orders",
      "reports.order_life_cycle",
      "reports.order_receipt",
      "reports.order_fiscal",
      "reports.expense",
      "reports.activity",
      "reports.product_mix_weekly",
      "reports.product_mix_summary",
      "reports.products_hourly",
      "reports.ai",
    ],
  },
  closing: {
    label: "Closing",
    children: ["closing", "closing.edit"],
  },
  kitchen: {
    label: "Kitchen",
    children: ["kitchen"],
  },
  order_display: {
    label: "Order Display",
    children: ["order_display"],
  },
  delivery: {
    label: "Delivery",
    children: [
      "delivery",
      "delivery.orders",
      "delivery.areas",
      "delivery.settings",
    ],
  },
  admin: {
    label: "Administration",
    children: [
      "admin",
      "admin.dishes",
      "admin.dishes.create",
      "admin.dishes.update",
      "admin.dishes.delete",
      "admin.dishes.import",
      "admin.menus",
      "admin.menus.create",
      "admin.menus.update",
      "admin.menus.delete",
      "admin.categories",
      "admin.categories.create",
      "admin.categories.update",
      "admin.categories.delete",
      "admin.categories.import",
      "admin.modifier_groups",
      "admin.modifier_groups.create",
      "admin.modifier_groups.update",
      "admin.modifier_groups.delete",
      "admin.modifier_groups.import",
      "admin.tables",
      "admin.tables.create",
      "admin.tables.update",
      "admin.tables.delete",
      "admin.tables.import",
      "admin.floors",
      "admin.floors.create",
      "admin.floors.update",
      "admin.floors.delete",
      "admin.floors.import",
      "admin.discounts",
      "admin.discounts.create",
      "admin.discounts.update",
      "admin.discounts.delete",
      "admin.coupons",
      "admin.coupons.create",
      "admin.coupons.update",
      "admin.coupons.delete",
      "admin.kitchens",
      "admin.kitchens.create",
      "admin.kitchens.update",
      "admin.kitchens.delete",
      "admin.kitchens.import",
      "admin.workflows",
      "admin.workflows.create",
      "admin.workflows.update",
      "admin.workflows.delete",
      "admin.printers",
      "admin.printers.create",
      "admin.printers.update",
      "admin.printers.delete",
      "admin.print_settings",
      "admin.print_settings.update",
      "admin.order_types",
      "admin.order_types.create",
      "admin.order_types.update",
      "admin.order_types.delete",
      "admin.order_types.import",
      "admin.payment_types",
      "admin.payment_types.create",
      "admin.payment_types.update",
      "admin.payment_types.delete",
      "admin.payment_types.import",
      "admin.extras",
      "admin.extras.create",
      "admin.extras.update",
      "admin.extras.delete",
      "admin.extras.import",
      "admin.taxes",
      "admin.taxes.create",
      "admin.taxes.update",
      "admin.taxes.delete",
      "admin.taxes.import",
      "admin.users",
      "admin.users.create",
      "admin.users.update",
      "admin.users.delete",
      "admin.roles",
      "admin.roles.create",
      "admin.roles.update",
      "admin.roles.delete",
      "admin.shifts",
      "admin.shifts.create",
      "admin.shifts.update",
      "admin.shifts.delete",
      "admin.tips_definition",
      "admin.tips_definition.create",
      "admin.tips_definition.update",
      "admin.tips_definition.delete",
      "admin.security_alerts",
      "admin.general_settings",
    ],
  },
  riders: {
    label: "Riders",
    children: [],
  },
  tips: {
    label: "Tip Distribution",
    children: ["tips", "tips.calculation", "tips.payout"],
  },
  settings: {
    label: "Settings",
    children: [
      "settings",
      "settings.printers",
      "settings.print_options",
      "settings.service_charges",
      "settings.menus",
      "settings.auto_check_close",
      "settings.closing_cycle",
      "settings.session_security",
      "settings.show_inclusive_prices",
      "settings.currency_symbol",
      "settings.restaurant_profile",
      "settings.access_control",
      "settings.translate_receipts",
    ],
  },
  accounts: {
    label: "Accounts",
    children: [
      "accounts",
      "accounts.chart_of_accounts",
      "accounts.account_groups",
      "accounts.journal_entries",
      "accounts.general_ledger",
      "accounts.trial_balance",
      "accounts.balance_sheet",
      "accounts.profit_loss",
      "accounts.cash_flow",
      "accounts.customer_statement",
      "accounts.supplier_statement",
    ],
  },
  integrations: {
    label: "Integrations",
    children: [
      "integrations",
      "integrations.providers",
      "integrations.configuration",
      "integrations.health",
      "integrations.queue",
      "integrations.toggle_provider",
      "integrations.open_configuration",
      "integrations.save_configuration",
    ],
  },
};

/** Old English permission strings → new ID(s). Ambiguous collisions expand to all targets. */
export const LEGACY_MODULE_MAP: Record<string, string | string[]> = {
  // Sections / sidebar
  Menu: "menu",
  Orders: "orders",
  Summary: "summary",
  Reports: "reports",
  Closing: "closing",
  Kitchen: "kitchen",
  "Order Display": "order_display",
  Delivery: "delivery",
  Admin: "admin",
  Riders: "riders",
  Tips: ["tips", "reports.tips"],
  Settings: "settings",
  Accounts: "accounts",
  Integrations: "integrations",

  // Menu
  "Change table": "menu.change_table",

  // Orders
  "Cancel order": "orders.cancel",
  "Split by seats": "orders.split_by_seats",
  "Split order by seats": "orders.split_by_seats",
  "Split by items": "orders.split_by_items",
  "Split order by items": "orders.split_by_items",
  "Split by amount": "orders.split_by_amount",
  "Split order by amount": "orders.split_by_amount",
  "Merge orders": "orders.merge",
  "Refund order": "orders.refund",
  "Print final copy": "orders.print_final",
  "Print temp bill": "orders.print_temp",
  "Print KOT copy": "orders.print_kot",
  "Override print limit": "orders.override_print_limit",
  "Open cash drawer": "orders.open_cash_drawer",
  "Apply tax": "orders.apply_tax",
  "Apply discount": "orders.apply_discount",
  "Apply coupon": "orders.apply_coupon",
  "Apply service charges": "orders.apply_service_charges",
  "Apply tips": "orders.apply_tips",
  "Change extras": "orders.change_extras",
  "Complete order": "orders.complete",
  "Complete order payment": "orders.complete_payment",
  "Update order payment details": "orders.update_payment",
  "Move order table": "orders.move_table",
  "Create remote payment intent": "orders.remote_payment_create",
  "Verify remote payment": "orders.remote_payment_verify",

  // Summary
  "Print summary": "summary.print",
  "Product mix report": "summary.product_mix",
  "Server sales": "summary.server_sales",

  // Reports
  "Delivery Density": "reports.delivery_density",
  "Cash closing": "reports.cash_closing",
  "Sales dashboard": "reports.sales_dashboard",
  "Sales Hourly Labour": "reports.sales_hourly_labour",
  "Sales Hourly Labour Weekly": "reports.sales_hourly_labour_weekly",
  "Server Sales": "reports.server_sales",
  "Sales Summary": "reports.sales_summary",
  "Sales Summary 2": "reports.sales_summary_2",
  "Sales Weekly": "reports.sales_weekly",
  "Advanced Sales": "reports.advanced_sales",
  Discount: "reports.discount",
  Tax: "reports.tax",
  Coupon: "reports.coupon",
  Voids: "reports.voids",
  "Merge Orders": "reports.merge_orders",
  "Split Orders": "reports.split_orders",
  "Order Life Cycle": "reports.order_life_cycle",
  "Order Receipt": "reports.order_receipt",
  "Order Fiscal": "reports.order_fiscal",
  Expense: "reports.expense",
  Activity: "reports.activity",
  "Product Mix Weekly": "reports.product_mix_weekly",
  "Product Mix Summary": "reports.product_mix_summary",
  "Products Hourly": "reports.products_hourly",
  "AI Report": "reports.ai",

  // Closing
  "Edit Closing": "closing.edit",

  // Delivery
  "Delivery orders": "delivery.orders",
  "Delivery areas": "delivery.areas",
  "Delivery settings": "delivery.settings",

  // Admin
  Dishes: "admin.dishes",
  Menus: ["admin.menus", "settings.menus"],
  Categories: "admin.categories",
  "Modifier Groups": "admin.modifier_groups",
  Tables: "admin.tables",
  Floors: "admin.floors",
  Discounts: "admin.discounts",
  Coupons: "admin.coupons",
  Kitchens: "admin.kitchens",
  Workflows: "admin.workflows",
  Printers: ["admin.printers", "settings.printers"],
  "Print settings": "admin.print_settings",
  "Order Types": "admin.order_types",
  "Payment Types": "admin.payment_types",
  Extras: "admin.extras",
  Taxes: "admin.taxes",
  Users: "admin.users",
  Roles: "admin.roles",
  Shifts: "admin.shifts",
  "Tips definition": "admin.tips_definition",
  "Security Alerts": "admin.security_alerts",
  "General settings": "admin.general_settings",

  // Tips distribution
  "Tip Calculation": "tips.calculation",
  "Payout Management": "tips.payout",

  // Settings
  "Print options": "settings.print_options",
  "Service charges": "settings.service_charges",
  "Auto check close": "settings.auto_check_close",
  "Closing cycle": "settings.closing_cycle",
  "Session security": "settings.session_security",
  "Show inclusive prices": "settings.show_inclusive_prices",
  "Currency symbol": "settings.currency_symbol",
  "Restaurant profile": "settings.restaurant_profile",
  "Access control": "settings.access_control",
  "Translate receipts": "settings.translate_receipts",

  // Accounts
  "Chart of Accounts": "accounts.chart_of_accounts",
  "Account Groups": "accounts.account_groups",
  "Journal Entries": "accounts.journal_entries",
  "General Ledger": "accounts.general_ledger",
  "Trial Balance": "accounts.trial_balance",
  "Balance Sheet": "accounts.balance_sheet",
  "Profit & Loss": "accounts.profit_loss",
  "Cash Flow": "accounts.cash_flow",
  "Customer Statement": "accounts.customer_statement",
  "Supplier Statement": "accounts.supplier_statement",

  // Integrations
  "Integration providers": "integrations.providers",
  "Integration configuration": "integrations.configuration",
  "Integration health": "integrations.health",
  "Integration queue": "integrations.queue",
  "Integration toggle provider": "integrations.toggle_provider",
  "Integration open configuration": "integrations.open_configuration",
  "Integration save configuration": "integrations.save_configuration",
};

const KNOWN_MODULE_IDS = new Set<string>([
  ...Object.keys(ACCESS_RULE_MODULES),
  ...Object.values(ACCESS_RULE_MODULES).flatMap((m) => m.children),
]);

export const expandLegacyModule = (id: string): string[] => {
  if (!id) return [];
  const mapped = LEGACY_MODULE_MAP[id];
  if (mapped == null) {
    return [id];
  }
  return Array.isArray(mapped) ? mapped : [mapped];
};

export const normalizeModules = (modules: string[] | undefined | null): string[] => {
  if (!modules?.length) return [];
  const next = new Set<string>();
  for (const mod of modules) {
    for (const expanded of expandLegacyModule(mod)) {
      next.add(expanded);
    }
  }
  return [...next];
};

/** Candidates for DB `IN` / includes checks during legacy→new transition.
 * Parent group ids also match (e.g. `settings` grants `settings.restaurant_profile`),
 * so roles saved before a new child module was added still work for admins with the group.
 */
export const moduleMatchCandidates = (module?: string): string[] => {
  if (!module) return [];
  const normalized = expandLegacyModule(module);
  const legacies = Object.entries(LEGACY_MODULE_MAP)
    .filter(([, target]) => {
      const targets = Array.isArray(target) ? target : [target];
      return targets.some((t) => normalized.includes(t) || t === module);
    })
    .map(([legacy]) => legacy);

  const parents: string[] = [];
  for (const id of [module, ...normalized]) {
    const parts = id.split('.');
    for (let i = 1; i < parts.length; i++) {
      parents.push(parts.slice(0, i).join('.'));
    }
  }

  return [...new Set([module, ...normalized, ...legacies, ...parents])];
};

/** True if `userModules` grants `module` (exact, legacy alias, or parent group). */
export const userModulesGrant = (userModules: string[] | undefined | null, module?: string): boolean => {
  if (!module || !userModules?.length) return false;
  const candidates = moduleMatchCandidates(module);
  return candidates.some((candidate) => userModules.includes(candidate));
};

export const isKnownModuleId = (id: string): boolean => KNOWN_MODULE_IDS.has(id);

export const getUserModules = (user?: User): string[] => {
  if (!user) return [];

  const modulesFromRoles = user.user_role?.roles || [];
  const modules = [...modulesFromRoles, ...(user.roles || [])];

  return normalizeModules(modules);
};

type DbQueryClient = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Resolve permission modules for the current user — mirrors protectAction's
 * server-side role fetch so the AI assistant sees the same grants as Manage UI.
 */
export const fetchUserModules = async (
  db: DbQueryClient,
  user?: User,
): Promise<string[]> => {
  if (!user?.id) return [];

  if (getProtectModulesSource() === "memory") {
    return getUserModules(user);
  }

  try {
    const result = await db.query(
      `SELECT * FROM ONLY ${toRecordId(user.id)} WHERE deleted_at = none FETCH user_role`,
    ) as [User?];
    const row = Array.isArray(result) ? result[0] : undefined;
    const fromRole = normalizeModules(row?.user_role?.roles);
    if (fromRole.length) {
      return fromRole;
    }
  } catch {
    // fall back to the in-memory login snapshot
  }

  return getUserModules(user);
};

export type ProtectModulesSource = "server" | "memory";

/**
 * Build-time source for protectAction module checks.
 * - server (default): re-fetch user + user_role from Surreal
 * - memory: use modules on the Jotai appPage.user snapshot from login
 */
export const getProtectModulesSource = (): ProtectModulesSource => {
  const raw = String(import.meta.env.VITE_PROTECT_MODULES_SOURCE ?? "server").toLowerCase().trim();
  return raw === "memory" ? "memory" : "server";
};
