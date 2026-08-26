import {Order as OrderModel, OrderStatus} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {Customer} from "@/api/model/customer.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {OrderItemName} from "@/components/common/order/order.item.tsx";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {toRecordId, withCurrency} from "@/lib/utils.ts";
import React, {useMemo, useState} from "react";
import {faArrowLeft, faCheck, faPlus, faTrash} from "@fortawesome/free-solid-svg-icons";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {toast} from "sonner";
import {RecordId} from "surrealdb";
import ScrollContainer from "react-indiana-drag-scroll";
import {nanoid} from "nanoid";
import {getInvoiceNumber, getOrderFilteredItems} from "@/lib/order.ts";
import {assertOrderMutationsAllowed} from "@/lib/closing.guard.ts";
import {useAtom} from "jotai";
import {appPage} from "@/store/jotai.ts";
import {generateNextInvoiceNumber, getNextAutoId} from "@/lib/invoice.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {useTranslation} from "react-i18next";
import {IconTooltipButton} from "@/components/common/input/icon.tooltip.button.tsx";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {formatGuestLabel} from "@/lib/guest-label.ts";
import {LabelValue} from "@/api/model/common.ts";

interface Props {
  order: OrderModel
  onClose?: () => void;
}

interface ClientSplit {
  id: string;
  name: string;
  items: OrderItem[];
  number: number;
  customer?: Customer;
}

export const SplitByClients = ({
  order, onClose
}: Props) => {
  const {t} = useTranslation(['orders', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const {data: customersData} = useApi<SettingsData<Customer>>(Tables.customers, [], ['name asc'], 0, 99999);

  const customerOptions: LabelValue[] = useMemo(() => (
    (customersData?.data ?? []).map((c) => ({
      label: formatGuestLabel(c) || c.guest_code || String(c.id),
      value: c.id?.toString(),
    }))
  ), [customersData?.data]);

  const [splits, setSplits] = useState<ClientSplit[]>([
    {
      id: 'split-1',
      name: t('split.splitName', {number: 1}),
      items: [...getOrderFilteredItems(order)],
      number: 1,
      customer: order.customer,
    },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [draggedItem, setDraggedItem] = useState<OrderItem | null>(null);
  const [dragOverSplit, setDragOverSplit] = useState<string | null>(null);

  const splitTotals = useMemo(() => {
    return splits.map(split =>
      split.items.reduce((total, item) => total + calculateOrderItemPrice(item), 0)
    );
  }, [splits]);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customersData?.data ?? []) {
      map.set(c.id?.toString(), c);
    }
    return map;
  }, [customersData?.data]);

  const setSplitCustomer = (splitId: string, option: LabelValue | null) => {
    const customer = option?.value ? customerById.get(String(option.value)) : undefined;
    setSplits(prev => prev.map(split =>
      split.id === splitId ? {...split, customer} : split
    ));
  };

  const addSplit = () => {
    setSplits(prev => [...prev, {
      id: nanoid(),
      name: t('split.splitName', {number: prev.length + 1}),
      number: prev.length + 1,
      items: [],
      customer: undefined,
    }]);
  };

  const removeSplit = (splitId: string) => {
    if (splits.length <= 1) return;
    setSplits(prev => {
      const removed = prev.find(s => s.id === splitId);
      const filtered = prev.filter(s => s.id !== splitId);
      if (removed) {
        const first = filtered.find(s => s.id === 'split-1');
        if (first) {
          first.items = [...first.items, ...removed.items];
        }
      }
      return filtered.map((split, index) => ({
        ...split,
        name: t('split.splitName', {number: index + 1}),
        number: index + 1,
      }));
    });
  };

  const moveItemToSplit = (item: OrderItem, splitId: string) => {
    setSplits(prev => {
      const current = prev.find(s => s.items.some(i => i.id === item.id));
      if (current?.id === splitId) return prev;
      return prev.map(split => {
        if (split.id === splitId) {
          return {...split, items: [...split.items, item]};
        }
        return {...split, items: split.items.filter(i => i.id !== item.id)};
      });
    });
  };

  const handleDragStart = (e: React.DragEvent, item: OrderItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id));
  };

  const handleDragOver = (e: React.DragEvent, splitId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSplit(splitId);
  };

  const handleDrop = (e: React.DragEvent, splitId: string) => {
    e.preventDefault();
    if (draggedItem) moveItemToSplit(draggedItem, splitId);
    setDraggedItem(null);
    setDragOverSplit(null);
  };

  const canSave =
    splits.length > 1 &&
    splits.every(s => s.items.length > 0 && !!s.customer?.id);

  const handleSaveSplits = async () => {
    if (!canSave) {
      if (splits.some(s => s.items.length > 0 && !s.customer?.id)) {
        toast.error(t('split.byClients.customerRequired'));
      }
      return;
    }

    setIsSaving(true);
    try {
      await assertOrderMutationsAllowed(db);
      const createdAt = new Date();
      const createdOrders = [];
      const oldOrderId = order.id.toString();
      const oldItems: Record<string, string[]> = {
        [oldOrderId]: getOrderFilteredItems(order).map(item => item.id.toString()),
      };
      const newItems: Record<string, string[]> = {};

      for (const split of splits) {
        if (split.items.length === 0) continue;
        const items = split.items.map(item => item.id);
        const nextInvoiceNumber = await generateNextInvoiceNumber(db);
        const nextAutoId = await getNextAutoId(db);

        const orderData = {
          floor: new RecordId('floor', order.floor.id),
          covers: Math.ceil(order.covers / splits.length) || 1,
          tags: [OrderStatus['Spilt']],
          customer: toRecordId(split.customer!.id),
          order_type: order.order_type.id,
          status: OrderStatus["In Progress"],
          auto_id: nextAutoId,
          invoice_number: nextInvoiceNumber,
          items,
          table: order.table.id,
          user: order.user.id,
          created_at: createdAt,
          split: split.number,
        };

        const splitOrder = await db.create(Tables.orders, orderData);
        createdOrders.push(splitOrder[0]);
        newItems[splitOrder[0].id.toString()] = items.map(item => item.toString());

        for (const item of items) {
          await db.merge(item, {order: splitOrder[0].id});
        }
      }

      await db.merge(order.id, {
        status: OrderStatus['Spilt'],
        items: [],
        tags: [...(order.tags || []), OrderStatus['Spilt']],
      });

      await db.create(Tables.order_split, {
        created_at: new Date(),
        created_by: toRecordId(page.user.id),
        old_order: order.id,
        new_orders: createdOrders.map(item => item.id),
        old_items: oldItems,
        new_items: newItems,
      });

      postOrderTracking({
        module: "orders.split_by_items",
        page: page?.page,
        orderId: order.id,
        payload: {
          split_count: createdOrders.length,
          mode: 'clients',
          new_orders: createdOrders.map((item) => item.id.toString()),
        },
        user: page?.user,
      });

      toast.success(t('split.toast.success', {count: createdOrders.length}));
      onClose?.();
    } catch (error) {
      console.error('Error creating client split orders:', error);
      toast.error(t('split.toast.failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const renderSplitCard = (split: ClientSplit, index: number) => {
    const selectedOption = split.customer
      ? {
          label: formatGuestLabel(split.customer) || split.customer.guest_code || String(split.customer.id),
          value: split.customer.id?.toString(),
        }
      : null;

    return (
      <div
        key={split.id}
        className={`bg-white rounded-xl shadow-lg border border-gray-200 min-w-[320px] ${
          dragOverSplit === split.id ? 'border-primary-400 bg-primary-50' : ''
        }`}
        onDragOver={(e) => handleDragOver(e, split.id)}
        onDragLeave={() => setDragOverSplit(null)}
        onDrop={(e) => handleDrop(e, split.id)}
      >
        <div className="p-4 border-b border-gray-200 space-y-3">
          <div className="flex justify-between items-center gap-2">
            <h4 className="font-semibold text-gray-800">{split.name}</h4>
            {index > 0 && (
              <IconTooltipButton
                label={t('common:actions.delete')}
                icon={faTrash}
                variant="danger"
                onClick={() => removeSplit(split.id)}
              />
            )}
          </div>
          <ReactSelect
            options={customerOptions}
            value={selectedOption}
            onChange={(value: LabelValue | null) => setSplitCustomer(split.id, value)}
            placeholder={t('split.byClients.pickCustomer')}
            isClearable
          />
          <div className="text-sm font-semibold text-neutral-600">
            {t('split.byItems.total', {amount: withCurrency(splitTotals[index] ?? 0)})}
          </div>
        </div>
        <ScrollContainer className="max-h-[360px] p-3 space-y-2">
          {split.items.length === 0 ? (
            <div className="text-sm text-neutral-400 p-3">{t('split.byItems.dragFromSplitOne')}</div>
          ) : (
            split.items.map(item => (
              <div
                key={item.id?.toString()}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={() => setDraggedItem(null)}
                className="p-2 rounded-lg border bg-neutral-50 cursor-grab active:cursor-grabbing"
              >
                <OrderItemName item={item}/>
                <div className="text-sm font-bold">{withCurrency(calculateOrderItemPrice(item))}</div>
              </div>
            ))
          )}
        </ScrollContainer>
      </div>
    );
  };

  return (
    <Modal
      testId="order-split-clients"
      title={t('split.byClients.title', {invoice: getInvoiceNumber(order)})}
      open={true}
      size="full"
      onClose={onClose}
    >
      <div className="flex flex-col h-full gap-4 p-4">
        <p className="text-sm text-neutral-600">{t('split.byClients.hint')}</p>
        <ScrollContainer className="flex-1">
          <div className="flex gap-4 min-h-[420px] pb-4">
            {splits.map((split, index) => renderSplitCard(split, index))}
            <div className="min-w-[180px] flex items-start">
              <Button variant="primary" flat icon={faPlus} onClick={addSplit}>
                {t('split.byItems.addSplit')}
              </Button>
            </div>
          </div>
        </ScrollContainer>
        <div className="flex justify-between items-center gap-3 border-t pt-3">
          <Button variant="neutral" flat icon={faArrowLeft} onClick={onClose}>
            {t('common:actions.back')}
          </Button>
          <Button
            variant="primary"
            filled
            icon={faCheck}
            isLoading={isSaving}
            disabled={!canSave || isSaving}
            onClick={() => void handleSaveSplits()}
          >
            {isSaving
              ? t('split.byItems.creating')
              : t('split.bySeats.save', {count: splits.filter(s => s.items.length > 0).length})}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

