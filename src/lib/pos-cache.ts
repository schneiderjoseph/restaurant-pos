import { Tables } from '@/api/db/tables.ts';
import { Table, TABLE_FETCHES } from '@/api/model/table.ts';
import { Dish, DISH_FETCHES } from '@/api/model/dish.ts';
import { Kitchen, KITCHEN_FETCHES } from '@/api/model/kitchen.ts';
import { PAYMENT_TYPE_FETCHES, PaymentType } from '@/api/model/payment_type.ts';
import { OrderType } from '@/api/model/order_type.ts';
import { Category } from '@/api/model/category.ts';
import { ModifierGroup } from '@/api/model/modifier_group.ts';
import { DishModifierGroup } from '@/api/model/dish_modifier_group.ts';
import { Floor } from '@/api/model/floor.ts';
import { Menu } from '@/api/model/menu.ts';
import { Tax } from '@/api/model/tax.ts';
import { toRecordId } from '@/lib/utils.ts';
import { RecordId } from 'surrealdb';
import { del, set } from 'idb-keyval';
import type { AppSettingsInterface } from '@/store/jotai.ts';

type DbClient = {
  query: (...args: any[]) => Promise<any>;
};

const toRows = <T,>(result: unknown): T[] => {
  return Array.isArray(result) ? (result as T[]) : [];
};

export const ASI_MENU_RECORD_ID = 'menu:asi_restaurant';
export const LOYVERSE_MENU_RECORD_ID = 'menu:loyverse_catalog';

export function cacheHasAsiMenu(menus: Menu[] | undefined): boolean {
  return (menus ?? []).some((menu) => {
    const id = menu?.id?.toString() ?? '';
    return id === ASI_MENU_RECORD_ID || id.endsWith(':asi_restaurant');
  });
}

export function cacheHasLoyverseMenu(menus: Menu[] | undefined): boolean {
  return (menus ?? []).some((menu) => {
    const id = menu?.id?.toString() ?? '';
    return id === LOYVERSE_MENU_RECORD_ID || id.endsWith(':loyverse_catalog');
  });
}

/** Load POS settings cache from Surreal (menus, dishes, floors, …). */
export async function fetchPosCacheSnapshot(
  db: DbClient
): Promise<Partial<AppSettingsInterface>> {
  const [
    orderTypesResult,
    categoriesResult,
    dishesResult,
    modifierGroupsResult,
    groupsDishesResult,
    floorsResult,
    tablesResult,
    kitchensResult,
    paymentTypesResult,
    taxesResult,
    menuSettingsResult,
    documentsResult,
  ] = await Promise.all([
    db.query(`SELECT *
              FROM ${Tables.order_types}
              WHERE deleted_at = none
              ORDER BY priority ASC`),
    db.query(`SELECT *
              FROM ${Tables.categories}
              WHERE deleted_at = none
              ORDER BY priority ASC`),
    db.query(`SELECT *
              FROM ${Tables.dishes}
              WHERE deleted_at = none
              ORDER BY priority ASC FETCH ${DISH_FETCHES.join(', ')}`),
    db.query(`SELECT *
              FROM ${Tables.modifier_groups}
              WHERE deleted_at = none
              ORDER BY priority ASC FETCH modifiers, modifiers.modifier, modifiers.allowed_next_groups, modifiers.next_group_overrides`),
    db.query(`SELECT *
              FROM ${Tables.dish_modifier_groups}
              ORDER BY priority ASC FETCH in, out, out.modifiers, out.modifiers.modifier, out.modifiers.allowed_next_groups, out.modifiers.next_group_overrides`),
    db.query(`SELECT *
              FROM ${Tables.floors}
              WHERE deleted_at = none
              ORDER BY priority ASC`),
    db.query(`SELECT *
              FROM ${Tables.tables}
              WHERE deleted_at = none
              ORDER BY priority ASC FETCH ${TABLE_FETCHES.join(', ')}`),
    db.query(`SELECT *
              FROM ${Tables.kitchens}
              WHERE deleted_at = none
              ORDER BY priority ASC FETCH ${KITCHEN_FETCHES.join(', ')}`),
    db.query(`SELECT *
              FROM ${Tables.payment_types}
              WHERE deleted_at = none
              ORDER BY priority ASC FETCH ${PAYMENT_TYPE_FETCHES.join(', ')}`),
    db.query(`SELECT *
              FROM ${Tables.taxes}
              WHERE deleted_at = none
              ORDER BY priority ASC`),
    db.query(`SELECT values
              FROM ${Tables.settings}
              WHERE key = 'menus' AND is_global = true
              FETCH values`),
    db.query(`SELECT id, content from ${Tables.documents}`),
  ]);

  const selectedMenuIds = Array.isArray(menuSettingsResult?.[0]?.[0]?.values)
    ? (menuSettingsResult[0][0].values as Array<{ id?: string } | string>)
        .map((value) => {
          if (typeof value === 'string') {
            return toRecordId(value) as RecordId;
          }
          return toRecordId(value?.id) as RecordId;
        })
        .filter(Boolean)
    : [];

  const menusResult =
    selectedMenuIds.length > 0
      ? await db.query(
          `SELECT * FROM ${Tables.menus}
           WHERE id INSIDE $ids
           FETCH items, items.menu_item, items.menu_item.categories, items.tax, items.taxes, items.tax_mode`,
          { ids: selectedMenuIds }
        )
      : [[]];

  await del(Tables.documents);
  await set(
    Tables.documents,
    (documentsResult?.[0] ?? []).map((item: { id: unknown; content?: unknown }) => ({
      ...item,
      id: item.id?.toString?.() ?? item.id,
    }))
  );

  return {
    order_types: toRows<OrderType>(orderTypesResult?.[0]),
    categories: toRows<Category>(categoriesResult?.[0]),
    dishes: toRows<Dish>(dishesResult?.[0]),
    modifier_groups: toRows<ModifierGroup>(modifierGroupsResult?.[0]),
    groups_dishes: toRows<DishModifierGroup>(groupsDishesResult?.[0]),
    floors: toRows<Floor>(floorsResult?.[0]),
    tables: toRows<Table>(tablesResult?.[0]),
    kitchens: toRows<Kitchen>(kitchensResult?.[0]),
    payment_types: toRows<PaymentType>(paymentTypesResult?.[0]),
    taxes: toRows<Tax>(taxesResult?.[0]),
    menus: toRows<Menu>(menusResult?.[0]),
  };
}
