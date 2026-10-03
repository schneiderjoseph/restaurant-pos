import { useEffect, useState } from "react";
import { Order, OrderStatus } from "@/api/model/order.ts";
import { toLuxonDateTime, nowInAppTimezone } from "@/lib/datetime.ts";
import { formatElapsed } from "@/lib/order.ts";

interface Props {
  order: Order
}

export const OrderElapsed = ({
  order
}: Props) => {
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

  if (!isInProgress) {
    return (
      <div className="flex text-neutral-600">
        <span>{time}</span>
      </div>
    );
  }

  const minutes = Math.max(0, Math.floor(nowInAppTimezone().diff(createdAt, 'minutes').minutes));

  return (
    <div className="flex text-neutral-600">
      <span>{time} · {formatElapsed(minutes)}</span>
    </div>
  );
}
