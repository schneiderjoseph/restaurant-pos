import { Category } from "@/api/model/category.ts";
import { ID, Name, Priority } from "@/api/model/common.ts";
import { Tax } from "@/api/model/tax.ts";
import { MenuModifierOverrides, TaxMode } from "@/api/model/menu.ts";
import { DishModifierGroup } from "@/api/model/dish_modifier_group.ts";
import { DateTime } from "surrealdb";
import {Document} from '@/api/model/document.ts'
import {Workflow} from "@/api/model/workflow.ts";

/** Dish description per app language code, e.g. { fr: "...", en: "..." }. */
export type DishDescription = Record<string, string>;

/** One format a dish is sold in, with its own price (Bottle, Shot). */
export interface DishVariant {
  name: string
  price: number
  /** Ask how many after picking it (shots: 1, 2, 3...); the line takes that quantity. */
  ask_quantity?: boolean
}

export interface Dish extends ID, Name, Priority {
  allow_half?: boolean
  categories?: Category[]
  /** Legacy DB field; POS pur keeps sell price only — treat as unused. */
  cost?: number
  number: string
  /** Shown on a long press of the dish in the POS menu. */
  description?: DishDescription | null
  position?: number
  price: number
  photo?: ArrayBuffer
  dish_photo?: Document
  modifier_groups?: DishModifierGroup[]
  allow_service_charges?: boolean
  discount?: number
  tax?: Tax
  taxes?: Tax[]
  tax_mode?: TaxMode
  menu_name?: string
  /** Per-menu modifier price overrides from the active menu_menu_item */
  menu_modifier_overrides?: MenuModifierOverrides | null
  /** Formats the server picks from when adding the dish; each has its own price. */
  variants?: DishVariant[] | null
  /** Sold by measure in this unit ("once"): the POS asks how much, price = quantity × price. */
  measure_unit?: string | null
  /** Smallest quantity the server can enter (0.5 = halves). Unset = 0.5. */
  measure_step?: number | null
  /** Quantity the pad opens with (12 oz). Unset = empty. */
  measure_default?: number | null
  /** What the + / − buttons add or take (4 oz). Unset = measure_step. */
  measure_bump?: number | null

  workflow?: Workflow
  stage_overrides?: Record<string, string>

  deleted_at?: DateTime
  created_at?: DateTime
}

export const DISH_FETCHES = [
  'categories', 'tax', 'workflow', 'workflow.stages', 'workflow.stages.kitchen'
]