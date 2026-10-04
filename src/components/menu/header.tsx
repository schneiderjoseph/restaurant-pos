import {useAtom} from "jotai";
import {appSettings, appState, closingEnforcementAtom} from "@/store/jotai.ts";
import {orderEditSessionAtom, orderIdToString} from "@/store/order-edit-session.ts";
import {Button} from "@/components/common/input/button.tsx";
import {faArrowLeft, faPlus, faTable, faTimes, faUser, faUsers} from "@fortawesome/free-solid-svg-icons";
import {cn, toRecordId} from "@/lib/utils.ts";
import React, {useEffect, useRef, useState} from "react";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {useDB} from "@/api/db/db.ts";
import {useDatabase} from "@/hooks/useDatabase.ts";
import {MenuItemType} from "@/api/model/cart_item.ts";
import {orderToCartItems, seatsFromOrder} from "@/lib/order-edit.ts";
import {Payment} from "@/components/payment/payment.tsx";
import {Customers} from "@/components/customer/customer.tsx";
import {formatOrderNumber, getInvoiceNumber} from "@/lib/order.ts";
import {formatGuestLabel, guestCodeLabel} from "@/lib/guest.ts";
import {useResortFb} from "@/hooks/useResortFb.ts";
import ScrollContainer from "react-indiana-drag-scroll";
import { nowSurrealDateTime } from "@/lib/datetime.ts";
import {toast} from "sonner";
import {useTranslation} from "react-i18next";
import i18n from "@/lib/i18n.ts";

export const MenuHeader = () => {
  const db = useDB();
  const {isEffectivelyConnected} = useDatabase();
  // Live value for the heartbeat interval below (its closure outlives renders).
  const connectedRef = useRef(isEffectivelyConnected);
  connectedRef.current = isEffectivelyConnected;
  const { t } = useTranslation('menu');

  const [state, setState] = useAtom(appState);
  const [editSession] = useAtom(orderEditSessionAtom);
  const [, setEditSession] = useAtom(orderEditSessionAtom);
  const [setting] = useAtom(appSettings);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const orderTakingBlocked = enforcement.orderTakingBlocked;
  const hideTableSelection = state.hideTableSelection === true;
  const {enabled: resortFb} = useResortFb();
  const skipTableUi = hideTableSelection || (resortFb && state.resortEntry !== 'floor');
  const [customerModal, setCustomerModal] = useState(false);
  const [confirmCartAction, setConfirmCartAction] = useState(false);

  useEffect(() => {
    if (!state.orderType) {
      setState(prev => ({
        ...prev,
        orderType: setting?.order_types[0]
      }))
    }
  }, [setting?.order_types, state.orderType]);

  useEffect(() => {
    // load old items into cart — skip when edit session already hydrated the cart
    if (state?.order?.id === 'new' || state.orders.length === 0) {
      return;
    }
    if (editSession && (state.cart?.length ?? 0) > 0) {
      return;
    }
    onOrderClick(state?.order?.id);
  }, [state.orders, state?.order?.id, editSession?.orderId]);

  useEffect(() => {
    if (!state.table?.id) {
      return;
    }

    const heartBeat = async () => {
      // A lock refresh only matters now: skip it offline rather than queue it
      // (queued heartbeats piled up by the hundreds and replayed stale times).
      if (!connectedRef.current) {
        return;
      }
      await db.merge(toRecordId(state.table.id), {
        locked_at: nowSurrealDateTime()
      })
    }

    const timer = setInterval(heartBeat, 10000);

    return () => clearInterval(timer);
  }, [state.table?.id])

  const reset = async () => {
    // check if cart has any new items

    if (state.cart.filter(item => item.newOrOld === MenuItemType.new).length > 0) {
      setConfirmCartAction(true);
      return false;
    }

    if (state.table?.id) {
      await db.merge(state.table.id, {
        is_locked: false,
        locked_at: null,
        locked_by: null
      });
    }

    setEditSession(null);
    setState(prev => ({
      ...prev,
      orderType: undefined,
      showFloor: true,
      persons: '1',
      cart: [],
      order: undefined,
      orders: [],
      customer: undefined,
      table: undefined,
      resortEntry: resortFb
        ? (prev.resortEntry === 'floor' ? 'floor' : 'guest')
        : prev.resortEntry,
    }));
  }

  const onOrderClick = (key: string | unknown) => {
    if (key === 'new') {
      if (orderTakingBlocked) {
        toast.warning(enforcement.message ?? i18n.t('closing:orderTakingDisabled'));
        return;
      }

      setState(prev => ({
        ...prev,
        order: {
          id: 'new',
          order: undefined
        },
        dueAt: undefined,
        cart: []
      }))
      return;
    }

    const keyStr = orderIdToString(key);
    const order =
      state.orders.find((item) => orderIdToString(item.id) === keyStr) ??
      (orderIdToString(state.order?.order?.id) === keyStr ? state.order?.order : undefined) ??
      (editSession && editSession.orderId === keyStr ? editSession.order : undefined);

    if (!order) {
      // Don't wipe a hydrated cart when id formats don't match yet.
      return;
    }

    const seatsArray = seatsFromOrder(order);
    const cart = orderToCartItems(order);
    const noSeat = cart.some((item) => item.seat === undefined || item.seat === null || item.seat === '');

    setState((prev) => ({
      ...prev,
      order: {
        order,
        id: keyStr || orderIdToString(order.id) || String(order.id),
      },
      cart,
      seats: seatsArray,
      // Unseated lines only show when seat is undefined (cart filters by exact seat).
      seat: noSeat ? undefined : (seatsArray.length > 0 ? seatsArray[0] : undefined),
      customer: order?.customer ?? prev.customer,
    }));
  }

  const switchTable = async () => {
    setState(prev => ({
      ...prev,
      showFloor: true,
      switchTable: true
    }));

    // release table
    await db.merge(state.table.id, {
      is_locked: false,
      locked_at: null,
      locked_by: null
    });
  }

  const openPersons = async () => {
    setState(prev => ({
      ...prev,
      showPersons: true,
    }));
  }

  const newCartItems = state?.cart?.filter(item => item.newOrOld === MenuItemType.new).length;

  const clear = async () => {
    setState(prev => ({
      ...prev,
      seats: [],
      cart: prev.cart.filter(item => item.newOrOld === MenuItemType.old),
      seat: undefined
    }));
  }

  const backFloorLabel = state?.floor?.name ?? '';
  const backGuestLabel = state.resortEntry === 'floor'
    ? (state?.floor?.name ?? t('guest.openFloor'))
    : t('guest.title');
  const customerLabel = state?.customer
    ? formatGuestLabel(state.customer)
    : t('header.customer');
  const personsCount = Number(state?.persons) || 0;
  const personsLabel = t('header.pax', { count: personsCount });

  return (
    <>
      <div className="flex items-center justify-between gap-2 w-full min-w-0 overflow-hidden" data-testid="menu-header">
        <div className="flex items-center gap-2 shrink-0">
          {!skipTableUi && !resortFb && (
            <Button
              variant="primary"
              icon={faArrowLeft}
              onClick={reset}
              size="lg"
              iconButton
              aria-label={backFloorLabel}
              title={backFloorLabel}
              data-testid="menu-back-floor"
            />
          )}
          {resortFb && (
            <Button
              variant="primary"
              icon={faArrowLeft}
              onClick={reset}
              size="lg"
              iconButton
              aria-label={backGuestLabel}
              title={backGuestLabel}
              data-testid="menu-back-guest"
            />
          )}
          {state?.orders?.length > 0 ? (
            <>
              <ScrollContainer className="max-w-[300px] flex flex-nowrap gap-3">
                <div className="input-group" data-testid="menu-order-tabs">
                  {state?.orders?.map((order, index) => {
                    const orderAria = t('header.orderNumber', { number: getInvoiceNumber(order) });
                    return (
                      <Button
                        key={index}
                        variant="primary"
                        onClick={() => onOrderClick(order.id)}
                        flat
                        size="lg"
                        active={state?.order?.id?.toString() === order?.id.toString()}
                        aria-label={orderAria}
                        title={orderAria}
                      >
                        {formatOrderNumber(order)}
                      </Button>
                    );
                  })}
                </div>
              </ScrollContainer>
              <Button
                active={state?.order?.id === MenuItemType.new}
                variant="primary"
                flat
                size="lg"
                iconButton
                disabled={orderTakingBlocked}
                onClick={() => onOrderClick('new')}
                icon={faPlus}
                aria-label={t('header.newOrder')}
                title={t('header.newOrder')}
                data-testid="menu-new-order"
              />
            </>
          ) : null}

          {!skipTableUi && !resortFb && (
            <Button
              type="button"
              className="btn btn-primary lg btn-flat min-w-[50px]"
              onClick={switchTable}
              icon={faTable}
              data-testid="menu-table"
            >{state?.table?.name}{state?.table?.number}</Button>
          )}
          <Button type="button"
                  className="btn btn-primary lg btn-flat"
                  onClick={openPersons}
                  icon={faUsers}
                  aria-label={personsLabel}
                  title={personsLabel}
                  data-testid="menu-persons"
          >
            {personsCount}
          </Button>

          <div className="input-group">
            <Button
              flat
              variant="primary"
              size="lg"
              iconButton
              icon={faUser}
              active={!!state?.customer}
              onClick={() => setCustomerModal(true)}
              aria-label={customerLabel}
              title={customerLabel}
              data-testid="menu-customer"
            />
          </div>
          {state.cart.filter(item => item.newOrOld === MenuItemType.new).length > 0 && (
            <Button
              variant="danger"
              size="lg"
              iconButton
              icon={faTimes}
              onClick={clear}
              aria-label={t('header.clear')}
              title={t('header.clear')}
              data-testid="menu-clear-cart"
            />
          )}
        </div>

        <div className="flex input-group rounded-full shrink-0" data-testid="menu-order-types">
          {setting?.order_types?.map((item, index) => (
            <Button
              variant="primary"
              size="lg"
              className={cn(
                "flex-1",
                index === 0 && '!rounded-l-lg',
                index === setting?.order_types?.length - 1 && ' !rounded-r-lg'
              )}
              active={item.id.toString() === state?.orderType?.id?.toString()}
              onClick={() => {
                setState(prev => ({
                  ...prev,
                  orderType: item
                }))
              }}
              key={index}
              flat
              data-testid={`menu-order-type-${index}`}
            >
              {item.name}
            </Button>
          ))}
        </div>
      </div>
      <Modal
        open={customerModal}
        onClose={() => {
          setCustomerModal(false)
        }}
        title={state?.customer?.name || t('header.selectCustomer')}
        size="md"
      >
        {state?.customer && (
          <div
            className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-1"
            data-testid="menu-customer-info"
          >
            <div className="font-semibold text-lg">{formatGuestLabel(state.customer)}</div>
            {state.customer.guest_code && state.customer.name?.trim() ? (
              <div className="text-sm text-neutral-600">#{guestCodeLabel(state.customer)}</div>
            ) : null}
            {state.customer.room ? (
              <div className="text-sm text-neutral-600">
                {t('guest.room')} {state.customer.room}
              </div>
            ) : null}
            {state.customer.phone != null && String(state.customer.phone).trim() ? (
              <div className="text-sm text-neutral-600">
                {t('guest.phone')} {String(state.customer.phone).trim()}
              </div>
            ) : null}
            {state.customer.email?.trim() ? (
              <div className="text-sm text-neutral-600">{state.customer.email.trim()}</div>
            ) : null}
          </div>
        )}
        <Customers onAttach={() => {
          setCustomerModal(false)
        }}/>
      </Modal>

      {confirmCartAction && (
        <Modal
          open={confirmCartAction}
          onClose={() => {
            setConfirmCartAction(false)
          }}
          title={t('header.confirmTitle')}
          size="sm"
        >
          <div className="alert alert-danger">
            {t('header.confirmCartMessage', { count: newCartItems })}
          </div>
          <Payment/>
        </Modal>
      )}
    </>
  )
}
