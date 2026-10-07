import { Order, OrderStatus } from "@/api/model/order.ts";
import { cn } from "@/lib/utils.ts";
import {formatOrderNumber, translateOrderStatus} from "@/lib/order.ts";
import {useTranslation} from "react-i18next";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPrint} from "@fortawesome/free-solid-svg-icons";
import {formatGuestContact, formatGuestLabel} from "@/lib/guest-label.ts";
import {formatTableLabel} from "@/lib/table-label.ts";
import {OrderLineageLabel} from "@/components/orders/order.lineage.tsx";
import type {OrderLineage} from "@/lib/order-lineage.ts";

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
  const showKitchenReady = kitchenReady && order.status === OrderStatus["In Progress"];

  const colors = {
    [OrderStatus["In Progress"]]: 'bg-warning-100 text-warning-700',
    [OrderStatus["Paid"]]: 'bg-success-100 text-success-700',
    [OrderStatus["Completed"]]: 'bg-success-100 text-success-700',
    [OrderStatus['Merged']]: 'bg-info-100 text-info-700',
    [OrderStatus['Spilt']]: 'bg-info-100 text-info-700',
    [OrderStatus['Cancelled']]: 'bg-danger-100 text-danger-700',
  };

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
          <span
            data-testid="order-status-badge"
            className={cn(
              "uppercase p-1 px-3 rounded-lg text-sm font-bold flex-grow-0 flex-shrink",
              showKitchenReady ? colors[OrderStatus.Paid] : colors[order?.status]
            )}
          >{showKitchenReady ? t('status.ready') : translateOrderStatus(t, order?.status)}</span>
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
