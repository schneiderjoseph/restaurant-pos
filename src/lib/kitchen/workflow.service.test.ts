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
  const recallDb = (status: string) => {
    const updates: string[] = [];
    const db = {
      merge: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT * FROM $oik")) {
          return [[{
            id: id("order_item_kitchen:1"),
            status,
            completed_by: [{ toString: () => "user:other" }],
            order_item: id("order_item:1"),
            sequence: 0,
          }]];
        }
        updates.push(sql);
        return [[]];
      }),
    };
    return { db, updates };
  };

  it("reopens a completed stage for everyone, whoever cleared it", async () => {
    const { db, updates } = recallDb(OrderItemKitchenStatus.Completed);

    await recallStage(db, "order_item_kitchen:1", "user:chef");

    const reopen = updates.find((sql) => sql.includes("SET status = $pending"));
    expect(reopen).toContain("completed_by = []");
  });

  it("leaves a stage that is not closed alone", async () => {
    const { db, updates } = recallDb(OrderItemKitchenStatus.Pending);

    await recallStage(db, "order_item_kitchen:1", "user:chef");

    expect(updates.filter((sql) => sql.includes("SET status = $pending"))).toHaveLength(0);
  });
});
