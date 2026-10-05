import {normalizeQueryDate, parseDateRangeWithPhrase, resolveNaturalDateRange} from "@/api/reports/shared/filters.ts";
import type {DateRangeFilter, DbClient} from "@/api/reports/shared/types.ts";
import {getProductMix, getSalesSummary, getTopSellingDishes, getUnsoldProducts, listMenuItems} from "@/api/reports/sales";
import {getDiscountSummary} from "@/api/reports/sales/discounts.ts";
import {
  getHourlyProductSales,
  getOrderFinanceSummary,
  getSalesDashboardSnapshot,
  getServerSales,
  getVoids,
  getWeeklySales,
  listCategories,
  listStaff,
} from "@/api/reports/sales/extended.ts";
import {getTips} from "@/api/reports/sales/tips.ts";
import {
  getKitchenDetail,
  getMenuItems,
  listCoupons,
  listDiscounts,
  listExtras,
  listFloors,
  listKitchens,
  listMenus,
  listModifierGroups,
  listOrderTypes,
  listPaymentTypes,
  listPrinters,
  listRoles,
  listShifts,
  listTables,
  listTaxes,
  listUsers,
  listWorkflows,
} from "@/api/reports/manage/lists.ts";
import {
  getServerTicketTimes,
  getStaffAccountabilityMetrics,
} from "@/api/reports/sales/server-analytics.ts";
import {getOrders} from "@/api/reports/operations/orders.ts";
import {getOrderDetail} from "@/api/reports/operations/order-detail.ts";
import {extractOrderStatusesFromArgs, inferOrderStatusesFromPrompt, isOrderListByStatusPrompt} from "@/lib/ai/order-query.ts";
import {
  getActivityLog,
  getCashClosing,
  getExpenses,
  getOrderLifecycleStats,
} from "@/api/reports/operations/index.ts";
import {getActiveSessions, getCurrentSessionServerSales} from "@/api/reports/operations/sessions.ts";
import {getVoidAndCancelSummary} from "@/api/reports/operations/void-cancel.ts";
import {
  getKitchenStationDelays,
  getPrepTimesByOrderType,
} from "@/api/reports/operations/kitchen-timing.ts";
import {getCashSettlementAudit} from "@/api/reports/operations/cash-audit.ts";
import {
  getAccountStatement,
  getBalanceSheet,
  getCashFlow,
  getGeneralLedger,
  getJournalEntries,
  getProfitLoss,
  getTrialBalance,
  listAccounts,
} from "@/api/reports/accounts/index.ts";
import {comparePeriods, getTimeSeries, type TimeSeriesMetric} from "@/api/reports/time-series.ts";
import {forecastFromPoints} from "@/lib/ai/forecast.ts";
import {type AiChartSpec, validateChartSpec, dedupeCharts} from "@/lib/ai/charts.ts";

const hasDateValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return false;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 && trimmed !== "undefined" && trimmed !== "null";
};

const parseOptionalDateRangeArgs = (args: Record<string, unknown>): DateRangeFilter => {
  const range: DateRangeFilter = {};

  if (hasDateValue(args.startDate)) {
    range.startDate = normalizeQueryDate(String(args.startDate));
  }

  if (hasDateValue(args.endDate)) {
    range.endDate = normalizeQueryDate(String(args.endDate));
  }

  return range;
};

export interface ExecuteToolContext {
  charts: AiChartSpec[];
}

export const executeAiReportTool = async (
  db: DbClient,
  toolName: string,
  args: Record<string, unknown>,
  context: ExecuteToolContext = {charts: []},
): Promise<unknown> => {
  switch (toolName) {
    case "resolve_date_range": {
      const phrase = String(args.phrase ?? "");
      return resolveNaturalDateRange({phrase});
    }

    case "get_top_selling_dishes": {
      return getTopSellingDishes(db, {
        ...parseOptionalDateRangeArgs(args),
        limit: args.limit ? Number(args.limit) : 10,
        sortBy: (args.sortBy as "revenue" | "quantity" | undefined) ?? "revenue",
      });
    }

    case "get_sales_summary": {
      const summary = await getSalesSummary(db, parseDateRangeWithPhrase(args));

      return {
        totalNetSales: summary.totalNetSales,
        amountDue: summary.paymentSummary.amountDue,
        amountCollected: summary.paymentSummary.amountCollected,
        cashPayments: summary.paymentSummary.cashPayments,
        nonCashPayments: summary.paymentSummary.nonCashPayments,
        nonCashBreakdown: summary.paymentSummary.nonCashBreakdown,
        roundingBenefit: summary.roundingBenefit,
        serviceCharges: summary.serviceCharges,
        taxes: summary.taxes,
        totalDiscounts: summary.totalDiscounts,
        totalCoupons: summary.totalCoupons,
        totalVoids: summary.totalVoids,
        dayPartTotals: summary.dayPartTotals,
        orderTypeBreakdown: summary.orderTypeBreakdown,
        discountRows: summary.discountRows,
      };
    }

    case "get_unsold_products":
      return getUnsoldProducts(db, {
        ...parseDateRangeWithPhrase(args),
        limit: args.limit ? Number(args.limit) : 100,
      });

    case "get_product_mix": {
      const fullMenu = args.fullMenu === true || args.fullMenu === "true";
      const mix = await getProductMix(db, {
        ...parseDateRangeWithPhrase(args),
        limit: args.limit ? Number(args.limit) : undefined,
      });

      if (fullMenu) {
        return mix;
      }

      return {
        categories: mix.categories.map(category => ({
          categoryName: category.categoryName,
          totals: category.totals,
          topItems: category.items.slice(0, 5).map(item => ({
            name: item.name,
            numSold: item.numSold,
            amount: item.amount,
            profit: item.profit,
          })),
        })),
        topItems: mix.topItems,
      };
    }

    case "get_voids":
      return getVoids(db, {
        ...parseOptionalDateRangeArgs(args),
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_tips":
      return getTips(db, {
        ...parseDateRangeWithPhrase(args),
        shiftId: args.shiftId ? String(args.shiftId) : undefined,
        includeProjectedDistribution: args.includeProjectedDistribution !== false,
      });

    case "get_current_session_sales":
      return getCurrentSessionServerSales(db);

    case "list_active_sessions":
      return getActiveSessions(db);

    case "get_server_sales":
      return getServerSales(db, {
        ...parseOptionalDateRangeArgs(args),
        limit: args.limit ? Number(args.limit) : 20,
      });

    case "get_tax_summary":
      return getOrderFinanceSummary(db, {
        ...parseOptionalDateRangeArgs(args),
        metric: "tax_amount",
      });

    case "get_discount_summary":
      return getDiscountSummary(db, {
        ...parseDateRangeWithPhrase(args),
        billPercentThreshold: args.billPercentThreshold
          ? Number(args.billPercentThreshold)
          : undefined,
      });

    case "get_coupon_summary":
      return getOrderFinanceSummary(db, {
        ...parseOptionalDateRangeArgs(args),
        metric: "coupon_discount",
      });

    case "get_weekly_sales":
      return getWeeklySales(db, parseOptionalDateRangeArgs(args));

    case "get_hourly_product_sales":
      return getHourlyProductSales(db, {
        ...parseOptionalDateRangeArgs(args),
        limit: args.limit ? Number(args.limit) : 20,
      });

    case "get_expenses":
      return getExpenses(db, parseOptionalDateRangeArgs(args));

    case "get_activity_log":
      return getActivityLog(db, {
        ...parseDateRangeWithPhrase(args),
        limit: args.limit ? Number(args.limit) : 50,
        module: args.module ? String(args.module) : undefined,
        modules: Array.isArray(args.modules) ? args.modules.map(String) : undefined,
      });

    case "get_cash_closing":
      return getCashClosing(db, {date: args.date ? String(args.date) : undefined});

    case "get_orders":
      return getOrders(db, {
        ...parseOptionalDateRangeArgs(args),
        statuses: extractOrderStatusesFromArgs(args),
        deliveryOnly: args.deliveryOnly === true || args.deliveryOnly === "true",
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_order_detail":
      return getOrderDetail(db, {
        orderId: args.orderId ? String(args.orderId) : undefined,
        autoId: args.autoId !== undefined ? Number(args.autoId) : undefined,
        invoiceNumber: args.invoiceNumber !== undefined ? Number(args.invoiceNumber) : undefined,
        trackingLimit: args.trackingLimit !== undefined ? Number(args.trackingLimit) : undefined,
      });

    case "get_order_lifecycle":
      return getOrderLifecycleStats(db, parseOptionalDateRangeArgs(args));

    case "get_time_series":
      return getTimeSeries(db, {
        ...parseOptionalDateRangeArgs(args),
        metric: String(args.metric) as TimeSeriesMetric,
        granularity: (args.granularity as "daily" | "weekly" | "hourly" | undefined) ?? "daily",
      });

    case "forecast_sales": {
      const points = (args.points as Array<{period: string; value: number}>) ?? [];
      const forecastDays = args.forecastDays ? Number(args.forecastDays) : 7;
      const method = (args.method as "linear_regression" | "moving_average" | "exponential_smoothing") ?? "linear_regression";
      return forecastFromPoints(
        points.map(p => ({period: p.period, value: p.value})),
        forecastDays,
        method,
      );
    }

    case "compare_periods":
      return comparePeriods(db, {
        metric: String(args.metric) as Parameters<typeof comparePeriods>[1]["metric"],
        period1: {
          startDate: normalizeQueryDate(String(args.period1Start)),
          endDate: normalizeQueryDate(String(args.period1End)),
        },
        period2: {
          startDate: normalizeQueryDate(String(args.period2Start)),
          endDate: normalizeQueryDate(String(args.period2End)),
        },
      });

    case "get_dashboard_snapshot":
      return getSalesDashboardSnapshot(db, parseOptionalDateRangeArgs(args));

    case "render_chart": {
      const spec = validateChartSpec(args);
      const next = dedupeCharts([...context.charts, spec]);
      context.charts.length = 0;
      context.charts.push(...next);
      return {success: true, chartId: spec.id, message: `Chart "${spec.title}" registered.`};
    }

    case "list_staff":
      return listStaff(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_categories":
      return listCategories(db, {limit: args.limit ? Number(args.limit) : 50});

    case "list_menu_items":
      return listMenuItems(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 500,
      });

    case "list_floors":
      return listFloors(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_tables":
      return listTables(db, {
        floor_name: args.floor_name ? String(args.floor_name) : undefined,
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_modifier_groups":
      return listModifierGroups(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_kitchens":
      return listKitchens(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_kitchen_detail":
      return getKitchenDetail(db, {
        name: args.name ? String(args.name) : undefined,
        search: args.search ? String(args.search) : undefined,
      });

    case "list_taxes":
      return listTaxes(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_discounts":
      return listDiscounts(db, {
        search: args.search ? String(args.search) : undefined,
        active_only: args.active_only === true,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_order_types":
      return listOrderTypes(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_payment_types":
      return listPaymentTypes(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_extras":
      return listExtras(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_coupons":
      return listCoupons(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_menus":
      return listMenus(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_menu_items":
      return getMenuItems(db, {
        menu_name: args.menu_name ? String(args.menu_name) : undefined,
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 100,
      });

    case "list_workflows":
      return listWorkflows(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_printers":
      return listPrinters(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_users":
      return listUsers(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_roles":
      return listRoles(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "list_shifts":
      return listShifts(db, {
        search: args.search ? String(args.search) : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_server_ticket_times":
      return getServerTicketTimes(db, {
        ...parseDateRangeWithPhrase(args),
        limit: args.limit ? Number(args.limit) : 3,
        dineInOnly: args.dineInOnly === true || args.dineInOnly === "true",
      });

    case "get_staff_accountability_metrics":
      return getStaffAccountabilityMetrics(db, {
        ...parseDateRangeWithPhrase(args),
        thresholdMultiplier: args.thresholdMultiplier
          ? Number(args.thresholdMultiplier)
          : undefined,
      });

    case "get_void_and_cancel_summary":
      return getVoidAndCancelSummary(db, {
        ...parseDateRangeWithPhrase(args),
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_prep_times_by_order_type":
      return getPrepTimesByOrderType(db, parseDateRangeWithPhrase(args));

    case "get_kitchen_station_delays":
      return getKitchenStationDelays(db, {
        ...parseDateRangeWithPhrase(args),
        startHour: args.startHour !== undefined ? Number(args.startHour) : undefined,
        endHour: args.endHour !== undefined ? Number(args.endHour) : undefined,
        hourPhrase: args.hourPhrase ? String(args.hourPhrase) : undefined,
      });

    case "get_cash_settlement_audit":
      return getCashSettlementAudit(db, {
        ...parseDateRangeWithPhrase(args),
        minutesBeforeClose: args.minutesBeforeClose
          ? Number(args.minutesBeforeClose)
          : undefined,
        limit: args.limit ? Number(args.limit) : 50,
      });

    case "get_trial_balance":
      return getTrialBalance(db, {
        ...parseDateRangeWithPhrase(args),
        asOf: args.asOf ? String(args.asOf) : undefined,
      });

    case "get_balance_sheet":
      return getBalanceSheet(db, {
        ...parseDateRangeWithPhrase(args),
        asOf: args.asOf ? String(args.asOf) : undefined,
      });

    case "get_profit_loss":
      return getProfitLoss(db, parseDateRangeWithPhrase(args));

    case "get_cash_flow":
      return getCashFlow(db, parseDateRangeWithPhrase(args));

    case "get_general_ledger":
      return getGeneralLedger(db, {
        ...parseDateRangeWithPhrase(args),
        accountCode: args.accountCode ? String(args.accountCode) : undefined,
        accountId: args.accountId ? String(args.accountId) : undefined,
      });

    case "get_journal_entries":
      return getJournalEntries(db, {
        ...parseDateRangeWithPhrase(args),
        status: args.status ? String(args.status) as "draft" | "posted" | "reversed" : undefined,
        sourceModule: args.sourceModule ? String(args.sourceModule) : undefined,
        limit: args.limit ? Number(args.limit) : undefined,
      });

    case "get_account_statement":
      return getAccountStatement(db, {
        ...parseDateRangeWithPhrase(args),
        accountCode: args.accountCode ? String(args.accountCode) : undefined,
        accountId: args.accountId ? String(args.accountId) : undefined,
        statementType: args.statementType === "supplier" ? "supplier" : "customer",
      });

    case "list_accounts":
      return listAccounts(db, {
        headType: args.headType ? String(args.headType) as "asset" | "liability" | "equity" | "income" | "expense" : undefined,
        search: args.search ? String(args.search) : undefined,
        customerOnly: args.customerOnly === true || args.customerOnly === "true",
        supplierOnly: args.supplierOnly === true || args.supplierOnly === "true",
        activeOnly: args.activeOnly !== false && args.activeOnly !== "false",
      });

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
