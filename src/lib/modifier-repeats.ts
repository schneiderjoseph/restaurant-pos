/**
 * The same choice picked more than once in a group (two portions of rice) shows once with its
 * count, "Riz (2)", in the cart, the kitchen screen and the order views, as on printed tickets.
 * A choice carrying its own sub-choices stays on its own line: those may differ.
 */
interface RepeatableModifier {
  id?: unknown;
  dish?: { id?: unknown; name?: string } | null;
  price?: number;
  includedModifier?: boolean;
  selectedGroups?: Array<{ selectedModifiers?: unknown[] | null }> | null;
}

export interface RepeatedModifier<T> {
  /** The first of the repeats: what the line shows. */
  modifier: T;
  count: number;
  /** All repeats together; part of them can be included (free). */
  total: number;
  /** Every repeat is one of the dish's included choices. */
  allIncluded: boolean;
}

const hasSubChoices = (modifier: RepeatableModifier): boolean =>
  (modifier.selectedGroups ?? []).some((group) => (group?.selectedModifiers?.length ?? 0) > 0);

export const groupRepeatedModifiers = <T extends RepeatableModifier>(modifiers: T[] | null | undefined): RepeatedModifier<T>[] => {
  const rows: RepeatedModifier<T>[] = [];
  const byKey = new Map<string, RepeatedModifier<T>>();
  for (const modifier of modifiers ?? []) {
    if (!modifier) continue;
    const price = Number(modifier.price ?? 0) || 0;
    const key = hasSubChoices(modifier)
      ? null
      : String(modifier.dish?.id ?? modifier.dish?.name ?? '');
    const row = key ? byKey.get(key) : undefined;
    if (row) {
      row.count += 1;
      row.total += price;
      row.allIncluded = row.allIncluded && modifier.includedModifier === true;
      continue;
    }
    const created = { modifier, count: 1, total: price, allIncluded: modifier.includedModifier === true };
    rows.push(created);
    if (key) byKey.set(key, created);
  }
  return rows;
};

/** "Riz (2)"; a single pick keeps its plain name. */
export const repeatedModifierLabel = (name: string | null | undefined, count: number): string =>
  count > 1 ? `${name ?? ''} (${count})` : String(name ?? '');
