import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { ORDER_FETCHES, type Order, OrderStatus } from '@/api/model/order.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { CustomerAlerts } from '@/components/customer/customer.alerts.tsx';
import { customerHistoryIds, customerNumberLabel, isCustomerDeleted } from '@/lib/customer.service.ts';
import { maskIdDocument } from '@/lib/customer-id-document.ts';
import { visiblePhone } from '@/lib/phone.ts';
import { formatGuestLabel } from '@/lib/guest.ts';
import { calculateOrderNetSales, getInvoiceNumber, translateOrderStatus } from '@/lib/order.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { withCurrency } from '@/lib/utils.ts';

interface Props {
  customer?: Customer;
  canViewIdDocument: boolean;
  canViewPhone: boolean;
  onClose: () => void;
}

/** Orders kept for the stats: enough for a regular, bounded for the screen. */
const HISTORY_LIMIT = 200;

/** Who the customer is, what they like, and what they ordered (merged duplicates included). */
export const CustomerDetail = ({ customer, canViewIdDocument, canViewPhone, onClose }: Props) => {
  const { t } = useTranslation(['admin', 'menu', 'orders', 'common']);
  const { t: tOrders } = useTranslation('orders');
  const db = useDB();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customer?.id) return;
    let cancelled = false;
    setOrders([]);
    setLoading(true);
    void (async () => {
      try {
        const customers = await customerHistoryIds(db, customer.id);
        const [rows] = await db.query<Order[]>(
          `SELECT * FROM ${Tables.orders}
           WHERE customer IN $customers
           ORDER BY created_at DESC
           LIMIT ${HISTORY_LIMIT}
           FETCH ${ORDER_FETCHES.join(', ')}`,
          { customers },
        );
        if (!cancelled) setOrders(Array.isArray(rows) ? rows : []);
      } catch (error) {
        console.error('Customer history failed', error);
        if (!cancelled) {
          toast.error(t('admin:customers.historyLoadFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on another customer only
  }, [customer?.id]);

  const stats = useMemo(() => {
    const counted = orders.filter(
      (order) => order.status !== OrderStatus.Cancelled && order.status !== OrderStatus.Merged,
    );
    const paid = counted.filter((order) => order.status === OrderStatus.Paid);
    const spent = paid.reduce((sum, order) => sum + calculateOrderNetSales(order), 0);
    const dishes = new Map<string, number>();
    for (const order of counted) {
      for (const item of order.items ?? []) {
        if (!item || item.deleted_at || item.is_refunded) continue;
        const name = item.item?.name?.trim();
        if (!name) continue;
        dishes.set(name, (dishes.get(name) ?? 0) + (Number(item.quantity) || 1));
      }
    }
    const favorites = [...dishes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      visits: counted.length,
      spent,
      average: paid.length ? spent / paid.length : 0,
      lastAt: counted[0]?.created_at,
      favorites,
    };
  }, [orders]);

  if (!customer) return null;

  const identity: Array<[string, string]> = [
    [t('menu:customer.number'), customerNumberLabel(customer)],
    [t('menu:guest.phone'), visiblePhone(customer.phone, canViewPhone)],
    [t('admin:customers.email'), customer.email ?? ''],
    [
      customer.id_document_type
        ? t(`menu:customer.idType.${customer.id_document_type}`, { defaultValue: t('menu:guest.idDocument') })
        : t('menu:guest.idDocument'),
      customer.id_document_number
        ? (canViewIdDocument ? customer.id_document_number : maskIdDocument(customer.id_document_number))
        : '',
    ],
    [t('menu:guest.room'), customer.room ?? ''],
    [t('menu:customer.language'), customer.language ?? ''],
    [t('menu:customer.birthday'), customer.birthday ?? ''],
    [t('admin:customers.source'), t(`admin:customers.sources.${customer.source || 'local'}`, { defaultValue: customer.source || '' })],
    [t('admin:customers.createdAt'), customer.created_at ? toLuxonDateTime(customer.created_at).toFormat('dd LLL yyyy') : ''],
    [t('menu:customer.marketingConsent'), customer.marketing_consent ? t('common:actions.yes') : ''],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title={formatGuestLabel(customer)} size="lg" testId="customer-detail">
      <div className="space-y-4">
        {isCustomerDeleted(customer) && (
          <div className="rounded-lg bg-danger-100 text-danger-800 p-3" data-testid="customer-detail-deleted">
            {customer.merged_into ? t('admin:customers.mergedBanner') : t('admin:customers.deletedBanner')}
            {customer.deleted_reason ? ` — ${customer.deleted_reason}` : ''}
          </div>
        )}

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {identity.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-neutral-500 shrink-0">{label}:</dt>
              <dd className="font-medium break-all">{value}</dd>
            </div>
          ))}
        </dl>

        <CustomerAlerts customer={customer} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="customer-stats">
          {[
            [t('admin:customers.stats.visits'), String(stats.visits)],
            [t('admin:customers.stats.spent'), withCurrency(stats.spent)],
            [t('admin:customers.stats.average'), withCurrency(stats.average)],
            [t('admin:customers.stats.lastVisit'), stats.lastAt ? toLuxonDateTime(stats.lastAt).toFormat('dd LLL yyyy') : '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-neutral-100 p-3">
              <div className="text-xs uppercase text-neutral-500">{label}</div>
              <div className="text-xl font-bold">{value}</div>
            </div>
          ))}
        </div>

        {stats.favorites.length > 0 && (
          <div>
            <h3 className="font-semibold mb-1">{t('admin:customers.stats.favorites')}</h3>
            <div className="flex flex-wrap gap-2">
              {stats.favorites.map(([name, quantity]) => (
                <span key={name} className="rounded-lg bg-primary-100 text-primary-800 px-3 py-1">
                  {name} × {quantity}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-1">{t('menu:guest.folio')}</h3>
          {loading && <div className="text-neutral-500">{t('common:actions.loading')}</div>}
          {!loading && orders.length === 0 && <div className="text-neutral-500">{t('menu:guest.folioEmpty')}</div>}
          <div className="divide-y rounded-lg border border-neutral-200 max-h-[40vh] overflow-auto">
            {orders.slice(0, 50).map((order) => (
              <div key={order.id?.toString()} className="flex justify-between gap-3 px-3 py-2">
                <div>
                  <div className="font-semibold">
                    {t('menu:header.orderNumber', { number: getInvoiceNumber(order) })}
                  </div>
                  <div className="text-sm text-neutral-500">
                    {toLuxonDateTime(order.created_at).toFormat('dd LLL yyyy HH:mm')}
                    {' · '}
                    {translateOrderStatus(tOrders, order.status)}
                  </div>
                </div>
                <div className="font-semibold whitespace-nowrap">{withCurrency(calculateOrderNetSales(order))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
