import React, {useMemo} from "react";
import {Button} from "@/components/common/input/button.tsx";
import {faTrash} from "@fortawesome/free-solid-svg-icons";
import {useAtom} from "jotai";
import {appState} from "@/store/jotai.ts";
import ScrollContainer from "react-indiana-drag-scroll";
import {CartItem} from "@/components/cart/cart.item.tsx";
import {CartItemGroup} from "@/components/cart/cart.item.group.tsx";
import {groupCartLines} from "@/lib/cart.ts";
import {Payment} from "@/components/payment/payment.tsx";
import {Seats} from "@/components/cart/seats.tsx";
import {CartActions} from "@/components/cart/cart.actions.tsx";
import {MenuItemType} from "@/api/model/cart_item.ts";
import {useTranslation} from "react-i18next";
import {newestLinesFirst} from "@/lib/order.ts";
import {useKitchenReadyLines} from "@/hooks/useKitchenReadyLines.ts";
import {kitchenOrderItemKey} from "@/lib/order-display.ts";

export const MenuCart = () => {
  const [state, setState] = useAtom(appState);
  const { t } = useTranslation('cart');

  const cartItems = useMemo(() => {
    const activeSeat = state.seat == null || state.seat === '' ? undefined : String(state.seat);
    return state.cart.filter((item) => {
      const itemSeat = item.seat == null || item.seat === '' ? undefined : String(item.seat);
      return itemSeat === activeSeat;
    });
  }, [state.cart, state.seat]);

  const isSelected = useMemo(() => {
    return state.cart.find(item => item.isSelected) !== undefined;
  }, [state.cart]);

  const newItems = useMemo(() => {
    return cartItems.filter(item => item.newOrOld === MenuItemType.new);
  }, [cartItems]);

  const newGroups = useMemo(() => groupCartLines(newItems), [newItems]);

  // Lines already sent, the latest sends first.
  const oldItems = useMemo(() => {
    return newestLinesFirst(cartItems.filter(item => item.newOrOld === MenuItemType.old));
  }, [cartItems]);

  // Every line of the order being edited (all seats), for the kitchen's "ready" marks.
  const sentLineIds = useMemo(() => (
    state.cart
      .filter(item => item.newOrOld === MenuItemType.old && !item.deleted_at)
      .map(item => kitchenOrderItemKey(item.id))
      .filter(Boolean)
  ), [state.cart]);
  const readyLines = useKitchenReadyLines(sentLineIds);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="cart-panel">
      <div className="p-3 flex-shrink-0" data-testid="cart-seats-or-actions">
        {isSelected ? (
          <CartActions/>
        ) : (
          <Seats/>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" data-testid="cart-items">
        {state.seat && cartItems.length === 0 && state.seats.length > 0 && (
          <div className="items-center flex justify-center h-[100px]">
            <Button variant="danger" size="lg" icon={faTrash} onClick={() => {
              setState(prev => ({
                ...prev,
                seats: prev.seats.filter(s => s !== state.seat),
              }));
              setState(prev => ({
                ...prev,
                seat: prev.seats.at(-1)
              }))
            }}>{t('seats.deleteSeat')}</Button>
          </div>
        )}
        <ScrollContainer className="h-full gap-1 flex flex-col select-none">
          {newGroups.map((group) => group.length > 1 ? (
            <CartItemGroup items={group} key={group[0].id}/>
          ) : (
            <CartItem item={group[0]} key={group[0].id}/>
          ))}
          {newItems.length > 0 && oldItems.length > 0 && (
            <div className="h-[2px] bg-neutral-900 my-1 rounded-full"></div>
          )}
          {oldItems.map((item) => (
            <CartItem item={item} key={item.id} ready={readyLines.has(kitchenOrderItemKey(item.id))}/>
          ))}
        </ScrollContainer>
      </div>
      <div className="flex-shrink-0" data-testid="cart-payment">
        <div className="h-[2px] separator"></div>
        <Payment/>
      </div>
    </div>
  );
}
