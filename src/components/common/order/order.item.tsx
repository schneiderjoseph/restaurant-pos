import {lineDisplayName} from "@/lib/dish-selling.ts";
import {groupRepeatedModifiers, repeatedModifierLabel} from "@/lib/modifier-repeats.ts";
import { cn, formatNumber } from "@/lib/utils.ts";
import React, {useMemo} from "react";
import { OrderItem, OrderItemModifier } from "@/api/model/order_item.ts";
import { useShowInclusivePrices } from "@/hooks/useShowInclusivePrices.ts";
import {
  getOrderItemDisplayLineTotal,
  getOrderItemDisplayUnitPrice,
  getOrderItemModifierDisplayPrice,
} from "@/lib/order-item-display.ts";
import {flattenOrderGroupModifiers} from "@/lib/line-display-group.ts";

export const OrderItemName = ({
  item, showGroups, showQuantity, showPrice, showModifierPrice, showTotal, showModifiers = true, cancelled = false,
  ready = false,
}: {
  item: OrderItem,
  showGroups?: boolean
  showQuantity?: boolean
  showPrice?: boolean
  showTotal?: boolean
  showModifierPrice?: boolean
  showModifiers?: boolean
  cancelled?: boolean
  /** The kitchen is done with this line: shown in green. */
  ready?: boolean
}) => (
  <OrderItemGroupName
    items={[item]}
    showGroups={showGroups}
    showQuantity={showQuantity}
    showPrice={showPrice}
    showModifierPrice={showModifierPrice}
    showTotal={showTotal}
    showModifiers={showModifiers}
    cancelled={cancelled}
    ready={ready}
  />
);

/**
 * One Commandes row for several order lines of the same dish+oz+unit price: qty summed,
 * sides listed flat underneath (same rule as the guest bill and KOT).
 */
export const OrderItemGroupName = ({
  items,
  showGroups,
  showQuantity,
  showPrice,
  showModifierPrice,
  showTotal,
  showModifiers = true,
  cancelled = false,
  ready = false,
}: {
  items: OrderItem[]
  showGroups?: boolean
  showQuantity?: boolean
  showPrice?: boolean
  showTotal?: boolean
  showModifierPrice?: boolean
  showModifiers?: boolean
  cancelled?: boolean
  ready?: boolean
}) => {
  const { enabled: showInclusive } = useShowInclusivePrices();
  const first = items[0];
  const quantity = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const unitPrice = getOrderItemDisplayUnitPrice(first, showInclusive);
  const lineTotal = items.reduce(
    (sum, item) => sum + getOrderItemDisplayLineTotal(item, showInclusive),
    0,
  );
  const isVoided = cancelled || items.every((item) => item.deleted_at != null);
  const isReady = ready && !isVoided;
  const flatSides = useMemo(
    () => groupRepeatedModifiers(flattenOrderGroupModifiers(items)),
    [items],
  );
  const grouped = items.length > 1;

  return (
    <div className={cn("hover:bg-neutral-200 flex-1", isVoided && "opacity-55")} data-ready={isReady || undefined}>
      <div className={cn("pl-x flex text-lg gap-1", isVoided && "line-through text-neutral-500", isReady && "text-success-700")} style={{
        '--padding': (first.level * 0.875) + 'rem'
      } as any}>
        <span className="flex-1">
          {lineDisplayName(first?.item?.name, first?.variant)}
        </span>
        <div className="flex gap-1 text-right">
          {showQuantity && <span className="flex-0 w-[50px]">{formatNumber(quantity)}</span>}
          {showPrice && <span className="flex-0 w-[70px]">{formatNumber(unitPrice)}</span>}
          {showTotal && (
            <span className="flex-0 w-[70px]">{formatNumber(lineTotal)}</span>
          )}
        </div>
      </div>
      {first.comments && (
        <span className="flex-1 text-sm italic text-danger-500">({first.comments})</span>
      )}
      {showModifiers && grouped && flatSides.length > 0 && (
        <div className="pl-3 flex flex-col">
          {flatSides.map(({modifier: selectedModifier, count, total}) => {
            const price = getOrderItemModifierDisplayPrice(total, first, showInclusive);
            return (
              <div key={String(selectedModifier.id ?? selectedModifier.dish?.id)} className="pl-3 text-sm">
                <div className="flex">
                  <span className="flex-1">
                    <span aria-hidden className="mr-1 text-warning-600">↳</span>
                    {repeatedModifierLabel(selectedModifier.dish?.name, count)}
                  </span>
                  {showModifierPrice && <span className="flex-0 w-[70px] text-right">{formatNumber(price)}</span>}
                </div>
                {selectedModifier?.selectedGroups?.map((selectedGroup, k) => (
                  <OrderItemModifiers
                    showPrice={showModifierPrice}
                    modifier={selectedGroup}
                    key={k}
                    parentItem={first}
                    showInclusive={showInclusive}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
      {showModifiers && !grouped && first?.modifiers?.length > 0 && (
        <div className="pl-3 flex flex-col">
          {first.modifiers.map((modifier, k) => (
            <OrderItemModifiers
              modifier={modifier}
              key={k}
              showGroups={showGroups}
              showPrice={showModifierPrice}
              parentItem={first}
              showInclusive={showInclusive}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const OrderItemModifiers = ({
  modifier, showGroups, showPrice, parentItem, showInclusive = false
}: {
  modifier: OrderItemModifier,
  showGroups?: boolean
  showPrice?: boolean
  parentItem?: OrderItem
  showInclusive?: boolean
}) => {
  return (
    <div key={modifier.id} className="flex flex-col kitchen-order-modifier-group">
      {showGroups && <strong>{modifier.out.name}</strong>}
      {groupRepeatedModifiers(modifier.selectedModifiers).map(({modifier: selectedModifier, count, total}) => {
        // The same side twice shows once with its count: "Riz (2)".
        const price = parentItem
          ? getOrderItemModifierDisplayPrice(total, parentItem, showInclusive)
          : total;

        return (
          <div key={selectedModifier.id} className="pl-3 text-sm">
            <div className="flex">
              <span className="flex-1">
                <span aria-hidden className="mr-1 text-warning-600">↳</span>
                {repeatedModifierLabel(selectedModifier.dish.name, count)}
              </span>
              {showPrice && <span className="flex-0 w-[70px] text-right">{formatNumber(price)}</span>}
            </div>

            {selectedModifier?.selectedGroups?.map((selectedGroup, k) => (
              <OrderItemModifiers
                showPrice={showPrice}
                modifier={selectedGroup}
                key={k}
                parentItem={parentItem}
                showInclusive={showInclusive}
              />
            ))}
          </div>
        );
      })}
    </div>
  )
}
