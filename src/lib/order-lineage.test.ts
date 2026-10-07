import {describe, expect, it} from 'vitest';
import {RecordId} from 'surrealdb';
import {loadOrderLineage} from '@/lib/order-lineage.ts';

const ref = (key: string, invoice_number: number, split?: number) =>
  ({id: new RecordId('order', key), invoice_number, split});

describe('loadOrderLineage', () => {
  it('names where split and merged orders come from and went to', async () => {
    const db = {
      query: async () => [
        [{old: ref('old', 88), news: [ref('a', 89, 1), ref('b', 90, 2)]}],
        [{merged: ref('m', 95), olds: [ref('x', 81), ref('y', 82)]}],
      ],
    } as any;

    const lineage = await loadOrderLineage(db, ['order:old', 'order:a', 'order:m', 'order:x']);

    expect(lineage['order:old']).toEqual({splitInto: '#089/1 · #090/2'});
    expect(lineage['order:a']).toEqual({splitFrom: '#088'});
    expect(lineage['order:b']).toBeUndefined();
    expect(lineage['order:m']).toEqual({mergedFrom: '#081 · #082'});
    expect(lineage['order:x']).toEqual({mergedInto: '#095'});
  });

  it('asks nothing for an empty list', async () => {
    const db = {query: async () => { throw new Error('no query expected'); }} as any;
    expect(await loadOrderLineage(db, [])).toEqual({});
  });
});
