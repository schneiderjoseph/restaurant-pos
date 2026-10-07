import { useState } from "react";
import { Kitchen, KitchenOrderBatch } from "@/api/model/kitchen.ts";
import { Order } from "@/api/model/order.ts";
import { Countdown } from "@/components/floor/countdown.tsx";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/common/input/button.tsx";
import { Modal } from "@/components/common/react-aria/modal.tsx";
import { useDB } from "@/api/db/db.ts";
import { OrderItemName } from "@/components/common/order/order.item.tsx";
import { formatOrderNumber } from "@/lib/order.ts";
import { nowInAppTimezone, toLuxonDateTime } from "@/lib/datetime.ts";
import { formatDueLabel, timerStartWithDue } from "@/lib/order-due.ts";
import { completeStage, completeStages } from "@/lib/kitchen/workflow.service.ts";
import { dispatchPrint } from "@/lib/print.service.ts";
import { useAtom } from "jotai";
import { appPage } from "@/store/jotai.ts";
import { useTranslation } from "react-i18next";
import { useSecurity } from "@/hooks/useSecurity.ts";
import { useActionVisible } from "@/hooks/useActionVisible.ts";
import {
  formatKitchenGuestLabel,
  formatKitchenPlaceLabel,
  type KitchenGuestLabelMode,
} from "@/lib/kitchen-ticket-label.ts";

export type KitchenBoardTicket = {
  order: Order
  batch: KitchenOrderBatch
  isAddon: boolean
  showKindLabel: boolean
  /** Shared border color for multi-part tickets of the same order. */
  groupColor?: string
};

interface Props {
  ticket: KitchenBoardTicket
  kitchen?: Kitchen
  isNew?: boolean
  /** Numbers of the orders that replaced this one after a split by amount. */
  splitInto?: string
}

const batchStart = (batch: KitchenOrderBatch) =>
  batch.items[0]?.activated_at ?? batch.items[0]?.created_at ?? batch.createdAt;

export const KitchenOrder = ({
  ticket,
  kitchen,
  isNew = false,
  splitInto,
}: Props) => {
  const db = useDB();
  const [page] = useAtom(appPage);
  const { t } = useTranslation(["kitchen", "payment"]);
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canReprintKot = isVisible("orders.print_kot");
  const [printing, setPrinting] = useState(false);
  const [showItems, setShowItems] = useState(false);

  const { order, batch, isAddon, showKindLabel, groupColor } = ticket;
  const liveItems = batch.items.filter((item) => !item.order_item?.deleted_at);
  const itemCount = liveItems.reduce((sum, item) => sum + (item.order_item?.quantity ?? 1), 0);
  const stageStart = batchStart(batch);
  // An order wanted later is timed from its due time, not from when it was sent.
  const timerStart = timerStartWithDue(
    stageStart ? toLuxonDateTime(stageStart) : null,
    order?.due_at ? toLuxonDateTime(order.due_at) : null,
  );
  const diff = timerStart
    ? nowInAppTimezone().diff(timerStart).as('minutes')
    : 0;

  const guestLabelMode = (page?.menuConfig?.kitchenGuestLabel ?? 'name') as KitchenGuestLabelMode;
  const placeLabel = formatKitchenPlaceLabel(order?.table, {
    room: t('labels.room'),
    table: t('labels.table'),
  });
  const guestLabel = formatKitchenGuestLabel(order?.customer, guestLabelMode);

  const ready = async () => {
    try {
      await completeStages(db, liveItems.map((item) => item.id.toString()), page?.user?.id);
    } catch (error) {
      console.error('Kitchen ready failed', error);
    }
  };

  const singleReady = async (item: string) => {
    try {
      await completeStage(db, item, page?.user?.id);
    } catch (error) {
      console.error('Kitchen item ready failed', error);
    }
  };

  const doReprint = async () => {
    if (!kitchen?.printers?.length || printing) {
      return;
    }

    const items = liveItems
      .filter((item) => item.order_item)
      .map((item) => ({
        ...item.order_item,
        item: item.order_item.item,
      }));

    if (items.length === 0) {
      return;
    }

    setPrinting(true);
    try {
      await dispatchPrint(db, 'kitchen', {
        items,
        order,
        kitchenName: kitchen.name,
        table: order?.table,
        guestLabel,
        placeLabel,
        placeKind: order?.table?.source === 'asi-room' ? 'room' : 'table',
        duplicate: true,
      }, {
        title: t("payment:print.kitchenTitle"),
        copies: 1,
        userId: page?.user?.id,
        printers: kitchen.printers,
      });
    } catch (error) {
      console.error('Kitchen KOT reprint failed', error);
    } finally {
      setPrinting(false);
    }
  };

  const reprint = () => {
    void protectAction(() => {
      void doReprint();
    }, {
      module: "orders.print_kot",
      description: t("actions.reprint"),
      payload: {
        order: order?.id?.toString(),
      },
    });
  };

  const dueLabel = order?.due_at
    ? t('due.forTime', {
      time: formatDueLabel(toLuxonDateTime(order.due_at), nowInAppTimezone(), t('due.tomorrowShort')),
    })
    : null;
  const subtitle = [order?.order_type?.name, placeLabel].filter(Boolean).join(' · ');

  const kindLabel = showKindLabel ? (
    <span className={cn(
      "text-xs font-bold uppercase px-2 py-0.5 rounded-full shrink-0",
      isAddon ? "bg-primary-500 text-white" : "bg-neutral-200 text-neutral-700"
    )}>
      {isAddon ? t("labels.addon") : t("labels.original")}
    </span>
  ) : null;

  const actions = (
    <div className="flex gap-1.5">
      {canReprintKot && (
        <Button
          variant="neutral"
          className="flex-1"
          size="lg"
          isLoading={printing}
          disabled={!kitchen?.printers?.length}
          onClick={reprint}
        >
          {t("actions.reprint")}
        </Button>
      )}
      <Button
        variant="success"
        filled
        className="flex-1 w-full"
        size="lg"
        onClick={ready}
      >
        {t("actions.ready")}
      </Button>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          "bg-white rounded-xl shadow-sm flex flex-col w-full h-full border-[3px] overflow-hidden",
          "animate-in fade-in zoom-in-95 duration-300",
          isNew && "ring-2 ring-primary-500 kitchen-new-order",
          !groupColor && "border-transparent",
        )}
        style={groupColor ? { borderColor: groupColor } : undefined}
        data-testid="kitchen-ticket"
      >
        <button
          type="button"
          onClick={() => setShowItems(true)}
          title={t("actions.viewItems")}
          className={cn(
            "flex-1 flex flex-col gap-1 p-3 text-left cursor-pointer transition-colors",
            !(diff >= 30) && !isNew && 'bg-neutral-50 hover:bg-neutral-100',
            diff >= 30 && diff <= 59 && 'bg-warning-200 text-warning-700 kitchen-late-order',
            diff >= 60 && 'bg-danger-200 text-danger-700 kitchen-delayed-order',
            !(diff >= 30) && isNew && 'bg-primary-100 text-primary-800 kitchen-new-order-batch',
          )}
        >
          <div className="flex items-start justify-between gap-2 w-full">
            {/* The order number, not the guest name, heads the ticket on screen (prints keep the guest). */}
            <span className="font-black text-2xl leading-none truncate" data-testid="kitchen-order-number">
              {formatOrderNumber(order)}
            </span>
            {timerStart && (
              <span className="text-lg font-bold tabular-nums leading-none shrink-0">
                <Countdown time={timerStart} hideUntilStarted />
              </span>
            )}
          </div>
          {/* Every line keeps its slot, even empty, so all tickets share one height. */}
          <span className="h-5 text-sm font-semibold uppercase truncate max-w-full opacity-80" data-testid="kitchen-place-label">
            {subtitle}
          </span>
          <div className="h-6 flex items-center justify-between gap-2 w-full">
            <span className="font-black text-base truncate" data-testid="kitchen-due-at">
              {dueLabel}
            </span>
            {splitInto && (
              <span className="font-bold text-sm truncate" data-testid="kitchen-split-into">
                → {splitInto}
              </span>
            )}
          </div>
          <div className="h-6 flex items-center justify-between gap-2 mt-1 w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-neutral-900 text-white shrink-0">
                {t("labels.items", { count: itemCount })}
              </span>
              {kindLabel}
            </div>
            <span className="text-sm font-semibold truncate opacity-70">{order?.user?.first_name}</span>
          </div>
        </button>

        <div className="p-1.5">
          {actions}
        </div>
      </div>

      {showItems && (
        <Modal
          open
          onClose={() => setShowItems(false)}
          size="md"
          testId="kitchen-ticket-items"
          title={
            <div className="flex items-center gap-3">
              <span className="font-black">{formatOrderNumber(order)}</span>
              {kindLabel}
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white p-3">
              {subtitle && <span className="font-semibold uppercase">{subtitle}</span>}
              {order?.user?.first_name && <span className="text-neutral-600">{order.user.first_name}</span>}
              {dueLabel && <span className="font-black text-danger-600">{dueLabel}</span>}
              {timerStart && (
                <span className="ml-auto font-bold tabular-nums">
                  <Countdown time={timerStart} hideUntilStarted />
                </span>
              )}
            </div>

            {/* Tap a line to mark that dish ready on its own. */}
            <div className="rounded-lg bg-white divide-y divide-neutral-100 max-h-[60vh] overflow-auto">
              {batch.items.map(item => (
                <div
                  onClick={() => singleReady(item.id.toString())}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 text-lg cursor-pointer hover:bg-neutral-50",
                    item.order_item?.deleted_at ? 'text-danger-700 line-through' : ''
                  )}
                  key={item.id}
                >
                  <OrderItemName item={item.order_item} showQuantity />
                </div>
              ))}
            </div>

            {actions}
          </div>
        </Modal>
      )}
    </>
  );
};
