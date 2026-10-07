import { describe, expect, it } from 'vitest';
import { CartModifierGroup, MenuItem, MenuItemType } from '@/api/model/cart_item.ts';
import { FreeModifierRule } from '@/api/model/modifier_group.ts';
import {
  applyIncludedModifierPricing,
  findNextActiveGroup,
  getGroupFillTarget,
  getGroupMaxModifiers,
  isOptionalGroup,
  shouldAdvanceFromGroup,
} from '@/lib/modifier-groups.ts';
import { cartItemMergeKey, calculateCartItemNetTotal, calculateCartItemPrice, groupCartLines } from '@/lib/cart.ts';

const side = (name: string, price: number): MenuItem => ({
  id: `sel-${name}`,
  dish: { id: `menu_item:${name}`, name } as never,
  quantity: 1,
  level: 1,
  newOrOld: MenuItemType.new,
  isModifier: true,
  price,
  listPrice: price,
});

const group = (
  link: Partial<CartModifierGroup>,
  selected: MenuItem[],
  out: { free_modifier_rule?: FreeModifierRule | null; extra_modifier_price?: number | null } = {},
): CartModifierGroup => ({
  id: 'menu_item_modifier_group:1',
  in: { id: 'menu_item:plate' } as never,
  out: { id: 'modifier_group:sides', name: 'Sides', priority: 0, modifiers: [], ...out },
  selectedModifiers: selected,
  ...link,
});

const prices = (grp: CartModifierGroup) => (grp.selectedModifiers ?? []).map((m) => m.price);

describe('applyIncludedModifierPricing', () => {
  it('leaves a group without included choices untouched', () => {
    const grp = group({ has_required_modifiers: true, required_modifiers: 1 }, [side('fries', 150)]);
    expect(applyIncludedModifierPricing(grp)).toBe(grp);
  });

  it('gives the first choice free and charges the second (normal plate)', () => {
    const grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)]),
    );
    expect(prices(grp)).toEqual([0, 100]);
    expect(grp.selectedModifiers!.map((m) => m.includedModifier)).toEqual([true, false]);
  });

  it('gives five free on a large plate and charges the sixth', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => side(n, 50));
    const grp = applyIncludedModifierPricing(group({ included_modifiers: 5 }, six));
    expect(prices(grp)).toEqual([0, 0, 0, 0, 0, 50]);
  });

  it('frees the cheapest when the group says so', () => {
    const grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)], { free_modifier_rule: 'cheapest' }),
    );
    expect(prices(grp)).toEqual([150, 0]);
  });

  it('frees the most expensive when the group says so', () => {
    const grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('rice', 100), side('fries', 150)], { free_modifier_rule: 'most_expensive' }),
    );
    expect(prices(grp)).toEqual([100, 0]);
  });

  it('breaks price ties by pick order', () => {
    const grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('a', 100), side('b', 100)], { free_modifier_rule: 'cheapest' }),
    );
    expect(prices(grp)).toEqual([0, 100]);
  });

  it('charges the group extra price instead of each choice price', () => {
    const grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)], { extra_modifier_price: 75 }),
    );
    expect(prices(grp)).toEqual([0, 75]);
  });

  it('gives the freed slot to the next choice once the free one is removed', () => {
    const priced = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)]),
    );
    const removed = applyIncludedModifierPricing({
      ...priced,
      selectedModifiers: priced.selectedModifiers!.slice(1),
    });
    // listPrice kept the rice price while it was free or charged.
    expect(prices(removed)).toEqual([0]);
    const readded = applyIncludedModifierPricing({
      ...removed,
      selectedModifiers: [...removed.selectedModifiers!, side('fries', 150)],
    });
    expect(prices(readded)).toEqual([0, 150]);
  });

  it('keeps each choice price after being made free and charged again', () => {
    let grp = applyIncludedModifierPricing(
      group({ included_modifiers: 1 }, [side('rice', 100), side('fries', 150)], { free_modifier_rule: 'cheapest' }),
    );
    expect(prices(grp)).toEqual([0, 150]);
    grp = applyIncludedModifierPricing({ ...grp, selectedModifiers: grp.selectedModifiers!.slice(1) });
    expect(prices(grp)).toEqual([0]);
    grp = applyIncludedModifierPricing({ ...grp, selectedModifiers: [...grp.selectedModifiers!, side('rice', 100)] });
    expect(prices(grp)).toEqual([150, 0]);
  });
});

describe('group limits', () => {
  it('a required group without included choices is capped and filled at its required count', () => {
    const grp = group({ has_required_modifiers: true, required_modifiers: 2 }, []);
    expect(getGroupMaxModifiers(grp)).toBe(2);
    expect(getGroupFillTarget(grp)).toBe(2);
    expect(isOptionalGroup(grp)).toBe(false);
  });

  it('a group with included choices has no cap unless a max is set', () => {
    expect(getGroupMaxModifiers(group({ included_modifiers: 1, has_required_modifiers: true, required_modifiers: 1 }, []))).toBeUndefined();
    expect(getGroupMaxModifiers(group({ included_modifiers: 1, max_modifiers: 3 }, []))).toBe(3);
  });

  it('a group with included choices fills at the larger of included and required, within the max', () => {
    expect(getGroupFillTarget(group({ included_modifiers: 5, has_required_modifiers: true, required_modifiers: 1 }, []))).toBe(5);
    expect(getGroupFillTarget(group({ included_modifiers: 1, has_required_modifiers: true, required_modifiers: 2 }, []))).toBe(2);
    expect(getGroupFillTarget(group({ included_modifiers: 5, max_modifiers: 3 }, []))).toBe(3);
  });

  it('a group with included choices is not optional, and moves on only once filled', () => {
    const grp = group({ included_modifiers: 2, should_auto_open: true }, [side('fries', 0)]);
    expect(isOptionalGroup(grp)).toBe(false);
    expect(shouldAdvanceFromGroup(grp)).toBe(false);
    expect(shouldAdvanceFromGroup({ ...grp, selectedModifiers: [side('a', 0), side('b', 0)] })).toBe(true);
  });

  it('moves on to an unfilled group with included choices', () => {
    const done = group({ id: 'e:1', has_required_modifiers: true, required_modifiers: 1 } as never, [side('rare', 0)]);
    const sides = group({ id: 'e:2', included_modifiers: 1 } as never, []);
    expect(findNextActiveGroup([done, sides], done)?.id).toBe('e:2');
  });
});

describe('cart lines with included choices', () => {
  const line = (groups: CartModifierGroup[]): MenuItem => ({
    id: 'line',
    dish: { id: 'menu_item:plate', name: 'Plate' } as never,
    quantity: 1,
    level: 0,
    price: 1000,
    newOrOld: MenuItemType.new,
    selectedGroups: groups,
  });

  it('charges only the paid choices', () => {
    const grp = applyIncludedModifierPricing(group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)]));
    expect(calculateCartItemPrice(line([grp]))).toBe(1100);
  });

  it('does not merge lines whose same choices are priced differently', () => {
    const a = applyIncludedModifierPricing(group({ included_modifiers: 1 }, [side('fries', 150), side('rice', 100)]));
    const b = applyIncludedModifierPricing(group({ included_modifiers: 1 }, [side('rice', 100), side('fries', 150)]));
    expect(cartItemMergeKey(line([a]))).not.toBe(cartItemMergeKey(line([b])));
    expect(cartItemMergeKey(line([a]))).toBe(cartItemMergeKey(line([applyIncludedModifierPricing(a)])));
  });
});

describe('groupCartLines', () => {
  const plate = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    id,
    dish: { id: 'menu_item:fish', name: 'Fish' } as never,
    quantity: 1,
    level: 0,
    price: 3860,
    newOrOld: MenuItemType.new,
    ...extra,
  });

  it('puts pending plates of one dish on one row, in cart order', () => {
    const other = { ...plate('c'), dish: { id: 'menu_item:chicken', name: 'Chicken' } as never };
    const groups = groupCartLines([plate('a'), other, plate('b')]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps apart plates for another seat, with a comment, held, sent or voided', () => {
    const groups = groupCartLines([
      plate('a'),
      plate('b', { seat: '2' }),
      plate('c', { comments: 'no salt' }),
      plate('d', { isHold: true }),
      plate('e', { newOrOld: MenuItemType.old }),
      plate('f', { newOrOld: MenuItemType.old }),
      plate('g', { deleted_at: 'x' as never }),
    ]);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it('shows a row total before taxes', () => {
    const grp = applyIncludedModifierPricing(group({ included_modifiers: 1 }, [side('fries', 150), side('mash', 229)]));
    const taxed = plate('a', {
      quantity: 2,
      selectedGroups: [grp],
      tax_mode: 'exclusive',
      taxes: [{ id: 'tax:t', name: 'TCA', rate: 10 } as never],
    });
    expect(calculateCartItemNetTotal(taxed)).toBe((3860 + 229) * 2);
  });
});
