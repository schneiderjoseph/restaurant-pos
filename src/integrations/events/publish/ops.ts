import { createPosEvent } from '@/integrations/events/pos-event-adapter.ts';
import { ManagerLike, safePublish } from '@/integrations/events/publish/safe.ts';

export type DayClosedPayload = {
  closingId: string;
  businessDate?: string;
  closedBy?: string;
  totals?: Record<string, number>;
};

export const dayClosedEventId = (closingId: string) => `DayClosed:${closingId}`;

export const publishDayClosed = async (
  manager: ManagerLike,
  payload: DayClosedPayload
): Promise<void> => {
  await safePublish(
    manager,
    async (m) => {
      await m.publish(
        createPosEvent(
          'DayClosed',
          payload,
          'ops-core',
          dayClosedEventId(payload.closingId)
        )
      );
    },
    'DayClosed'
  );
};
