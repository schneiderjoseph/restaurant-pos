import { Customer } from '@/api/model/customer.ts';
import { Order } from '@/api/model/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';

export { formatGuestLabel } from '@/lib/guest-label.ts';

/** Prefer guest code when present (admin / lookup secondary line). */
export function guestCodeLabel(
  customer?: Pick<Customer, 'guest_code' | 'name'> | null
): string {
  if (!customer) {
    return '';
  }
  const code = customer.guest_code?.trim();
  if (code) {
    return code;
  }
  return customer.name?.trim() ?? '';
}

/** Prefer customer name for tickets / KDS / order display. */
export function guestDisplayLabel(
  customer?: Pick<Customer, 'guest_code' | 'name'> | null
): string {
  if (!customer) {
    return '';
  }
  const name = customer.name?.trim();
  if (name) {
    return name;
  }
  return customer.guest_code?.trim() ?? '';
}

export function orderZoneLabel(order?: Pick<Order, 'floor'> | null): string {
  return order?.floor?.name?.trim() ?? '';
}

export function orderContextLabel(order?: Order | null): string {
  if (!order) {
    return '';
  }

  const guest = formatGuestLabel(order.customer);
  const zone = orderZoneLabel(order);
  const table = order.table
    ? `${order.table.name ?? ''}${order.table.number ?? ''}`.trim()
    : '';

  const parts = [guest, zone, table].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return order.order_type?.name ?? '';
}
