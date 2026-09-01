import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faCopy, faSquareCheck} from "@fortawesome/free-regular-svg-icons";
import {faPause, faPlay, faTrash} from "@fortawesome/free-solid-svg-icons";
import {Dropdown, DropdownItem} from "@/components/common/react-aria/dropdown.tsx";
import React, {useMemo, useState} from "react";
import {useAtom} from "jotai";
import {appPage, appState} from "@/store/jotai.ts";
import {nanoid} from "nanoid";
import {MenuItemType} from "@/api/model/cart_item.ts";
import {useTranslation} from "react-i18next";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {toRecordId} from "@/lib/utils.ts";
import {createStageRows} from "@/lib/kitchen/workflow.service.ts";
import {dispatchPrint} from "@/lib/print.service.ts";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {nowSurrealDateTime} from "@/lib/datetime.ts";

export const CartActions = () => {
  const db = useDB();
  const [state, setState] = useAtom(appState);
  const [page] = useAtom(appPage);
  const { t } = useTranslation(['cart', 'payment', 'common']);
  const [selected, setSelected] = useState(false);

  const isEditingExisting =
    state.order?.id != null && String(state.order.id) !== 'new';

  const hasRemovableSelected = useMemo(() => {
    return state.cart.some((item) => {
      if (!item.isSelected || item.deleted_at) {
        return false;
      }
      return item.newOrOld === MenuItemType.new || isEditingExisting;
    });
  }, [state.cart, isEditingExisting]);

  const hasHoldItems = useMemo(() => {
    return state.cart.some(item => item.isSelected && item.isHold)
  }, [state.cart]);

  const onClickSeatItem = (seat: string) => {
    if( seat === 'new' ) {
      seat = nanoid();
      setState(prev => ({
        ...prev,
        seats: [
          ...prev.seats,
          seat
        ],
        seat: seat
      }));
    }

    setState(prev => ({
      ...prev,
      cart: prev.cart.map(cartItem => {
        if( cartItem.isSelected ) {
          cartItem.seat = seat;
          cartItem.isSelected = false;
        }

        return cartItem;
      })
    }))
  }

  const deleteSelectedCartItems = () => {
    const voidedAt = nowSurrealDateTime();
    setState((prev) => ({
      ...prev,
      cart: prev.cart
        .map((item) => {
          if (!item.isSelected) {
            return item;
          }
          if (item.newOrOld === MenuItemType.new) {
            return null;
          }
          if (isEditingExisting) {
            return {
              ...item,
              deleted_at: voidedAt as typeof item.deleted_at,
              isSelected: false,
            };
          }
          return item;
        })
        .filter((item): item is NonNullable<typeof item> => item != null),
    }));
  }

  const copySelectedCartItems = () => {
    const prevItems = [...state.cart];
    const newItems = [];
    prevItems.forEach(item => {
      if( item.isSelected ) {
        item.isSelected = false;
        if(item.newOrOld === MenuItemType.new){
          item.id = nanoid();
          newItems.push(item);
        }
      }
    });

    setState(prev => ({
      ...prev,
      cart: [
        ...prevItems.map(item => ({
          ...item,
          isSelected: false,
          id: item.newOrOld === MenuItemType.old ? item.id : nanoid()
        })),
        ...newItems,
      ]
    }))
  }

  const toggleCartItems = () => {
    setState(prev => ({
      ...prev,
      cart: prev.cart.map(cartItem => {
        if (cartItem.deleted_at) {
          return cartItem;
        }
        if (cartItem.newOrOld === MenuItemType.new || cartItem.isHold || isEditingExisting) {
          cartItem.isSelected = !selected;
        }

        return cartItem
      })
    }))

    setSelected(!selected);
  }

  const toggleHoldSelectedCartItems = () => {
    setState(prev => ({
      ...prev,
      cart: prev.cart.map(cartItem => {
        if( cartItem.isSelected ) {
          cartItem.isHold = !cartItem.isHold;
          cartItem.isSelected = false;
        }

        return cartItem;
      })
    }))
  }

  const fireSelectedCartItems = async () => {
    const heldSelected = state.cart.filter((item) => item.isSelected && item.isHold);
    if (heldSelected.length === 0) {
      return;
    }

    const kitchenItems: Record<string, any[]> = {};
    const firedIds = new Set(heldSelected.map((item) => item.id?.toString()));

    for (const item of heldSelected) {
      const itemId = item.id?.toString();
      if (!itemId?.includes('order_item:')) {
        continue;
      }

      const orderItemRef = toRecordId(itemId);
      await db.merge(orderItemRef, { is_suspended: false });

      const [countResult]: any = await db.query(
        `SELECT count() AS count FROM ${Tables.order_items_kitchen} WHERE order_item = $oi GROUP ALL`,
        { oi: orderItemRef }
      );
      const kitchenRowCount = Number(countResult?.[0]?.count ?? 0);

      if (kitchenRowCount === 0) {
        await createStageRows(db, {
          orderItem: {
            id: orderItemRef,
            quantity: item.quantity,
            comments: item.comments,
            seat: item.seat,
            price: item.price,
            modifiers: item.selectedGroups,
          },
          dish: item.dish,
          kitchenItems,
        });
      }
    }

    const hasKitchenPrintItems = Object.keys(kitchenItems).length > 0;
    if (hasKitchenPrintItems) {
      const order =
        state.order?.order ??
        (state.order?.id && state.order.id !== 'new'
          ? { id: state.order.id }
          : undefined);

      const [kitchens]: any = await db.query(
        `SELECT * FROM ${Tables.kitchens} WHERE deleted_at = none FETCH printers`
      );

      for (const k of kitchens ?? []) {
        const kitchenId = k.id.toString();
        if (!kitchenItems[kitchenId]) {
          continue;
        }

        void dispatchPrint(
          db,
          'kitchen',
          {
            items: kitchenItems[kitchenId],
            order: {
              ...order,
              order_type: state?.orderType ?? order?.order_type,
              user: page?.user ?? order?.user,
            },
            kitchenName: k.name,
            table: state?.table,
            isAddOn: true,
          },
          {
            title: t('payment:print.kitchenTitle'),
            copies: 1,
            userId: page?.user?.id,
            printers: k.printers,
          }
        ).catch((error) => {
          console.error('Kitchen print dispatch failed', error);
        });
      }
    }

    setState((prev) => ({
      ...prev,
      cart: prev.cart.map((cartItem) => {
        if (!firedIds.has(cartItem.id?.toString())) {
          return cartItem;
        }

        return {
          ...cartItem,
          isHold: false,
          isSelected: false,
        };
      }),
    }));
  }

  return (
    <div className="flex gap-3">
      <IconTooltipButton label={t('common:actions.selectAll')} size="lg" variant="primary" onClick={toggleCartItems}>
        <FontAwesomeIcon icon={faSquareCheck} size="lg"/>
      </IconTooltipButton>
      {hasRemovableSelected && (
        <>
          <span className="bg-neutral-400 h-[48px] w-[2px]"></span>
          <IconTooltipButton label={t('common:actions.copy')} size="lg" variant="primary" onClick={copySelectedCartItems}>
            <FontAwesomeIcon icon={faCopy} size="lg"/>
          </IconTooltipButton>
          <IconTooltipButton label={t('common:actions.remove')} size="lg" variant="danger" onClick={deleteSelectedCartItems}>
            <FontAwesomeIcon icon={faTrash} size="lg"/>
          </IconTooltipButton>
        </>
      )}


      {hasHoldItems ? (
        <IconTooltipButton label={t('common:actions.fire')} size="lg" variant="success" onClick={fireSelectedCartItems}>
          <FontAwesomeIcon icon={faPlay} size="lg"/>
        </IconTooltipButton>
      ) : (
        <IconTooltipButton label={t('common:actions.hold')} size="lg" variant="warning" onClick={toggleHoldSelectedCartItems}>
          <FontAwesomeIcon icon={faPause} size="lg"/>
        </IconTooltipButton>
      )}

      {hasRemovableSelected && (
        <Dropdown label={t('seats.seat')} btnSize="lg" onAction={onClickSeatItem}>
          {state.seats.map((seat, index) => (
            <DropdownItem id={seat} key={seat} className="min-w-[50px]">{index + 1}</DropdownItem>
          ))}
          <DropdownItem id="new" key="new" className="min-w-[50px]">{t('seats.newSeat')}</DropdownItem>
        </Dropdown>
      )}

    </div>
  )
}
