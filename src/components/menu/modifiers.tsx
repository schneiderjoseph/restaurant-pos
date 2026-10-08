import {Dish} from "@/api/model/dish.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import React, {useEffect, useMemo, useState} from "react";
import {cn, formatNumber} from "@/lib/utils.ts";
import {MenuDish} from "@/components/menu/dish.tsx";
import {CartModifierGroup, MenuItem, MenuItemType} from "@/api/model/cart_item.ts";
import {useAtom} from "jotai";
import {appAlert, appState} from "@/store/jotai.ts";
import {nanoid} from "nanoid";
import {Button} from "@/components/common/input/button.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPencil, faTimes} from "@fortawesome/free-solid-svg-icons";
import {
  applyIncludedModifierPricing,
  cloneCartModifierGroups,
  findNextActiveGroup,
  getGroupInstanceKey,
  getGroupMaxModifiers,
  getGroupSidebarLabel,
  getVisibleCatalogModifiers,
  hasIncludedModifiers,
  isGroupFilled,
  isOpenEndedGroup,
  isOptionalGroup,
  isSameGroupInstance,
  resolveGroupInList,
  shouldAdvanceFromGroup,
  updateModifierNestedGroups,
} from "@/lib/modifier-groups.ts";
import {useTranslation} from "react-i18next";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";

interface Props {
  dish?: Dish
  onClose?: (payload: CartModifierGroup[]) => void
  isOpen: boolean
  groups: CartModifierGroup[]
  level: number
  editing?: boolean
}

const ModifierPrice = ({modifier}: { modifier: MenuItem }) => {
  const { t } = useTranslation('menu');

  return (
    <span className="shrink-0">
      {modifier.includedModifier ? t('modifiers.included') : formatNumber(modifier.price ?? 0)}
    </span>
  );
};

const NestedModifiersSummary = ({groups}: { groups: CartModifierGroup[] }) => (
  <>
    {groups.map((grp) => (
      <div
        key={getGroupInstanceKey(grp)}
        className="mt-1 flex flex-col"
      >
        <div className="text-sm font-bold bg-slate-600 text-white self-start rounded px-[3px]">{getGroupSidebarLabel(grp, groups)}</div>
        {(grp.selectedModifiers ?? []).map((modifier) => (
          <div key={modifier.id} className="text-sm border-l-2 border-warning-500">
            <div className="flex justify-between gap-2 pl-1">
              <span className="min-w-0 truncate">{modifier.dish.name}</span>
              <ModifierPrice modifier={modifier}/>
            </div>
            {(modifier.selectedGroups?.length ?? 0) > 0 && (
              <NestedModifiersSummary groups={modifier.selectedGroups!}/>
            )}
          </div>
        ))}
      </div>
    ))}
  </>
);

export const MenuDishModifiers = (props: Props) => {
  const [state] = useAtom(appState);
  const [, setAlert] = useAtom(appAlert);
  const { t } = useTranslation(['menu', 'common']);

  const [groups, setGroups] = useState(() => cloneCartModifierGroups(props.groups));
  const [group, setGroup] = useState<CartModifierGroup>();
  const [editingNestedFor, setEditingNestedFor] = useState<string | null>(null);

  useEffect(() => {
    const cloned = cloneCartModifierGroups(props.groups);
    setGroups(cloned);
    setGroup((prev) => {
      if (!prev) {
        return prev;
      }

      const resolved = cloned.find((g) => isSameGroupInstance(g, prev));

      return resolved ?? (cloned.length > 0 ? cloned[0] : undefined);
    });
  }, [props.groups]);

  const visibleModifiers = useMemo(() => {
    if (!group) {
      return [];
    }

    return getVisibleCatalogModifiers(group);
  }, [group]);

  const selected = useMemo(() => {
    return groups.reduce(
      (prev, item) => prev + (item.selectedModifiers?.length ?? 0),
      0
    );
  }, [groups]);

  const allFilled = useMemo(() => {
    return groups.every(isGroupFilled);
  }, [groups]);

  const optional = useMemo(() => {
    return groups.filter(isOptionalGroup).length;
  }, [groups]);

  // Groups that take more than their included choices (several sides, or the same twice).
  const openEnded = useMemo(() => {
    return groups.filter(isOpenEndedGroup).length;
  }, [groups]);

  const isDismissible = useMemo(() => {
    if (!groups || groups.length === 0) {
      return true;
    }

    return !groups.some(
      grp => grp.has_required_modifiers && (grp.selectedModifiers?.length ?? 0) < grp.required_modifiers
    );
  }, [groups]);

  const hideCloseButton = !isDismissible;

  useEffect(() => {
    if (props.dish && !group && groups.length > 0) {
      setGroup(groups[0]);

      return;
    }

    if (
      group &&
      (group.selectedModifiers?.length ?? 0) === 0 &&
      visibleModifiers.length === group.required_modifiers &&
      props.editing !== true &&
      group.should_auto_select
    ) {
      for (const catalog of visibleModifiers) {
        onModifierClick(
          {
            quantity: 1,
            dish: catalog.dish,
            seat: state.seat,
            id: nanoid(),
            level: props.level,
            price: catalog.price,
            newOrOld: MenuItemType.new,
            category: state.category
              ? state.category.name
              : ((catalog.dish.categories ?? []).length === 1
                ? (catalog.dish.categories ?? [])[0].name
                : ''),
            category_id: state.category?.id?.toString(),
          },
          catalog.selectedGroups,
          catalog.price,
          catalog
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seat changes must not re-auto-select
  }, [props.dish, group, props.level, props.editing, visibleModifiers]);

  const buildModifiersObj = (
    dish: Dish,
    nestedGroups?: CartModifierGroup[],
    price?: number,
    catalog?: MenuItem
  ): MenuItem => {
    const sourceModifier = catalog?.sourceModifier;

    return {
      quantity: 1,
      dish: dish,
      seat: state.seat,
      id: nanoid(),
      level: props.level,
      selectedGroups: nestedGroups,
      newOrOld: MenuItemType.new,
      category: state.category
        ? state.category?.name
        : ((dish.categories ?? []).length === 1 ? (dish.categories ?? [])[0].name : ''),
      category_id: state.category?.id?.toString(),
      isModifier: true,
      price: price,
      listPrice: price,
      sourceModifier,
      catalogModifierId: catalog
        ? (catalog.catalogModifierId ?? catalog.id.toString())
        : undefined,
    }
  }

  const onModifierClick = (
    d: MenuItem,
    selectedGroups?: CartModifierGroup[],
    price?: number,
    catalog?: MenuItem
  ) => {
    setGroups(
      newGroups => newGroups.map(grp => {
        if (!isSameGroupInstance(grp, group)) {
          return grp;
        }

        const clonedNested = selectedGroups
          ? cloneCartModifierGroups(selectedGroups)
          : undefined;
        const selectedModifiers = [...(grp.selectedModifiers ?? [])];
        const max = getGroupMaxModifiers(grp);
        const isFull = max !== undefined && selectedModifiers.length >= max;

        if (isFull && !props.editing) {
          return grp;
        }

        if (isFull) {
          selectedModifiers.pop();

          setAlert(prev => ({
            ...prev,
            message: t('modifiers.replacedWarning'),
            type: 'warning',
            opened: true
          }));
        }

        selectedModifiers.push(
          buildModifiersObj(d.dish, clonedNested, price ?? d.price, catalog)
        );

        return applyIncludedModifierPricing({...grp, selectedModifiers});
      })
    );
  }

  const requireClass = (grp: CartModifierGroup) => {
    if (grp.has_required_modifiers && (grp.selectedModifiers?.length ?? 0) < grp.required_modifiers) {
      return 'bg-danger-200';
    } else if (grp.has_required_modifiers && (grp.selectedModifiers?.length ?? 0) === grp.required_modifiers) {
      return 'bg-white';
    }

    return 'bg-white';
  }

  useEffect(() => {
    if (!group) {
      return;
    }

    const current = resolveGroupInList(groups, group);

    if (!shouldAdvanceFromGroup(current)) {
      return;
    }

    const next = findNextActiveGroup(groups, current);

    if (next && !isSameGroupInstance(next, current)) {
      setGroup(next);
    }
  }, [groups, group]);

  useEffect(() => {
    // Closes by itself only when nothing more can be added; otherwise "Confirm" closes it.
    if (allFilled && optional === 0 && openEnded === 0 && props.editing !== true) {
      props.onClose(selected > 0 ? groups : []);
    }
  }, [selected, allFilled, groups, optional, openEnded, props]);

  const removeItem = (targetGroup: CartModifierGroup, itemIndex: number) => {
    setGroups(prev => prev.map(grp => {
      if (isSameGroupInstance(grp, targetGroup)) {
        const selectedModifiers = [...(grp.selectedModifiers ?? [])];
        selectedModifiers.splice(itemIndex, 1);
        return applyIncludedModifierPricing({...grp, selectedModifiers});
      }

      return grp;
    }));
  }

  const editingNestedModifier = useMemo(() => {
    if (!editingNestedFor) {
      return undefined;
    }

    for (const grp of groups) {
      const found = (grp.selectedModifiers ?? []).find((m) => m.id === editingNestedFor);
      if (found) {
        return found;
      }
    }

    return undefined;
  }, [editingNestedFor, groups]);

  const closeWithSelection = () => {
    props.onClose(selected > 0 || optional > 0 ? groups : []);
  };

  const groupCounter = (item: CartModifierGroup) => {
    if (hasIncludedModifiers(item)) {
      return t('modifiers.includedCount', {
        count: item.selectedModifiers?.length ?? 0,
        included: item.included_modifiers,
      });
    }

    return item.has_required_modifiers
      ? `${item.selectedModifiers?.length ?? 0} / ${item.required_modifiers}`
      : null;
  };

  /** What picking this option costs right now: free while the dish still has included choices. */
  const optionPriceLabel = (catalog: MenuItem) => {
    const current = group ? resolveGroupInList(groups, group) : undefined;
    if (current && hasIncludedModifiers(current)) {
      const count = current.selectedModifiers?.length ?? 0;
      if (count < Number(current.included_modifiers)) {
        return t('modifiers.included');
      }
      const fixed = current.out?.extra_modifier_price;
      const charge = fixed !== null && fixed !== undefined && Number.isFinite(Number(fixed))
        ? Number(fixed)
        : Number(catalog.price ?? 0);
      return charge > 0 ? `+${formatNumber(charge)}` : formatNumber(0);
    }

    return formatNumber(catalog.price ?? 0);
  };

  return (
    <Modal
      open={props.isOpen}
      title={t('modifiers.modifyTitle', { name: props.dish.name })}
      shouldCloseOnOverlayClick={isDismissible}
      shouldCloseOnEsc={isDismissible}
      hideCloseButton={hideCloseButton}
      onClose={closeWithSelection}
      size="lg"
    >
      {props.dish && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {groups.map((item) => (
              <button
                type="button"
                key={getGroupInstanceKey(item)}
                onClick={() => setGroup(item)}
                className={cn(
                  'flex flex-col items-start rounded-xl px-4 py-2 shadow-sm',
                  group && isSameGroupInstance(group, item) ? 'bg-gradient text-white' : requireClass(item)
                )}
              >
                <span className="font-semibold">{getGroupSidebarLabel(item, groups)}</span>
                {groupCounter(item) && (
                  <span className="text-sm">{groupCounter(item)}</span>
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="max-h-[55vh] overflow-auto md:col-span-2">
              {group && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {visibleModifiers.map((catalog) => (
                    <MenuDish
                      variant="option"
                      priceLabel={optionPriceLabel(catalog)}
                      onClick={(item, groups, itemPrice) =>
                        onModifierClick(item, groups, itemPrice, catalog)
                      }
                      item={catalog.dish}
                      key={catalog.catalogModifierId ?? catalog.id}
                      level={props.level + 1}
                      isModifier
                      price={catalog.price ?? 0}
                      allowedNextGroupIds={catalog.allowedNextGroupIds}
                      parentModifier={catalog.sourceModifier}
                      menuModifierOverrides={props.dish?.menu_modifier_overrides}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-xl bg-white p-3">
              {groups.map((g) => (
                <div key={getGroupInstanceKey(g)}>
                  <span className="font-bold">{getGroupSidebarLabel(g, groups)}</span>
                  {(g.selectedModifiers ?? []).map((m, mIndex) => (
                    <div key={mIndex} className="mb-2 flex items-start gap-3">
                      <IconTooltipButton label={t('common:actions.remove')}
                        className="shrink-0"
                        size="lg"
                        variant="danger"
                        flat
                        onClick={() => removeItem(g, mIndex)}
                      >
                        <FontAwesomeIcon icon={faTimes}/>
                      </IconTooltipButton>
                      <div className="min-w-0 flex-1">
                        {m?.selectedGroups?.length > 0 ? (
                          <>
                            <Button
                              icon={faPencil}
                              onClick={() => setEditingNestedFor(m.id)}
                              className="flex w-full !justify-between"
                              flat
                              variant="custom"
                            >
                              <span className="min-w-0 truncate">{m.dish.name}</span>
                              <ModifierPrice modifier={m}/>
                            </Button>
                            <NestedModifiersSummary groups={m.selectedGroups}/>
                          </>
                      ) : (
                          <div className="flex justify-between gap-2 py-2">
                            <span className="min-w-0 truncate">{m.dish.name}</span>
                            <ModifierPrice modifier={m}/>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="danger"
              flat
              onClick={() => {
                props.onClose([]);
              }}
              className="lg"
            >{t('modifiers.cancel')}</Button>
            <Button
              variant="primary"
              filled
              disabled={!isDismissible}
              onClick={closeWithSelection}
              className="lg"
              data-testid="modifiers-confirm"
            >{t('modifiers.confirm')}</Button>
          </div>
        </div>
      )}

      {editingNestedModifier && editingNestedFor && (
        <MenuDishModifiers
          key={editingNestedFor}
          isOpen={editingNestedFor !== null}
          dish={editingNestedModifier.dish}
          groups={cloneCartModifierGroups(editingNestedModifier.selectedGroups ?? [])}
          level={editingNestedModifier.level + 1}
          editing={true}
          onClose={(payload) => {
            const modifierId = editingNestedFor;
            setEditingNestedFor(null);
            if (payload.length > 0 && modifierId) {
              setGroups((prev) =>
                updateModifierNestedGroups(prev, modifierId, payload)
              );
            }
          }}
        />
      )}
    </Modal>
  )
}
