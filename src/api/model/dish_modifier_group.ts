import { Dish } from "@/api/model/dish.ts";
import { ModifierGroup } from "@/api/model/modifier_group.ts";
import { ID } from "@/api/model/common.ts";

export interface DishModifierGroup extends ID{
  in: Dish
  out: ModifierGroup
  required_modifiers?: number
  should_auto_open?: boolean
  has_required_modifiers?: boolean
  should_auto_select?: boolean
  priority?: number
  /** Choices this dish gives free; the next ones are charged. Unset / 0 = off. */
  included_modifiers?: number | null
  /** The most choices allowed when `included_modifiers` is set. Unset / 0 = no limit. */
  max_modifiers?: number | null
}
