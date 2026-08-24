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
  /** Provenance: local | asi-fd */
  source?: string | null
  asi_synced_at?: string | null
}
