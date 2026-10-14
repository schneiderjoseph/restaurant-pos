import { Order } from "@/api/model/order.ts";
import {formatOrderNumber} from "@/lib/order.ts";
import {useTranslation} from "react-i18next";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPrint} from "@fortawesome/free-solid-svg-icons";
import {formatGuestContact, formatGuestLabel} from "@/lib/guest-label.ts";
import {formatTableLabel} from "@/lib/table-label.ts";
import {OrderLineageLabel} from "@/components/orders/order.lineage.tsx";
import type {OrderLineage} from "@/lib/order-lineage.ts";
import {OrderStatusBadge} from "@/components/orders/order.status-badge.tsx";

interface Props {
  order: Order
  tempPrinted?: boolean
  kitchenReady?: boolean
  lineage?: OrderLineage
}

export const OrderHeader = ({
  order,
  tempPrinted = false,
  kitchenReady = false,
  lineage,
}: Props) => {
  const {t} = useTranslation('orders');
  const guestContact = order?.customer ? formatGuestContact(order.customer) : '';

  return (
    <div className="flex justify-between">
      <div className="flex gap-3">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-black leading-none text-neutral-900" data-testid="order-number">
              {formatOrderNumber(order)}
            </span>
            {order?.table && (
              <span className="text-lg font-bold text-neutral-900">{formatTableLabel(order.table)}</span>
            )}
          </div>
          <OrderStatusBadge order={order} kitchenReady={kitchenReady} className="flex-grow-0 flex-shrink" />
          <OrderLineageLabel lineage={lineage}/>

        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {tempPrinted && (
            <span
              className="text-warning-600 bg-warning-100 px-2 py-1 rounded"
              title={t('print.tempAlreadyPrinted')}
            >
              <FontAwesomeIcon icon={faPrint} />
            </span>
          )}
          <span className="text-lg font-bold bg-neutral-200 px-2 rounded">{order?.user?.first_name}</span>
        </div>
        {order?.customer && (
          <>
            <span>{formatGuestLabel(order.customer)}</span>
            {guestContact ? <span>{guestContact}</span> : null}
          </>
        )}

      </div>
    </div>
  )
}
