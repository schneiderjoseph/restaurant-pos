import { describe, expect, it } from 'vitest';
import { groupRepeatedModifiers, repeatedModifierLabel } from '@/lib/modifier-repeats.ts';

const side = (id: string, name: string, price = 0, includedModifier = false, selectedGroups?: any[]) =>
  ({ id: `${id}-${Math.random()}`, dish: { id, name }, price, includedModifier, selectedGroups });

describe('groupRepeatedModifiers', () => {
  it('shows the same side once with its count', () => {
    const rows = groupRepeatedModifiers([side('riz', 'Riz', 0, true), side('frites', 'Frites'), side('riz', 'Riz', 150)]);
    expect(rows.map((row) => repeatedModifierLabel(row.modifier.dish?.name, row.count))).toEqual(['Riz (2)', 'Frites']);
    expect(rows[0]).toMatchObject({ count: 2, total: 150, allIncluded: false });
  });

  it('keeps a side with its own sub-choices on its own line', () => {
    const nested = [{ selectedModifiers: [{}] }];
    const rows = groupRepeatedModifiers([side('riz', 'Riz', 0, false, nested), side('riz', 'Riz')]);
    expect(rows.map((row) => row.count)).toEqual([1, 1]);
  });
});
