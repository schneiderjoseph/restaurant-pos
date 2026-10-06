import { ID } from "@/api/model/common.ts";
import { Dish } from "@/api/model/dish.ts";
import { DishModifierGroup } from "@/api/model/dish_modifier_group.ts";
import { MenuItemType } from "@/api/model/cart_item.ts";
import {User} from "@/api/model/user.ts";
import {Category} from "@/api/model/category.ts";
import { DateTime } from "surrealdb";
import {Order} from "@/api/model/order.ts";
import {Workflow} from "@/api/model/workflow.ts";
import {Tax} from "@/api/model/tax.ts";
import {TaxMode} from "@/api/model/menu.ts";

export interface OrderItem extends ID {
  comments?: string
  created_at: DateTime
  updated_at?: DateTime
  deleted_at?: DateTime
  discount?: number
  item: Dish
  modifiers: OrderItemModifier[]
  position: number
  price: number
  original_price?: number
  quantity: number
  service_charges?: number
  tax?: number
  taxes?: Tax[]
  tax_mode?: TaxMode
  seat?: string
  is_suspended?: boolean
  level?: number
  category?: string
  category_id?: string
  /** Point of sale when sold (name and id copied, so reclassifying a category never moves past sales). */
  outlet?: string
  outlet_id?: string
  is_addition?: boolean
  is_refunded?: boolean
  created_by?: User

  workflow?: Workflow
  current_sequence?: number
  workflow_status?: string

  order?: Order
  /** Split by amount: the original line this re-priced copy stands for in the kitchen. */
  split_source?: string | OrderItem
  /** Split by amount: the share of the line's units this copy stands for (reports). */
  split_share?: number
}

export interface OrderItemModifier extends ID, DishModifierGroup{
  modifiers?: OrderItemModifierItem[]
  selectedModifiers?: ({
    selectedGroups?: OrderItemModifier[]
  } & OrderItemModifierItem) []
}

export interface OrderItemModifierItem extends ID {
  dish: Dish
  level: number
  newOrOld: MenuItemType
  price: number
  quantity: number
}
