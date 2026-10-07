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
import {Button} from "@/components/common/input/button.tsx";
import {OrderDueModal} from "@/components/menu/order-due.modal.tsx";
import {calculateCartItemNetTotal} from "@/lib/cart.ts";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";
import {nowInAppTimezone, nowSurrealDateTime, toLuxonDateTime} from "@/lib/datetime.ts";
import {
  getItemPourLabel,
  hasItemCommentPreset,
  ITEM_COMMENT_PRESET_IDS,
  type ItemCommentPresetId,
  parseItemPourParts,
  setItemPourComment,
  toggleItemCommentPreset,
} from "@/lib/item-comments.ts";
import {dueFromParts, formatDueLabel, isDueAhead} from "@/lib/order-due.ts";

function itemPourModalValue(pourLabel: string | null): string | null {
  if (!pourLabel) return null;
  const parts = parseItemPourParts(pourLabel);
  if (!parts) return null;
  const now = nowInAppTimezone();
  const due = dueFromParts(now, parts.dayOffset, parts.hour, parts.minute);
  return isDueAhead(due, now) ? due.toUTC().toISO() : null;
}

interface Props {
  item: MenuItem
  index?: number
}

export const CartItem = ({ item }: Props) => {
  const { t } = useTranslation(['cart', 'common', 'payment', 'receipts']);
  const [state, setState] = useAtom(appState);
  const [isModifiersOpen, setModifiersOpen] = useState(false);
  const [isCommentKeyboardOpen, setCommentKeyboardOpen] = useState(false);
  const [isItemDueOpen, setItemDueOpen] = useState(false);
  const [commentText, setCommentText] = useState(item.comments || "");

  const presetLabel = (id: ItemCommentPresetId) => t(`cart:comments.presets.${id}`);
  const immediateLabel = presetLabel('immediate');
  const pourPrefix = t('receipts:dueAt');
  const pourLabel = getItemPourLabel(commentText, pourPrefix);

  // Before taxes, like the dish price beside the name: the taxes show in the total below.
  const lineTotal = useMemo(() => calculateCartItemNetTotal(item), [item]);

  const isNew = item.newOrOld === MenuItemType.new;
  const isEditingExisting =
    state.order?.id != null && String(state.order.id) !== 'new';
  /** New lines always; old lines when editing an unpaid order. */
  const isLineEditable = !item.deleted_at && (isNew || isEditingExisting);
  const canSelect = isLineEditable || (!!item.isHold && !item.deleted_at);

  const updateQuantity = (next: number) => {
    setState(prev => ({
      ...prev,
      cart: prev.cart.map((_item) =>
        item.id === _item.id ? { ..._item, quantity: Math.max(1, next) } : _item,
      ),
    }));
  };

  const removeOrVoidLine = () => {
    setState((prev) => {
      if (isNew) {
        return {
          ...prev,
          cart: prev.cart.filter((_item) => _item.id !== item.id),
        };
      }
      // Soft-void persisted lines so createOrder can write deleted_at.
      return {
        ...prev,
        cart: prev.cart.map((_item) =>
          _item.id === item.id
            ? { ..._item, deleted_at: nowSurrealDateTime() as MenuItem['deleted_at'], isSelected: false }
            : _item,
        ),
      };
    });
  };

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
        {isLineEditable ? (
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded bg-white border border-neutral-300 text-sm"
              aria-label={t('common:actions.remove')}
              onClick={() => {
                if (item.quantity <= 1) {
                  removeOrVoidLine();
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

        {isLineEditable && (
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
              // By id: `index` counts within the shown list, not the whole cart.
              cart: prev.cart.map((cItem) =>
                cItem.id === item.id ? { ...cItem, selectedGroups: groups } : cItem
              )
            }))
          }}
        />
      )}
      {isCommentKeyboardOpen && (
        <VirtualKeyboard
          open={isCommentKeyboardOpen}
          onClose={() => {
            setCommentKeyboardOpen(false);
            setItemDueOpen(false);
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
          extras={(
            <div className="flex flex-wrap gap-2" data-testid="item-comment-presets">
              {ITEM_COMMENT_PRESET_IDS.map((id) => {
                const label = presetLabel(id);
                const active = hasItemCommentPreset(commentText, label);
                return (
                  <Button
                    key={id}
                    type="button"
                    variant="primary"
                    flat={!active}
                    filled={active}
                    size="lg"
                    data-testid={`item-comment-preset-${id}`}
                    onClick={() => {
                      setCommentText((prev) =>
                        toggleItemCommentPreset(prev, label, {
                          clearsPour: id === 'immediate',
                          pourPrefix,
                        }),
                      );
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
              <Button
                type="button"
                variant="warning"
                flat={!pourLabel}
                filled={!!pourLabel}
                size="lg"
                data-testid="item-comment-pour"
                onClick={() => setItemDueOpen(true)}
              >
                {pourLabel ? `${pourPrefix} ${pourLabel}` : t('cart:comments.forTime')}
              </Button>
            </div>
          )}
        />
      )}
      {isItemDueOpen && (
        <OrderDueModal
          value={itemPourModalValue(pourLabel)}
          onChange={(value) => {
            const now = nowInAppTimezone();
            if (!value) {
              setCommentText((prev) => setItemPourComment(prev, null, { pourPrefix }));
              return;
            }
            const due = toLuxonDateTime(value);
            if (!isDueAhead(due, now)) {
              setCommentText((prev) => setItemPourComment(prev, null, { pourPrefix }));
              return;
            }
            const label = formatDueLabel(due, now, t('payment:due.tomorrowShort'));
            setCommentText((prev) =>
              setItemPourComment(prev, label, {
                pourPrefix,
                immediateLabel,
              }),
            );
          }}
          onClose={() => setItemDueOpen(false)}
        />
      )}
    </>
  );
}
