import { Tables } from "@/api/db/tables.ts";
import { toRecordId } from "@/lib/utils.ts";
import { recordIdToString } from "@/api/reports/shared/records.ts";

/**
 * Station accounts: one user per station, bound to it through `user.kitchen`. Signed in
 * on the station's tablet, the account opens the station screen and nothing else (role
 * "Station" = `kitchen` only), and that screen shows its own station only.
 */

export const STATION_ROLE_ID = `${Tables.user_roles}:station`;
export const STATION_ROLE_MODULES = ['kitchen'];
/** first_name of a generated account; last_name follows the station's name. */
export const STATION_ACCOUNT_FIRST_NAME = 'Station';

const PIN_COUNT = 10000;
const CREATE_ATTEMPTS = 5;

type Db = { query: (sql: string, vars?: Record<string, unknown>) => Promise<any> };

export interface StationAccount {
  id: string;
  /** For a PIN user the login IS the PIN. */
  login: string;
}

/** "kitchen:id" of the station a user is bound to, "" for a regular user. */
export const stationKitchenId = (user?: { kitchen?: unknown } | null): string =>
  recordIdToString(user?.kitchen);

/** A 4-digit PIN nobody holds: a random start, then the next free one. */
export const pickFreePin = (
  taken: Iterable<string>,
  random: () => number = Math.random,
): string | null => {
  const used = new Set(taken);
  const start = Math.floor(random() * PIN_COUNT) % PIN_COUNT;

  for (let offset = 0; offset < PIN_COUNT; offset++) {
    const pin = String((start + offset) % PIN_COUNT).padStart(4, '0');
    if (!used.has(pin)) {
      return pin;
    }
  }

  return null;
};

/** Same as migrations/2026_10_05_station_accounts.surql, for a DB that has not run it. */
export const ensureStationAccountSchema = async (db: Db) => {
  await db.query(
    `DEFINE FIELD IF NOT EXISTS kitchen ON ${Tables.users} TYPE none | record<${Tables.kitchens}> | null PERMISSIONS FULL;
     INSERT IGNORE INTO ${Tables.user_roles} { id: ${STATION_ROLE_ID}, name: 'Station', roles: $modules };`,
    { modules: STATION_ROLE_MODULES },
  );
};

const syncStationAccounts = async (db: Db): Promise<Record<string, StationAccount>> => {
  await ensureStationAccountSchema(db);

  const [kitchens, accounts, logins] = await db.query(
    `SELECT id, name FROM ${Tables.kitchens} WHERE deleted_at = none;
     SELECT id, kitchen, login, first_name, last_name FROM ${Tables.users}
       WHERE kitchen != NONE AND kitchen != NULL AND deleted_at = none;
     SELECT VALUE login FROM ${Tables.users} WHERE deleted_at = NONE OR deleted_at = NULL;`,
  );

  const byKitchen: Record<string, StationAccount> = {};
  const namesByKitchen = new Map<string, { first_name?: string; last_name?: string }>();
  for (const account of accounts ?? []) {
    const kitchenId = recordIdToString(account.kitchen);
    if (kitchenId && !byKitchen[kitchenId]) {
      byKitchen[kitchenId] = { id: recordIdToString(account.id), login: account.login };
      namesByKitchen.set(kitchenId, account);
    }
  }

  const taken = new Set<string>((logins ?? []).map(String));

  for (const kitchen of kitchens ?? []) {
    const kitchenId = recordIdToString(kitchen.id);
    const existing = byKitchen[kitchenId];

    if (existing) {
      // A renamed station renames its account, unless someone renamed the account itself.
      const names = namesByKitchen.get(kitchenId);
      if (names?.first_name === STATION_ACCOUNT_FIRST_NAME && names.last_name !== kitchen.name) {
        await db.query(`UPDATE $user SET last_name = $name`, {
          user: toRecordId(existing.id),
          name: kitchen.name,
        });
      }
      continue;
    }

    // The unique index on user.active_login refuses a PIN taken meanwhile: try another.
    let lastError: unknown;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS && !byKitchen[kitchenId]; attempt++) {
      const pin = pickFreePin(taken);
      if (!pin) {
        throw new Error('No free PIN left for a station account');
      }
      taken.add(pin);

      try {
        const [created] = await db.query(
          `INSERT INTO ${Tables.users} (first_name, last_name, login, login_method, password, roles, user_role, kitchen)
           VALUES ($first_name, $last_name, $login, 'pin', crypto::bcrypt::generate($login), $roles, $role, $kitchen)
           RETURN AFTER`,
          {
            first_name: STATION_ACCOUNT_FIRST_NAME,
            last_name: kitchen.name,
            login: pin,
            roles: STATION_ROLE_MODULES,
            role: toRecordId(STATION_ROLE_ID),
            kitchen: toRecordId(kitchenId),
          },
        );
        const row = Array.isArray(created) ? created[0] : created;
        byKitchen[kitchenId] = { id: recordIdToString(row?.id), login: pin };
      } catch (error) {
        lastError = error;
      }
    }

    if (!byKitchen[kitchenId]) {
      throw lastError ?? new Error(`Station account not created for ${kitchen.name}`);
    }
  }

  return byKitchen;
};

let inFlight: Promise<Record<string, StationAccount>> | null = null;

/**
 * Gives every active station its account (and keeps the account named after the
 * station); returns the accounts by station id. One run at a time: two overlapping runs
 * would each create an account for the same station.
 */
export const ensureStationAccounts = (db: Db): Promise<Record<string, StationAccount>> => {
  if (!inFlight) {
    inFlight = syncStationAccounts(db).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
};

/** A removed station takes its account with it; the PIN becomes free again. */
export const removeStationAccount = async (db: Db, kitchenId: unknown) => {
  await db.query(
    `UPDATE ${Tables.users} SET deleted_at = time::now() WHERE kitchen = $kitchen AND deleted_at = none`,
    { kitchen: toRecordId(recordIdToString(kitchenId)) },
  );
};
