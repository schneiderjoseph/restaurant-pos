import {lineDisplayName} from "@/lib/dish-selling.ts";
import {groupRepeatedModifiers, repeatedModifierLabel} from "@/lib/modifier-repeats.ts";
import {MenuItem} from "@/api/model/cart_item.ts";
import {cn, formatNumber} from "@/lib/utils.ts";
import React from "react";
import {useAtom} from "jotai";
import {appPage} from "@/store/jotai.ts";
import {useTranslation} from "react-i18next";

interface Props {
  item: MenuItem
  index: number
  mainItem: MenuItem
}

interface RepeatProps {
  /** The same side picked this many times in its group: "Riz (2)". */
  count?: number
  /** Price of all the repeats together. */
  total?: number
  allIncluded?: boolean
}

export const CartItemName = ({ item, mainItem, count = 1, total, allIncluded }: Omit<Props, "index"> & RepeatProps) => {
  const [pageState] = useAtom(appPage);
  const { t } = useTranslation('menu');
  const { showTotalInCart = false } = pageState.menuConfig ?? {};

  return (
    <>
      <div className={
        cn("pl-x flex justify-between", item.isModifier ? 'text-sm' : '')
      } style={{
        '--padding': (item.level * 0.875) + 'rem'
      } as any}>
        <span className="text-ellipsis line-clamp-1">
          {item.isModifier && <span aria-hidden className="mr-1 text-warning-600">↳</span>}
          {repeatedModifierLabel(lineDisplayName(item.dish.name, item.variant), count)}
        </span>
        <div className={
          cn(
            showTotalInCart ? "grid grid-cols-2 gap-2 w-[70px] text-right" : "grid grid-cols-1 w-[40px] text-right"
          )
        }>
          <span>{(count > 1 ? allIncluded : item.includedModifier) ? t('modifiers.included') : formatNumber(total ?? item.price)}</span>
          {showTotalInCart && (
            <span>{formatNumber((total ?? item.price) * mainItem.quantity)}</span>
          )}
        </div>
      </div>
      {item.comments && (
        <div className="italic text-sm">({item.comments})</div>
      )}
      {item?.selectedGroups?.map(group =>
        <div className="border-[3px] border-l-warning-500 border-r-0 border-y-0 mb-2" key={group.out?.id}>
          {groupRepeatedModifiers(group?.selectedModifiers).map(row => (
            <CartItemName
              key={row.modifier.id}
              item={row.modifier}
              mainItem={mainItem}
              count={row.count}
              total={row.total}
              allIncluded={row.allIncluded}
            />
          ))}
        </div>
      )}
    </>
  )
}
