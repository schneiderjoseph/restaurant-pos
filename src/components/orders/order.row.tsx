import {Order as OrderModel, OrderStatus} from "@/api/model/order.ts";
import {calculateOrderTotal, getOrderServiceChargeAmount} from "@/lib/cart.ts";
import React, {useMemo, useState} from "react";
import {cn} from "@/lib/utils.ts";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";
import {OrderPayment} from "@/components/orders/order.payment.tsx";
import {formatOrderNumber, getOrderDisplayItems, translateOrderStatus} from "@/lib/order.ts";
import {useTranslation} from "react-i18next";
import {useOrderCardHydrate} from "@/hooks/useOrderCardHydrate.ts";
import {useDB} from "@/api/db/db.ts";
import {fetchOrderFull} from "@/lib/order-fetch.ts";
import {toast} from "sonner";
import {formatGuestLabel} from "@/lib/guest-label.ts";
import {OrderElapsed} from "@/components/orders/order.elapsed.tsx";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";
import {RECEIVE_PAYMENT_MODULE} from "@/lib/payment-access.ts";
import {formatTableLabel} from "@/lib/table-label.ts";

/** Shared by the sticky header and every row so columns line up. */
export const ORDERS_LIST_GRID_CLASS =
  "grid grid-cols-[minmax(4.5rem,5.5rem)_minmax(7rem,1.5fr)_minmax(5rem,0.85fr)_minmax(6.5rem,1fr)_minmax(5.5rem,0.95fr)_minmax(4rem,0.55fr)_minmax(5.5rem,1fr)] gap-x-2 items-center px-3";

interface Props {
  order: OrderModel
  kitchenReady?: boolean
}

export const OrderRow = ({
  order: snapshot,
  kitchenReady = false,
}: Props) => {
  const {t} = useTranslation('orders');
  const db = useDB();
  const {rootRef, displayOrder: order, cardReady, isHydrating, retryHydrate} = useOrderCardHydrate(snapshot);
  const itemsTotal = cardReady ? calculateOrderTotal(order) : 0;
  const [paymentOrder, setPaymentOrder] = useState<OrderModel | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  const showKitchenReady = kitchenReady && order.status === OrderStatus["In Progress"];

  const colors = {
    [OrderStatus["In Progress"]]: 'bg-warning-100 text-warning-700',
    [OrderStatus["Paid"]]: 'bg-success-100 text-success-700',
    [OrderStatus["Completed"]]: 'bg-success-100 text-success-700',
  };

  const total = useMemo(() => {
    const extrasTotal = order?.extras
      ? order.extras.reduce((prev, item) => prev + Number(item?.value || 0), 0)
      : 0;
    const serviceChargeAmount = cardReady
      ? getOrderServiceChargeAmount(order, itemsTotal)
      : Number(order?.service_charge_amount ?? 0);
    if (!cardReady) {
      return Number(order?.tax_amount || 0) - Number(order?.discount_amount || 0) + serviceChargeAmount
        + extrasTotal;
    }
    return itemsTotal + extrasTotal + Number(order?.tax_amount || 0) - Number(order?.discount_amount || 0) + serviceChargeAmount;
  }, [cardReady, itemsTotal, order]);

  // A role that cannot take a payment gets a read-only row.
  const {can} = useModuleAccess();
  const canReceivePayment = can(RECEIVE_PAYMENT_MODULE);
  const isActionable = canReceivePayment && order.status === OrderStatus["In Progress"] && !isLoadingFull;

  const openPayment = async () => {
    if (!canReceivePayment || order.status !== OrderStatus["In Progress"] || isLoadingFull) {
      return;
    }
    setIsLoadingFull(true);
    try {
      const full = await fetchOrderFull(db, snapshot.id);
      if (!full) {
        toast.error(t('loadFailed'));
        return;
      }
      setPaymentOrder(full);
    } catch (error) {
      console.error('Failed to load full order', error);
      toast.error(t('loadFailed'));
    } finally {
      setIsLoadingFull(false);
    }
  };

  return (
    <>
      <div
        ref={rootRef}
        onClick={() => {
          void openPayment();
        }}
        className={cn(
          ORDERS_LIST_GRID_CLASS,
          "min-h-[56px] select-none border-b border-neutral-200 odd:bg-white even:bg-neutral-100",
          isActionable && "cursor-pointer active:bg-neutral-300",
          !isActionable && "cursor-default",
        )}
      >
        <div className="font-semibold py-2">{formatOrderNumber(order)}</div>

        <div className="flex flex-col justify-center gap-1 py-2 min-w-0">
          {order?.table && (
            <span className="text-sm font-medium text-neutral-900">
              {formatTableLabel(order.table)}
            </span>
          )}
          {order?.customer && (
            <span className="text-sm text-neutral-700 truncate">
              {formatGuestLabel(order.customer)}
            </span>
          )}
        </div>

        <div className="py-2 truncate">{order?.user?.first_name}</div>

        <div className="py-2">
          <span
            data-testid="order-status-badge"
            className={cn(
              "uppercase p-1 px-3 rounded-lg text-sm font-bold inline-block",
              showKitchenReady ? colors[OrderStatus.Paid] : colors[order?.status]
            )}
          >{showKitchenReady ? t('status.ready') : translateOrderStatus(t, order?.status)}</span>
        </div>

        <div className="py-2 min-h-[2.5rem] flex flex-col justify-center">
          <OrderElapsed order={order} />
        </div>

        <div className="py-2 flex items-center">
          <span className="inline-flex h-[24px] min-w-[24px] rounded-full bg-neutral-900 text-white justify-center items-center text-sm">
            {cardReady ? getOrderDisplayItems(order).length : (isHydrating ? '…' : '—')}
          </span>
        </div>

        <div className="py-2 text-right font-bold text-lg text-danger-700">
          {cardReady ? <DualCurrency amount={total} primaryClassName="text-lg font-bold" /> : '…'}
        </div>
      </div>

      {paymentOrder && (
        <OrderPayment order={paymentOrder} onClose={() => {
          setPaymentOrder(null);
          void retryHydrate();
        }}/>
      )}
    </>
  );
}
