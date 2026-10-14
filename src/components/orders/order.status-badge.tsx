import { Order, OrderStatus } from '@/api/model/order.ts';
import { cn } from '@/lib/utils.ts';
import { translateOrderStatus } from '@/lib/order.ts';
import { orderDeferredCharges } from '@/lib/order-deferred-charge.ts';
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  [OrderStatus['In Progress']]: 'bg-warning-100 text-warning-700',
  [OrderStatus.Paid]: 'bg-success-100 text-success-700',
  [OrderStatus.Merged]: 'bg-info-100 text-info-700',
  [OrderStatus.Spilt]: 'bg-info-100 text-info-700',
  [OrderStatus.Cancelled]: 'bg-danger-100 text-danger-700',
};

const DEFERRED_COLORS = {
  room: 'bg-info-100 text-info-800',
  credit: 'bg-neutral-800 text-white',
} as const;

interface Props {
  order: Pick<Order, 'status' | 'payments'>;
  /** Kitchen finished every line while the check is still open. */
  kitchenReady?: boolean;
  className?: string;
}

/**
 * Status chip on Orders cards/rows. Room / Credit replace "Payée" — the ticket is
 * closed but money is still on the folio / house account.
 */
export const OrderStatusBadge = ({ order, kitchenReady = false, className }: Props) => {
  const { t } = useTranslation('orders');
  const showKitchenReady = kitchenReady && order.status === OrderStatus['In Progress'];
  const deferred = showKitchenReady ? [] : orderDeferredCharges(order);

  if (showKitchenReady) {
    return (
      <span
        data-testid="order-status-badge"
        className={cn(
          'uppercase p-1 px-3 rounded-lg text-sm font-bold inline-block',
          STATUS_COLORS[OrderStatus.Paid],
          className,
        )}
      >
        {t('status.ready')}
      </span>
    );
  }

  if (deferred.length > 0) {
    return (
      <span className={cn('inline-flex flex-wrap gap-1', className)} data-testid="order-status-badge">
        {deferred.map((kind) => (
          <span
            key={kind}
            data-testid={`order-status-${kind}`}
            className={cn(
              'uppercase p-1 px-3 rounded-lg text-sm font-bold inline-block',
              DEFERRED_COLORS[kind],
            )}
          >
            {t(kind === 'room' ? 'status.room' : 'status.credit')}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      data-testid="order-status-badge"
      className={cn(
        'uppercase p-1 px-3 rounded-lg text-sm font-bold inline-block',
        STATUS_COLORS[order?.status] ?? 'bg-neutral-100 text-neutral-700',
        className,
      )}
    >
      {translateOrderStatus(t, order?.status)}
    </span>
  );
};
