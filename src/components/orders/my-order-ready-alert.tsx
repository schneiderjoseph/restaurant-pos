import {useCallback, useEffect, useRef, useState} from "react";
import {useAtomValue} from "jotai";
import {useLocation} from "react-router";
import {useTranslation} from "react-i18next";
import {LiveSubscription} from "surrealdb";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {OrderItemKitchen} from "@/api/model/order_item_kitchen.ts";
import {appPage} from "@/store/jotai.ts";
import {ORDER_DISPLAY} from "@/routes/posr.ts";
import {Button} from "@/components/common/input/button.tsx";
import {getAppStartOfDaySurreal} from "@/lib/datetime.ts";
import {getOrderFilteredItems} from "@/lib/order.ts";
import {buildKitchenRowsMap} from "@/lib/order-display.ts";
import {toRecordId} from "@/lib/utils.ts";
import {
  findNewlyReadyOrders,
  OrderColumns,
  readyAnnouncement,
  ReadyAlert,
  toReadyAlert,
} from "@/lib/my-order-ready.ts";
import {
  playReadyChime,
  speakOrderReady,
  unlockReadyChime,
  unlockSpeech,
} from "@/lib/order-ready-announcement.ts";

const REFRESH_DEBOUNCE_MS = 1000;
const SPEECH_AFTER_CHIME_MS = 700;

/**
 * Tells the signed-in server, on whatever page this terminal shows (lock screen included),
 * that the kitchen finished one of their orders: chime, spoken announcement and a popup that
 * stays until it is acknowledged. The order display screen announces every order itself.
 */
export const MyOrderReadyAlert = () => {
  const {t, i18n} = useTranslation('orders');
  const db = useDB();
  const page = useAtomValue(appPage);
  const userId = page?.user?.id?.toString();
  const {pathname} = useLocation();
  const onOrderDisplay = pathname === ORDER_DISPLAY;

  const [alerts, setAlerts] = useState<ReadyAlert[]>([]);
  const columnsRef = useRef<OrderColumns>(new Map());

  const announce = useCallback((ready: ReadyAlert[]) => {
    setAlerts(prev => [...prev, ...ready.filter(alert => !prev.some(item => item.id === alert.id))]);
    playReadyChime();
    window.setTimeout(() => {
      ready.forEach(alert => {
        const {key, values} = readyAnnouncement(alert);
        speakOrderReady(t(key, values), i18n.language);
      });
    }, SPEECH_AFTER_CHIME_MS);
  }, [t, i18n.language]);

  // Browsers only play sound after a gesture; any tap on the POS unlocks it.
  useEffect(() => {
    const unlock = () => {
      unlockSpeech();
      unlockReadyChime();
    };
    window.addEventListener('pointerdown', unlock, {once: true});
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Alerts belong to the server who was signed in.
  useEffect(() => {
    setAlerts([]);
    columnsRef.current = new Map();
  }, [userId]);

  useEffect(() => {
    if (!userId || onOrderDisplay) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscriptions: LiveSubscription[] = [];

    const refresh = async () => {
      const startDate = getAppStartOfDaySurreal();
      const [orderRows] = await db.query(
        `SELECT * FROM ${Tables.orders}
         WHERE user = $user AND created_at >= $startDate AND status NOT IN $closed
         FETCH items, table, customer`,
        {
          user: toRecordId(userId),
          startDate,
          closed: [OrderStatus.Cancelled, OrderStatus.Merged],
        },
      );
      const orders = Array.isArray(orderRows) ? (orderRows as Order[]) : [];
      const itemIds = orders.flatMap(order => getOrderFilteredItems(order).map(item => item.id));

      let kitchenRows: OrderItemKitchen[] = [];
      if (itemIds.length > 0) {
        const [rows] = await db.query(
          `SELECT * FROM ${Tables.order_items_kitchen}
           WHERE created_at >= $startDate AND order_item INSIDE $itemIds
           FETCH order_item`,
          {startDate, itemIds},
        );
        kitchenRows = Array.isArray(rows) ? (rows as OrderItemKitchen[]) : [];
      }

      if (cancelled) {
        return;
      }

      const {columns, newlyReady} = findNewlyReadyOrders(
        columnsRef.current,
        orders,
        buildKitchenRowsMap(kitchenRows),
      );
      columnsRef.current = columns;
      if (newlyReady.length > 0) {
        announce(newlyReady.map(toReadyAlert));
      }
    };

    const scheduleRefresh = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        refresh().catch(error => console.error('Order ready check failed', error));
      }, REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      await refresh().catch(error => console.error('Order ready check failed', error));
      for (const table of [Tables.orders, Tables.order_items_kitchen]) {
        const subscription = await db.live(table, scheduleRefresh);
        if (cancelled) {
          await subscription.kill().catch(() => undefined);
          return;
        }
        subscriptions.push(subscription);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscriptions.forEach(subscription => subscription.kill().catch(() => undefined));
    };
  }, [db, userId, onOrderDisplay, announce]);

  const current = alerts[0];
  if (!current) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="order-ready-alert-title"
      data-testid="order-ready-alert"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border-4 border-success-500 bg-white p-8 text-center shadow-2xl">
        <p id="order-ready-alert-title" className="text-2xl font-bold uppercase text-success-700">
          {t('readyAlert.title')}
        </p>
        <p className="text-6xl font-black tabular-nums text-success-900">{current.displayNumber}</p>
        {current.table && (
          <p className="text-2xl font-semibold">{t('readyAlert.table', {table: current.table})}</p>
        )}
        {current.guest && <p className="text-xl text-neutral-700">{current.guest}</p>}
        <Button
          variant="success"
          size="lg"
          className="w-full"
          data-testid="order-ready-alert-ok"
          onClick={() => setAlerts(prev => prev.slice(1))}
        >
          {alerts.length > 1
            ? t('readyAlert.okWithMore', {count: alerts.length - 1})
            : t('readyAlert.ok')}
        </Button>
      </div>
    </div>
  );
};
