import { ID, Name } from "@/api/model/common.ts";
import {DateTime, RecordId} from "surrealdb";
import { PaymentType } from "@/api/model/payment_type.ts";

export interface UserRole extends ID, Name {
  roles: string[]
  /** Payment types this role may take; none or empty = every type. */
  payment_types?: (PaymentType | RecordId | string)[] | null

  deleted_at?: DateTime
}
