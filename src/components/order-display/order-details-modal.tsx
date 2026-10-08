import {lineDisplayName} from "@/lib/dish-selling.ts";
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { Order } from '@/api/model/order.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { Countdown } from '@/components/floor/countdown.tsx';
import { formatOrderNumber, getOrderFilteredItems } from '@/lib/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import { isHotelRoomTable } from '@/lib/kitchen-ticket-label.ts';
import { nowInAppTimezone, toLuxonDateTime } from '@/lib/datetime.ts';
import { formatDueLabel, timerStartWithDue } from '@/lib/order-due.ts';
import {
  INCOMPLETE_KITCHEN_STATUSES,
  KitchenRowsByOrderItemId,
  KitchenStationStatus,
  kitchenOrderItemKey,
} from '@/lib/order-display.ts';
import { cn } from '@/lib/utils.ts';

interface Props {
  order: Order;
  variant: 'preparing' | 'ready';
  stations: KitchenStationStatus[];
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId;
  onClose: () => void;
  /** Ready orders only. */
  onServe?: () => Promise<void>;
}

const InfoRow = ({ label, value }: { label: string; value?: string | null }) =>
  value ? (
    <div className="flex flex-col">
      <span className="text-xs uppercase text-neutral-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  ) : null;

export const OrderDetailsModal = ({
  order,
  variant,
  stations,
  kitchenRowsByOrderItemId,
  onClose,
  onServe,
}: Props) => {
  const { t } = useTranslation('order-display');
  const [serving, setServing] = useState(false);
  const items = getOrderFilteredItems(order);
  const dueLabel = order.due_at
    ? formatDueLabel(toLuxonDateTime(order.due_at), nowInAppTimezone(), t('due.tomorrowShort'))
    : null;

  // Pending until every kitchen row of the line is done; no kitchen row means nothing to wait for.
  const itemReady = (itemId: unknown) =>
    !(kitchenRowsByOrderItemId[kitchenOrderItemKey(itemId)] ?? []).some(
      (row) => !!row.status && INCOMPLETE_KITCHEN_STATUSES.has(row.status)
    );

  const serve = async () => {
    if (!onServe) return;
    setServing(true);
    try {
      await onServe();
      onClose();
    } finally {
      setServing(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      testId="order-display-details"
      title={
        <div className="flex items-center gap-3">
          <span className="font-black">{formatOrderNumber(order)}</span>
          <span
            className={cn(
              'text-sm font-bold uppercase px-2 py-0.5 rounded-full text-white',
              variant === 'ready' ? 'bg-success-600' : 'bg-warning-500'
            )}
          >
            {variant === 'ready' ? t('readyBadge') : t('preparing')}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-white p-3">
          <InfoRow label={t('details.type')} value={order.order_type?.name} />
          <InfoRow
            label={t(isHotelRoomTable(order.table) ? 'details.room' : 'details.table')}
            value={order.table?.number || order.table?.asi_alias}
          />
          <InfoRow label={t('details.guest')} value={formatGuestLabel(order.customer)} />
          <InfoRow label={t('details.server')} value={order.user?.first_name} />
          <InfoRow
            label={t('orderTime')}
            value={toLuxonDateTime(order.created_at).toFormat('hh:mm a')}
          />
          {dueLabel && <InfoRow label={t('details.due')} value={dueLabel} />}
          {variant === 'preparing' && (
            <div className="flex flex-col">
              <span className="text-xs uppercase text-neutral-500">{t('details.elapsed')}</span>
              <span className="font-semibold">
                <Countdown
                  time={timerStartWithDue(
                    toLuxonDateTime(order.created_at),
                    order.due_at ? toLuxonDateTime(order.due_at) : null,
                  )}
                  hideUntilStarted
                />
              </span>
            </div>
          )}
        </div>

        {stations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stations.map((station) => (
              <span
                key={station.kitchenId}
                className={cn(
                  'text-xs font-bold uppercase px-2 py-1 rounded-full text-white',
                  station.ready ? 'bg-success-600' : 'bg-warning-500'
                )}
              >
                {station.kitchenName} {station.ready ? '✓' : '…'}
              </span>
            ))}
          </div>
        )}

        <div className="rounded-lg bg-white divide-y divide-neutral-100" data-testid="order-display-details-items">
          {items.map((item) => {
            const done = itemReady(item.id);
            return (
              <div key={item.id.toString()} className="flex items-start gap-3 px-3 py-2">
                <span className="font-black w-8 shrink-0">{item.quantity}×</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{lineDisplayName(item.item?.name, item.variant)}</div>
                  {item.comments && (
                    <div className="text-sm italic text-neutral-500">{item.comments}</div>
                  )}
                </div>
                <span
                  className={cn('text-sm font-bold', done ? 'text-success-600' : 'text-warning-600')}
                >
                  {done ? '✓' : '…'}
                </span>
              </div>
            );
          })}
        </div>

        {order.notes && (
          <div className="rounded-lg bg-warning-50 border border-warning-200 p-3 text-sm">
            <span className="font-semibold">{t('details.notes')} : </span>
            {order.notes}
          </div>
        )}

        {variant === 'ready' && onServe && (
          <Button
            variant="success"
            filled
            size="lg"
            icon={faCheck}
            isLoading={serving}
            disabled={serving}
            onClick={() => void serve()}
            data-testid="order-display-mark-served"
          >
            {t('markServed')}
          </Button>
        )}
      </div>
    </Modal>
  );
};
