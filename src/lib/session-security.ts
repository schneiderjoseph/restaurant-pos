import { Tables } from '@/api/db/tables.ts';
import type { Setting } from '@/api/model/setting.ts';
import {
  DEFAULT_SESSION_SECURITY,
  SESSION_SECURITY_KEY,
  type SessionSecuritySettings,
  normalizeSessionSecurity,
} from '@/api/model/session_security.ts';

type QueryDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Load the establishment-wide session idle settings row (or defaults). */
export async function loadSessionSecuritySettings(db: QueryDb): Promise<SessionSecuritySettings> {
  try {
    const [raw] = (await db.query(
      `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
      { key: SESSION_SECURITY_KEY },
    )) as [Setting[] | undefined];
    const rows = Array.isArray(raw) ? raw : [];
    return normalizeSessionSecurity((rows[0]?.values ?? {}) as Partial<SessionSecuritySettings>);
  } catch {
    return DEFAULT_SESSION_SECURITY;
  }
}
