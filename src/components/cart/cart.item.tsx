import React, {useMemo, useState} from "react";
import {MenuItem, MenuItemType} from "@/api/model/cart_item.ts";
import {useAtom} from "jotai";
import {appState} from "@/store/jotai.ts";
import {cn} from "@/lib/utils.ts";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faMinus, faPencil, faPlus, faTrash, faComment} from "@fortawesome/free-solid-svg-icons";
import {MenuDishModifiers} from "@/components/menu/modifiers.tsx";
import {CartItemName} from "@/components/common/cart/cart.item.name.tsx";
import {useTranslation} from "react-i18next";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {VirtualKeyboard} from "@/components/common/input/virtual.keyboard.tsx";
import {calculateCartItemPrice} from "@/lib/cart.ts";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";

interface Props {
  item: MenuItem
  index: number
}

export const CartItem = ({ item, index }: Props) => {
  const { t } = useTranslation(['cart', 'common']);
  const [, setState] = useAtom(appState);
  const [isModifiersOpen, setModifiersOpen] = useState(false);
  const [isCommentKeyboardOpen, setCommentKeyboardOpen] = useState(false);
  const [commentText, setCommentText] = useState(item.comments || "");

  const lineTotal = useMemo(() => calculateCartItemPrice(item), [item]);

  const updateQuantity = (next: number) => {
    setState(prev => ({
      ...prev,
      cart: prev.cart.map((_item) =>
        item.id === _item.id ? { ..._item, quantity: Math.max(1, next) } : _item,
      ),
    }));
  };

  const isNew = item.newOrOld === MenuItemType.new;
  const canSelect = item.deleted_at === undefined && (isNew || item.isHold);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md cursor-pointer select-none px-2 py-1.5 min-h-[44px]",
          item.isSelected ? 'bg-neutral-300' : (
            item.isHold ? 'bg-warning-100' : 'bg-neutral-100'
          ),
          item.deleted_at && 'opacity-60',
        )}
        onClick={() => {
          if (canSelect) {
            setState(prev => ({
              ...prev,
              cart: prev.cart.map(ci =>
                ci.id === item.id ? { ...ci, isSelected: !ci.isSelected } : ci,
              ),
            }));
          }
        }}
      >
        {isNew ? (
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded bg-white border border-neutral-300 text-sm"
              aria-label={t('common:actions.remove')}
              onClick={() => {
                if (item.quantity <= 1) {
                  setState(prev => ({
                    ...prev,
                    cart: prev.cart.filter((_item) => _item.id !== item.id),
                  }));
                } else {
                  updateQuantity(item.quantity - 1);
                }
              }}
            >
              <FontAwesomeIcon icon={item.quantity <= 1 ? faTrash : faMinus} className="text-xs" />
            </button>
            <span className="min-w-[1.75rem] text-center text-sm font-bold tabular-nums">{item.quantity}</span>
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded bg-white border border-neutral-300 text-sm"
              aria-label={t('common:actions.add')}
              onClick={() => updateQuantity(item.quantity + 1)}
            >
              <FontAwesomeIcon icon={faPlus} className="text-xs" />
            </button>
          </div>
        ) : (
          <span className="shrink-0 min-w-[1.75rem] text-center text-sm font-bold tabular-nums bg-white rounded px-1">
            {item.quantity}
          </span>
        )}

        <div className={cn(
          "flex-1 min-w-0 text-sm leading-snug",
          item.deleted_at && 'line-through text-danger-500',
        )}>
          <CartItemName item={item} mainItem={item} />
        </div>

        <div className="shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
          <DualCurrency amount={lineTotal} primaryClassName="text-sm font-semibold" secondaryClassName="text-[10px]" />
        </div>

        {isNew && (
          <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
            {item?.selectedGroups?.length > 0 && (
              <IconTooltipButton label={t('common:actions.edit')}
                flat
                variant="primary"
                onClick={() => setModifiersOpen(true)}
                className="!h-7 !w-7 !min-w-0 !p-0"
              ><FontAwesomeIcon icon={faPencil} className="text-xs"/></IconTooltipButton>
            )}
            <IconTooltipButton label={t('common:actions.comment')}
              flat
              variant="primary"
              onClick={() => {
                setCommentText(item.comments || "");
                setCommentKeyboardOpen(true);
              }}
              className="!h-7 !w-7 !min-w-0 !p-0"
            >
              <FontAwesomeIcon icon={faComment} className="text-xs"/>
            </IconTooltipButton>
          </div>
        )}
      </div>
      {isModifiersOpen && (
        <MenuDishModifiers
          isOpen={isModifiersOpen}
          dish={item.dish}
          groups={item.selectedGroups}
          level={item.level + 1}
          editing={true}
          onClose={(groups) => {
            setModifiersOpen(false);
            setState(prev => ({
              ...prev,
              cart: prev.cart.map((cItem, cIndex) => {
                if(cIndex === index){
                  cItem.selectedGroups = groups;
                }

                return cItem;
              })
            }))
          }}
        />
      )}
      {isCommentKeyboardOpen && (
        <VirtualKeyboard
          open={isCommentKeyboardOpen}
          onClose={() => {
            setCommentKeyboardOpen(false);
            setState(prev => ({
              ...prev,
              cart: prev.cart.map((_item) => {
                if (item.id === _item.id) {
                  _item.comments = commentText;
                }
                return _item;
              })
            }));
          }}
          type="text"
          placeholder={t('seats.addComment')}
          value={commentText}
          onChange={(v) => setCommentText(v)}
        />
      )}
    </>
  );
}
