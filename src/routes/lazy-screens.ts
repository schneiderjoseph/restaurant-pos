import {lazy} from "react";

export const Closing = lazy(() =>
  import('@/screens/closing.tsx').then(m => ({default: m.Closing}))
);
export const OrderDisplayScreen = lazy(() =>
  import('@/screens/order-display.tsx').then(m => ({default: m.OrderDisplayScreen}))
);
export const Delivery = lazy(() =>
  import('@/screens/delivery/').then(m => ({default: m.Index}))
);
export const Admin = lazy(() =>
  import('@/screens/admin').then(m => ({default: m.Admin}))
);
export const Settings = lazy(() =>
  import('@/screens/settings.tsx').then(m => ({default: m.Settings}))
);
export const IntegrationsScreen = lazy(() =>
  import('@/screens/integrations/index.tsx').then(m => ({default: m.IntegrationsScreen}))
);
export const TipDistributionScreen = lazy(() =>
  import('@/screens/tip.distribution.tsx').then(m => ({default: m.TipDistributionScreen}))
);
export const AccountsScreen = lazy(() =>
  import('@/screens/accounts.tsx').then(m => ({default: m.AccountsScreen}))
);
export const Reports = lazy(() =>
  import('@/screens/reports/').then(m => ({default: m.Reports}))
);

export const ProductMixWeeklyReport = lazy(() =>
  import('@/screens/reports/product.mix.weekly.report.tsx').then(m => ({default: m.ProductMixWeeklyReport}))
);
export const AuditReport = lazy(() =>
  import('@/screens/reports/audit.report.tsx').then(m => ({default: m.AuditReport}))
);
export const CashClosingReport = lazy(() =>
  import('@/screens/reports/cash.closing.report.tsx').then(m => ({default: m.CashClosingReport}))
);
export const DiscountsReport = lazy(() =>
  import('@/screens/reports/discounts.report.tsx').then(m => ({default: m.DiscountsReport}))
);
export const ProductHourlyReport = lazy(() =>
  import('@/screens/reports/product.hourly.report.tsx').then(m => ({default: m.ProductHourlyReport}))
);
export const ProductListReport = lazy(() =>
  import('@/screens/reports/product.list.report.tsx').then(m => ({default: m.ProductListReport}))
);
export const ProductMixSummaryReport = lazy(() =>
  import('@/screens/reports/product.mix.summary.report.tsx').then(m => ({default: m.ProductMixSummaryReport}))
);
export const SalesAdvancedReport = lazy(() =>
  import('@/screens/reports/sales.advanced.report.tsx').then(m => ({default: m.SalesAdvancedReport}))
);
export const SalesServerReport = lazy(() =>
  import('@/screens/reports/sales.server.report.tsx').then(m => ({default: m.SalesServerReport}))
);
export const SalesSummaryReport = lazy(() =>
  import('@/screens/reports/sales.summary.report.tsx').then(m => ({default: m.SalesSummaryReport}))
);
export const SalesSummary2Report = lazy(() =>
  import('@/screens/reports/sales.summary2.report.tsx').then(m => ({default: m.SalesSummary2Report}))
);
export const SalesWeeklyReport = lazy(() =>
  import('@/screens/reports/sales.weekly.report.tsx').then(m => ({default: m.SalesWeeklyReport}))
);
export const TablesSummaryReport = lazy(() =>
  import('@/screens/reports/tables.summary.report.tsx').then(m => ({default: m.TablesSummaryReport}))
);
export const VoidsReport = lazy(() =>
  import('@/screens/reports/voids.report.tsx').then(m => ({default: m.VoidsReport}))
);
export const TipsReport = lazy(() =>
  import('@/screens/reports/tips.report.tsx').then(m => ({default: m.TipsReport}))
);
export const SalesDashboardReport = lazy(() =>
  import('@/screens/reports/sales.dashboard.report.tsx').then(m => ({default: m.SalesDashboardReport}))
);
export const DeliveryDensityReport = lazy(() =>
  import('@/screens/reports/delivery.density.report.tsx').then(m => ({default: m.DeliveryDensityReport}))
);
export const TaxReport = lazy(() =>
  import('@/screens/reports/tax.report.tsx').then(m => ({default: m.TaxReport}))
);
export const CouponReport = lazy(() =>
  import('@/screens/reports/coupon.report.tsx').then(m => ({default: m.CouponReport}))
);
export const MergeOrdersReport = lazy(() =>
  import('@/screens/reports/merge.orders.report.tsx').then(m => ({default: m.MergeOrdersReport}))
);
export const SplitOrdersReport = lazy(() =>
  import('@/screens/reports/split.orders.report.tsx').then(m => ({default: m.SplitOrdersReport}))
);
export const OrderLifecycleReport = lazy(() =>
  import('@/screens/reports/order.lifecycle.report.tsx').then(m => ({default: m.OrderLifecycleReport}))
);
export const OrderReceiptReport = lazy(() =>
  import('@/screens/reports/order.receipt.report.tsx').then(m => ({default: m.OrderReceiptReport}))
);
export const OrderFiscalReport = lazy(() =>
  import('@/screens/reports/order.fiscal.report.tsx').then(m => ({default: m.OrderFiscalReport}))
);
export const ExpenseReport = lazy(() =>
  import('@/screens/reports/expense.report.tsx').then(m => ({default: m.ExpenseReport}))
);
export const ActivityReport = lazy(() =>
  import('@/screens/reports/activity.report.tsx').then(m => ({default: m.ActivityReport}))
);
export const AiReport = lazy(() =>
  import('@/screens/reports/ai.report.tsx').then(m => ({default: m.AiReport}))
);
