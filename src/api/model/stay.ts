import { ID } from '@/api/model/common.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { User } from '@/api/model/user.ts';

export type StayStatus = 'open' | 'closed';

/** One POS Front Desk stay (manual, outside ASI). A customer may have many over time. */
export interface Stay extends ID {
  customer?: Customer | string | null;
  /** Display room number as assigned at check-in / move. */
  room?: string;
  /** Normalized key used for uniqueness and conflict checks. */
  room_key?: string;
  /** YYYY-MM-DD */
  date_in?: string;
  /** YYYY-MM-DD */
  date_out?: string;
  status?: StayStatus | string;
  /** Computed: room_key when open, else none — UNIQUE among open stays. */
  open_room_key?: string | null;
  checked_in_by?: User | string | null;
  checked_in_at?: string | Date | null;
  checked_out_by?: User | string | null;
  checked_out_at?: string | Date | null;
  room_total_at_checkout?: number | null;
  room_settled_at?: string | Date | null;
  room_settled_by?: User | string | null;
  settled_amount?: number | null;
}
