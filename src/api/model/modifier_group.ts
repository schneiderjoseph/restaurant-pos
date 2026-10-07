import { ID, Name, Priority } from "@/api/model/common.ts";
import { Modifier } from "@/api/model/modifier.ts";
import {DateTime} from "surrealdb";

/** Which choices a dish gives free when they don't cost the same (see `included_modifiers`). */
export type FreeModifierRule = 'first' | 'cheapest' | 'most_expensive';

export interface ModifierGroup extends ID, Name, Priority {
  background?: string
  color?: string
  modifiers: Modifier[]

  /** Free choices past a dish's included count: which ones. Unset = 'first'. */
  free_modifier_rule?: FreeModifierRule | null
  /** One price for every paid choice. Unset = each choice's own price. */
  extra_modifier_price?: number | null

  deleted_at?: DateTime
}
