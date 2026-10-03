import { useEffect, useState } from "react";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import {
  DEFAULT_ORDER_VISIBILITY,
  ORDER_VISIBILITY_KEY,
  OrderVisibilitySettings,
} from "@/api/model/order_visibility.ts";

/** The global "each user sees only their own orders" switch. Off until it is loaded. */
export const useOrderVisibility = () => {
  const db = useDB();
  const [ownOrdersOnly, setOwnOrdersOnly] = useState(DEFAULT_ORDER_VISIBILITY.own_orders_only);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [rows] = await db.query(
          `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
          { key: ORDER_VISIBILITY_KEY },
        );
        const row = Array.isArray(rows) ? rows[0] : undefined;
        const values = (row as { values?: OrderVisibilitySettings } | undefined)?.values;
        if (!cancelled) {
          setOwnOrdersOnly(Boolean(values?.own_orders_only ?? DEFAULT_ORDER_VISIBILITY.own_orders_only));
        }
      } catch {
        // keep the default: everyone sees every order
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { ownOrdersOnly };
};
