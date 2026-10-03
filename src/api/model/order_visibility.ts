export const ORDER_VISIBILITY_KEY = 'order_visibility';

/** Global setting (Manage → General settings). */
export interface OrderVisibilitySettings {
  /** When on, a user sees only the orders they opened, unless their role holds `order_visibility.all`. */
  own_orders_only: boolean;
}

export const DEFAULT_ORDER_VISIBILITY: OrderVisibilitySettings = {
  own_orders_only: false,
};

/** Permission that exempts a role from `own_orders_only`. */
export const SEES_ALL_ORDERS_MODULE = 'order_visibility.all';

/** Whether the Orders screen shows every user's orders to this user. */
export const seesAllOrders = (ownOrdersOnly: boolean, holdsSeeAll: boolean): boolean =>
  !ownOrdersOnly || holdsSeeAll;

/** A role's module list with `order_visibility.all` added or removed. */
export const withSeeAllOrders = (roles: string[] | undefined | null, seesAll: boolean): string[] => {
  const without = (roles ?? []).filter((module) => module !== SEES_ALL_ORDERS_MODULE);
  return seesAll ? [...without, SEES_ALL_ORDERS_MODULE] : without;
};
