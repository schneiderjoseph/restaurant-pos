import {Route, Routes} from "react-router";
import {Login} from "@/screens/login.tsx";
import {NotFound} from "@/screens/not-found.tsx";
import {Menu} from "@/screens/menu";
import {Orders} from "@/screens/orders.tsx";
import {Summary} from "@/screens/summary.tsx";
import {KitchenScreen} from "@/screens/kitchen.tsx";
import {ProtectedRoute} from "@/routes/protected-route.tsx";
import {SuspenseOutlet} from "@/routes/suspense-outlet.tsx";
import {
  ADMIN,
  CLOSING,
  DELIVERY,
  KITCHEN,
  ORDER_DISPLAY,
  LOGIN,
  MENU,
  ORDERS,
  REPORTS,
  REPORTS_ACTIVITY,
  REPORTS_AI,
  REPORTS_AUDIT,
  REPORTS_CASH_CLOSING,
  REPORTS_COUPON,
  REPORTS_DELIVERY_DENSITY,
  REPORTS_DISCOUNTS,
  REPORTS_EXPENSE,
  REPORTS_MERGE_ORDERS,
  REPORTS_ORDER_FISCAL,
  REPORTS_ORDER_LIFECYCLE,
  REPORTS_ORDER_RECEIPT,
  REPORTS_PRODUCT_HOURLY,
  REPORTS_PRODUCT_LIST,
  REPORTS_PRODUCT_MIX_SUMMARY,
  REPORTS_PRODUCT_MIX_WEEKLY,
  REPORTS_SALES_ADVANCED,
  REPORTS_SALES_DASHBOARD,
  REPORTS_SALES_SERVER,
  REPORTS_SALES_SUMMARY,
  REPORTS_SALES_SUMMARY2,
  REPORTS_SALES_WEEKLY,
  REPORTS_SPLIT_ORDERS,
  REPORTS_TABLES_SUMMARY,
  REPORTS_TAX,
  REPORTS_TIPS,
  REPORTS_SALES_BY_CUSTOMER,
  REPORTS_VOIDS,
  SETTINGS,
  INTEGRATIONS,
  SUMMARY,
  TIP_DISTRIBUTION,
  FRONTDESK,
  ACCOUNTS,
} from "@/routes/posr.ts";
import {
  AccountsScreen,
  ActivityReport,
  Admin,
  AiReport,
  AuditReport,
  Closing,
  Delivery,
  IntegrationsScreen,
  CashClosingReport,
  CouponReport,
  DeliveryDensityReport,
  DiscountsReport,
  ExpenseReport,
  MergeOrdersReport,
  OrderDisplayScreen,
  OrderFiscalReport,
  OrderLifecycleReport,
  OrderReceiptReport,
  ProductHourlyReport,
  ProductListReport,
  ProductMixSummaryReport,
  ProductMixWeeklyReport,
  Reports,
  SalesAdvancedReport,
  SalesDashboardReport,
  SalesServerReport,
  SalesSummary2Report,
  SalesSummaryReport,
  SalesWeeklyReport,
  Settings,
  SplitOrdersReport,
  TablesSummaryReport,
  TaxReport,
  TipDistributionScreen,
  FrontDeskScreen,
  TipsReport,
  SalesByCustomerReport,
  VoidsReport,
} from "@/routes/lazy-screens.ts";
import {
  isAccountingModuleEnabled,
  isClosingModuleEnabled,
  isDeliveryModuleEnabled,
  isIntegrationsModuleEnabled,
} from "@/lib/feature-modules.ts";

export const AppRoutes = () => {
  const delivery = isDeliveryModuleEnabled();
  const integrations = isIntegrationsModuleEnabled();
  const accounting = isAccountingModuleEnabled();
  const closing = isClosingModuleEnabled();

  return (
  <Routes>
    <Route path={LOGIN} element={<Login/>}/>
    <Route element={<ProtectedRoute/>}>
      <Route path={MENU} element={<Menu/>}/>
      <Route path={ORDERS} element={<Orders/>}/>
      <Route path={SUMMARY} element={<Summary/>}/>
      <Route path={KITCHEN} element={<KitchenScreen/>}/>

      <Route element={<SuspenseOutlet/>}>
        {closing && <Route path={CLOSING} element={<Closing/>}/>}
        <Route path={ORDER_DISPLAY} element={<OrderDisplayScreen/>}/>
        {delivery && <Route path={DELIVERY} element={<Delivery/>}/>}
        <Route path={ADMIN} element={<Admin/>}/>
        <Route path={SETTINGS} element={<Settings/>}/>
        {integrations && <Route path={INTEGRATIONS} element={<IntegrationsScreen/>}/>}
        <Route path={TIP_DISTRIBUTION} element={<TipDistributionScreen/>}/>
        <Route path={FRONTDESK} element={<FrontDeskScreen/>}/>
        {accounting && <Route path={ACCOUNTS} element={<AccountsScreen/>}/>}
        <Route path={REPORTS} element={<Reports/>}/>
        <Route path={REPORTS_SALES_DASHBOARD} element={<SalesDashboardReport/>}/>
        <Route path={REPORTS_AUDIT} element={<AuditReport/>}/>
        {closing && <Route path={REPORTS_CASH_CLOSING} element={<CashClosingReport/>}/>}
        <Route path={REPORTS_DISCOUNTS} element={<DiscountsReport/>}/>
        <Route path={REPORTS_TAX} element={<TaxReport/>}/>
        <Route path={REPORTS_COUPON} element={<CouponReport/>}/>
        <Route path={REPORTS_MERGE_ORDERS} element={<MergeOrdersReport/>}/>
        <Route path={REPORTS_SPLIT_ORDERS} element={<SplitOrdersReport/>}/>
        <Route path={REPORTS_ORDER_LIFECYCLE} element={<OrderLifecycleReport/>}/>
        <Route path={REPORTS_ORDER_RECEIPT} element={<OrderReceiptReport/>}/>
        <Route path={REPORTS_ORDER_FISCAL} element={<OrderFiscalReport/>}/>
        <Route path={REPORTS_EXPENSE} element={<ExpenseReport/>}/>
        <Route path={REPORTS_ACTIVITY} element={<ActivityReport/>}/>
        <Route path={REPORTS_AI} element={<AiReport/>}/>
        <Route path={REPORTS_PRODUCT_HOURLY} element={<ProductHourlyReport/>}/>
        <Route path={REPORTS_PRODUCT_LIST} element={<ProductListReport/>}/>
        <Route path={REPORTS_PRODUCT_MIX_SUMMARY} element={<ProductMixSummaryReport/>}/>
        <Route path={REPORTS_PRODUCT_MIX_WEEKLY} element={<ProductMixWeeklyReport/>}/>
        <Route path={REPORTS_SALES_ADVANCED} element={<SalesAdvancedReport/>}/>
        {delivery && <Route path={REPORTS_DELIVERY_DENSITY} element={<DeliveryDensityReport/>}/>}
        <Route path={REPORTS_SALES_SERVER} element={<SalesServerReport/>}/>
        <Route path={REPORTS_SALES_SUMMARY} element={<SalesSummaryReport/>}/>
        <Route path={REPORTS_SALES_SUMMARY2} element={<SalesSummary2Report/>}/>
        <Route path={REPORTS_TIPS} element={<TipsReport/>}/>
        <Route path={REPORTS_SALES_BY_CUSTOMER} element={<SalesByCustomerReport/>}/>
        <Route path={REPORTS_SALES_WEEKLY} element={<SalesWeeklyReport/>}/>
        <Route path={REPORTS_TABLES_SUMMARY} element={<TablesSummaryReport/>}/>
        <Route path={REPORTS_VOIDS} element={<VoidsReport/>}/>
      </Route>
    </Route>
    <Route path="*" element={<NotFound/>}/>
  </Routes>
  );
};
