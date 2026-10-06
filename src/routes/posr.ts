export const LOGIN = '/';
export const MENU = '/menu';
export const ORDERS = '/orders';
export const SUMMARY = '/summary';
export const KITCHEN = '/kitchen';
export const ORDER_DISPLAY = '/order-display';
export const DELIVERY = '/delivery';
export const CLOSING = '/closing';
export const ADMIN = '/admin';
export const SETTINGS = '/settings';
export const INTEGRATIONS = '/integrations';
export const TIP_DISTRIBUTION = '/tip-distribution';
export const ACCOUNTS = '/accounts';

export const REPORTS = '/reports';
export const REPORTS_PRODUCT_MIX_WEEKLY = REPORTS + '/product-mix-weekly';
export const REPORTS_SALES_DASHBOARD = REPORTS + '/sales-dashboard';
export const REPORTS_AUDIT = REPORTS + '/audit';
export const REPORTS_CASH_CLOSING = REPORTS + '/cash-closing';
export const REPORTS_DISCOUNTS = REPORTS + '/discounts';
export const REPORTS_TAX = REPORTS + '/tax';
export const REPORTS_COUPON = REPORTS + '/coupon';
export const REPORTS_MERGE_ORDERS = REPORTS + '/merge-orders';
export const REPORTS_SPLIT_ORDERS = REPORTS + '/split-orders';
export const REPORTS_ORDER_LIFECYCLE = REPORTS + '/order-lifecycle';
export const REPORTS_ORDER_RECEIPT = REPORTS + '/order-receipt';
export const REPORTS_ORDER_FISCAL = REPORTS + '/order-fiscal';

export type OrderReceiptUrlParams = {
  id?: string | {toString(): string};
  orderId?: string | number;
  invoice?: string | number;
};

export const orderReceiptUrl = (params: OrderReceiptUrlParams = {}) => {
  const search = new URLSearchParams();
  if (params.id != null && params.id !== '') {
    const raw = typeof params.id === 'string' ? params.id : params.id.toString();
    if (raw) {
      search.set('id', raw);
    }
  }
  if (params.orderId != null && params.orderId !== '') {
    search.set('order_id', String(params.orderId));
  }
  if (params.invoice != null && params.invoice !== '') {
    search.set('invoice', String(params.invoice));
  }
  const qs = search.toString();
  return qs ? `${REPORTS_ORDER_RECEIPT}?${qs}` : REPORTS_ORDER_RECEIPT;
};
export const REPORTS_EXPENSE = REPORTS + '/expense';
export const REPORTS_ACTIVITY = REPORTS + '/activity';
export const REPORTS_PRODUCT_HOURLY = REPORTS + '/product-hourly';
export const REPORTS_PRODUCT_LIST = REPORTS + '/product-list';
export const REPORTS_PRODUCT_MIX_SUMMARY = REPORTS + '/product-mix-summary';
export const REPORTS_SALES_ADVANCED = REPORTS + '/sales-advanced';
export const REPORTS_DELIVERY_DENSITY = REPORTS + '/delivery-density';
export const REPORTS_SALES_SERVER = REPORTS + '/sales-server';
export const REPORTS_SALES_SUMMARY = REPORTS + '/sales-summary';
export const REPORTS_SALES_SUMMARY2 = REPORTS + '/sales-summary-2';
export const REPORTS_SALES_WEEKLY = REPORTS + '/sales-weekly';
export const REPORTS_TIPS = REPORTS + '/tips';
export const REPORTS_TABLES_SUMMARY = REPORTS + '/tables-summary';
export const REPORTS_VOIDS = REPORTS + '/voids';
export const REPORTS_AI = REPORTS + '/ai';
