import { describe, expect, it, vi } from "vitest";
import { DateTime as SurrealDateTime } from "surrealdb";

vi.mock("@/lib/print.service.ts", () => ({ dispatchPrint: vi.fn() }));

import { createStageRows, kitchenFireTime } from "@/lib/kitchen/workflow.service.ts";

const id = (value: string) => ({ toString: () => value });

/** Dishes without a workflow, each owned by one station. */
const fakeDb = (now?: unknown) => {
  const creates: { sql: string; params: Record<string, unknown> }[] = [];
  const query = vi.fn(async (sql: string, params: Record<string, unknown> = {}) => {
    if (sql.startsWith("RETURN time::now()")) {
      if (now instanceof Error) throw now;
      return [now];
    }
    if (sql.startsWith("CREATE")) {
      creates.push({ sql, params });
      return [[]];
    }
    if (sql.includes("items ?= $dish")) {
      return [[{ id: id("kitchen:grill") }]];
    }
    return [[]];
  });
  return { db: { query, merge: vi.fn() }, creates };
};

const fire = (db: unknown, itemId: string, firedAt?: unknown) =>
  createStageRows(db, {
    orderItem: { id: id(`order_item:${itemId}`) },
    dish: { id: id(`menu_item:${itemId}`) } as never,
    kitchenItems: {},
    firedAt,
  });

describe("kitchen fire time", () => {
  it("stamps every row of a send with the same created_at", async () => {
    const serverNow = new SurrealDateTime(new Date("2026-10-04T12:00:00.950Z"));
    const { db, creates } = fakeDb(serverNow);

    const firedAt = await kitchenFireTime(db);
    await fire(db, "a", firedAt);
    await fire(db, "b", firedAt);

    expect(creates).toHaveLength(2);
    for (const create of creates) {
      expect(create.sql).toContain("created_at = $firedAt,");
      expect(create.params.firedAt).toBe(serverNow);
    }
  });

  it("falls back to per-row server time when the lookup fails", async () => {
    const { db, creates } = fakeDb(new Error("offline"));

    const firedAt = await kitchenFireTime(db);
    expect(firedAt).toBeUndefined();
    await fire(db, "a", firedAt);

    expect(creates[0].sql).toContain("created_at = time::now(),");
  });
});
