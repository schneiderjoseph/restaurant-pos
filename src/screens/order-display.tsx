import { Layout } from '@/screens/partials/layout.tsx';
import useApi, { SettingsData } from '@/api/db/use.api.ts';
import { Order as OrderModel, OrderStatus } from '@/api/model/order.ts';
import { OrderItemKitchen } from '@/api/model/order_item_kitchen.ts';
import { Tables } from '@/api/db/tables.ts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDB } from '@/api/db/db.ts';
import { OrderType } from '@/api/model/order_type.ts';
import { ReactSelect } from '@/components/common/input/custom.react.select.tsx';
import { useAtom } from 'jotai';
import { appPage, appState, AppStateInterface } from '@/store/jotai.ts';
import { toRecordId } from '@/lib/utils.ts';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';
import { useOrderVisibility } from '@/hooks/useOrderVisibility.ts';
import { SEES_ALL_ORDERS_MODULE, seesAllOrders as seesAllOrdersFor } from '@/api/model/order_visibility.ts';
import { LabelValue } from '@/api/model/common.ts';
import { Button } from '@/components/common/input/button.tsx';
import { toSurrealDateTime, getAppStartOfDaySurreal } from '@/lib/datetime.ts';
import { fetchDueOrderItemIds } from '@/lib/order-due-items.ts';
import { useTranslation } from 'react-i18next';
import { formatOrderNumber, translateOrderStatus } from '@/lib/order.ts';
import { toast } from 'sonner';
import {
  buildKitchenRowsMap,
  getKitchenStationStatuses,
  ORDER_DISPLAY_MAX_VISIBLE,
  partitionDisplayOrders,
} from '@/lib/order-display.ts';
import { OrderTile } from '@/components/order-display/order-tile.tsx';
import { OrderReadyCelebration } from '@/components/order-display/order-ready-celebration.tsx';
import { useOrderReadyAnnouncements } from '@/hooks/useOrderReadyAnnouncements.ts';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { DocumentTitle } from '@/components/common/document-title.tsx';

export const OrderDisplayScreen = () => {
  const { t } = useTranslation(['order-display', 'orders']);
  const { t: tNav } = useTranslation('navigation');
  const db = useDB();
  const [state, setState] = useAtom(appState);
  const [orders, setOrders] = useState<OrderModel[]>([]);
  const [kitchenRowsByOrderItemId, setKitchenRowsByOrderItemId] = useState(
    buildKitchenRowsMap()
  );
  const [showSidebar, setShowSidebar] = useState(false);
  // Same rule as the Orders page: with "own orders only" on, a role without the grant sees
  // only the orders its user opened.
  const [app] = useAtom(appPage);
  const { can } = useModuleAccess();
  const { ownOrdersOnly } = useOrderVisibility();
  const seesAllOrders = seesAllOrdersFor(ownOrdersOnly, can(SEES_ALL_ORDERS_MODULE));
  const currentUserId = app?.user?.id?.toString();
  const liveOrdersRef = useRef<{ kill: () => Promise<void> } | null>(null);
  const liveKitchenRef = useRef<{ kill: () => Promise<void> } | null>(null);
  const fetchRequestRef = useRef(0);
  const [hydrated, setHydrated] = useState(false);

  const defaultStatusFilter = useMemo(
    () => [{ label: OrderStatus['In Progress'], value: OrderStatus['In Progress'] }],
    []
  );

  const selectedFilters = useMemo(
    () => ({
      statuses:
        state?.orderDisplayFilters?.statuses?.length
          ? state.orderDisplayFilters.statuses
          : defaultStatusFilter,
      orderTypes: state?.orderDisplayFilters?.orderTypes ?? [],
    }),
    [state?.orderDisplayFilters, defaultStatusFilter]
  );

  const updateFilter = useCallback(
    (key: keyof AppStateInterface['orderDisplayFilters'], value: LabelValue[]) => {
      setState((prev) => ({
        ...prev,
        orderDisplayFilters: {
          statuses: prev?.orderDisplayFilters?.statuses ?? [],
          orderTypes: prev?.orderDisplayFilters?.orderTypes ?? [],
          [key]: value ?? [],
        },
      }));
    },
    [setState]
  );

  const { data: orderTypes } = useApi<SettingsData<OrderType>>(
    Tables.order_types,
    ['deleted_at = none'],
    [],
    0,
    99999
  );

  const whereClauses = useMemo(() => {
    const clauses: string[] = [];

    const statusFilters = selectedFilters.statuses.map(
      (status) => `status = "${status.value}"`
    );
    if (statusFilters.length > 0) {
      clauses.push(`(${statusFilters.join(' or ')})`);
    }

    const orderTypeFilters = selectedFilters.orderTypes.map(
      (orderType) => `order_type = ${orderType.value}`
    );
    if (orderTypeFilters.length > 0) {
      clauses.push(`(${orderTypeFilters.join(' or ')})`);
    }

    if (!seesAllOrders) {
      clauses.push('user = $currentUser');
    }

    return clauses;
  }, [selectedFilters, seesAllOrders]);

  const fetchOrders = useCallback(async () => {
    const request = ++fetchRequestRef.current;
    const startDate = getAppStartOfDaySurreal();
    const currentUser = currentUserId ? toRecordId(currentUserId) : null;
    const filterSql = whereClauses.length > 0 ? `and ${whereClauses.join(' and ')}` : '';
    // Orders taken an earlier day and wanted today or later stay on the board.
    const dueItems = await fetchDueOrderItemIds(db, startDate);
    const [rows, kitchenRows] = await db.query(
      `SELECT * FROM ${Tables.orders}
       WHERE (created_at >= $startDate OR due_at >= $startDate) ${filterSql}
       ORDER BY created_at DESC
       FETCH items, table, user, order_type, customer;
       SELECT * FROM ${Tables.order_items_kitchen}
       WHERE created_at >= $startDate OR order_item IN $dueItems
       FETCH order_item, kitchen`,
      { startDate, dueItems, currentUser }
    );

    // Every live event starts a fetch: an older one answering late must not win.
    if (request !== fetchRequestRef.current) {
      return;
    }

    setOrders(Array.isArray(rows) ? (rows as OrderModel[]) : []);
    setKitchenRowsByOrderItemId(
      buildKitchenRowsMap(Array.isArray(kitchenRows) ? (kitchenRows as OrderItemKitchen[]) : [])
    );
    setHydrated(true);
  }, [whereClauses, currentUserId]);

  useEffect(() => {
    // New filters bring orders already ready into view: not announcements.
    setHydrated(false);
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const ordersSubscription = await db.live(Tables.orders, () => {
        void fetchOrders();
      });
      const kitchenSubscription = await db.live(Tables.order_items_kitchen, () => {
        void fetchOrders();
      });

      if (cancelled) {
        await ordersSubscription.kill().catch(() => undefined);
        await kitchenSubscription.kill().catch(() => undefined);
        return;
      }

      liveOrdersRef.current = ordersSubscription;
      liveKitchenRef.current = kitchenSubscription;
    };

    void setup();

    return () => {
      cancelled = true;
      liveOrdersRef.current?.kill().catch(() => undefined);
      liveKitchenRef.current?.kill().catch(() => undefined);
      liveOrdersRef.current = null;
      liveKitchenRef.current = null;
    };
  }, [fetchOrders]);

  // Announcements look at every order: the columns only show the first few, and an
  // older ready order sliding back into view must not be announced again.
  const all = useMemo(
    () => partitionDisplayOrders(orders, kitchenRowsByOrderItemId, Number.MAX_SAFE_INTEGER),
    [orders, kitchenRowsByOrderItemId]
  );
  const preparing = useMemo(() => all.preparing.slice(0, ORDER_DISPLAY_MAX_VISIBLE), [all]);
  const ready = useMemo(() => all.ready.slice(0, ORDER_DISPLAY_MAX_VISIBLE), [all]);

  // Server clock, like the kitchen's completed_at it is compared with.
  const setServed = useCallback(async (order: OrderModel, served: boolean) => {
    await db.query(
      `UPDATE $order SET served_at = ${served ? 'time::now()' : 'NONE'}`,
      { order: toRecordId(order.id.toString()) }
    );
    await fetchOrders();
  }, [fetchOrders]);

  const markServed = useCallback(async (order: OrderModel) => {
    try {
      await setServed(order, true);
      toast.success(t('order-display:served', { number: formatOrderNumber(order) }), {
        action: {
          label: t('order-display:undo'),
          onClick: () => void setServed(order, false).catch(() => undefined),
        },
      });
    } catch (error) {
      console.error('Mark order served failed', error);
    }
  }, [setServed, t]);

  const { activeCelebration, completeCelebration, highlightedOrderIds } =
    useOrderReadyAnnouncements(all.ready, all.preparing, hydrated);

  return (
    <Layout showSidebar={showSidebar} overflowHidden containerClassName="overflow-hidden">
      <DocumentTitle parts={[tNav('sidebar.orderDisplay')]} />
      {activeCelebration && (
        <OrderReadyCelebration
          orderNumber={activeCelebration.orderNumber}
          displayNumber={activeCelebration.displayNumber}
          onComplete={completeCelebration}
        />
      )}
      <div className="flex flex-col gap-3 p-3 h-full" data-testid="order-display-page">
        <div className="h-[60px] flex-shrink-0 rounded-xl bg-white flex items-center px-3 gap-3" data-testid="order-display-filters">
          <div className="min-w-[200px]">
            <ReactSelect
              options={[
                OrderStatus['In Progress'],
                OrderStatus.Pending,
                OrderStatus.Paid,
                OrderStatus.Cancelled,
                OrderStatus.Spilt,
                OrderStatus.Merged,
              ].map((item) => ({
                label: translateOrderStatus(t, item),
                value: item,
              }))}
              isMulti
              placeholder={t('order-display:filters.status')}
              value={selectedFilters.statuses}
              onChange={(value: LabelValue[]) => updateFilter('statuses', value)}
            />
          </div>
          <div className="min-w-[200px]">
            <ReactSelect
              options={orderTypes?.data.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
              isMulti
              placeholder={t('order-display:filters.orderTypes')}
              value={selectedFilters.orderTypes}
              onChange={(value: LabelValue[]) => updateFilter('orderTypes', value)}
            />
          </div>
          <div className="flex-1 flex justify-end">
            <Button
              icon={faBars}
              variant="neutral"
              active={showSidebar}
              onClick={() => setShowSidebar((prev) => !prev)}
            >
              {t('order-display:toggleSidebar')}
            </Button>
          </div>
        </div>

        <div className="flex flex-1 gap-3 min-h-0" data-testid="order-display-boards">
          <div className="flex-1 flex flex-col rounded-xl bg-neutral-100 overflow-hidden">
            <div className="flex-shrink-0 px-4 py-3 bg-warning-500 text-white">
              <h2 className="text-2xl font-bold uppercase tracking-wide">
                {t('order-display:preparing')}
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {preparing.map((order) => (
                  <OrderTile
                    key={order.id.toString()}
                    order={order}
                    variant="preparing"
                    stations={getKitchenStationStatuses(order, kitchenRowsByOrderItemId)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col rounded-xl bg-neutral-100 overflow-hidden">
            <div className="flex-shrink-0 px-4 py-3 bg-success-600 text-white">
              <h2 className="text-2xl font-bold uppercase tracking-wide">
                {t('order-display:readyForPickup')}
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {ready.map((order) => (
                  <OrderTile
                    key={order.id.toString()}
                    order={order}
                    variant="ready"
                    celebrate={highlightedOrderIds.has(order.id.toString())}
                    onServe={() => void markServed(order)}
                    stations={getKitchenStationStatuses(order, kitchenRowsByOrderItemId)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
