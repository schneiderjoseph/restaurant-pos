import { IntegrationEvent } from '@/integrations/core/types.ts';
import { categorizeExternalError, isRetriableExternalError } from '@/integrations/accounting/external/errors.ts';

export type ExternalEventRoutingResult = {
  handled: boolean;
  action?: string;
  skippedReason?: string;
  error?: string;
  retriable?: boolean;
};

/**
 * Routes a POS business event to the correct outbound path:
 *   sale/refund/customer → entity sync (via adapter)
 */
export const routeExternalAccountingEvent = async (
  event: IntegrationEvent<any>,
  enqueueJob: (action: string, payload: Record<string, unknown>, idempotencyKey?: string) => Promise<void>
): Promise<ExternalEventRoutingResult> => {
  try {
    // Sales and payments → native entity sync
    if (event.name === 'SaleCompleted') {
      const orderId = String(event.payload?.orderId ?? event.payload?.id ?? '');
      if (!orderId) return { handled: false, error: 'SaleCompleted missing order id' };
      await enqueueJob('syncSale', { eventPayload: event.payload }, `syncSale:${orderId}`);
      return { handled: true, action: 'syncSale' };
    }

    if (event.name === 'PaymentCompleted') {
      const paymentId = String(event.payload?.paymentId ?? event.payload?.id ?? '');
      if (!paymentId) return { handled: false, error: 'PaymentCompleted missing payment id' };
      await enqueueJob('syncPayment', { eventPayload: event.payload }, `syncPayment:${paymentId}`);
      return { handled: true, action: 'syncPayment' };
    }

    if (event.name === 'SaleRefunded') {
      const refundId = String(event.payload?.refundId ?? event.payload?.id ?? '');
      if (!refundId) return { handled: false, error: 'SaleRefunded missing refund id' };
      await enqueueJob('syncRefund', { eventPayload: event.payload }, `syncRefund:${refundId}`);
      return { handled: true, action: 'syncRefund' };
    }

    if (event.name === 'CustomerCreated') {
      const customerId = String(event.payload?.customerId ?? event.payload?.id ?? '');
      if (!customerId) return { handled: false, error: 'CustomerCreated missing customer id' };
      await enqueueJob('syncCustomer', { eventPayload: event.payload }, `syncCustomer:${customerId}`);
      return { handled: true, action: 'syncCustomer' };
    }

    return { handled: false, skippedReason: `No handler for event ${event.name}` };
  } catch (err: any) {
    const category = categorizeExternalError(err);
    return {
      handled: false,
      error: err?.message ?? 'Event routing failed',
      retriable: isRetriableExternalError(category),
    };
  }
};
