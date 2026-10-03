import { describe, expect, it, vi } from 'vitest';
import { RecordId } from 'surrealdb';
import { MenuItem, MenuItemType } from '@/api/model/cart_item.ts';
import { OrderItem } from '@/api/model/order_item.ts';
import { OrderStatus } from '@/api/model/order.ts';
import { OrderEditRequestStatus, SentLineChange } from '@/api/model/order_edit_request.ts';
import { userModulesGrant } from '@/lib/access.rules.ts';
import {
  approveOrderEditRequest,
  diffSentLines,
  EDIT_SENT_ITEMS_MODULE,
  refKey,
  rejectOrderEditRequest,
} from '@/lib/order-edit-request.ts';

// The kitchen workflow module pulls in the print service and the browser store.
vi.mock('@/lib/kitchen/workflow.service.ts', () => ({ cancelItemStages: vi.fn(async () => undefined) }));

const dish = { id: 'dish:burger', name: 'Burger', price: 10 } as unknown as MenuItem['dish'];

const sent = (id: string, patch: Partial<OrderItem> = {}): OrderItem => ({
  id: `order_item:${id}`,
  item: dish,
  quantity: 2,
  price: 10,
  modifiers: [],
  position: 0,
  ...patch,
} as unknown as OrderItem);

const cartLine = (id: string, patch: Partial<MenuItem> = {}): MenuItem => ({
  id: `order_item:${id}`,
  dish,
  quantity: 2,
  price: 10,
  level: 0,
  selectedGroups: [],
  newOrOld: MenuItemType.old,
  ...patch,
} as unknown as MenuItem);

describe('order_edit.sent_items', () => {
  it('is not granted by the orders section', () => {
    expect(userModulesGrant(['orders', 'menu'], EDIT_SENT_ITEMS_MODULE)).toBe(false);
    expect(userModulesGrant(['orders', EDIT_SENT_ITEMS_MODULE], EDIT_SENT_ITEMS_MODULE)).toBe(true);
  });
});

describe('refKey', () => {
  it('reads a fetched record and a bare record id the same way', () => {
    const id = new RecordId('user', 'srv');
    expect(refKey(id)).toBe('user:srv');
    expect(refKey({ id, first_name: 'Jean' })).toBe('user:srv');
    expect(refKey('user:srv')).toBe('user:srv');
  });
});

describe('diffSentLines', () => {
  it('sees nothing when the sent lines are untouched, whatever is added', () => {
    const added = cartLine('x', { id: 'tmp-1', newOrOld: MenuItemType.new });
    expect(diffSentLines([sent('a')], [cartLine('a'), added])).toEqual([]);
  });

  it('reports a struck-out line and a line removed from the cart as voids', () => {
    const changes = diffSentLines(
      [sent('a'), sent('b', { quantity: 3 })],
      [cartLine('a', { deleted_at: new Date() as unknown as MenuItem['deleted_at'] })],
    );
    expect(changes.map(({ order_item, action, quantity }) => ({ order_item, action, quantity }))).toEqual([
      { order_item: 'order_item:a', action: 'void', quantity: 2 },
      { order_item: 'order_item:b', action: 'void', quantity: 3 },
    ]);
  });

  it('reports a quantity change with the values to write once approved', () => {
    const [change] = diffSentLines([sent('a')], [cartLine('a', { quantity: 1 })]);
    expect(change).toMatchObject({
      order_item: 'order_item:a',
      action: 'update',
      name: 'Burger',
      from_quantity: 2,
      quantity: 1,
      comments_changed: false,
      modifiers_changed: false,
    });
    expect(change.patch?.quantity).toBe(1);
    expect(Object.values(change.patch ?? {})).not.toContain(undefined);
  });

  it('reports a comment change and an options change', () => {
    const [comment] = diffSentLines([sent('a')], [cartLine('a', { comments: 'sans oignon' })]);
    expect(comment).toMatchObject({ action: 'update', comments_changed: true, comments: 'sans oignon' });

    const groups = [{ id: 'g1', selectedModifiers: [] }] as unknown as MenuItem['selectedGroups'];
    const [options] = diffSentLines([sent('a')], [cartLine('a', { selectedGroups: groups })]);
    expect(options).toMatchObject({ action: 'update', modifiers_changed: true });
  });

  it('ignores a line that was already voided on the order', () => {
    const voided = sent('a', { deleted_at: new Date() as unknown as OrderItem['deleted_at'] });
    expect(diffSentLines([voided], [])).toEqual([]);
  });
});

/** Just enough of the database for the decision path: one request, one order, its lines. */
const fakeDb = (orderStatus: OrderStatus, lines: Record<string, { deleted_at?: unknown }>) => {
  const state = { requestStatus: OrderEditRequestStatus.pending as string, writes: [] as string[] };
  const query = async (sql: string, params?: Record<string, unknown>) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT id, status FROM order:')) {
      return [[{ id: 'order:1', status: orderStatus }]];
    }
    if (q.startsWith('SELECT id, deleted_at FROM order_item:')) {
      const id = q.split(' ').pop() as string;
      return [lines[id] ? [{ id, ...lines[id] }] : []];
    }
    if (q.startsWith('UPDATE order_edit_request:') && q.includes('WHERE status = $pending')) {
      if (state.requestStatus !== OrderEditRequestStatus.pending) {
        return [[]];
      }
      state.requestStatus = String(params?.status);
      return [[{ id: 'order_edit_request:1' }]];
    }
    if (q.startsWith('UPDATE order_edit_request:')) {
      state.requestStatus = String(params?.pending);
      return [[]];
    }
    if (q.includes('MERGE $patch') && params?.patch && (params.patch as { fail?: boolean }).fail) {
      throw new Error('write failed');
    }
    state.writes.push(q);
    return [[]];
  };
  return { state, db: { query } };
};

const request = (changes: SentLineChange[]) => ({
  id: 'order_edit_request:1',
  order: { id: 'order:1' },
  requested_by: { id: 'user:server' },
  changes,
}) as unknown as Parameters<typeof approveOrderEditRequest>[1];

const voidA: SentLineChange = {
  order_item: 'order_item:a', action: 'void', name: 'Burger', from_quantity: 2, quantity: 2,
};
const updateB: SentLineChange = {
  order_item: 'order_item:b', action: 'update', name: 'Frites', from_quantity: 2, quantity: 1,
  patch: { quantity: 1, modifiers: [], price: 5, tax: 0 },
};

describe('approveOrderEditRequest', () => {
  it('writes the changes on an open order and marks the request approved', async () => {
    const { db, state } = fakeDb(OrderStatus['In Progress'], { 'order_item:a': {}, 'order_item:b': {} });
    expect(await approveOrderEditRequest(db, request([voidA, updateB]), 'user:manager'))
      .toEqual({ decision: 'approved', applied: [voidA, updateB] });
    expect(state.requestStatus).toBe(OrderEditRequestStatus.approved);
    expect(state.writes.some((q) => q.startsWith('UPDATE order_item:a SET deleted_at'))).toBe(true);
    expect(state.writes.some((q) => q.startsWith('UPDATE order_item:b MERGE $patch'))).toBe(true);
  });

  it('expires the request without touching a paid order', async () => {
    const { db, state } = fakeDb(OrderStatus.Paid, { 'order_item:a': {} });
    expect((await approveOrderEditRequest(db, request([voidA]), 'user:manager')).decision).toBe('expired');
    expect(state.requestStatus).toBe(OrderEditRequestStatus.expired);
    expect(state.writes).toEqual([]);
  });

  it('does nothing when another approver already answered', async () => {
    const { db, state } = fakeDb(OrderStatus['In Progress'], { 'order_item:a': {} });
    state.requestStatus = OrderEditRequestStatus.rejected;
    expect((await approveOrderEditRequest(db, request([voidA]), 'user:manager')).decision).toBe('taken');
    expect(await rejectOrderEditRequest(db, request([voidA]), 'user:manager')).toBe('taken');
    expect(state.writes).toEqual([]);
  });

  it('skips a line that was removed since the request was made', async () => {
    const { db, state } = fakeDb(OrderStatus['In Progress'], { 'order_item:a': { deleted_at: 'x' } });
    expect(await approveOrderEditRequest(db, request([voidA]), 'user:manager'))
      .toEqual({ decision: 'approved', applied: [] });
    expect(state.writes.some((q) => q.startsWith('UPDATE order_item:a'))).toBe(false);
  });

  it('puts the request back to pending when a write fails', async () => {
    const { db, state } = fakeDb(OrderStatus['In Progress'], { 'order_item:b': {} });
    const failing = { ...updateB, patch: { ...updateB.patch, fail: true } } as unknown as SentLineChange;
    await expect(approveOrderEditRequest(db, request([failing]), 'user:manager')).rejects.toThrow('write failed');
    expect(state.requestStatus).toBe(OrderEditRequestStatus.pending);
  });
});

describe('rejectOrderEditRequest', () => {
  it('marks a pending request rejected and writes nothing on the order', async () => {
    const { db, state } = fakeDb(OrderStatus['In Progress'], { 'order_item:a': {} });
    expect(await rejectOrderEditRequest(db, request([voidA]), 'user:manager')).toBe('rejected');
    expect(state.requestStatus).toBe(OrderEditRequestStatus.rejected);
    expect(state.writes).toEqual([]);
  });
});
