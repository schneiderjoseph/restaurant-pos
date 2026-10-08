import {Button} from "@/components/common/input/button.tsx";
import {faCancel, faCheck, faClock, faTimes} from "@fortawesome/free-solid-svg-icons";
import React, {useEffect, useMemo, useRef, useState} from "react";
import {useAtom, useAtomValue} from "jotai";
import {appDuo, appPage, appSettings, appState, closingEnforcementAtom} from "@/store/jotai.ts";
import {resolveOutlet} from "@/lib/outlet.ts";
import {orderEditSessionAtom} from "@/store/order-edit-session.ts";
import {calculateCartItemNetTotal} from "@/lib/cart.ts";
import {sameCustomer} from "@/lib/customer.service.ts";
import {buildOrderItemPayload} from "@/lib/order-item-pricing.ts";
import {syncOrderTaxes} from "@/lib/order-tax.service.ts";
import {orderAutoExtras, syncOrderAutoExtras} from "@/lib/order-auto-extras.ts";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Extra} from "@/api/model/extra.ts";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {
  Order,
  ORDER_FETCHES,
  ORDER_PAYMENT_FETCHES,
  OrderStatus,
  parseOrderQueryResult,
} from "@/api/model/order.ts";
import {OrderTotals, CartTotals} from "@/components/orders/order.totals.tsx";
import {toRecordId} from "@/lib/utils.ts";
import {StringRecordId} from "surrealdb";
import {MenuItemType} from "@/api/model/cart_item.ts";
import {dispatchPrint} from "@/lib/print.service.ts";
import {DiscountType} from "@/api/model/discount.ts";
import {assertOrderTakingAllowed} from "@/lib/closing.guard.ts";
import {toast} from "sonner";
import {generateNextInvoiceNumber, getNextAutoId} from "@/lib/invoice.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {cancelItemStages, createStageRows, kitchenFireTime} from "@/lib/kitchen/workflow.service.ts";
import {nowInAppTimezone, nowSurrealDateTime, toLuxonDateTime, toSurrealDateTime} from "@/lib/datetime.ts";
import {formatDueLabel, isDueAhead} from "@/lib/order-due.ts";
import {OrderDueModal} from "@/components/menu/order-due.modal.tsx";
import {useTranslation} from "react-i18next";
import {DateTime} from "luxon";
import {
  publishCustomerCreated,
  publishOrderCreated,
} from "@/integrations/events/index.ts";
import { entityAfterWrite } from "@/integrations/events/publish/entity.ts";
import {
  formatKitchenGuestLabel,
  formatKitchenPlaceLabel,
  type KitchenGuestLabelMode,
} from "@/lib/kitchen-ticket-label.ts";
import {OrderVoidReason} from "@/api/model/order_void.ts";
import {orderIdToString} from "@/store/order-edit-session.ts";
import {fetchUserModules, userModulesGrant} from "@/lib/access.rules.ts";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";
import {createOrderEditRequest, diffSentLines, refKey, sentItemsEditMode} from "@/lib/order-edit-request.ts";
import {duoMemberIds} from "@/lib/duo.ts";
import {getCustomerTaxExemptionIds} from "@/lib/tax-calculator.ts";

export const Payment = () => {
  const {t} = useTranslation(["payment", "toast", "kitchen", "menu"]);
  const db = useDB();
  const [state, setState] = useAtom(appState);
  const [editSession, setEditSession] = useAtom(orderEditSessionAtom);
  const [page] = useAtom(appPage);
  const [settings] = useAtom(appSettings);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const duo = useAtomValue(appDuo);
  const orderTakingBlocked = enforcement.orderTakingBlocked;
  const {can} = useModuleAccess();

  const [isLoading, setLoading] = useState(false);
  /** Sync re-entry guard: React isLoading alone cannot stop double-click before re-render. */
  const createInFlightRef = useRef(false);
  const [order, setOrder] = useState<Order>();
  const [dueOpen, setDueOpen] = useState(false);

  // An exempt customer's order starts without those taxes, from the cart on.
  const customerExemptTaxIds = useMemo(
    () => getCustomerTaxExemptionIds(state?.customer),
    [state?.customer],
  );

  // When the order is wanted: the server's choice, else what an existing order already holds.
  const storedDueAt = order?.due_at ?? state?.order?.order?.due_at;
  const dueAt: string | null = state.dueAt !== undefined
    ? state.dueAt
    : (storedDueAt ? toLuxonDateTime(storedDueAt).toUTC().toISO() : null);
  const dueChanged = state.dueAt !== undefined;

  /** Value written to `order.due_at`: a time already past is stored as "as soon as possible". */
  const dueAtForSave = () => {
    const due = dueAt ? toLuxonDateTime(dueAt) : null;
    return isDueAhead(due, nowInAppTimezone()) ? toSurrealDateTime(due) : null;
  };

  /** An existing order whose cart did not change still gets its new due time. */
  const saveDueAtOnly = async () => {
    if (!dueChanged || !state?.order?.id || state.order.id === 'new') {
      return;
    }
    await db.merge(toRecordId(state.order.id), {due_at: dueAtForSave()});
  };

  const total = useMemo(() => {
    return state.cart.reduce((prev, item) => {
      if (!item.deleted_at) {
        return prev + calculateCartItemNetTotal(item);
      }

      return prev;
    }, 0);
  }, [state.cart]);

  const cartItemCount = useMemo(() => {
    return state.cart.filter(item => !item.deleted_at).length;
  }, [state.cart]);

  const fetchOrderForPayment = async (orderId: unknown): Promise<Order | undefined> => {
    const id = toRecordId(orderId);
    const runQuery = async (fetches: string[]) => {
      const onlyResult = await db.query(
        `SELECT * FROM ONLY ${id} FETCH ${fetches.join(", ")}`
      );
      const parsed = parseOrderQueryResult(onlyResult);
      if (parsed?.items) {
        return parsed;
      }

      const legacyResult = await db.query(
        `SELECT * FROM ${id} FETCH ${fetches.join(", ")}`
      );
      return parseOrderQueryResult(legacyResult);
    };

    try {
      const full = await runQuery(ORDER_FETCHES);
      if (full) {
        return full;
      }
    } catch (error) {
      console.warn('Full order fetch failed, retrying with payment fetches', error);
    }

    return runQuery(ORDER_PAYMENT_FETCHES);
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (state?.order?.id !== 'new') {
        const freshOrder = await fetchOrderForPayment(state?.order?.id);
        if (!cancelled) {
          setOrder(freshOrder);
        }
      } else {
        setOrder(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state?.order?.id]);

  const hasNewCartItems = () =>
    state.cart.some((item) => item.newOrOld === MenuItemType.new && !item.deleted_at);

  const isPersistedCartItem = (item: { id?: unknown; newOrOld?: MenuItemType }) =>
    item.newOrOld === MenuItemType.old || item.id?.toString().includes('order_item:');

  const originalOrderItems = () =>
    editSession?.order?.items ?? state.order?.order?.items ?? [];

  /** What the cart changed on lines the order already holds (quantity, removal, comment, options). */
  const sentLineChanges = () =>
    state?.order?.id === 'new' ? [] : diffSentLines(originalOrderItems(), state.cart);

  const hasPersistedCartEdits = () => sentLineChanges().length > 0;

  /** The role is read again from the database, as `protectAction` does. */
  const fetchSentItemsEditMode = async () => {
    const modules = await fetchUserModules(db, page?.user);
    return sentItemsEditMode((module) => userModulesGrant(modules, module));
  };

  const hasCartChangesToPersist = () => hasNewCartItems() || hasPersistedCartEdits();

  const softVoidPersistedItem = async (itemId: string, quantity: number) => {
    const now = nowSurrealDateTime();
    const itemRef = toRecordId(itemId);
    await db.merge(itemRef, { deleted_at: now });
    await cancelItemStages(db, itemId);
    if (page?.user?.id && state?.order?.id && state.order.id !== 'new') {
      try {
        await db.create(Tables.order_voids, {
          comments: 'POS order edit',
          created_at: now,
          deleted_by: toRecordId(page.user.id),
          logged_in_user: toRecordId(page.user.id),
          order: toRecordId(state.order.id),
          quantity,
          reason: OrderVoidReason.PunchByMistake,
          items: [itemRef],
        });
      } catch (error) {
        console.error('Failed to record void for edited line', error);
      }
    }
  };

  const createOrder = async () => {
    const isNewOrder = state?.order?.id === 'new';
    const hasNewItems = hasNewCartItems();
    const hasOldEdits = hasPersistedCartEdits();

    // Existing order with no cart mutations: nothing to persist.
    if (!isNewOrder && !hasNewItems && !hasOldEdits) {
      return state?.order?.order ?? { id: state?.order?.id };
    }

    // Hard re-entry guard (sync) before any await / setState.
    // Callers must not treat this as success (e.g. do not reset cart).
    if (createInFlightRef.current) {
      return 'busy' as const;
    }
    createInFlightRef.current = true;
    setLoading(true);

    let orderObj: any;

    try {
      await assertOrderTakingAllowed(db);

      // order.order_type is a required record: fail before any write, otherwise
      // order items and kitchen rows are created for an order that never exists.
      if (isNewOrder && !state?.orderType?.id) {
        throw new Error(t("payment:errors.noOrderType"));
      }

      const date = DateTime.now().toJSDate();

      // Changing a line already sent takes the right to; without it the lines stay as sent
      // and the changes wait for an approver. New lines are saved and sent either way.
      const changes = sentLineChanges();
      const awaitsApproval = changes.length > 0 && (await fetchSentItemsEditMode()) === 'request';

      const kitchenItems: Record<string, any[]> = {};
      const items: any[] = [];
      const newItemIds: any[] = [];
      // One kitchen time for the whole send, so the KDS shows it as one ticket.
      const firedAt = await kitchenFireTime(db);

      for (const item of state.cart) {
        if (isPersistedCartItem(item)) {
          if (awaitsApproval) {
            if (!item.deleted_at) {
              await db.merge(toRecordId(item.id), {
                seat: item.seat,
                is_suspended: item.isHold,
                updated_at: date,
              });
            }
            items.push(toRecordId(item.id));
            continue;
          }

          if (item.deleted_at) {
            await softVoidPersistedItem(
              orderIdToString(item.id) || String(item.id),
              Number(item.quantity) || 1,
            );
            continue;
          }

          const pricing = buildOrderItemPayload(item);
          await db.merge(toRecordId(item.id), {
            quantity: item.quantity,
            comments: item.comments,
            modifiers: pricing.modifiers,
            price: pricing.price,
            tax: pricing.tax,
            tax_mode: pricing.tax_mode,
            seat: item.seat,
            is_suspended: item.isHold,
            updated_at: date,
          });
          items.push(toRecordId(item.id));
          continue;
        }

        const pricing = buildOrderItemPayload(item);
        const itemData: any = {
          tax: pricing.tax,
          item: new StringRecordId(item.dish.id.toString()),
          price: pricing.price,
          quantity: item.quantity,
          position: 0,
          comments: item.comments,
          service_charges: 0,
          discount: 0,
          modifiers: pricing.modifiers,
          seat: item.seat,
          is_suspended: item.isHold,
          level: item.level,
          category: item.category,
          category_id: item.category_id ? toRecordId(item.category_id) : null,
          is_addition: !isNewOrder,
          menu: item.menu_name,
          tax_mode: pricing.tax_mode,
          created_at: date,
          created_by: toRecordId(page?.user?.id),
        };

        if (pricing.original_price !== undefined) {
          itemData.original_price = pricing.original_price;
        }

        // Only set when picked, so a plain dish still saves on a DB without
        // migrations/2026_10_08_dish_variants_measure.surql.
        if (item.variant) {
          itemData.variant = item.variant;
        }
        if (item.measureQuantity != null) {
          itemData.measure_quantity = item.measureQuantity;
        }

        // Point of sale copied at the time of sale; left out when unclassified, which also
        // keeps this insert valid on a DB without migrations/2026_10_02_outlets.surql.
        const outlet = resolveOutlet(item, settings.categories ?? []);
        if (outlet) {
          itemData.outlet_id = toRecordId(outlet.id);
          itemData.outlet = outlet.name;
        }

        if (pricing.taxes && pricing.taxes.length > 0) {
          itemData.taxes = pricing.taxes.map(t => toRecordId(t.id));
        }

        const record = await db.create(Tables.order_items, itemData);
        items.push(record[0].id);
        newItemIds.push(record[0].id);

        // Held items stay off kitchen until Fire; route everything else now.
        if (!item.isHold) {
          await createStageRows(db, {
            orderItem: record[0],
            dish: item.dish,
            kitchenItems,
            firedAt,
          });
        }
      }

      // Soft-void originals removed from the cart entirely (not just marked deleted_at).
      if (!isNewOrder) {
        const keptIds = new Set(
          items.map((id) => orderIdToString(id)).filter(Boolean),
        );
        for (const orig of originalOrderItems()) {
          if (orig?.deleted_at) {
            continue;
          }
          const id = orderIdToString(orig.id);
          if (!id || keptIds.has(id)) {
            continue;
          }
          const stillInCart = state.cart.some(
            (c) => orderIdToString(c.id) === id,
          );
          if (stillInCart) {
            // Already handled via deleted_at branch above.
            continue;
          }
          if (awaitsApproval) {
            items.push(toRecordId(id));
            continue;
          }
          await softVoidPersistedItem(id, Number(orig.quantity) || 1);
        }
      }

      let customer = null;
      if (state?.customer && state.customer.id) {
        customer = toRecordId(state.customer.id);
      }

      if (state?.customer && state.customer.id === undefined) {
        // create customer and get id
        const [cus] = await db.insert(Tables.customers, {
          ...state.customer
        });

        customer = cus.id
        await publishCustomerCreated(undefined, {
          customerId: String(cus.id),
          name: state.customer.name,
          phone: state.customer.phone != null ? String(state.customer.phone) : undefined,
          email: state.customer.email != null ? String(state.customer.email) : undefined,
        });
        await entityAfterWrite({
          domain: 'pos',
          table: Tables.customers,
          entityId: String(cus.id),
          action: 'create',
          after: state.customer,
          source: 'payment',
        });
      }

      // Allocate invoice/auto ids only for brand-new orders (globally unique invoice_number).
      let invoiceNumber: number | undefined =
        state?.order?.order?.invoice_number ?? editSession?.order?.invoice_number;
      if (isNewOrder) {
        invoiceNumber = await generateNextInvoiceNumber(db);
      }

      const data: any = {
        floor: state?.floor?.id ? toRecordId(state.floor.id) : null,
        covers: parseInt(state?.persons) || 1,
        customer: customer,
        items: items,
        // NONE when tableless; never pass undefined (Surreal error "undefined doesn't exist")
        table: state?.table?.id ? toRecordId(state.table.id) : null,
        user: page?.user?.id ? toRecordId(page.user.id) : null,
      };

      // A customer left as loaded is not written back: the order may have been moved to
      // another client file meanwhile (lib/order-transfer.ts), and that move must stand.
      const loadedOrder = isNewOrder ? undefined : (editSession?.order ?? state?.order?.order);
      if (loadedOrder && (sameCustomer(loadedOrder.customer, customer) || (!loadedOrder.customer && !customer))) {
        delete data.customer;
      }

      // In a duo, the order is the duo's: its lines count for whichever of the two added them.
      // An order of the partner stays theirs when this user changes it.
      if (duo) {
        const members = duoMemberIds(duo);
        const [storedOwner] = isNewOrder
          ? [null]
          : await db.query(`SELECT VALUE user FROM ONLY $id`, {id: toRecordId(state?.order?.id)});
        if (isNewOrder || members.includes(refKey(storedOwner))) {
          data.duo = toRecordId(refKey(duo));
          if (!isNewOrder) {
            data.user = storedOwner;
          }
        }
      }

      // Required field: on an existing order with no type in state, keep the stored one.
      if (state?.orderType?.id) {
        data.order_type = toRecordId(state.orderType.id);
      }

      // An order being edited keeps its stored time unless the server changed it.
      if (isNewOrder || dueChanged) {
        data.due_at = dueAtForSave();
      }

      if (isNewOrder) {
        data.tax = null;
        data.tax_amount = 0;
        data.tags = ['Normal'];
        data.discount = null;
        data.discount_amount = 0;
        data.status = OrderStatus["In Progress"];
        data.invoice_number = invoiceNumber;
        data.service_charge = 0;
        data.service_charge_amount = 0;
        data.service_charge_type = DiscountType.Percent;
        data.excluded_taxes = customerExemptTaxIds.map((id) => toRecordId(id));
      }

      if (isNewOrder && state?.orderType?.allow_service_charges) {
        const [serviceChargeSettingResult] = await db.query(
          `SELECT *
           FROM ${Tables.settings}
           WHERE key = $key AND is_global = true LIMIT 1 FETCH
           values`,
          {key: "service_charges"}
        );
        const serviceChargeSetting = serviceChargeSettingResult.length > 0 ? serviceChargeSettingResult?.[0]?.values : null;
        const defaultTypeRaw = serviceChargeSetting?.type?.value ?? serviceChargeSetting?.type;
        const defaultValueRaw = serviceChargeSetting?.value?.value ?? serviceChargeSetting?.value;
        const normalizedType = String(defaultTypeRaw || DiscountType.Percent);
        const normalizedValue = Number(defaultValueRaw || 0);

        data.service_charge = normalizedValue;
        data.service_charge_type = normalizedType;
        data.service_charge_amount = normalizedType === DiscountType.Fixed ? normalizedValue : (total * normalizedValue / 100);
      }

      if (isNewOrder) {
        data.auto_id = await getNextAutoId(db);
        data.created_at = date;
        orderObj = await db.create(Tables.orders, data);

        for (const item of newItemIds) {
          await db.merge(item, {
            order: orderObj[0].id
          });
        }
      } else {
        data.updated_at = date;

        orderObj = await db.merge(toRecordId(state?.order?.id), data);

        for (const item of newItemIds) {
          await db.merge(item, {
            order: orderObj.id
          });
        }
      }

      const normalizedOrder = isNewOrder ? orderObj[0] : orderObj;
      await syncOrderTaxes(db, toRecordId(normalizedOrder?.id));
      // Room service and the like: extras of the order type / table go on the order now,
      // so the pre-bill carries them before payment.
      await syncOrderAutoExtras(db, normalizedOrder?.id, {
        orderTypeId: state?.orderType?.id?.toString() ?? normalizedOrder?.order_type?.toString(),
        tableId: state?.table?.id?.toString(),
      });

      postOrderTracking({
        module: isNewOrder ? t("payment:tracking.createOrder") : t("payment:tracking.appendOrder"),
        page: page?.page,
        orderId: normalizedOrder?.id,
        payload: {
          table: state?.table?.id?.toString(),
          items_count: items.length,
          is_new_order: isNewOrder,
        },
        user: page?.user,
      });

      if (awaitsApproval) {
        await createOrderEditRequest(db, {
          orderId: normalizedOrder?.id,
          requestedBy: page?.user?.id,
          changes,
        });
        toast.info(t("payment:editRequest.sent"));
      }

      if (isNewOrder && normalizedOrder?.id) {
        await publishOrderCreated(undefined, {
          orderId: String(normalizedOrder.id),
          invoiceNumber: normalizedOrder.invoice_number,
          orderTypeId: state?.orderType?.id ? String(state.orderType.id) : undefined,
          tableId: state?.table?.id ? String(state.table.id) : undefined,
          customerId: customer ? String(customer) : undefined,
          itemCount: items.length,
          createdBy: page?.user?.id ? String(page.user.id) : undefined,
        });
        await entityAfterWrite({
          domain: 'pos',
          table: Tables.orders,
          entityId: String(normalizedOrder.id),
          action: 'create',
          after: {
            invoice_number: normalizedOrder.invoice_number,
            status: OrderStatus["In Progress"],
          },
          source: 'payment',
          changedBy: page?.user?.id ? String(page.user.id) : undefined,
        });
      }

      const hasKitchenPrintItems = Object.keys(kitchenItems).length > 0;
      if (hasKitchenPrintItems) {
        const [kitchens]: any = await db.query(`SELECT *
                                                from ${Tables.kitchens}
                                                where deleted_at = none FETCH printers`);
        if (kitchens.length > 0) {
          for (const k of kitchens) {
            if (kitchenItems[k.id.toString()]) {
              void dispatchPrint(db, 'kitchen', {
                items: kitchenItems[k.id.toString()],
                order: {
                  ...normalizedOrder,
                  order_type: state?.orderType ?? normalizedOrder.order_type,
                  user: page?.user ?? normalizedOrder.user,
                  customer: state?.customer ?? normalizedOrder.customer,
                  table: state?.table ?? normalizedOrder.table,
                },
                kitchenName: k.name,
                table: state?.table,
                guestLabel: formatKitchenGuestLabel(
                  state?.customer ?? normalizedOrder.customer,
                  (page?.menuConfig?.kitchenGuestLabel ?? 'name') as KitchenGuestLabelMode,
                ),
                placeLabel: formatKitchenPlaceLabel(state?.table, {
                  room: t('kitchen:labels.room'),
                  table: t('kitchen:labels.table'),
                }),
                placeKind: state?.table?.source === 'asi-room' ? 'room' : 'table',
                isAddOn: !isNewOrder,
              }, {
                title: t("payment:print.kitchenTitle"),
                copies: 1,
                userId: page?.user?.id,
                printers: k.printers
              }).catch((error) => {
                console.error('Kitchen print dispatch failed', error);
              });
            }
          }
        }
      }

      return orderObj;
    } catch (e) {
      throw e;
    } finally {
      createInFlightRef.current = false;
      setLoading(false);
    }
  }

  const createOrderAndBack = async () => {
    try {
      if (hasCartChangesToPersist()) {
        const result = await createOrder();
        if (result === 'busy') {
          return;
        }
      } else {
        await saveDueAtOnly();
      }
      await reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("payment:errors.createOrder");
      setLoading(false);
      console.error(error);
      toast.error(message);
    }
  }

  const reset = async () => {
    if (state?.table?.id) {
      await db.merge(state.table.id, {
        is_locked: false,
        locked_by: null,
        locked_at: null
      });
    }

    // clear cart and go back to floor screen
    setEditSession(null);
    setState(prev => ({
      ...prev,
      cart: [],
      customer: undefined,
      dueAt: undefined,
      showFloor: true,
      table: undefined,
      persons: '1',
      orderType: undefined,
      order: {
        id: 'new',
        order: undefined
      }
    }));
  }

  const cancel = async () => {
    setState(prev => ({
      ...prev,
      seats: [],
      cart: prev.cart.filter(item => item.newOrOld === MenuItemType.old),
      seat: undefined
    }));

    await reset();
  }

  const clear = () => {
    setState(prev => ({
      ...prev,
      seats: [],
      cart: prev.cart.filter(item => item.newOrOld === MenuItemType.old),
      seat: undefined
    }));
  }

  const hasNewLines = state.cart.some(item => item.newOrOld === MenuItemType.new);

  // Extras of the order type / table (room service), in the footer before the order is sent.
  const {data: extrasCatalog} = useApi<SettingsData<Extra>>(Tables.extras, [], ["name asc"], 0, 99999, [
    "payment_types",
    "order_types",
    "tables",
  ]);
  const cartExtras = useMemo(() => orderAutoExtras(extrasCatalog?.data, {
    orderTypeId: state?.orderType?.id?.toString(),
    tableId: state?.table?.id?.toString(),
  }), [extrasCatalog, state?.orderType?.id, state?.table?.id]);

  return (
    <>
      <div className="font-bold">
        {order && (
          <>
            <div className="p-3">
              <OrderTotals order={order} cart={state.cart} />
            </div>
            <div className="h-[2px] separator"></div>
          </>
        )}
        {!order && (
          <div className="p-3">
            <CartTotals itemCount={cartItemCount} cart={state.cart} allowServiceCharges={state?.orderType?.allow_service_charges} excludedTaxIds={customerExemptTaxIds} extras={cartExtras} />
          </div>
        )}


        <div className="p-3" data-testid="cart-payment-actions">
          {hasPersistedCartEdits() && sentItemsEditMode(can) === 'request' && (
            <p className="mb-3 text-sm font-normal text-warning-700" data-testid="cart-edit-needs-approval">
              {t("payment:editRequest.notice")}
            </p>
          )}
          <Button
            variant={dueAt ? "warning" : "primary"}
            flat
            size="lg"
            className="w-full"
            icon={faClock}
            disabled={isLoading}
            data-testid="cart-due-at"
            onClick={() => setDueOpen(true)}
          >
            {dueAt
              ? t("payment:due.forTime", {
                  time: formatDueLabel(toLuxonDateTime(dueAt), nowInAppTimezone(), t("payment:due.tomorrowShort")),
                })
              : t("payment:due.asapButton")}
          </Button>
          <div className="flex gap-2 mt-3">
            <Button variant="success" className="flex-1 min-w-0 whitespace-nowrap" size="lg" icon={faCheck} onClick={createOrderAndBack}
                    disabled={isLoading || (cartItemCount === 0 && !hasPersistedCartEdits()) || orderTakingBlocked} isLoading={isLoading}
                    data-testid="cart-to-kitchen">{t("payment:actions.toKitchen")}</Button>
            <Button variant="danger" className="flex-1 min-w-0 whitespace-nowrap" size="lg" icon={faCancel} onClick={cancel}
                    disabled={isLoading} data-testid="cart-cancel">{t("payment:actions.cancel")}</Button>
            <Button variant="warning" className="flex-1 min-w-0 whitespace-nowrap" size="lg" icon={faTimes} onClick={clear}
                    disabled={isLoading || !hasNewLines} data-testid="menu-clear-cart">{t("menu:header.clear")}</Button>
          </div>
        </div>
      </div>
      {dueOpen && (
        <OrderDueModal
          value={dueAt}
          onChange={(value) => setState(prev => ({...prev, dueAt: value}))}
          onClose={() => setDueOpen(false)}
        />
      )}
    </>
  )
}
