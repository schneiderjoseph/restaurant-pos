import { DateTime } from 'surrealdb';
import type { Customer } from '@/api/model/customer.ts';
import type { Order } from '@/api/model/order.ts';
import type { User } from '@/api/model/user.ts';

export enum CustomerCreditRequestStatus {
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  /** Customer deleted (or gone) before anyone decided. */
  expired = 'expired',
}

export interface CustomerCreditRequest {
  id: string
  customer: Customer
  order?: Order | null
  requested_by: User
  status: CustomerCreditRequestStatus
  /** Ceiling set by the approver; null / missing = no ceiling. */
  approved_limit?: number | null
  created_at: DateTime
  decided_by?: User
  decided_at?: DateTime
}
