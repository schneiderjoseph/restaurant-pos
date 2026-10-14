import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/i18n.ts', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@/integrations/events/publish/entity.ts', () => ({
  entityAfterWrite: vi.fn(async () => undefined),
}));

import { toast } from 'sonner';
import { executeSettingsDelete } from '@/lib/settings-delete.service.ts';

type Call = { sql: string; params?: Record<string, unknown> };

const fakeDb = (opts: {
  usageCounts?: number[];
  deleteImpl?: () => Promise<unknown>;
}) => {
  const calls: Call[] = [];
  let usageIdx = 0;
  return {
    calls,
    query: async (sql: string, params?: Record<string, unknown>) => {
      calls.push({ sql, params });
      if (sql.includes('count()')) {
        const count = opts.usageCounts?.[usageIdx++] ?? 0;
        return [[{ count }]];
      }
      return [[]];
    },
    merge: vi.fn(async () => ({})),
    delete: opts.deleteImpl ?? (async () => ({})),
  };
};

describe('executeSettingsDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hard-deletes when usage checks are empty and runs cleanup first', async () => {
    const db = fakeDb({ usageCounts: [0, 0] });
    const result = await executeSettingsDelete({
      db,
      id: 'menu_item:abc',
      entityLabel: 'Plat',
      usageChecks: [
        { query: 'SELECT count() AS count FROM order_item WHERE item = $idRecord GROUP ALL' },
        { query: 'SELECT count() AS count FROM modifier_group WHERE true GROUP ALL' },
      ],
      cleanupQueries: [
        { query: 'DELETE menu_item_modifier_group WHERE in = $idRecord' },
        { query: 'DELETE menu_menu_item WHERE menu_item = $idRecord' },
        {
          query:
            'UPDATE kitchen SET items = array::complement(items ?? [], [$idRecord]) WHERE items ?= $idRecord',
        },
      ],
    });

    expect(result).toBe('deleted');
    expect(toast.success).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(db.merge).not.toHaveBeenCalled();

    const sqls = db.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('DELETE menu_menu_item'))).toBe(true);
    expect(sqls.some((s) => s.includes('array::complement'))).toBe(true);
    expect(sqls.some((s) => s.includes('deleted_at = time::now()'))).toBe(false);
  });

  it('soft-deletes with time::now when a usage check finds rows', async () => {
    const db = fakeDb({ usageCounts: [3] });
    const result = await executeSettingsDelete({
      db,
      id: 'menu_item:abc',
      entityLabel: 'Plat',
      usageChecks: [
        { query: 'SELECT count() AS count FROM order_item WHERE item = $idRecord GROUP ALL' },
      ],
      cleanupQueries: [
        { query: 'DELETE menu_menu_item WHERE menu_item = $idRecord' },
      ],
    });

    expect(result).toBe('deactivated');
    expect(toast.info).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(db.merge).not.toHaveBeenCalled();

    const soft = db.calls.find((c) => c.sql.includes('deleted_at = time::now()'));
    expect(soft).toBeTruthy();
    expect(soft?.params).toMatchObject({ idRecord: expect.anything() });
    expect(db.calls.some((c) => c.sql.includes('DELETE menu_menu_item'))).toBe(false);
  });
});
