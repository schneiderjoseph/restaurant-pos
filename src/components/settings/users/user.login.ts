import {Tables} from "@/api/db/tables.ts";
import type {ImportDbLike} from "@/lib/data-import/types.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {StringRecordId} from "surrealdb";
import {pickFreePin} from "@/lib/kitchen/station-account.ts";

export interface LoginOwner {
  id: string;
  name: string;
}

/**
 * The active user already holding `login`, other than `excludeId`.
 * A PIN identifies one person (for a PIN user, login IS the PIN), so two active
 * users may not share one; the database enforces it with a unique index on
 * user.active_login, this lookup only gives the form a readable message first.
 */
export async function findActiveLoginOwner(
  db: Pick<ImportDbLike, "query">,
  login: string,
  excludeId?: unknown,
): Promise<LoginOwner | null> {
  const exclude = recordIdToString(excludeId);
  const result = await db.query(
    `SELECT id, first_name, last_name FROM ${Tables.users}
     WHERE login = $login AND (deleted_at = NONE OR deleted_at = NULL)
     ${exclude ? "AND id != $exclude" : ""}
     LIMIT 1`,
    {login: login.trim(), ...(exclude ? {exclude: new StringRecordId(exclude)} : {})},
  );
  const rows = Array.isArray(result?.[0]) ? result[0] : [];
  const row = rows[0];
  if (!row) return null;
  return {
    id: recordIdToString(row.id),
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
  };
}

/** A random 4-digit PIN no active user holds, or null when all 10000 are taken. */
export async function generateFreePin(db: Pick<ImportDbLike, "query">): Promise<string | null> {
  const result = await db.query(
    `SELECT VALUE login FROM ${Tables.users} WHERE deleted_at = NONE OR deleted_at = NULL`,
  );
  const logins = Array.isArray(result?.[0]) ? result[0] : [];
  return pickFreePin(logins.map(String));
}
