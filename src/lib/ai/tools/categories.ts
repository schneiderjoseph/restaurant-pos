export type AiReportToolDomain =
  | "sales"
  | "operations"
  | "analysis"
  | "accounts"
  | "chart"
  | "lookup"
  | "manage";

export const AI_REPORT_TOOL_CATEGORIES: Record<AiReportToolDomain | "core", readonly string[]> = {
  core: ["resolve_date_range"],
  sales: [
    "get_top_selling_dishes",
    "get_sales_summary",
    "get_product_mix",
    "get_unsold_products",
    "get_voids",
    "get_tips",
    "get_server_sales",
    "get_current_session_sales",
    "get_tax_summary",
    "get_discount_summary",
    "get_coupon_summary",
    "get_weekly_sales",
    "get_hourly_product_sales",
    "get_dashboard_snapshot",
    "get_server_ticket_times",
    "get_staff_accountability_metrics",
  ],
  operations: [
    "get_orders",
    "get_order_detail",
    "get_order_lifecycle",
    "get_expenses",
    "get_activity_log",
    "get_cash_closing",
    "list_active_sessions",
    "get_void_and_cancel_summary",
    "get_prep_times_by_order_type",
    "get_kitchen_station_delays",
    "get_cash_settlement_audit",
  ],
  analysis: [
    "get_time_series",
    "forecast_sales",
    "compare_periods",
  ],
  accounts: [
    "get_trial_balance",
    "get_balance_sheet",
    "get_profit_loss",
    "get_cash_flow",
    "get_general_ledger",
    "get_journal_entries",
    "get_account_statement",
    "list_accounts",
  ],
  chart: ["render_chart"],
  lookup: [
    "list_staff",
    "list_categories",
    "list_menu_items",
  ],
  manage: [
    "list_floors",
    "list_tables",
    "list_modifier_groups",
    "get_kitchen_detail",
    "list_kitchens",
    "list_taxes",
    "list_discounts",
    "list_order_types",
    "list_payment_types",
    "list_extras",
    "list_coupons",
    "list_menus",
    "get_menu_items",
    "list_workflows",
    "list_printers",
    "list_users",
    "list_roles",
    "list_shifts",
  ],
};

export const ALL_AI_REPORT_TOOL_NAMES = [
  ...AI_REPORT_TOOL_CATEGORIES.core,
  ...AI_REPORT_TOOL_CATEGORIES.sales,
  ...AI_REPORT_TOOL_CATEGORIES.operations,
  ...AI_REPORT_TOOL_CATEGORIES.analysis,
  ...AI_REPORT_TOOL_CATEGORIES.accounts,
  ...AI_REPORT_TOOL_CATEGORIES.chart,
  ...AI_REPORT_TOOL_CATEGORIES.lookup,
  ...AI_REPORT_TOOL_CATEGORIES.manage,
];
