import { describe, expect, it } from 'vitest';
import { Extra } from '@/api/model/extra.ts';
import { extraAppliesToOrder, isOrderTimeExtra, orderAutoExtras, syncOrderAutoExtras } from '@/lib/order-auto-extras.ts';

const roomService = {
  id: 'extras:service_chambre',
  name: 'Service chambre',
  value: 390,
  order_types: [{ id: 'order_type:en_chambre' }],
} as unknown as Extra;
const cardFee = {
  id: 'extras:card',
  name: 'Frais carte',
  value: 50,
  payment_types: [{ id: 'payment_type:card' }],
} as unknown as Extra;

describe('order-time extras', () => {
  it('applies the room-service extra to room orders only', () => {
    expect(extraAppliesToOrder(roomService, { orderTypeId: 'order_type:en_chambre' })).toBe(true);
    expect(extraAppliesToOrder(roomService, { orderTypeId: 'order_type:sur_place' })).toBe(false);
    expect(orderAutoExtras([roomService, cardFee], { orderTypeId: 'order_type:en_chambre' }))
      .toEqual([{ name: 'Service chambre', value: 390 }]);
  });

  it('leaves payment-type and delivery extras to the payment screen', () => {
    expect(isOrderTimeExtra(cardFee)).toBe(false);
    expect(isOrderTimeExtra({ ...roomService, delivery: true } as Extra)).toBe(false);
    expect(isOrderTimeExtra({ name: 'x', value: 1 } as Extra)).toBe(false);
  });
});

/** In-memory stand-in for the few queries the sync runs. */
const fakeDb = (orderExtras: Array<{ id: string; name: string; value: number }>) => {
  const state = { extras: [...orderExtras], deleted: [] as string[], created: 0 };
  return {
    state,
    query: async (sql: string) => (sql.includes('FROM extra ')
      ? [[roomService, cardFee]]
      : [state.extras.map((extra) => ({ ...extra }))]),
    create: async (_table: string, data: { name: string; value: number }) => {
      state.created += 1;
      const record = { id: `order_extras:new${state.created}`, ...data };
      state.extras.push(record);
      return [record];
    },
    merge: async (_ref: unknown, data: { extras: string[] }) => {
      state.extras = state.extras.filter((extra) => data.extras.includes(extra.id));
    },
    delete: async (id: string) => {
      state.deleted.push(id);
    },
  };
};

describe('syncOrderAutoExtras', () => {
  it('adds room service once, keeping a hand-added extra', async () => {
    const db = fakeDb([{ id: 'order_extras:tip', name: 'Bouteille offerte', value: 0 }]);
    await syncOrderAutoExtras(db, 'order:1', { orderTypeId: 'order_type:en_chambre' });
    await syncOrderAutoExtras(db, 'order:1', { orderTypeId: 'order_type:en_chambre' });
    expect(db.state.extras.map((extra) => extra.name)).toEqual(['Bouteille offerte', 'Service chambre']);
    expect(db.state.created).toBe(1);
  });

  it('removes room service when the order is no longer in a room', async () => {
    const db = fakeDb([{ id: 'order_extras:rs', name: 'Service chambre', value: 390 }]);
    await syncOrderAutoExtras(db, 'order:1', { orderTypeId: 'order_type:sur_place' });
    expect(db.state.extras).toEqual([]);
    expect(db.state.deleted).toEqual(['order_extras:rs']);
  });
});
