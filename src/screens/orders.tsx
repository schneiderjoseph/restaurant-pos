import {Layout} from "@/screens/partials/layout.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Order as OrderModel, ORDER_LIST_FETCHES, OrderStatus} from "@/api/model/order.ts";
import {Tables} from "@/api/db/tables.ts";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import {OrderBox} from "@/components/orders/order.box.tsx";
import ScrollContainer from "react-indiana-drag-scroll";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import {User} from "@/api/model/user.ts";
import {Customer} from "@/api/model/customer.ts";
import {formatGuestLabel} from "@/lib/guest-label.ts";
import {useAtom} from "jotai";
import {appAlert, appPage, appSettings, appState, AppStateInterface} from "@/store/jotai.ts";
import {DatePicker} from "@/components/common/antd/datepicker.tsx";
import {getLocalTimeZone, today} from '@internationalized/date';
import {DateValue} from "react-aria-components";
import {Button} from "@/components/common/input/button.tsx";
import {faBars, faChair, faMoneyBillWave, faTableColumns} from "@fortawesome/free-solid-svg-icons";
import {OrderRow, ORDERS_LIST_GRID_CLASS} from "@/components/orders/order.row.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {Dropdown, DropdownItem} from "@/components/common/react-aria/dropdown.tsx";
import {LiveSubscription, RecordId} from "surrealdb";
import {toast} from "sonner";
import {useQueryBuilder} from "@/api/db/query-builder.ts";
import {LabelValue} from "@/api/model/common.ts";
import {assertOrderMutationsAllowed} from "@/lib/closing.guard.ts";
import {toRecordId} from "@/lib/utils.ts";
import {commitMerge, MergeConflictError} from "@/lib/order-merge.ts";
import {loadOrderLineage, OrderLineage} from "@/lib/order-lineage.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {useTranslation} from "react-i18next";
import {translateOrderStatus} from "@/lib/order.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import { useActionVisible } from "@/hooks/useActionVisible.ts";
import {dispatchPrint} from "@/lib/print.service.ts";
import {PRINT_TYPE} from "@/lib/print.registry.tsx";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import { batchOrdersWithTempPrint } from "@/lib/order-print.ts";
import {calendarDateToAppDateTime, toSurrealDateTime} from "@/lib/datetime.ts";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";
import {useOrderVisibility} from "@/hooks/useOrderVisibility.ts";
import {useDuoUserIds} from "@/hooks/useDuoUserIds.ts";
import {SEES_ALL_ORDERS_MODULE, seesAllOrders as seesAllOrdersFor} from "@/api/model/order_visibility.ts";
import {kitchenReadyOrderIds} from "@/lib/order-display.ts";
import {formatTableLabel} from "@/lib/table-label.ts";

const ORDERS_LIST_LIMIT = 500;
const ORDERS_LIVE_DEBOUNCE_MS = 1000;
// Hidden on request 2026-10-03; code kept.
const SHOW_OPEN_CASH_DRAWER = false;

export const Orders = () => {
  const {t} = useTranslation('orders');
  const {t: tNav} = useTranslation('navigation');
  const db = useDB();
  const {protectAction} = useSecurity();
  const isVisible = useActionVisible();
  const canOpenCashDrawer = isVisible("orders.open_cash_drawer");
  const liveQueryRef = useRef<LiveSubscription | null>(null);
  const liveKitchenQueryRef = useRef<LiveSubscription | null>(null);
  const fetchOrdersRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fetchOrdersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useAtom(appState);
  const [settings] = useAtom(appSettings);
  const [date, setDate] = useState<DateValue>(today(getLocalTimeZone()));
  const [view, setView] = useState<'row' | 'column'>('column');
  const selectedOrderFilters = useMemo(() => ({
    users: state?.ordersFilters?.users ?? [],
    floors: state?.ordersFilters?.floors ?? [],
    statuses: state?.ordersFilters?.statuses ?? [],
    orderTypes: state?.ordersFilters?.orderTypes ?? [],
    customers: state?.ordersFilters?.customers ?? [],
  }), [state?.ordersFilters]);

  const [merging, setMerging] = useState<boolean>(false);
  const [mergingOrders, setMergingOrders] = useState<OrderModel[]>([]);
  const [mergingTable, setMergingTable] = useState<string>();

  const [, setAlert] = useAtom(appAlert);
  const [app,] = useAtom(appPage);
  // With "own orders only" on (Manage → General settings), a role without this grant sees
  // only the orders its user opened, and those of their duo partner.
  const {can} = useModuleAccess();
  const {ownOrdersOnly} = useOrderVisibility();
  const seesAllOrders = seesAllOrdersFor(ownOrdersOnly, can(SEES_ALL_ORDERS_MODULE));
  const duoUserKey = useDuoUserIds().join('|');

  const [orders, setOrders] = useState<OrderModel[]>([]);
  const [tempPrintedOrderIds, setTempPrintedOrderIds] = useState<Set<string>>(new Set());
  const [kitchenReadyIds, setKitchenReadyIds] = useState<Set<string>>(new Set());
  /** Split / merge history of the listed orders, keyed by "order:id". */
  const [lineageByOrder, setLineageByOrder] = useState<Record<string, OrderLineage>>({});

  const updateOrderFilter = useCallback((key: keyof AppStateInterface['ordersFilters'], value: LabelValue[]) => {
    setState(prev => ({
      ...prev,
      ordersFilters: {
        users: prev?.ordersFilters?.users ?? [],
        floors: prev?.ordersFilters?.floors ?? [],
        statuses: prev?.ordersFilters?.statuses ?? [],
        orderTypes: prev?.ordersFilters?.orderTypes ?? [],
        customers: prev?.ordersFilters?.customers ?? [],
        [key]: value ?? [],
      }
    }));
  }, [setState]);


  const {orderFilters, orderFilterParams} = useMemo(() => {
    const floorFilters = [];
    const userFilters = [];
    const orderTypeFilters = [];
    const statusFilters = [];
    const customerFilters = [];

    const f = [];
    const params: Record<string, unknown> = {};

    selectedOrderFilters?.floors?.forEach(floor => {
      floorFilters.push(`floor = ${floor.value}`);
    });
    if (floorFilters.length > 0) {
      f.push(`(${floorFilters.join(' or ')})`);
    }

    if (seesAllOrders) {
      selectedOrderFilters?.users?.forEach(user => {
        userFilters.push(`user = ${user.value}`);
      });
      if (userFilters.length > 0) {
        f.push(`(${userFilters.join(' or ')})`);
      }
    } else {
      f.push(`user IN $visibleUsers`);
      params.visibleUsers = duoUserKey ? duoUserKey.split("|").map(id => toRecordId(id)) : [];
    }

    selectedOrderFilters?.statuses?.forEach(status => {
      statusFilters.push(`status = "${status.value}"`);
    });
    if (statusFilters.length > 0) {
      f.push(`(${statusFilters.join(' or ')})`);
    } else {
      // Default to In Progress when no status is selected
      f.push(`status = "${OrderStatus["In Progress"]}"`);
    }

    selectedOrderFilters?.orderTypes?.forEach(order_type => {
      orderTypeFilters.push(`order_type = ${order_type.value}`);
    });
    if (orderTypeFilters.length > 0) {
      f.push(`(${orderTypeFilters.join(' or ')})`);
    }

    selectedOrderFilters?.customers?.forEach(customer => {
      customerFilters.push(`customer = ${customer.value}`);
    });
    if (customerFilters.length > 0) {
      f.push(`(${customerFilters.join(' or ')})`);
    }

    if (date) {
      const dayStart = calendarDateToAppDateTime({
        year: date.year,
        month: date.month,
        day: date.day,
      });
      const dayEnd = dayStart.plus({days: 1});
      f.push(
        `(status = "${OrderStatus["In Progress"]}" OR (created_at >= $dayStart AND created_at < $dayEnd))`
      );
      params.dayStart = toSurrealDateTime(dayStart);
      params.dayEnd = toSurrealDateTime(dayEnd);
    }

    return {orderFilters: f, orderFilterParams: params};
  }, [selectedOrderFilters, date, seesAllOrders, duoUserKey]);

  const ordersQb = useQueryBuilder(
    Tables.orders, '*', orderFilters.map(item => `and ${item}`), ORDERS_LIST_LIMIT, 0, ['created_at desc'],
    ORDER_LIST_FETCHES
  );

  useEffect(() => {
    ordersQb.setWheres(orderFilters.map(item => `and ${item}`));
    ordersQb.setParameters(orderFilterParams);
  }, [orderFilters, orderFilterParams]);

  const fetchOrders = useCallback(async () => {
    const [listQuery] = await db.query(ordersQb.queryString, ordersQb.parameters);
    const list = listQuery as OrderModel[];
    setOrders(list);
    const ids = list.map((o) => o.id.toString());
    const printed = await batchOrdersWithTempPrint(db, ids);
    setTempPrintedOrderIds(printed);
    // Shown on the cards: which order a split / merged order comes from, or went into.
    setLineageByOrder(await loadOrderLineage(db, list.map((o) => o.id)).catch((error) => {
      console.error('Orders lineage query failed', error);
      return {};
    }));

    // Looked up by order item (indexed), so the query does not scan every kitchen row ever made.
    const inProgressItems = list
      .filter((order) => order.status === OrderStatus["In Progress"])
      .flatMap((order) => (order.items ?? []) as unknown[])
      .map((item) => item instanceof RecordId ? item : toRecordId((item as {id?: unknown})?.id))
      .filter(Boolean);

    if (inProgressItems.length === 0) {
      setKitchenReadyIds(new Set());
      return;
    }

    try {
      // Lines re-created by a split by amount follow the original line's kitchen rows.
      const [itemRows, , kitchenRows] = await db.query(
        `SELECT order, deleted_at, is_refunded, is_suspended, split_source FROM ${Tables.order_items}
         WHERE id IN $items;
         LET $sources = array::filter((SELECT VALUE split_source FROM ${Tables.order_items} WHERE id IN $items), |$v| $v != NONE AND $v != NULL);
         SELECT status, order_item, order_item.order AS order, order_item.deleted_at AS deleted_at,
         order_item.is_suspended AS is_suspended FROM ${Tables.order_items_kitchen}
         WHERE order_item IN array::concat($items, $sources)`,
        { items: inProgressItems }
      );
      setKitchenReadyIds(
        kitchenReadyOrderIds(
          Array.isArray(itemRows) ? itemRows : [],
          Array.isArray(kitchenRows) ? kitchenRows : []
        )
      );
    } catch (error) {
      console.error('Orders kitchen ready query failed', error);
      setKitchenReadyIds(new Set());
    }
  }, [ordersQb.queryString, ordersQb.parameters]);

  fetchOrdersRef.current = fetchOrders;

  const scheduleFetchOrders = useCallback(() => {
    if (fetchOrdersTimerRef.current) {
      clearTimeout(fetchOrdersTimerRef.current);
    }

    fetchOrdersTimerRef.current = setTimeout(() => {
      void fetchOrdersRef.current();
    }, ORDERS_LIVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [ordersQb.queryString, ordersQb.parameters]);

  const {
    data: users,
  } = useApi<SettingsData<User>>(Tables.users, ['deleted_at = none'], [], 0, 99999);

  const {
    data: customers,
  } = useApi<SettingsData<Customer>>(Tables.customers, [], ['name asc'], 0, 99999);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const ordersSubscription = await db.live(Tables.orders, (action) => {
        if (action === 'CREATE' || action === 'UPDATE' || action === 'DELETE') {
          scheduleFetchOrders();
        }
      });
      const kitchenSubscription = await db.live(Tables.order_items_kitchen, (action) => {
        if (action === 'CREATE' || action === 'UPDATE' || action === 'DELETE') {
          scheduleFetchOrders();
        }
      });

      if (cancelled) {
        await ordersSubscription.kill().catch(() => undefined);
        await kitchenSubscription.kill().catch(() => undefined);
        return;
      }

      liveQueryRef.current = ordersSubscription;
      liveKitchenQueryRef.current = kitchenSubscription;
    };

    void setup();

    return () => {
      cancelled = true;
      if (fetchOrdersTimerRef.current) {
        clearTimeout(fetchOrdersTimerRef.current);
      }
      liveQueryRef.current?.kill().catch(() => undefined);
      liveKitchenQueryRef.current?.kill().catch(() => undefined);
      liveQueryRef.current = null;
      liveKitchenQueryRef.current = null;
    };
  }, [scheduleFetchOrders]);

  const selectedTable = useMemo(() => {
    return settings.tables.find(item => item.id.toString() === mergingTable);
  }, [mergingTable, settings.tables]);

  const [isSaving, setIsSaving] = useState(false);
  const confirmMerge = async () => {

    if (!mergingTable) {
      setAlert(prev => ({
        ...prev,
        opened: true,
        type: 'error',
        message: t('merge.chooseTableAlert')
      }))

      return;
    }

    try {
      await assertOrderMutationsAllowed(db);
      setIsSaving(true);

      // One transaction: lines, payments taken, discounts, coupon and extras move together.
      const merged = await commitMerge(db, {
        orderIds: mergingOrders.map(item => item.id),
        table: {id: mergingTable, floor: selectedTable?.floor},
        user: app?.user,
      });

      postOrderTracking({
        module: "orders.merge",
        page: app?.page,
        orderId: merged.id,
        payload: {
          source_orders: mergingOrders.map((item) => item.id.toString()),
          table: mergingTable,
        },
        user: app?.user,
      });

      toast.success(t('merge.success', {invoiceNumber: merged.invoiceNumber}));

      // reset to default
      setMerging(false);
      setMergingTable(undefined);
      setMergingOrders([]);

    } catch (error) {
      console.error('Error creating merging orders:', error);
      toast.error(t(error instanceof MergeConflictError ? 'merge.changed' : 'merge.failed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout containerClassName="overflow-hidden">
      <DocumentTitle parts={[tNav('sidebar.orders')]} />
      <div className="flex gap-3 p-3 flex-col h-[100vh]" data-testid="orders-page">
        <div
          className="min-h-[60px] flex-0 rounded-xl bg-white flex flex-wrap items-center px-3 py-2 gap-3"
          data-testid="orders-filters"
        >
          <div className="min-w-[120px] flex-1 basis-[120px]">
            <ReactSelect
              options={[OrderStatus["In Progress"], OrderStatus.Paid, OrderStatus.Cancelled, OrderStatus.Spilt, OrderStatus.Merged].map(item => ({
                label: translateOrderStatus(t, item),
                value: item
              }))}
              isMulti
              placeholder={t('filters.status')}
              value={selectedOrderFilters.statuses}
              onChange={(value: LabelValue[]) => updateOrderFilter('statuses', value)}
            />
          </div>
          <div className="min-w-[120px] flex-1 basis-[120px]">
            <ReactSelect
              options={settings.order_types.map(item => ({
                label: item.name,
                value: item.id
              }))}
              isMulti
              placeholder={t('filters.orderTypes')}
              value={selectedOrderFilters.orderTypes}
              onChange={(value: LabelValue[]) => updateOrderFilter('orderTypes', value)}
            />
          </div>
          <div className="min-w-[160px] flex-1 basis-[160px]">
            <ReactSelect
              options={settings.floors.map(item => ({
                label: item.name,
                value: item.id
              }))}
              isMulti
              placeholder={t('filters.floors')}
              value={selectedOrderFilters.floors}
              onChange={(value: LabelValue[]) => updateOrderFilter('floors', value)}
            />
          </div>
          {seesAllOrders && (
          <div className="min-w-[160px] flex-1 basis-[160px]">
            <ReactSelect
              options={users?.data?.map(item => ({
                label: item.first_name + ' ' + item.last_name,
                value: item.id
              }))}
              isMulti
              placeholder={t('filters.users')}
              value={selectedOrderFilters.users}
              onChange={(value: LabelValue[]) => updateOrderFilter('users', value)}
            />
          </div>
          )}
          <div className="min-w-[180px] flex-1 basis-[180px]">
            <ReactSelect
              options={(customers?.data ?? []).map(item => ({
                label: formatGuestLabel(item) || item.guest_code || String(item.id),
                value: item.id
              }))}
              isMulti
              placeholder={t('filters.customers')}
              value={selectedOrderFilters.customers}
              onChange={(value: LabelValue[]) => updateOrderFilter('customers', value)}
              data-testid="orders-filter-customers"
            />
          </div>
          <div className="shrink-0">
            <DatePicker value={date} onChange={setDate} maxValue={today(getLocalTimeZone())} isClearable/>
          </div>
          <div className="input-group flex shrink-0 ml-auto" data-testid="orders-toolbar">
            {SHOW_OPEN_CASH_DRAWER && canOpenCashDrawer && (
              <Button
                icon={faMoneyBillWave}
                variant="primary"
                data-testid="orders-open-cash-drawer"
                onClick={() => {
                  protectAction(() => {
                    void dispatchPrint(db, PRINT_TYPE.pulse, {}, {userId: app?.user?.id});
                  }, {
                    module: 'orders.open_cash_drawer',
                    description: 'Open cash drawer',
                  });
                }}
              >
                {t('actions.openCashDrawer')}
              </Button>
            )}
            <Button
              icon={faTableColumns}
              variant="primary"
              data-testid="orders-view-blocks"
              onClick={() => setView('column')}
              active={view === 'column'}
            >
              {t('view.blocks')}
            </Button>
            <Button
              icon={faBars}
              variant="primary"
              data-testid="orders-view-table"
              onClick={() => setView('row')}
              active={view === 'row'}
            >
              {t('view.table')}
            </Button>
          </div>
        </div>
        {view === 'column' && (
          <div className="flex-1 min-h-0" data-testid="orders-list-blocks">
            <ScrollContainer className="h-full">
              {orders.length === 0 ? (
                <div className="h-full flex items-center justify-center text-neutral-500 text-lg">
                  {t('list.empty')}
                </div>
              ) : (
                <div className="flex-1 rounded-xl flex gap-3 flex-row">
                  {orders.map(item => (
                    <div className="w-[400px] flex-shrink-0" key={item.id}>
                      <OrderBox
                        order={item}
                        merging={merging}
                        mergingOrders={mergingOrders}
                        taxes={settings.taxes}
                        tempPrinted={tempPrintedOrderIds.has(item.id.toString())}
                        kitchenReady={kitchenReadyIds.has(item.id.toString())}
                        lineage={lineageByOrder[item.id.toString()]}
                        onMergeSelect={(order, status) => {
                          if (status) {
                            setMerging(true);

                            setMergingOrders(prev => [
                              ...prev,
                              order
                            ]);
                          } else {
                            setMergingOrders(prev => prev.filter(order => order.id.toString() !== item.id.toString()));
                          }
                        }}
                        onAction={fetchOrders}
                      />
                    </div>
                  ))}
                </div>
              )}
            </ScrollContainer>
          </div>
        )}

        {view === 'row' && (
          <div className="flex-1 min-h-0" data-testid="orders-list-table">
            <ScrollContainer className="h-full">
              {orders.length === 0 ? (
                <div className="h-full flex items-center justify-center text-neutral-500 text-lg">
                  {t('list.empty')}
                </div>
              ) : (
                <div className="flex-1 rounded-xl flex flex-col bg-white">
                  <div
                    className={`${ORDERS_LIST_GRID_CLASS} sticky top-0 z-10 min-h-[44px] bg-neutral-200 text-sm font-semibold text-neutral-700 border-b border-neutral-300`}
                  >
                    <div>{t('list.columns.number')}</div>
                    <div>{t('list.columns.tableGuest')}</div>
                    <div>{t('list.columns.server')}</div>
                    <div>{t('list.columns.status')}</div>
                    <div>{t('list.columns.time')}</div>
                    <div>{t('list.columns.items')}</div>
                    <div className="text-right">{t('list.columns.total')}</div>
                  </div>
                  {orders.map(item => (
                    <OrderRow
                      order={item}
                      key={item.id}
                      kitchenReady={kitchenReadyIds.has(item.id.toString())}
                      lineage={lineageByOrder[item.id.toString()]}
                    />
                  ))}
                </div>
              )}
            </ScrollContainer>
          </div>
        )}

        {merging && (
          <div className="min-h-[60px] flex-0 rounded-xl bg-white flex items-center px-3 gap-3" data-testid="orders-merge-bar">
            <div className="flex flex-wrap gap-5">
              <Dropdown
                label={<><FontAwesomeIcon icon={faChair} className="mr-3"/> {t('merge.chooseTable')}{selectedTable ? ` (${formatTableLabel(selectedTable)})` : ''}</>}
                btnSize="lg"
                className="flex-1 h-[300px] overflow-auto"
                onAction={(key) => {
                  setMergingTable(key.toString());
                }}
              >
                {settings.tables.map(item => (
                  <DropdownItem isActive={item.id.toString() === mergingTable} id={item.id.toString()}
                                key={item.id.toString()} className="min-w-[200px]">
                    {item.name + '' + item.number}
                  </DropdownItem>
                ))}
              </Dropdown>

              <Button
                variant="success"
                size="lg"
                disabled={mergingOrders.length <= 1 || isSaving}
                onClick={confirmMerge}
                isLoading={isSaving}
              >
                {mergingOrders.length <= 1 ? t('merge.selectTwoOrMore') : t('merge.confirmMerging', {count: mergingOrders.length})}
              </Button>

              <Button flat size="lg" variant="danger" data-testid="orders-merge-cancel" onClick={() => {
                setMerging(false);
                setMergingOrders([]);
              }}>
                {t('merge.cancelMerging')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
