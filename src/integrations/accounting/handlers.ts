import {
  OrderCancelledPayload,
  SaleCompletedPayload,
  SaleRefundedPayload,
} from '@/integrations/accounting/events/payloads.ts';
import { TemplateAmountContext } from '@/integrations/accounting/templates/builder.ts';
import { IntegrationEventName } from '@/integrations/core/types.ts';

export interface EventPostingHandler {
  buildAmounts: (payload: any) => TemplateAmountContext;
  originRecordId: (payload: any) => string | undefined;
}

const saleLikeAmounts = (payload: {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  tipAmount: number;
  totalCollected: number;
  tenders: { cashAmount: number; cardAmount: number; otherAmount: number };
}): TemplateAmountContext => {
  const salesRevenue = Number((payload.subtotal + payload.discountAmount).toFixed(2));
  return {
    cashAmount: payload.tenders.cashAmount,
    cardAmount: payload.tenders.cardAmount,
    otherAmount: payload.tenders.otherAmount,
    taxAmount: payload.taxAmount,
    discountAmount: payload.discountAmount,
    tipAmount: payload.tipAmount,
    salesRevenue,
    totalCollected: payload.totalCollected,
  };
};

export const buildSaleCompletedAmountContext = (
  payload: SaleCompletedPayload
): TemplateAmountContext => saleLikeAmounts(payload);

export const EVENT_POSTING_HANDLERS: Partial<
  Record<IntegrationEventName, EventPostingHandler>
> = {
  SaleCompleted: {
    buildAmounts: (payload: SaleCompletedPayload) => saleLikeAmounts(payload),
    originRecordId: (payload: SaleCompletedPayload) => payload.orderId,
  },
  SaleRefunded: {
    buildAmounts: (payload: SaleRefundedPayload) => saleLikeAmounts(payload),
    originRecordId: (payload: SaleRefundedPayload) =>
      payload.refundId || payload.orderId,
  },
  OrderCancelled: {
    buildAmounts: (payload: OrderCancelledPayload) => saleLikeAmounts(payload),
    originRecordId: (payload: OrderCancelledPayload) => payload.orderId,
  },
};
