import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Order } from '@/api/model/order.ts';
import { useDB } from '@/api/db/db.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { OrderReceiptView } from '@/components/reports/order-receipt/order.receipt.view.tsx';
import { fetchOrderFull } from '@/lib/order-fetch.ts';
import { getInvoiceNumber } from '@/lib/order.ts';

interface Props {
  /** Order to show; null closes the modal. */
  orderId: unknown;
  onClose: () => void;
  /** Prints this order as a room charge slip (FR / EN). */
  onPrint?: (order: Order, lang: 'fr' | 'en') => void;
}

/** Full receipt (dishes, extras, taxes, payments) of an order charged to a room — read only. */
export const RoomOrderModal = ({ orderId, onClose, onPrint }: Props) => {
  const { t } = useTranslation(['frontdesk', 'menu']);
  const db = useDB();
  const [order, setOrder] = useState<Order | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setOrder(undefined);
    setFailed(false);
    if (orderId == null) return;
    let cancelled = false;
    fetchOrderFull(db, orderId)
      .then((row) => {
        if (cancelled) return;
        if (row) setOrder(row);
        else setFailed(true);
      })
      .catch((error) => {
        console.error('Room order load failed', error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, orderId]);

  return (
    <Modal
      open={orderId != null}
      onClose={onClose}
      title={order ? t('menu:header.orderNumber', { number: getInvoiceNumber(order) }) : t('roomOrderTitle')}
      size="md"
      testId="frontdesk-room-order"
    >
      <div className="space-y-3">
        {failed ? (
          <p className="text-sm text-danger-700">{t('roomOrderLoadFailed')}</p>
        ) : !order ? (
          <p className="text-sm text-neutral-500 py-6 text-center">{t('roomOrderLoading')}</p>
        ) : (
          <>
            <div className="max-h-[65vh] overflow-auto">
              <OrderReceiptView order={order} />
            </div>
            {onPrint && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => onPrint(order, 'fr')}>
                  {t('printFicheFr')}
                </Button>
                <Button variant="secondary" onClick={() => onPrint(order, 'en')}>
                  {t('printFicheEn')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
