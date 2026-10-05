import { describe, expect, it, vi } from "vitest";
import { DateTime as SurrealDateTime } from "surrealdb";

vi.mock("@/lib/print.service.ts", () => ({ dispatchPrint: vi.fn() }));

import {
  createStageRows,
  kitchenFireTime,
  recallStage,
} from "@/lib/kitchen/workflow.service.ts";
import { OrderItemKitchenStatus } from "@/api/model/order_item_kitchen.ts";

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

describe("recallStage", () => {
  it("reopens the global status when the last user recalls", async () => {
    const updates: { sql: string; params: Record<string, unknown> }[] = [];
    let completedBy: unknown[] = [{ toString: () => "user:chef" }];

    const db = {
      merge: vi.fn(),
      query: vi.fn(async (sql: string, params: Record<string, unknown> = {}) => {
        if (sql.includes("array::complement")) {
          completedBy = [];
          updates.push({ sql, params });
          return [[]];
        }
        if (sql.startsWith("SELECT * FROM $oik")) {
          return [[{
            id: id("order_item_kitchen:1"),
            status: OrderItemKitchenStatus.Completed,
            completed_by: completedBy,
            order_item: id("order_item:1"),
            sequence: 0,
          }]];
        }
        if (sql.includes("SET status = $pending")) {
          updates.push({ sql, params });
          return [[]];
        }
        if (sql.includes("sequence > $seq")) {
          return [[]];
        }
        return [[]];
      }),
    };

    await recallStage(db, "order_item_kitchen:1", "user:chef");

    expect(updates.some((u) => u.sql.includes("array::complement"))).toBe(true);
    expect(updates.some((u) => u.sql.includes("SET status = $pending"))).toBe(true);
  });

  it("keeps global status completed when another user still has it cleared", async () => {
    const updates: string[] = [];
    const other = { toString: () => "user:other" };

    const db = {
      merge: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("array::complement")) {
          updates.push(sql);
          return [[]];
        }
        if (sql.startsWith("SELECT * FROM $oik")) {
          return [[{
            id: id("order_item_kitchen:1"),
            status: OrderItemKitchenStatus.Completed,
            completed_by: [other],
            order_item: id("order_item:1"),
            sequence: 0,
          }]];
        }
        updates.push(sql);
        return [[]];
      }),
    };

    await recallStage(db, "order_item_kitchen:1", "user:chef");

    expect(updates.filter((sql) => sql.includes("SET status = $pending"))).toHaveLength(0);
  });
});
