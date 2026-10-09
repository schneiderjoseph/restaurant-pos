import {lineDisplayName} from "@/lib/dish-selling.ts";
import React, {useMemo, useState} from "react";
import {MenuItem} from "@/api/model/cart_item.ts";
import {useAtom} from "jotai";
import {appState} from "@/store/jotai.ts";
import {cn, formatNumber} from "@/lib/utils.ts";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faChevronDown, faChevronUp, faMinus, faPlus, faTrash} from "@fortawesome/free-solid-svg-icons";
import {CartItem} from "@/components/cart/cart.item.tsx";
import {CartItemName} from "@/components/common/cart/cart.item.name.tsx";
import {useTranslation} from "react-i18next";
import {IconTooltipButton} from "@/components/common/input/icon.tooltip.button.tsx";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";
import {calculateCartItemNetTotal} from "@/lib/cart.ts";
import {
  cartGroupIsPending,
  flattenCartGroupModifiers,
} from "@/lib/line-display-group.ts";
import {groupRepeatedModifiers} from "@/lib/modifier-repeats.ts";

interface Props {
  /** Lines of one dish+oz+price (see `groupCartLines`), newest first. */
  items: MenuItem[]
  /** Sent lines the kitchen finished: green header. */
  ready?: boolean
}

/**
 * One cart row for several lines of the same dish/oz at the same unit price, e.g.
 * "3 grilled fish" with rice, fries and mash listed flat underneath.
 */
export const CartItemGroup = ({ items, ready = false }: Props) => {
  const { t } = useTranslation(['cart', 'common']);
  const [, setState] = useAtom(appState);
  const [expanded, setExpanded] = useState(false);

  const first = items[0];
  const ids = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const quantity = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + calculateCartItemNetTotal(item), 0),
    [items]
  );
  const allSelected = items.every((item) => item.isSelected);
  const pending = cartGroupIsPending(items);
  const flatSides = useMemo(
    () => groupRepeatedModifiers(flattenCartGroupModifiers(items)),
    [items],
  );

  const newest = items[0];

  const decrement = () => {
    setState((prev) => ({
      ...prev,
      cart: Number(newest.quantity || 1) > 1
        ? prev.cart.map((line) =>
            line.id === newest.id ? { ...line, quantity: Number(line.quantity || 1) - 1 } : line
          )
        : prev.cart.filter((line) => line.id !== newest.id),
    }));
  };

  const increment = () => {
    setState((prev) => ({
      ...prev,
      cart: prev.cart.map((line) =>
        line.id === newest.id ? { ...line, quantity: Number(line.quantity || 1) + 1 } : line
      ),
    }));
  };

  return (
    <div className="flex flex-col gap-1" data-testid="cart-item-group">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md cursor-pointer select-none px-2 py-1.5 min-h-[44px]",
          allSelected ? 'bg-neutral-300' : (first.isHold ? 'bg-warning-100' : 'bg-neutral-100'),
          ready && !first.deleted_at && 'text-success-700',
        )}
        onClick={() => {
          setState((prev) => ({
            ...prev,
            cart: prev.cart.map((line) =>
              ids.has(line.id) ? { ...line, isSelected: !allSelected } : line
            ),
          }));
        }}
      >
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {pending ? (
            <>
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center rounded bg-white border border-neutral-300 text-sm"
                aria-label={t('common:actions.remove')}
                onClick={decrement}
              >
                <FontAwesomeIcon icon={quantity <= 1 ? faTrash : faMinus} className="text-xs"/>
              </button>
              <span className="min-w-[1.75rem] text-center text-sm font-bold tabular-nums">{quantity}</span>
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center rounded bg-white border border-neutral-300 text-sm"
                aria-label={t('common:actions.add')}
                onClick={increment}
              >
                <FontAwesomeIcon icon={faPlus} className="text-xs"/>
              </button>
            </>
          ) : (
            <span className="min-w-[1.75rem] text-center text-sm font-bold tabular-nums">{quantity}</span>
          )}
        </div>

        <div className="flex-1 min-w-0 text-sm leading-snug">
          <div className="flex justify-between">
            <span className="text-ellipsis line-clamp-1">{lineDisplayName(first.dish.name, first.variant)}</span>
            <span className="w-[40px] text-right">{formatNumber(first.price)}</span>
          </div>
          {first.comments && (
            <div className="italic text-sm">({first.comments})</div>
          )}
          {flatSides.length > 0 && (
            <div className="border-[3px] border-l-warning-500 border-r-0 border-y-0 mb-1">
              {flatSides.map(({ modifier, count, total, allIncluded }) => (
                <CartItemName
                  key={String(modifier.id ?? modifier.dish?.id)}
                  item={{ ...modifier, isModifier: true }}
                  mainItem={{ ...first, quantity: 1 }}
                  count={count}
                  total={total}
                  allIncluded={allIncluded}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
          <DualCurrency amount={total} primaryClassName="text-sm font-semibold" secondaryClassName="text-[10px]"/>
        </div>

        <div className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
          <IconTooltipButton
            label={t(expanded ? 'cart:group.fold' : 'cart:group.unfold')}
            flat
            variant="primary"
            onClick={() => setExpanded((open) => !open)}
            className="!h-7 !w-7 !min-w-0 !p-0"
            data-testid="cart-item-group-toggle"
          >
            <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className="text-xs"/>
          </IconTooltipButton>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1 pl-4">
          {items.map((item) => (
            <CartItem item={item} key={item.id}/>
          ))}
        </div>
      )}
    </div>
  );
};
