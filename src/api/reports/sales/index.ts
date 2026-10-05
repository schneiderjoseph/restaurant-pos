import type {DateRangeFilter, DbClient, ProductMixFilters} from "@/api/reports/shared/types.ts";
import {
  aggregateProductMixByCategory,
  aggregateSalesByOutlet,
  aggregateSalesSummary,
  aggregateTopSellingDishes,
} from "@/api/reports/sales/aggregate.ts";
import {
  fetchDashboardOrders,
  fetchOrderVoids,
  fetchOrders,
  fetchPaidOrders,
  PRODUCT_MIX_FETCHES,
  SALES_SUMMARY_FETCHES,
} from "@/api/reports/sales/fetch.ts";

export {
  aggregateAccumulatedModifiersSummary,
  aggregateModifiersSummary,
  aggregateProductMixByCategory,
  aggregateSalesByOutlet,
  aggregateSalesSummary,
  aggregateTopSellingDishes,
  calculateOrderNetSales,
  getOrderFigures,
  UNCLASSIFIED_OUTLET_ID,
} from "@/api/reports/sales/aggregate.ts";
export type {OutletSales} from "@/api/reports/sales/aggregate.ts";

export {
  fetchDashboardOrders,
  fetchOrderVoids,
  fetchOrders,
  fetchPaidOrders,
  PRODUCT_MIX_FETCHES,
  SALES_SUMMARY_FETCHES,
} from "@/api/reports/sales/fetch.ts";

export const getTopSellingDishes = async (
  db: DbClient,
  options: DateRangeFilter & {limit?: number; sortBy?: "quantity" | "revenue"},
) => {
  const {limit, sortBy, ...dateRange} = options;
  const orders = await fetchPaidOrders(db, {...dateRange, fetches: ["items", "items.item"]});
  return aggregateTopSellingDishes(orders, {limit, sortBy});
};

export const getSalesSummary = async (
  db: DbClient,
  options: DateRangeFilter,
) => {
  const [orders, voids] = await Promise.all([
    fetchPaidOrders(db, {...options, fetches: SALES_SUMMARY_FETCHES}),
    fetchOrderVoids(db, options),
  ]);
  return aggregateSalesSummary(orders, voids);
};

/** Paid sales split by point of sale (Bar, Restaurant, …) over a date range. */
export const getSalesByOutlet = async (
  db: DbClient,
  options: DateRangeFilter,
) => {
  const orders = await fetchPaidOrders(db, {...options, fetches: SALES_SUMMARY_FETCHES});
  return aggregateSalesByOutlet(orders);
};

export const getProductMix = async (
  db: DbClient,
  options: DateRangeFilter & ProductMixFilters & {limit?: number},
) => {
  const {limit, categoryIds, menuItemIds, ...dateRange} = options;
  const orders = await fetchOrders(db, {
    ...dateRange,
    fetches: PRODUCT_MIX_FETCHES,
    paidOnly: true,
    categoryIds,
    menuItemIds,
  });

  const categoryGroups = aggregateProductMixByCategory(orders, {categoryIds, menuItemIds});

  if (!limit) {
    return {categories: categoryGroups};
  }

  const topItems = categoryGroups
    .flatMap(category => category.items.map(item => ({
      ...item,
      categoryName: category.categoryName,
    })))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);

  return {categories: categoryGroups, topItems};
};

export {getTips} from "@/api/reports/sales/tips.ts";
export type {GetTipsOptions, TipStaffRow} from "@/api/reports/sales/tips.ts";
export {
  getServerTicketTimes,
  getStaffAccountabilityMetrics,
} from "@/api/reports/sales/server-analytics.ts";
export {getUnsoldProducts, listMenuItems} from "@/api/reports/sales/products.ts";
export type {GetUnsoldProductsOptions, ListMenuItemsOptions, MenuItemSummary} from "@/api/reports/sales/products.ts";
