import { ID, Name, Priority } from "@/api/model/common.ts";
import { DateTime } from "surrealdb";

/**
 * A point of sale inside the venue (Bar, Restaurant, …): groups the menu and splits
 * sales. Not the HR `department`. Set on top-level categories; sub-categories inherit
 * it through `parent`, and each order line keeps a copy of it once sold.
 */
export interface Outlet extends ID, Name, Priority {
  color?: string
  deleted_at?: DateTime
}
