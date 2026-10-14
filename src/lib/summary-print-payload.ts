/**
 * Keep only fields the thermal summary printer (computeSummary) needs.
 * Full day-order graphs (images, nested relations) easily exceed nginx's
 * default 1mb body limit and trigger 413 Request Entity Too Large.
 */

type AnyRecord = Record<string, unknown>;

function slimModifierGroups(groups: unknown): unknown[] {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => {
    const g = (group && typeof group === 'object' ? group : {}) as AnyRecord;
    const selected = Array.isArray(g.selectedModifiers) ? g.selectedModifiers : [];
    return {
      selectedModifiers: selected.map((selectedMod) => {
        const sm = (selectedMod && typeof selectedMod === 'object' ? selectedMod : {}) as AnyRecord;
        const dish = sm.dish && typeof sm.dish === 'object' ? (sm.dish as AnyRecord) : null;
        return {
          name: sm.name,
          price: sm.price,
          dish: dish ? { name: dish.name } : undefined,
          selectedGroups: slimModifierGroups(sm.selectedGroups),
        };
      }),
    };
  });
}

function slimOrderForSummaryPrint(order: unknown): AnyRecord {
  const o = (order && typeof order === 'object' ? order : {}) as AnyRecord;
  const tax = o.tax && typeof o.tax === 'object' ? (o.tax as AnyRecord) : null;
  const discount = o.discount && typeof o.discount === 'object' ? (o.discount as AnyRecord) : o.discount;
  const coupon = o.coupon && typeof o.coupon === 'object' ? (o.coupon as AnyRecord) : null;
  const couponInner =
    coupon?.coupon && typeof coupon.coupon === 'object' ? (coupon.coupon as AnyRecord) : null;

  return {
    id: o.id != null ? String(o.id) : undefined,
    status: o.status,
    covers: o.covers,
    discount_amount: o.discount_amount,
    discount: discount && typeof discount === 'object' ? { name: (discount as AnyRecord).name } : discount,
    service_charge_amount: o.service_charge_amount,
    tax_amount: o.tax_amount,
    tip_amount: o.tip_amount,
    tax: tax ? { name: tax.name, rate: tax.rate } : undefined,
    coupon: coupon
      ? {
          discount: coupon.discount,
          coupon: couponInner ? { code: couponInner.code } : undefined,
        }
      : undefined,
    extras: (Array.isArray(o.extras) ? o.extras : []).map((extra) => {
      const e = (extra && typeof extra === 'object' ? extra : {}) as AnyRecord;
      return { name: e.name, value: e.value };
    }),
    payments: (Array.isArray(o.payments) ? o.payments : []).map((payment) => {
      const p = (payment && typeof payment === 'object' ? payment : {}) as AnyRecord;
      const pt = p.payment_type && typeof p.payment_type === 'object' ? (p.payment_type as AnyRecord) : null;
      return {
        amount: p.amount,
        payable: p.payable,
        payment_type: pt
          ? { type: pt.type, name: pt.name, title: pt.title }
          : undefined,
      };
    }),
    items: (Array.isArray(o.items) ? o.items : []).map((item) => {
      const it = (item && typeof item === 'object' ? item : {}) as AnyRecord;
      const dishItem = it.item && typeof it.item === 'object' ? (it.item as AnyRecord) : null;
      const dish = it.dish && typeof it.dish === 'object' ? (it.dish as AnyRecord) : null;
      return {
        id: it.id != null ? String(it.id) : undefined,
        deleted_at: it.deleted_at,
        is_refunded: it.is_refunded,
        is_suspended: it.is_suspended,
        discount: it.discount,
        quantity: it.quantity,
        price: it.price,
        category: it.category,
        item: dishItem ? { name: dishItem.name } : undefined,
        dish: dish ? { name: dish.name } : undefined,
        modifiers: slimModifierGroups(it.modifiers),
      };
    }),
  };
}

/** Slim an orders list (or { data: Order[] }) for summary print payloads. */
export function slimOrdersForSummaryPrint(orders: unknown): unknown {
  if (Array.isArray(orders)) {
    return orders.map(slimOrderForSummaryPrint);
  }
  if (orders && typeof orders === 'object' && Array.isArray((orders as { data?: unknown }).data)) {
    return {
      ...(orders as object),
      data: ((orders as { data: unknown[] }).data).map(slimOrderForSummaryPrint),
    };
  }
  return orders;
}
