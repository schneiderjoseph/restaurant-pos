import {useAtom} from "jotai";
import {appAlert, appPage, appSettings, appState, closingEnforcementAtom} from "@/store/jotai.ts";
import {CSSProperties, useEffect, useMemo, useRef, useState} from "react";
import {Button} from "@/components/common/input/button.tsx";
import {cn, toRecordId} from "@/lib/utils.ts";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Tables} from "@/api/db/tables.ts";
import {Table} from "@/api/model/table.ts";
import {FloorTable} from "@/components/settings/floors/layout/table.tsx";
import {useDB} from "@/api/db/db.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faArrowLeft, faChair} from "@fortawesome/free-solid-svg-icons";
import {LiveSubscription} from "surrealdb";
import {nowSurrealDateTime} from "@/lib/datetime.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {getClosingEnforcementState} from "@/lib/closing.guard.ts";
import {Link} from "react-router";
import {useTranslation} from "react-i18next";
import i18n from "@/lib/i18n.ts";
import {useFloorMapCamera} from "@/hooks/useFloorMapCamera.ts";
import {useResortFb} from "@/hooks/useResortFb.ts";
import {ensureResortFloorTables, loadResortChambresFloor} from "@/lib/resort-floor-tables.ts";
import {Customer} from "@/api/model/customer.ts";
import {formatGuestLabel} from "@/lib/guest.ts";


const normalizeRoomKey = (raw?: string | number | null): string => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^\d+$/.test(trimmed)) {
    return String(Number(trimmed));
  }
  return trimmed.toLowerCase();
};

export const FloorLayout = () => {
  const { t } = useTranslation(['closing', 'menu']);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useAtom(appState);
  const [, setSettings] = useAtom(appSettings);
  const db = useDB();
  const [liveQuery, setLiveQuery] = useState<LiveSubscription | null>(null);
  const [tablesLiveQuery, setTablesLiveQuery] = useState<LiveSubscription | null>(null);
  const [inHouseLiveQuery, setInHouseLiveQuery] = useState<LiveSubscription | null>(null);
  const [page] = useAtom(appPage);
  const [, setAlert] = useAtom(appAlert);
  const [settings] = useAtom(appSettings);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const {enabled: resortFb} = useResortFb();
  const isClosingLocked = enforcement.orderTakingBlocked;
  const closingLockMessage = enforcement.message;
  const [occupiedRooms, setOccupiedRooms] = useState<Map<string, Customer>>(new Map());

  const floors = useMemo(() => {
    return settings.floors;
  }, [settings.floors]);

  const tables = useMemo(() => {
    if (state.floor) {
      return settings.tables.filter(item => item.floor.id.toString() === state.floor.id.toString());
    }

    return settings.tables;
  }, [settings.tables, state.floor]);

  const tableBounds = useMemo(
    () => tables.map((table) => ({
      x: Number(table.x) || 0,
      y: Number(table.y) || 0,
      width: Number(table.width) || 50,
      height: Number(table.height) || 50,
    })),
    [tables]
  );

  const {
    camera,
    worldSize,
    suppressClickRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isPanning,
  } = useFloorMapCamera(viewportRef, tableBounds, state.floor?.id?.toString());

  const categories = useMemo(() => {
    return settings.categories.filter(item => item.show_in_menu !== false);
  }, [settings.categories]);

  const orderTypes = useMemo(() => {
    return settings.order_types;
  }, [settings.order_types]);

  const paymentTypes = useMemo(() => {
    return settings.payment_types;
  }, [settings.payment_types]);

  const {
    data: orders,
    fetchData: fetchOrders
  } = useApi<SettingsData<Order>>(Tables.orders, [`status = "${OrderStatus["In Progress"]}"`], ['created_at asc'],
    undefined, undefined, [
      'customer', 'items', 'items.item', 'items.taxes', 'items.tax_mode', 'items.modifiers',
      'order_type', 'table', 'user', 'tax', 'order_taxes', 'order_taxes.tax', 'coupon', 'order_discounts',
      'extras',
    ], {}, [
      'covers', 'created_at', 'floor', 'id', 'invoice_number', 'order_type', 'status', 'table', 'tags', 'user',
      'items.*', 'customer',
      'tax', 'tax_amount', 'order_taxes',
      'discount_amount', 'order_discounts', 'order_discounts.discount',
      'service_charge', 'service_charge_amount', 'service_charge_type',
      'tip', 'tip_amount', 'tip_type',
      'extras', 'coupon',
    ]);

  const fetchTables = async () => {
    const [t] = await db.query<Table[]>(
      `SELECT id, locked_at, locked_by, is_locked, priority
       FROM ${Tables.tables}
       WHERE deleted_at = none
       ORDER BY priority ASC`
    );

    const tableLocks = Array.isArray(t) ? t : [];
    if (tableLocks.length === 0) {
      return;
    }

    setSettings(prev => ({
      ...prev,
      tables: prev.tables.map((cachedTable) => {
        const updatedTable = tableLocks.find(item => item.id.toString() === cachedTable.id.toString());
        if (!updatedTable) {
          return cachedTable;
        }

        return {
          ...cachedTable,
          is_locked: updatedTable.is_locked,
          locked_at: updatedTable.locked_at,
          locked_by: updatedTable.locked_by,
          priority: updatedTable.priority,
        };
      })
    }));
  }

  const fetchInHouseRooms = async () => {
    const [rows] = await db.query<Customer[]>(
      `SELECT * FROM ${Tables.customers}
       WHERE (in_house = true OR tags CONTAINS 'in-house')
         AND room != NONE
         AND room != NULL`
    );
    const map = new Map<string, Customer>();
    for (const guest of Array.isArray(rows) ? rows : []) {
      const key = normalizeRoomKey(guest.room);
      if (!key || map.has(key)) {
        continue;
      }
      map.set(key, guest);
    }
    setOccupiedRooms(map);
    return map;
  };

  const guestFromRoomMap = (item: Table, map: Map<string, Customer>): Customer | undefined => {
    if (item.source !== 'asi-room') {
      return undefined;
    }
    return (
      map.get(normalizeRoomKey(item.number))
      ?? map.get(normalizeRoomKey(item.asi_alias))
    );
  };

  const runLiveQuery = async () => {
    const result = await db.live(Tables.orders, function () {
      fetchOrders();
    });

    setLiveQuery(result);
  }

  const runTablesLiveQuery = async () => {
    const result = await db.live(Tables.tables, function () {
      fetchTables();
    });

    setTablesLiveQuery(result);
  }

  const runInHouseLiveQuery = async () => {
    const result = await db.live(Tables.customers, function () {
      void fetchInHouseRooms();
    });
    setInHouseLiveQuery(result);
  }

  useEffect(() => {
    runLiveQuery().then();
    runTablesLiveQuery().then();
    void fetchInHouseRooms();
    runInHouseLiveQuery().then();

    return () => {
      liveQuery?.kill().catch(() => undefined);
      tablesLiveQuery?.kill().catch(() => undefined);
      inHouseLiveQuery?.kill().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!resortFb) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const seeded = await ensureResortFloorTables(db);
        const chambres = await loadResortChambresFloor(db);
        if (cancelled) {
          return;
        }
        setSettings((prev) => {
          const floorMap = new Map(
            (prev.floors ?? []).map((floor) => [floor.id?.toString(), floor]),
          );
          floorMap.set(seeded.floor.id?.toString(), seeded.floor);
          if (chambres?.floor?.id) {
            floorMap.set(chambres.floor.id.toString(), chambres.floor);
          }
          const tableMap = new Map(
            (prev.tables ?? []).map((table) => [table.id?.toString(), table]),
          );
          for (const table of seeded.tables) {
            tableMap.set(table.id?.toString(), table);
          }
          for (const table of chambres?.tables ?? []) {
            tableMap.set(table.id?.toString(), table);
          }
          return {
            ...prev,
            floors: Array.from(floorMap.values()),
            tables: Array.from(tableMap.values()),
          };
        });
        // Never force Salle — only set a floor when none is selected yet.
        setState((prev) => ({
          ...prev,
          floor: prev.floor ?? seeded.floor,
        }));
      } catch (error) {
        console.error('Failed to layout resort floor tables', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, resortFb, setSettings, setState]);

  useEffect(() => {
    if (isClosingLocked && closingLockMessage) {
      setAlert(prev => ({
        ...prev,
        message: closingLockMessage,
        type: "warning",
        opened: true
      }));
    }
  }, [isClosingLocked, closingLockMessage, setAlert]);

  useEffect(() => {
    // Prefer Salle as default when nothing selected (not Map insertion order).
    if (!state.floor && floors?.length > 0) {
      const salle =
        floors.find((f) => f.id?.toString() === 'floor:resort_salle' || f.name === 'Salle') ??
        floors[0];
      setState((prev) => ({
        ...prev,
        floor: salle,
      }));
    }
  }, [floors, state.floor]);

  const tableOrders = (tableId: string) => {
    return orders?.data?.filter(item => item?.table?.id?.toString() === tableId.toString())
  }

  const tableOrder = (tableId: string) => {
    return orders?.data?.find(item =>
      item?.table?.id?.toString() === tableId.toString()
    )
  }

  const roomGuestForTable = (item: Table): Customer | undefined => {
    return guestFromRoomMap(item, occupiedRooms);
  };

  const roomOccupiedBy = (item: Table): string | undefined => {
    const guest = roomGuestForTable(item);
    return guest ? formatGuestLabel(guest) : undefined;
  };

  const isTableBusy = (item: Table) => {
    return Boolean(tableOrder(item.id.toString())) || Boolean(roomOccupiedBy(item));
  };

  const floorStats = useMemo(() => {
    const visible = tables ?? [];
    let occupied = 0;
    let locked = 0;
    let free = 0;

    for (const table of visible) {
      if (table.is_block) {
        continue;
      }
      if (table.is_locked) {
        locked += 1;
      }
      if (isTableBusy(table)) {
        occupied += 1;
      } else if (!table.is_locked) {
        free += 1;
      }
    }

    return {occupied, locked, free, total: visible.length};
  }, [tables, orders?.data, occupiedRooms]);

  const occupiedOnFloor = (floorId: string) => {
    const floorTables = settings.tables.filter(
      (table) => table.floor?.id?.toString() === floorId && !table.is_block
    );
    return floorTables.filter((table) => isTableBusy(table)).length;
  }

  const onClick = async (item: Table) => {
    try {
      const enforcementState = await getClosingEnforcementState(db);
      if (enforcementState.orderTakingBlocked) {
        setAlert(prev => ({
          ...prev,
          message: enforcementState.message ?? i18n.t('closing:orderTakingDisabled'),
          type: "warning",
          opened: true
        }));
        return;
      }
    } catch (error) {
      console.error("Failed to check closing enforcement:", error);
      setAlert(prev => ({
        ...prev,
        message: i18n.t('closing:verifyClosingFailed'),
        type: "error",
        opened: true
      }));
      return;
    }

    if (item.is_locked) {
      setAlert(prev => ({
        ...prev,
        message: t('tableLocked', { user: item.locked_by }),
        type: 'error',
        opened: true
      }))
    }

    if (!item.is_block && !item.is_locked) {
      let ordersData = orders?.data ?? [];
      let ordersForTable = ordersData.filter(orderItem => orderItem?.table?.id?.toString() === item.id.toString());
      let order = ordersForTable[0];
      let cart = state.cart;

      // Hotel rooms require an in-house guest — auto-attach when occupied.
      let roomGuest: Customer | undefined;
      if (item.source === 'asi-room') {
        roomGuest = guestFromRoomMap(item, occupiedRooms) ?? order?.customer;
        if (!roomGuest) {
          const freshMap = await fetchInHouseRooms();
          roomGuest = guestFromRoomMap(item, freshMap) ?? order?.customer;
        }
        if (!roomGuest) {
          setAlert(prev => ({
            ...prev,
            message: t('menu:guest.roomRequiresGuest'),
            type: 'error',
            opened: true,
          }));
          return;
        }
      }

      if (state.switchTable) {
        if (state.order.id !== 'new') {
          const fromTableId = state?.table?.id?.toString();
          // update new table in order
          await db.merge(toRecordId(state.order.id), {
            table: toRecordId(item.id),
          });

          // await fetchOrders();
          const [freshTableOrders] = await db.query<Order[]>(
            `SELECT *
             FROM ${Tables.orders}
             WHERE status = $status AND table = $table
             ORDER BY created_at ASC
             FETCH customer, items, items.item, order_type, table, user`,
            {
              status: OrderStatus["In Progress"],
              table: toRecordId(item.id),
            }
          );

          ordersForTable = Array.isArray(freshTableOrders) ? freshTableOrders : [];
          order = ordersForTable.find(orderItem => orderItem?.id?.toString() === state.order.id?.toString()) ?? ordersForTable[0];

          if (!order && state.order.order) {
            order = {
              ...state.order.order,
              table: item
            };
            ordersForTable = [order];
          }

          postOrderTracking({
            module: "orders.move_table",
            page: page?.page,
            orderId: state.order.id,
            payload: {
              from_table: fromTableId,
              to_table: item.id.toString(),
            },
            user: page?.user,
          });
        }
        cart = [];
      }

      if (order) {
        cart = [];
      }

      const seats = new Map();
      order?.items.forEach(item => {
        if (item.seat) {
          seats.set(item.seat, item.seat);
        }
      });

      const seatsArray = Array.from(seats.values());

      const noSeat = state.cart.some(item => item.seat === undefined);

      setState(prev => ({
        ...prev,
        table: item,
        showFloor: false,
        showPersons: order ? false : item.ask_for_covers,
        persons: order ? order?.covers?.toString() : '1',
        orders: ordersForTable,
        cart: cart,
        seats: seatsArray,
        seat: noSeat ? undefined : (seatsArray.length > 0 ? seatsArray[0] : undefined),
        order: {
          order: order,
          id: order ? order.id : 'new'
        },
        switchTable: false, // turn off switch table flag
        customer: order?.customer ?? roomGuest ?? undefined,
        resortEntry: prev.resortEntry === 'floor' ? 'floor' : prev.resortEntry,
        orderType: (item.order_types?.length > 0 ? item.order_types : orderTypes)[0]
      }));

      setSettings(prev => ({
        ...prev,
        categories: item.categories?.length > 0 ? item.categories : categories,
        order_types: item.order_types?.length > 0 ? item.order_types : orderTypes,
        payment_types: item.payment_types?.length > 0 ? item.payment_types : paymentTypes,
      }));

      await db.merge(item.id, {
        is_locked: true,
        locked_at: nowSurrealDateTime(),
        locked_by: `${page.user.first_name} ${page.user.last_name}`
      });
    }
  }

  return (
    <>
      <div className="flex flex-col h-full transition-all delay-75" data-testid="menu-floor" style={{
        background: state.floor?.background
      }}>
        <div className="min-h-[72px] bg-white/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex items-center gap-4">
          {resortFb && state.resortEntry === 'floor' && (
            <Button
              variant="primary"
              flat
              size="lg"
              icon={faArrowLeft}
              data-testid="floor-back-guest"
              onClick={() => setState((prev) => ({
                ...prev,
                resortEntry: 'guest',
                showFloor: true,
                showPersons: false,
                table: undefined,
                customer: undefined,
                order: undefined,
                orders: [],
                cart: [],
              }))}
            >
              {t('menu:guest.backToGuests')}
            </Button>
          )}
          {state.switchTable ? (
            <div className="flex-1 rounded-xl bg-warning-100 text-warning-900 px-4 py-2 flex items-center gap-3">
              <FontAwesomeIcon icon={faChair} className="text-xl"/>
              <div className="leading-tight">
                <div className="text-lg font-bold">{t('floor.switchTable', {
                  table: `${state?.table?.name ?? ''}${state?.table?.number ?? ''}`
                })}</div>
                <div className="text-sm opacity-80">{t('floor.switchHint')}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-[120px]">
                <div className="text-2xl font-black leading-none">{state.floor?.name}</div>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="rounded-full bg-success-100 text-success-800 px-3 py-1">{t('floor.free', {count: floorStats.free})}</span>
                <span className="rounded-full bg-warning-100 text-warning-800 px-3 py-1">{t('floor.occupied', {count: floorStats.occupied})}</span>
              </div>
              <div className="ml-auto hidden lg:flex items-center gap-3 text-xs font-semibold text-neutral-600">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success-500"/>{t('floor.legendFree')}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning-500"/>{t('floor.legendBusy')}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-neutral-700"/>{t('floor.legendLocked')}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-danger-500"/>{t('floor.legendLate')}</span>
              </div>
            </>
          )}
          {isClosingLocked && closingLockMessage && (
            <div className="alert alert-warning flex-1">
              {closingLockMessage}
            </div>
          )}
        </div>
        <div
          ref={viewportRef}
          className={cn(
            "layout relative h-[calc(100vh_-_72px_-_80px)] overflow-hidden bg-grid touch-none",
            isPanning ? "cursor-grabbing" : "cursor-grab"
          )}
          data-testid="menu-floor-tables"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {floors?.length === 0 && (
            <div className="flex items-center justify-center h-full text-xl text-neutral-700 cursor-default">
              {t('floor.reloadCachePrefix')}{" "}<span className="ml-2 btn btn-secondary"><Link to="/settings">{t('floor.settings')}</Link></span>
            </div>
          )}
          {state.floor && tables?.length === 0 && (
            <div className="flex items-center justify-center h-full text-xl text-neutral-600 font-semibold cursor-default">
              {t('floor.emptyFloor')}
            </div>
          )}
          {state.floor && tables?.length > 0 && (
            <div
              className="absolute top-0 left-0 origin-top-left will-change-transform"
              style={{
                width: worldSize.width,
                height: worldSize.height,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
              }}
            >
              {tables.map(item => (
                <FloorTable
                  order={tableOrder(item.id)}
                  occupiedBy={roomOccupiedBy(item)}
                  table={item}
                  isEditing={false}
                  isLocked={item.is_locked}
                  onClick={() => onClick(item)}
                  key={item.id}
                  numberOfOrders={tableOrders(item.id)?.length}
                  suppressClick={suppressClickRef}
                />
              ))}
            </div>
          )}
        </div>
        <div className="floor-btns flex gap-2 p-3 bg-white/90 border-t border-neutral-200" data-testid="menu-floor-switcher">
          {floors?.map(item => {
            const active = state?.floor && item.id.toString() === state?.floor?.id?.toString();
            const busy = occupiedOnFloor(item.id.toString());
            return (
              <Button
                variant="custom"
                key={item.id}
                size="lg"
                data-testid="menu-floor-btn"
                className={
                  cn(
                    "flex-1 relative outline-none pressable rounded-2xl min-h-[56px] font-bold shadow-sm",
                    active ? 'ring-2 ring-neutral-900' : 'opacity-85'
                  )
                }
                onClick={() => setState(prev => ({
                  ...prev,
                  floor: item
                }))}
                style={{
                  '--background': item.background,
                  '--color': item.color,
                  '--scale': 0.98
                } as CSSProperties}
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>{item.name}</span>
                  {busy > 0 && (
                    <span className="text-xs font-semibold opacity-80">{t('floor.occupied', {count: busy})}</span>
                  )}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}
