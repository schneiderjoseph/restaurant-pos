import { Order } from '@/api/model/order.ts';
import { formatOrderNumber, getOrderFilteredItems } from '@/lib/order.ts';
import { cn } from '@/lib/utils.ts';
import { Countdown } from '@/components/floor/countdown.tsx';
import { nowInAppTimezone, toLuxonDateTime } from '@/lib/datetime.ts';
import { formatDueLabel, timerStartWithDue } from '@/lib/order-due.ts';
import { useTranslation } from 'react-i18next';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import { isHotelRoomTable } from '@/lib/kitchen-ticket-label.ts';
import { KitchenStationStatus } from '@/lib/order-display.ts';

interface Props {
  order: Order;
  variant: 'preparing' | 'ready';
  celebrate?: boolean;
  stations?: KitchenStationStatus[];
  /** Tap to open the order details. */
  onOpen?: () => void;
}

export const OrderTile = ({ order, variant, celebrate = false, stations = [], onOpen }: Props) => {
  const { t } = useTranslation('order-display');
  const dueLabel = order.due_at
    ? formatDueLabel(toLuxonDateTime(order.due_at), nowInAppTimezone(), t('due.tomorrowShort'))
    : null;
  const itemCount = getOrderFilteredItems(order).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  const guest = formatGuestLabel(order.customer);
  const placeNumber = order.table?.number || order.table?.asi_alias;
  const place = placeNumber
    ? t(isHotelRoomTable(order.table) ? 'room' : 'table', { number: placeNumber })
    : '';
  const subtitle = [order.order_type?.name, place]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('openDetails')}
      data-testid={`order-tile-${variant}`}
      className={cn(
        'w-full text-left flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm border-l-[6px] border border-neutral-200',
        'cursor-pointer hover:shadow-md active:scale-[0.98] transition animate-in fade-in zoom-in-95 duration-300',
        variant === 'ready' ? 'border-l-success-500' : 'border-l-warning-500',
        celebrate && 'ring-4 ring-success-500 shadow-xl order-ready-tile-celebrate'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl font-black tracking-tight leading-none">
          {formatOrderNumber(order)}
        </span>
        {variant === 'preparing' ? (
          <span className="text-sm font-bold text-warning-700 tabular-nums">
            <Countdown
              time={timerStartWithDue(
                toLuxonDateTime(order.created_at),
                order.due_at ? toLuxonDateTime(order.due_at) : null,
              )}
              hideUntilStarted
            />
          </span>
        ) : (
          <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-success-100 text-success-800">
            {t('readyBadge')}
          </span>
        )}
      </div>

      {(subtitle || guest) && (
        <div className="flex flex-col min-w-0">
          {subtitle && (
            <span className="text-sm font-semibold uppercase text-neutral-600 truncate">{subtitle}</span>
          )}
          {guest && <span className="text-sm text-neutral-700 truncate">{guest}</span>}
        </div>
      )}

      {dueLabel && (
        <span className="text-sm font-black text-danger-600" data-testid="order-tile-due-at">
          {t('due.forTime', { time: dueLabel })}
        </span>
      )}

      {stations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stations.map((station) => (
            <span
              key={station.kitchenId}
              className={cn(
                'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full',
                station.ready ? 'bg-success-600 text-white' : 'bg-warning-500 text-white'
              )}
            >
              {station.kitchenName} {station.ready ? '✓' : '…'}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-neutral-500">
        <span>{t('itemsCount', { count: itemCount })}</span>
        <span>{toLuxonDateTime(order.created_at).toFormat('hh:mm a')}</span>
      </div>
    </button>
  );
};
