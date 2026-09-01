import type { Customer } from '@/api/model/customer.ts';
import type { Table } from '@/api/model/table.ts';

export type KitchenGuestLabelMode = 'name' | 'code' | 'both';

export type KitchenPlaceLabels = {
  room: string;
  table: string;
};

type GuestLike = Pick<Customer, 'name' | 'guest_code'> | null | undefined;
type TableLike = Pick<Table, 'name' | 'number' | 'source' | 'asi_alias'> | null | undefined;

/** Shorten long names for kitchen tickets: "Ricardo Michel" → "Ricardo M." */
export function truncateGuestName(name: string, maxLen = 18): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxLen) {
    return trimmed;
  }

  const parts = trimmed.split(' ');
  if (parts.length >= 2) {
    const lastInitial = parts[parts.length - 1][0] ?? '';
    const shortened = `${parts[0]} ${lastInitial}.`.trim();
    if (shortened.length <= maxLen) {
      return shortened;
    }
  }

  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}

export function formatKitchenGuestLabel(
  guest: GuestLike,
  mode: KitchenGuestLabelMode = 'name',
): string {
  if (!guest) {
    return '';
  }

  const name = truncateGuestName(guest.name ?? '');
  const rawCode = (guest.guest_code ?? '').toString().trim();
  const code = rawCode ? (rawCode.startsWith('#') ? rawCode : `#${rawCode}`) : '';

  if (mode === 'code') {
    return code || name;
  }
  if (mode === 'both') {
    return [name, code].filter(Boolean).join(' · ');
  }
  return name || code;
}

export function isHotelRoomTable(table: TableLike): boolean {
  return table?.source === 'asi-room';
}

/**
 * Place badge for kitchen tickets / KOT.
 * Hotel rooms → "Chambre 18"; dining → "Table 7" (or existing table name+number).
 */
export function formatKitchenPlaceLabel(
  table: TableLike,
  labels: KitchenPlaceLabels,
): string {
  if (!table) {
    return '';
  }

  if (isHotelRoomTable(table)) {
    const roomNo = String(table.number || table.asi_alias || table.name || '').trim();
    return roomNo ? `${labels.room} ${roomNo}` : labels.room;
  }

  const name = String(table.name ?? '').trim();
  const number = String(table.number ?? '').trim();
  if (name && number) {
    // Prefer "Table 7" over duplicated "TableTable7" when name already says Table.
    if (/^table$/i.test(name) || /^t$/i.test(name)) {
      return `${labels.table} ${number}`;
    }
    return `${name}${number}`;
  }
  if (number) {
    return `${labels.table} ${number}`;
  }
  if (name) {
    return name;
  }
  return labels.table;
}
