import { describe, expect, it } from "vitest";
import { pickFreePin, stationKitchenId } from "@/lib/kitchen/station-account.ts";

describe("station account", () => {
  it("picks a 4-digit PIN nobody holds", () => {
    expect(pickFreePin([], () => 0)).toBe("0000");
    expect(pickFreePin(["0000", "0001"], () => 0)).toBe("0002");
    expect(pickFreePin([], () => 0.4821)).toBe("4821");
  });

  it("wraps around after 9999", () => {
    expect(pickFreePin(["9999"], () => 0.9999)).toBe("0000");
  });

  it("returns null when every PIN is taken", () => {
    const all = Array.from({ length: 10000 }, (_, i) => String(i).padStart(4, "0"));
    expect(pickFreePin(all)).toBeNull();
  });

  it("reads the station a user is bound to", () => {
    expect(stationKitchenId({ kitchen: "kitchen:bar" })).toBe("kitchen:bar");
    expect(stationKitchenId({ kitchen: { toString: () => "kitchen:bar", tb: "kitchen", id: "bar" } })).toBe("kitchen:bar");
    expect(stationKitchenId({})).toBe("");
    expect(stationKitchenId(undefined)).toBe("");
  });
});
