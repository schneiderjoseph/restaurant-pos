import type {ReportInsight} from '@/components/reports/report-insights.tsx';
import type {RoomChargeRow} from '@/api/reports/sales/room-charges.ts';
import {listNames} from '@/api/reports/insights/credit.ts';

type T = (key: string, params?: Record<string, unknown>) => string;

/** A single charge this many times the average one is worth a second look. */
export const LARGE_CHARGE_FACTOR = 3;

export type RoomGuestTotal = {
  key: string;
  guestName: string;
  room: string;
  folio: string;
  source: 'asi' | 'manual';
  inHouse: boolean;
  count: number;
  amount: number;
  lastAt: Date | null;
  /** Manual stay closed at check-out without the room bill being settled. */
  unsettled: boolean;
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** One line per guest and room (a guest moving rooms gets one line per room). */
export function groupRoomChargesByGuest(rows: RoomChargeRow[]): RoomGuestTotal[] {
  const map = new Map<string, RoomGuestTotal>();
  for (const r of rows) {
    const key = `${r.guestId || r.guestName}|${r.room}|${r.stayId}`;
    const g = map.get(key) ?? {
      key, guestName: r.guestName, room: r.room, folio: r.folio, source: r.source, inHouse: r.inHouse,
      count: 0, amount: 0, lastAt: null, unsettled: false,
    };
    g.count += 1;
    g.amount += r.roomAmount;
    if (r.createdAt && (!g.lastAt || r.createdAt > g.lastAt)) g.lastAt = r.createdAt;
    if (!g.folio && r.folio) g.folio = r.folio;
    g.unsettled = g.unsettled || (r.stayClosed && !r.staySettled);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** Rule-based observations on room charges. `fmt` formats an amount in the app currency. */
export function buildRoomChargeInsights(
  rows: RoomChargeRow[],
  periodSales: number,
  t: T,
  fmt: (n: number) => string,
): ReportInsight[] {
  const out: ReportInsight[] = [];
  if (rows.length === 0) {
    out.push({id: 'none', severity: 'info', text: t('insights.rooms.none')});
    return out;
  }
  const total = rows.reduce((s, r) => s + r.roomAmount, 0);
  const guests = groupRoomChargesByGuest(rows);

  out.push({
    id: 'share',
    severity: 'info',
    text: t('insights.rooms.share', {amount: fmt(total), pct: pct(total, periodSales), count: rows.length, guests: guests.length}),
  });

  const top = guests[0];
  if (guests.length >= 2) {
    out.push({
      id: 'top-guest',
      severity: 'info',
      text: t('insights.rooms.topGuest', {name: top.guestName || '—', room: top.room || '—', amount: fmt(top.amount), count: top.count, pct: pct(top.amount, total)}),
    });
  }

  const unsettled = guests.filter((g) => g.unsettled);
  if (unsettled.length) {
    out.push({
      id: 'unsettled',
      severity: 'bad',
      text: t('insights.rooms.unsettled', {
        count: unsettled.length,
        amount: fmt(unsettled.reduce((s, g) => s + g.amount, 0)),
        names: listNames(unsettled.map((g) => `${g.guestName || '—'} (${g.room || '—'})`), t),
      }),
    });
  }

  const noFolio = rows.filter((r) => r.source === 'asi' && !r.folio);
  if (noFolio.length) {
    out.push({
      id: 'no-folio',
      severity: 'warn',
      text: t('insights.rooms.noFolio', {count: noFolio.length, amount: fmt(noFolio.reduce((s, r) => s + r.roomAmount, 0))}),
    });
  }

  const departed = guests.filter((g) => !g.inHouse);
  if (departed.length) {
    out.push({
      id: 'departed',
      severity: 'info',
      text: t('insights.rooms.departed', {
        count: departed.length,
        amount: fmt(departed.reduce((s, g) => s + g.amount, 0)),
        names: listNames(departed.map((g) => `${g.guestName || '—'} (${g.room || '—'})`), t),
      }),
    });
  }

  if (rows.length >= 5) {
    const average = total / rows.length;
    const large = rows.filter((r) => r.roomAmount >= average * LARGE_CHARGE_FACTOR);
    if (large.length) {
      out.push({
        id: 'large',
        severity: 'info',
        text: t('insights.rooms.large', {
          count: large.length,
          factor: LARGE_CHARGE_FACTOR,
          average: fmt(average),
          orders: listNames(large.map((r) => (r.invoiceNumber ? `#${r.invoiceNumber}` : r.orderId)), t, 5),
        }),
      });
    }
  }
  return out;
}
