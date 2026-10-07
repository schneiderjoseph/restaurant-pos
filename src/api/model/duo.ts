import { DateTime } from "surrealdb";
import { ID } from "@/api/model/common.ts";
import { User } from "@/api/model/user.ts";

export enum DuoStatus {
  /** Sent by the inviter, waiting for the partner's answer on their terminal. */
  pending = 'pending',
  active = 'active',
  declined = 'declined',
  /** The inviter withdrew the invitation, or nobody answered in time. */
  cancelled = 'cancelled',
  ended = 'ended',
}

/**
 * Two servers working together for the day: each sees and changes the other's orders, and an
 * order the kitchen finishes is announced on both terminals. Sales stay with whoever added the
 * line; the tip of an order shared by a duo is split by those sales (src/lib/duo.ts).
 */
export interface Duo extends ID {
  inviter: User | unknown
  partner: User | unknown
  status: DuoStatus
  created_at: DateTime
  accepted_at?: DateTime
  /** End of the latest service of the two (Manage → Services) + 2 h; moved 1 h by "Extend". */
  ends_at?: DateTime
  ended_at?: DateTime
  ended_by?: User | unknown
}
