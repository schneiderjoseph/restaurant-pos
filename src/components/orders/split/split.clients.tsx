import {Order as OrderModel} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {Customer} from "@/api/model/customer.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {OrderItemName} from "@/components/common/order/order.item.tsx";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {toRecordId, withCurrency} from "@/lib/utils.ts";
import React, {useMemo, useState} from "react";
import {faArrowLeft, faCheck, faPlus, faTrash, faUserPlus} from "@fortawesome/free-solid-svg-icons";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {toast} from "sonner";
import {canCarveUnit, carveUnit, commitSplit, linesRatio, orderHasPayments, partLines, splitErrorKey} from "@/lib/order-split.ts";
import {CarveUnitButton} from "@/components/orders/split/carve-unit-button.tsx";
import ScrollContainer from "react-indiana-drag-scroll";
import {nanoid} from "nanoid";
import {getInvoiceNumber, getOrderFilteredItems} from "@/lib/order.ts";
import {assertOrderMutationsAllowed} from "@/lib/closing.guard.ts";
import {useAtom} from "jotai";
import {appPage} from "@/store/jotai.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {useTranslation} from "react-i18next";
import {IconTooltipButton} from "@/components/common/input/icon.tooltip.button.tsx";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {formatGuestLabel} from "@/lib/guest-label.ts";
import {LabelValue} from "@/api/model/common.ts";
import {ACTIVE_CUSTOMER} from "@/lib/customer-scope.ts";
import {tapSelectedClass, useTapToMove} from "@/components/orders/split/use-tap-to-move.ts";
import {QuickCreateCustomerModal} from "@/components/customer/quick.create.modal.tsx";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";

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
  const {can} = useModuleAccess();
  const canCreateCustomer = can('customers.create');
  const {data: customersData, fetchData: refreshCustomers} = useApi<SettingsData<Customer>>(
    Tables.customers,
    [ACTIVE_CUSTOMER],
    ['name asc'],
    0,
    99999,
  );
  const [createForSplitId, setCreateForSplitId] = useState<string | null>(null);

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

  const assignCustomerToSplit = (splitId: string, customer: Customer) => {
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
      return filtered.map((split, index) => ({
        ...split,
        items: split.id === 'split-1' && removed ? [...split.items, ...removed.items] : split.items,
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

  const tap = useTapToMove(moveItemToSplit);

  // One unit of a multi-unit line becomes its own line (3 beers for 3 guests).
  const carveOne = (item: OrderItem, splitId: string) => {
    setSplits(prev => prev.map(split => split.id !== splitId ? split : {
      ...split,
      items: split.items.flatMap(line => line.id === item.id ? carveUnit(line) : [line]),
    }));
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
    if (orderHasPayments(order)) {
      toast.error(t('split.toast.hasPayments'));
      return;
    }

    setIsSaving(true);
    try {
      await assertOrderMutationsAllowed(db);
      const allLines = getOrderFilteredItems(order);
      const newOrders = await commitSplit(db, {
        order,
        user: page?.user,
        parts: splits.map(split => ({
          ...partLines(split.items),
          fields: {customer: toRecordId(split.customer!.id)},
          ratio: linesRatio(split.items, allLines, splits.length),
        })),
      });

      postOrderTracking({
        module: "orders.split_by_items",
        page: page?.page,
        orderId: order.id,
        payload: {
          split_count: newOrders.length,
          mode: 'clients',
          new_orders: newOrders.map(String),
        },
        user: page?.user,
      });

      toast.success(t('split.toast.success', {count: newOrders.length}));
      onClose?.();
    } catch (error) {
      console.error('Error creating client split orders:', error);
      toast.error(t(splitErrorKey(error)));
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
        className={`bg-white rounded-xl shadow-lg border border-gray-200 w-full max-w-[400px] min-w-0 ${
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
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <ReactSelect
                options={customerOptions}
                value={selectedOption}
                onChange={(value: LabelValue | null) => setSplitCustomer(split.id, value)}
                placeholder={t('split.byClients.pickCustomer')}
                isClearable
              />
            </div>
            {canCreateCustomer && (
              <IconTooltipButton
                label={t('split.byClients.newCustomer')}
                icon={faUserPlus}
                variant="primary"
                onClick={() => setCreateForSplitId(split.id)}
                data-testid={`split-create-customer-${split.number}`}
              />
            )}
          </div>
          <div className="text-sm font-semibold text-neutral-600">
            {t('split.byItems.total', {amount: withCurrency(splitTotals[index] ?? 0)})}
          </div>
        </div>
        <ScrollContainer className="max-h-[360px] min-h-[120px] p-3 space-y-2" {...tap.splitProps(split.id)}>
          {split.items.length === 0 ? (
            <div className="text-sm text-neutral-400 p-3">{t('split.byItems.dragFromSplitOne')}</div>
          ) : (
            split.items.map(item => (
              <div
                key={item.id?.toString()}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={() => setDraggedItem(null)}
                {...tap.itemProps(item)}
                className={`p-2 rounded-lg border bg-neutral-50 cursor-pointer ${tap.isSelected(item) ? tapSelectedClass : ''}`}
              >
                <OrderItemName item={item}/>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold">{withCurrency(calculateOrderItemPrice(item))}</div>
                  {canCarveUnit(item) && <CarveUnitButton onCarve={() => carveOne(item, split.id)}/>}
                </div>
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
        <p className="text-xs text-primary-600">{t('split.tapHint')}</p>
        <ScrollContainer className="flex-1">
          <div className="flex flex-row max-sm:flex-col gap-4 min-h-[420px] pb-4">
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

      {createForSplitId && (
        <QuickCreateCustomerModal
          open
          onClose={() => setCreateForSplitId(null)}
          onCreated={(customer) => {
            assignCustomerToSplit(createForSplitId, customer);
            refreshCustomers();
            setCreateForSplitId(null);
          }}
        />
      )}
    </Modal>
  );
};

