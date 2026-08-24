import { describe, expect, it, vi } from "vitest";
import {
  claimDishesForKitchen,
  kitchenHasDish,
  kitchenMatchesDish,
  resolveRouteKitchens,
} from "@/lib/kitchen/routing.ts";

const kitchen = (
  id: string,
  opts: { items?: string[]; shows_all?: boolean } = {}
) => ({
  id: { toString: () => id },
  items: (opts.items ?? []).map((dishId) => ({ id: { toString: () => dishId } })),
  shows_all: opts.shows_all ?? false,
});

describe("kitchen routing", () => {
  const drinks = "menu_item:cola";
  const burger = "menu_item:burger";
  const bar = kitchen("kitchen:bar", { items: [drinks] });
  const grill = kitchen("kitchen:grill", { items: [burger] });
  const expo = kitchen("kitchen:expo", { shows_all: true, items: [] });

  it("matches a dish only when the station owns it", () => {
    expect(kitchenHasDish(bar, drinks)).toBe(true);
    expect(kitchenHasDish(bar, burger)).toBe(false);
    expect(kitchenMatchesDish(expo, drinks)).toBe(true);
    expect(kitchenMatchesDish(grill, drinks)).toBe(false);
    expect(kitchenMatchesDish(grill, burger)).toBe(true);
  });

  it("routes a BAR drink to BAR and expo, not grill", () => {
    const routed = resolveRouteKitchens([bar, grill, expo], drinks).map((k) =>
      k.id.toString()
    );
    expect(routed).toEqual(["kitchen:bar", "kitchen:expo"]);
  });

  it("falls back to the workflow kitchen when no station owns the dish", () => {
    const routed = resolveRouteKitchens(
      [grill, expo],
      "menu_item:orphan",
      "kitchen:grill"
    ).map((k) => k.id.toString());
    expect(routed).toEqual(["kitchen:grill", "kitchen:expo"]);
  });

  it("removes claimed dishes from other stations but not from show-all", async () => {
    const merge = vi.fn();
    const db = {
      query: vi.fn(async () => [[
        { id: "kitchen:grill", items: [{ toString: () => drinks }, { toString: () => burger }], shows_all: false },
        { id: "kitchen:expo", items: [{ toString: () => drinks }], shows_all: true },
      ]]),
      merge,
    };

    await claimDishesForKitchen(db, "kitchen:bar", [drinks]);

    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge.mock.calls[0][0]).toBe("kitchen:grill");
    const nextItems = merge.mock.calls[0][1].items.map((item: { toString: () => string }) =>
      item.toString()
    );
    expect(nextItems).toEqual([burger]);
  });

  it("does not steal dishes when the kitchen shows all tickets", async () => {
    const merge = vi.fn();
    await claimDishesForKitchen(
      { query: vi.fn(), merge },
      "kitchen:expo",
      [drinks],
      { showsAll: true }
    );
    expect(merge).not.toHaveBeenCalled();
  });

  it("matches raw RecordIds as well as fetched dish rows", () => {
    const raw = {
      id: { toString: () => "kitchen:bar" },
      items: [{ tb: "menu_item", id: "cola", toString: () => drinks }],
      shows_all: false,
    };
    expect(kitchenHasDish(raw, drinks)).toBe(true);
    expect(kitchenHasDish(raw, burger)).toBe(false);
  });
});
