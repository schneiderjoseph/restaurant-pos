/**
 * Compatibility re-exports — prefer `@/integrations/events`.
 */
export {
  saleCompletedEventId,
  saleRefundedEventId,
  orderCancelledEventId,
  publishSaleCompleted,
  publishSaleRefunded,
  publishOrderCancelled,
} from '@/integrations/events/publish/sales.ts';
