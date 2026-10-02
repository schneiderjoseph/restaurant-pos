import { ID, Name, Priority } from "@/api/model/common.ts";
import {DateTime} from "surrealdb";
import {Outlet} from "@/api/model/outlet.ts";

export interface Category extends ID, Name, Priority{
  background?: string
  color?: string
  parent?: Category
  /** Point of sale, on a top-level category; sub-categories inherit it through `parent`. */
  outlet?: Outlet
  show_in_menu?: boolean
  deleted_at?: DateTime
}
