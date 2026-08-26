import {Layout} from "@/screens/partials/layout.tsx";
import {MenuDishes} from "@/components/menu/dishes.tsx";
import {MenuCart} from "@/components/cart/cart.tsx";
import {useEffect, useMemo, useRef} from "react";
import {FloorLayout} from "@/components/floor/floor.layout.tsx";
import {MenuHeader} from "@/components/menu/header.tsx";
import {GuestLookup} from "@/components/menu/guest.lookup.tsx";
import {useAtom} from "jotai";
import {appAlert, appSettings, appState, closingEnforcementAtom} from "@/store/jotai.ts";
import {MenuPersons} from "@/components/menu/persons.tsx";
import {useDB} from "@/api/db/db.ts";
import {toRecordId} from "@/lib/utils.ts";
import {Tables} from "@/api/db/tables.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import 'swiper/css';
import {useTranslation} from "react-i18next";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import {useSearchParams} from "react-router";
import {useResortFb} from "@/hooks/useResortFb.ts";
import {useEnsureAsiMenuCache} from "@/hooks/useEnsureAsiMenuCache.ts";
import {useEnsureLoyverseMenuCache} from "@/hooks/useEnsureLoyverseMenuCache.ts";

export const Menu = () => {
  const {t: tNav} = useTranslation('navigation');
  const [state, setState] = useAtom(appState);
  const [settings, setSettings] = useAtom(appSettings);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const [, setAlert] = useAtom(appAlert);
  const db = useDB();
  const [searchParams] = useSearchParams();
  const {enabled: resortFb} = useResortFb();
  useEnsureAsiMenuCache();
  useEnsureLoyverseMenuCache();
  /** Docs capture only — never write this into persisted appState. */
  const docsTableless = searchParams.get('docs_tableless') === '1';
  /** User preference (Settings → table selection). */
  const hideTableSelectionSetting = state.hideTableSelection === true;
  const resortFloorMode = resortFb && state.resortEntry === 'floor';
  const tablelessMode = hideTableSelectionSetting || (resortFb && !resortFloorMode);

  // One-time recovery: earlier docs capture wrote hideTableSelection into app-state.
  useEffect(() => {
    if (docsTableless) {
      return;
    }
    try {
      if (localStorage.getItem('posr_docs_tableless_leak_recovered') === '1') {
        return;
      }
      localStorage.setItem('posr_docs_tableless_leak_recovered', '1');
    } catch {
      return;
    }
    setState((prev) => {
      if (prev.hideTableSelection !== true) {
        return prev;
      }
      return {
        ...prev,
        hideTableSelection: false,
        showFloor: true,
        showPersons: false,
      };
    });
  }, [docsTableless, setState]);

  useEffect(() => {
    // Product tableless mode only (not docs query). Resort guest entry skips this.
    if (resortFb) {
      return;
    }
    if (!hideTableSelectionSetting || state.showFloor !== true || enforcement.orderTakingBlocked) {
      return;
    }

    setState(prev => ({
      ...prev,
      showFloor: false,
      showPersons: false,
      table: undefined,
      order: {id: 'new', order: undefined},
      cart: [],
      floor: prev.floor ?? settings.floors[0],
      orderType: prev.orderType ?? settings.order_types[0],
    }));

    setSettings(prev => ({
      ...prev,
      categories: prev.categories.filter(item => item.show_in_menu !== false),
    }));
  }, [
    enforcement.orderTakingBlocked,
    hideTableSelectionSetting,
    setSettings,
    setState,
    settings.floors,
    settings.order_types,
    state.showFloor,
    resortFb,
  ]);

  const tablelessOrdersLiveRef = useRef<{kill: () => Promise<void>} | null>(null);

  useEffect(() => {
    // Live tableless order list only for product setting (not docs-only flag).
    // Resort guest mode loads orders per guest instead.
    if (!hideTableSelectionSetting || resortFb) {
      return;
    }

    let cancelled = false;

    const fetchTablelessOrders = async () => {
      const [rows] = await db.query<Order[]>(
        `SELECT * FROM ${Tables.orders}
         WHERE status = $status AND table = none
         ORDER BY created_at ASC
         FETCH customer, items, items.item, order_type, table, user`,
        {status: OrderStatus["In Progress"]}
      );

      if (cancelled) {
        return;
      }

      const orders = Array.isArray(rows) ? rows : [];

      setState(prev => {
        const prevIds = prev.orders.map(order => order.id?.toString()).join(',');
        const nextIds = orders.map(order => order.id?.toString()).join(',');
        if (prevIds === nextIds) {
          return prev;
        }

        return {
          ...prev,
          orders,
        };
      });
    };

    const setup = async () => {
      await fetchTablelessOrders();
      if (cancelled) {
        return;
      }

      const subscription = await db.live(Tables.orders, () => {
        void fetchTablelessOrders();
      });

      if (cancelled) {
        await subscription.kill().catch(() => undefined);
        return;
      }

      tablelessOrdersLiveRef.current = subscription;
    };

    void setup();

    return () => {
      cancelled = true;
      tablelessOrdersLiveRef.current?.kill().catch(() => undefined);
      tablelessOrdersLiveRef.current = null;
    };
  }, [db, hideTableSelectionSetting, resortFb, setState]);

  useEffect(() => {
    if (!enforcement.orderTakingBlocked || state.showFloor) {
      return;
    }

    const returnToFloor = async () => {
      if (state.table?.id) {
        try {
          await db.merge(toRecordId(state.table.id), {
            is_locked: false,
            locked_at: null,
            locked_by: null,
          });
        } catch (error) {
          console.error("Failed to release table lock:", error);
        }
      }

      setState(prev => ({
        ...prev,
        showFloor: true,
        showPersons: false,
        orderType: undefined,
        cart: [],
        order: undefined,
        orders: hideTableSelectionSetting ? prev.orders : [],
        customer: undefined,
        table: undefined,
        switchTable: false,
      }));

      if (enforcement.message) {
        setAlert(prev => ({
          ...prev,
          message: enforcement.message!,
          type: "warning",
          opened: true,
        }));
      }
    };

    void returnToFloor();
  }, [
    db,
    enforcement.message,
    enforcement.orderTakingBlocked,
    hideTableSelectionSetting,
    setAlert,
    setState,
    state.showFloor,
    state.table?.id,
  ]);

  // Docs capture: never force persisted showFloor/persons off — only branch UI here.
  const showGuestLookup =
    resortFb &&
    !resortFloorMode &&
    (state.showFloor === true || !state.customer?.id);
  const showFloorLayout =
    !docsTableless &&
    state.showFloor === true &&
    !hideTableSelectionSetting &&
    (!resortFb || resortFloorMode);
  const showPersonsLayout = !docsTableless && !showGuestLookup && state.showPersons === true;

  const screen = useMemo(() => {
    if (showGuestLookup) {
      return <GuestLookup/>;
    }

    if (showFloorLayout) {
      return <FloorLayout/>;
    }

    if (showPersonsLayout) {
      return <MenuPersons/>;
    }

    return (
      <div className="grid grid-cols-[minmax(0,1fr)_440px] gap-3 pl-3 h-[100vh] overflow-hidden" data-testid="menu-page">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="mb-3 flex h-[70px] shrink-0 items-center gap-3">
            <MenuHeader/>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="menu-dishes">
            <MenuDishes/>
          </div>
        </div>
        <div className="bg-white rounded-xl flex flex-col h-full min-h-0 overflow-hidden" data-testid="menu-cart">
          <MenuCart/>
        </div>
      </div>
    )

  }, [showFloorLayout, showPersonsLayout, showGuestLookup]);

  const isMenuOrderingScreen = !showFloorLayout && !showPersonsLayout && !showGuestLookup;

  return (
    <Layout
      overflowHidden={isMenuOrderingScreen}
      containerClassName={isMenuOrderingScreen ? "overflow-hidden" : undefined}
      showSidebar={showFloorLayout || showPersonsLayout || showGuestLookup || tablelessMode || docsTableless}
    >
      <DocumentTitle parts={[tNav('sidebar.menu')]} />
      {screen}
    </Layout>
  );
}
