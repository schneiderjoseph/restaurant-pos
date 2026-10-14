import { describe, expect, it } from 'vitest';
import { lastOrderPrintAt, TEMP_BILL_COOLDOWN_MS, tempBillCooldownLeft } from '@/lib/order-print.ts';

describe('temp bill cooldown', () => {
  const now = Date.parse('2026-10-14T18:00:00Z');

  it('asks within 45 s of the last print, not after', () => {
    expect(TEMP_BILL_COOLDOWN_MS).toBe(45_000);
    expect(tempBillCooldownLeft(new Date(now - 10_000), now)).toBe(35_000);
    expect(tempBillCooldownLeft(new Date(now - 45_000), now)).toBe(0);
    expect(tempBillCooldownLeft(new Date(now - 120_000), now)).toBe(0);
  });

  it('never blocks without a print', () => {
    expect(tempBillCooldownLeft(null, now)).toBe(0);
    expect(tempBillCooldownLeft(new Date('not a date'), now)).toBe(0);
  });

  it("reads the order's last temp print time", async () => {
    const calls: { sql: string; params?: Record<string, unknown> }[] = [];
    const db = {
      query: async (sql: string, params?: Record<string, unknown>) => {
        calls.push({ sql, params });
        return [['2026-10-14T17:59:50.000Z']];
      },
      create: async () => undefined,
    };
    const last = await lastOrderPrintAt(db, 'order:abc', 'temp');
    expect(last?.toISOString()).toBe('2026-10-14T17:59:50.000Z');
    expect(calls[0].sql).toMatch(/ORDER BY printed_at DESC LIMIT 1/);
    expect(calls[0].params?.printType).toBe('temp');
  });

  it('returns null for an order never printed', async () => {
    const db = { query: async () => [[]], create: async () => undefined };
    expect(await lastOrderPrintAt(db, 'order:abc', 'temp')).toBeNull();
  });
});
