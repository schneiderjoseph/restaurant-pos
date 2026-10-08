import { ID, Name } from "@/api/model/common.ts";

export interface Customer extends ID, Name{
  address?: string
  email?: string
  lat?: number
  lng?: number
  phone?: number | string
  secondary_address?: string
  postal_code?: number
  points?: number
  /** Customer number (C-000123), from the customer_number sequence: tells homonyms apart. */
  number?: number | null
  tags?: string[]
  /** Optional guest/room code when name is absent (display via formatGuestLabel). */
  guest_code?: string
  /** Hotel room number (PMS / FrontDesk or manual). */
  room?: string
  /** True when currently in-house (ASI FD sync also sets tags containing in-house). */
  in_house?: boolean
  /** ASI FrontDesk guest master id */
  asi_guest_id?: number | null
  /** ASI FrontDesk check-in id (stay) — upsert key customer:asi_fd_{id} */
  asi_checkin_id?: number | null
  /** ASI FrontDesk folio number */
  asi_folio_no?: string | null
  /** ASI FrontDesk unit / room id */
  asi_unit_id?: number | null
  /** ASI FrontDesk planned departure day (YYYY-MM-DD), informational: ASI decides check-out */
  asi_date_out?: string | null
  /** Provenance: local | asi-fd */
  source?: string | null
  asi_synced_at?: string | null
  /** ID document number (CIN, NIF, passport…), stored normalized; displayed masked unless allowed. */
  id_document_number?: string | null
  /** cin | nif | passport | license | other */
  id_document_type?: string | null
  /** Computed by the database: the ID of an active non-ASI customer, UNIQUE. Never written. */
  id_document_key?: string | null
  /** Computed by the database from phone ("+50937473889"). Shared phones are allowed. Never written. */
  phone_e164?: string | null
  /** Free-text staff note, shown when the guest is selected. */
  notes?: string | null
  /** Allergies, printed on kitchen tickets. */
  allergies?: string[] | null
  /** Diet: vegetarian, halal… */
  dietary?: string[] | null
  seating_pref?: string | null
  language?: string | null
  /** YYYY-MM-DD */
  birthday?: string | null
  vip?: boolean | null
  marketing_consent?: boolean | null
  /** Taxes this customer does not pay: copied to `order.excluded_taxes` of a new order. */
  tax_exemptions?: unknown[] | null
  /** Soft delete: a customer is never removed from the database. */
  deleted_at?: string | Date | null
  deleted_by?: unknown
  deleted_reason?: string | null
  /** Duplicate folded into this customer; its orders show with it. */
  merged_into?: unknown
  created_at?: string | Date | null
  created_by?: unknown
  updated_at?: string | Date | null
  updated_by?: unknown
  /** Read-only projection (guest lookup query): created_at of the latest order. Never written. */
  last_order_at?: string | Date | null
}
