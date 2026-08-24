import { describe, expect, it } from 'vitest';
import {
  RESORT_FLOOR_NAME,
  RESORT_FLOOR_RECORD_ID,
  RESORT_TABLE_COUNT,
  RESORT_TABLE_LAYOUT,
  resortTablePosition,
} from '@/lib/resort-floor-tables.ts';

describe('resort floor tables', () => {
  it('uses a stable salle floor id and seeds a practical table count', () => {
    expect(RESORT_FLOOR_RECORD_ID).toBe('floor:resort_salle');
    expect(RESORT_FLOOR_NAME).toBe('Salle');
    expect(RESORT_TABLE_COUNT).toBeGreaterThanOrEqual(20);
    expect(RESORT_TABLE_COUNT).toBeLessThanOrEqual(40);
  });

  it('packs tables in a compact grid without large gaps', () => {
    const first = resortTablePosition(0);
    const second = resortTablePosition(1);
    const ninth = resortTablePosition(8);

    expect(first.x).toBe(RESORT_TABLE_LAYOUT.paddingX);
    expect(first.y).toBe(RESORT_TABLE_LAYOUT.paddingY);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
    expect(ninth.x).toBe(first.x);
    expect(ninth.y).toBeGreaterThan(first.y);

    const last = resortTablePosition(RESORT_TABLE_COUNT - 1);
    const bottom =
      last.y + last.size + RESORT_TABLE_LAYOUT.paddingY;
    // Must stay above typical floor switcher (100vh − 160px ≈ 600+ on POS tablets)
    expect(bottom).toBeLessThan(620);
  });
});
