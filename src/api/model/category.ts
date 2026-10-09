import { ID, Name, Priority } from "@/api/model/common.ts";
import {DateTime} from "surrealdb";
import {Outlet} from "@/api/model/outlet.ts";
import type {Dish} from "@/api/model/dish.ts";

export interface Category extends ID, Name, Priority{
  background?: string
  color?: string
  parent?: Category
  /** Point of sale, on a top-level category; sub-categories inherit it through `parent`. */
  outlet?: Outlet
  show_in_menu?: boolean
  /** Service hours "HH:mm" (breakfast 06:00–10:00); see lib/category-hours.ts. */
  available_from?: string | null
  available_to?: string | null
  /** During its hours: free for hotel guests, walk-ins pay `walkin_price` on each plate. */
  room_included?: boolean | null
  /** Price of a plate (a dish at 0) for a walk-in, or anyone outside the hours: 1 690. */
  walkin_price?: number | null
  /** Dishes that come with the plate and stay at 0 for a walk-in (coffee + fruits). */
  package_base_items?: Array<Dish | string> | null
  deleted_at?: DateTime
}
