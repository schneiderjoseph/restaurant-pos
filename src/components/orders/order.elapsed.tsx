import { useEffect, useState } from "react";
import { Order, OrderStatus } from "@/api/model/order.ts";
import { toLuxonDateTime, nowInAppTimezone } from "@/lib/datetime.ts";
import { formatElapsed } from "@/lib/order.ts";
import { formatDueLabel } from "@/lib/order-due.ts";
import { useTranslation } from "react-i18next";

interface Props {
  order: Order
}

export const OrderElapsed = ({
  order
}: Props) => {
  const {t} = useTranslation('orders');
  const [, setTick] = useState(0);
  const isInProgress = order.status === OrderStatus["In Progress"];

  useEffect(() => {
    if (!isInProgress) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isInProgress]);

  const createdAt = toLuxonDateTime(order.created_at);
  const time = createdAt.toFormat('HH:mm');
  // When the guest wants it (set by the server at order time); absent = as soon as possible.
  const due = order.due_at ? (
    <span className="font-bold text-warning-700" data-testid="order-due-at">
      {t('due.forTime', {
        time: formatDueLabel(toLuxonDateTime(order.due_at), nowInAppTimezone(), t('due.tomorrowShort')),
      })}
    </span>
  ) : null;

  if (!isInProgress) {
    return (
      <div className="flex flex-wrap gap-x-3 text-neutral-600">
        <span>{time}</span>
        {due}
      </div>
    );
  }

  const minutes = Math.max(0, Math.floor(nowInAppTimezone().diff(createdAt, 'minutes').minutes));

  return (
    <div className="flex flex-wrap gap-x-3 text-neutral-600">
      <span>{time} · {formatElapsed(minutes)}</span>
      {due}
    </div>
  );
}
