import { DateTime } from "surrealdb";
import { Order } from "@/api/model/order.ts";
import { User } from "@/api/model/user.ts";

export enum OrderEditRequestStatus {
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  /** The order was paid, cancelled or merged before anyone decided. */
  expired = 'expired',
}

/** One change a user asked for on a line that was already sent. */
export interface SentLineChange {
  /** `order_item:…` */
  order_item: string
  action: 'void' | 'update'
  /** Dish name when the request was made, for the approver's screen. */
  name: string
  from_quantity: number
  /** Quantity after the change; for a void, the quantity removed. */
  quantity: number
  comments_changed?: boolean
  comments?: string
  modifiers_changed?: boolean
  /**
   * The change takes money off the order (a void, fewer plates, cheaper options). Only these
   * wait for an approver; a comment or a dearer option is written straight away.
   */
  lowers_total?: boolean
  /** Fields written on the order line once approved (update only). */
  patch?: {
    quantity: number
    comments?: string
    modifiers: unknown
    price: number
    tax: number
    tax_mode?: unknown
  }
}

export interface OrderEditRequest {
  id: string
  order: Order
  requested_by: User
  status: OrderEditRequestStatus
  changes: SentLineChange[]
  created_at: DateTime
  decided_by?: User
  decided_at?: DateTime
}
