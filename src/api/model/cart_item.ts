import { Dish } from "@/api/model/dish.ts";
import { ModifierGroup } from "@/api/model/modifier_group.ts";
import { DishModifierGroup } from "@/api/model/dish_modifier_group.ts";
import { Modifier } from "@/api/model/modifier.ts";
import { DateTime } from "surrealdb";
import { Tax } from "@/api/model/tax.ts";
import { TaxMode } from "@/api/model/menu.ts";

export enum MenuItemType {
  new = 'new',
  old = 'old'
}
export interface MenuItem {
  quantity: number
  price?: number

  seat?: string
  comments?: string

  serviceCharges?: number

  dish: Dish
  /** Variant picked or measure entered at the sale, shown after the dish name ("Shot", "3,5 once"). */
  variant?: string
  /** Sold by measure: the quantity entered (3.5); the line price already covers it. */
  measureQuantity?: number
  category?: string
  category_id?: string
  menu_name?: string

  id: string

  group?: ModifierGroup
  modifiers?: Dish[]
  selectedGroups?: CartModifierGroup[]
  isModifier?: boolean

  level: number
  isSelected?: boolean
  isHold?: boolean

  newOrOld: MenuItemType

  /** When set from a modifier line, limits which dish-attached groups open in POS. */
  allowedNextGroupIds?: string[]

  /** Parent modifier row from DB (for nested group overrides). */
  sourceModifier?: Modifier

  /** Modifier record id in the parent group catalog (distinct when same dish appears twice). */
  catalogModifierId?: string

  /** Instance-only: hide this catalog option in the POS picker. */
  hidden?: boolean

  /** Template price at clone time; used to reset instance overrides. */
  basePrice?: number

  /** Modifier line: its price when charged, before a dish's included choices make it free. */
  listPrice?: number

  /** Modifier line: one of the choices the dish gives free (price 0). */
  includedModifier?: boolean

  /** Tax mode for this item (exclusive or inclusive) */
  tax_mode?: TaxMode

  /** Multiple taxes applied to this item */
  taxes?: Tax[]

  created_at?: DateTime
  updated_at?: DateTime
  deleted_at?: DateTime
}

export interface CartModifierGroup extends DishModifierGroup {
  selected_quantity?: number
  selectedModifiers?: MenuItem[]
  modifiers?: MenuItem[]
  catalogCustomized?: boolean
}
