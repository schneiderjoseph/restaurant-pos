import {Order as OrderModel, OrderStatus} from "@/api/model/order.ts";
import React, {CSSProperties, useEffect, useMemo, useRef, useState} from "react";
import {useAtom} from "jotai";
import {useDB} from "@/api/db/db.ts";
import {appPage, appState, closingEnforcementAtom} from "@/store/jotai.ts";
import {orderEditSessionAtom} from "@/store/order-edit-session.ts";
import {buildOrderEditSession, commitOrderEditSession} from "@/lib/commit-order-edit.ts";
import {Button} from "@/components/common/input/button.tsx";
import {OrderPayment} from "@/components/orders/order.payment.tsx";
import ScrollContainer from "react-indiana-drag-scroll";
import {OrderHeader} from "@/components/orders/order.header.tsx";
import {OrderTimes} from "@/components/orders/order.times.tsx";
import {
  faAnglesDown,
  faChair,
  faCodeBranch,
  faCreditCard,
  faEllipsisV,
  faMoneyBillTransfer,
  faObjectGroup,
  faPenToSquare,
  faPrint,
  faUser,
  faUsers
} from "@fortawesome/free-solid-svg-icons";
import {OrderItemName} from "@/components/common/order/order.item.tsx";
import {Dropdown, DropdownItem, DropdownSeparator} from "@/components/common/react-aria/dropdown.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {dispatchPrint} from "@/lib/print.service";
import {PRINT_TYPE} from "@/lib/print.registry.tsx";
import {OrderTotals} from "@/components/orders/order.totals.tsx";
import {SplitBySeats} from "@/components/orders/split/split.seats.tsx";
import {SplitItems} from "@/components/orders/split/split.items.tsx";
import {SplitAmount} from "@/components/orders/split/split.amount.tsx";
import {SplitByClients} from "@/components/orders/split/split.clients.tsx";
import {Customers} from "@/components/customer/customer.tsx";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {toRecordId} from "@/lib/utils.ts";
import {Customer} from "@/api/model/customer.ts";
import {Checkbox} from "@/components/common/input/checkbox.tsx";
import {OrderCancelModal} from "@/components/orders/order.cancel.modal.tsx";
import {OrderRefundModal} from "@/components/orders/order.refund.modal.tsx";
import {getOrderDisplayItems, getOrderFilteredItems} from "@/lib/order.ts";
import {Tax} from "@/api/model/tax.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useTranslation} from "react-i18next";
import { getFiscalQrcodesForOrderPrint } from "@/integrations/providers/fiscal/settlement.ts";
import { hasTempPrint, requestBillPrint } from "@/lib/order-print.ts";
import { printDuplicateKotForOrder } from "@/lib/kitchen/print-duplicate-kot.ts";
import {useOrderCardHydrate} from "@/hooks/useOrderCardHydrate.ts";
import {fetchOrderById, fetchOrderFull} from "@/lib/order-fetch.ts";
import {ORDER_FETCHES} from "@/api/model/order.ts";
import {toast} from "sonner";
import {useNavigate} from "react-router";
import {MENU} from "@/routes/posr.ts";
import {canEditOrder} from "@/lib/order-edit.ts";
import {nowSurrealDateTime} from "@/lib/datetime.ts";
import {flushSync} from "react-dom";

interface Props {
  order: OrderModel
  onMergeSelect?: (order: OrderModel, add: boolean) => void
  mergingOrders: OrderModel[]
  merging: boolean
  onAction?: () => void;
  tempPrinted?: boolean;
  taxes?: Tax[];
}

export const OrderBox = ({
  order: snapshot,
  onMergeSelect,
  mergingOrders,
  merging,
  onAction,
  tempPrinted: tempPrintedProp,
  taxes: taxesProp,
}: Props) => {
  const {t} = useTranslation('orders');
  const db = useDB();
  const navigate = useNavigate();
  const [page] = useAtom(appPage);
  const [, setAppState] = useAtom(appState);
  const [, setEditSession] = useAtom(orderEditSessionAtom);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const mutationsBlocked = enforcement.orderMutationsBlocked;
  const {rootRef, displayOrder: order, cardReady, hydrateError, retryHydrate} = useOrderCardHydrate(snapshot);
  const [paymentOrder, setPaymentOrder] = useState<OrderModel | null>(null);
  const [actionOrder, setActionOrder] = useState<OrderModel | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);

  const [splitBySeats, setSplitBySeats] = useState(false);
  const [splitByManually, setSplitByManually] = useState(false);
  const [splitByAmount, setSplitByAmount] = useState(false);
  const [splitByClients, setSplitByClients] = useState(false);
  const [transferCustomerOpen, setTransferCustomerOpen] = useState(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [refundOrderOpen, setRefundOrderOpen] = useState(false);
  const [tempPrintedLocal, setTempPrintedLocal] = useState(false);
  const itemsContainerRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreItemsBelow, setHasMoreItemsBelow] = useState(false);

  const tempPrinted = tempPrintedProp ?? tempPrintedLocal;

  useEffect(() => {
    if (tempPrintedProp != null) {
      return;
    }
    let cancelled = false;
    void hasTempPrint(db, snapshot.id.toString()).then((v) => {
      if (!cancelled) setTempPrintedLocal(v);
    });
    return () => {
      cancelled = true;
    };
  }, [db, snapshot.id, tempPrintedProp]);

  const hasSeats = useMemo(() => {
    if (!cardReady) return false;
    const items = getOrderFilteredItems(order).filter((item) => item.seat !== undefined);
    return items.length > 1
  }, [cardReady, order]);

  const mergingOrderIds = useMemo(() => {
    return mergingOrders.map(item => item.id.toString());
  }, [mergingOrders]);

  const taxes = taxesProp;

  const {protectAction} = useSecurity();

  const withFullOrder = async (run: (full: OrderModel) => void | Promise<void>) => {
    setIsLoadingFull(true);
    try {
      const full = await fetchOrderFull(db, snapshot.id);
      if (!full) {
        toast.error(t('loadFailed'));
        return;
      }
      setActionOrder(full);
      await run(full);
    } catch (error) {
      console.error('Failed to load full order', error);
      toast.error(t('loadFailed'));
    } finally {
      setIsLoadingFull(false);
    }
  };

  const openOrderForEdit = async () => {
    setIsLoadingFull(true);
    try {
      const full = await fetchOrderById(db, snapshot.id, [...ORDER_FETCHES, 'floor', 'table.floor', 'customer']);
      if (!full) {
        toast.error(t('loadFailed'));
        return;
      }
      if (!canEditOrder(full)) {
        toast.error(t('actions.editOnlyUnpaid'));
        return;
      }
      if (enforcement.orderTakingBlocked) {
        toast.warning(enforcement.message ?? t('actions.editBlocked'));
        return;
      }

      const session = buildOrderEditSession(full);
      if (!session) {
        toast.error(t('loadFailed'));
        return;
      }

      flushSync(() => {
        commitOrderEditSession(
          { setSession: setEditSession, setAppState },
          session,
        );
      });

      if (full.table?.id) {
        try {
          await db.merge(toRecordId(full.table.id), {
            is_locked: true,
            locked_at: nowSurrealDateTime(),
            locked_by: page?.user
              ? `${page.user.first_name ?? ''} ${page.user.last_name ?? ''}`.trim()
              : null,
          });
        } catch (error) {
          console.error('Failed to lock table for edit', error);
        }
      }

      toast.success(t('actions.editOpened'));
      navigate(MENU, { replace: true });
      onAction?.();
    } catch (error) {
      console.error('Failed to open order for edit', error);
      toast.error(t('loadFailed'));
    } finally {
      setIsLoadingFull(false);
    }
  };

  const printTempBill = () => {
    void withFullOrder((full) => requestBillPrint({
      db,
      protectAction,
      orderId: full.id.toString(),
      printType: 'temp',
      printModule: 'orders.print_temp',
      description: 'Print temp bill',
      payload: { order: full.id.toString() },
      userId: page?.user?.id?.toString?.() ?? page?.user?.id,
      doPrint: () => dispatchPrint(db, PRINT_TYPE.presale_bill, {order: full, taxes}, {userId: page?.user?.id}),
      onPrinted: () => {
        setTempPrintedLocal(true);
        onAction?.();
      },
    }));
  };

  const printFinalCopy = () => {
    void withFullOrder((full) => requestBillPrint({
      db,
      protectAction,
      orderId: full.id.toString(),
      printType: 'final',
      printModule: 'orders.print_final',
      description: 'Print final copy',
      payload: { order: full.id.toString() },
      userId: page?.user?.id?.toString?.() ?? page?.user?.id,
      isDuplicate: true,
      doPrint: async () => {
        const qrcodes = await getFiscalQrcodesForOrderPrint(db, full.id);
        return dispatchPrint(db, PRINT_TYPE.final_bill, {
          order: full,
          duplicate: true,
          qrcodes,
          qrcode: qrcodes[0]?.value,
        }, {userId: page?.user?.id});
      },
    }));
  };

  const printKotCopy = () => {
    void protectAction(() => {
      void withFullOrder((full) => printDuplicateKotForOrder({
        db,
        order: full,
        userId: page?.user?.id,
        title: t("actions.printKotCopy"),
      }).catch((error) => {
        console.error("Order KOT reprint failed", error);
      }));
    }, {
      module: "orders.print_kot",
      description: t("actions.printKotCopy"),
      payload: {
        order: snapshot.id.toString(),
      },
    });
  };

  const [pageState] = useAtom(appPage);
  const {
    showTotalInOrderCard = false,
    showModifierPriceInOrderCard = false,
    showModifiersInOrderCard = false,
    showQuantityInOrderCard = false,
    showPriceInOrderCard = false,
    showGroupsInOrderCard = false,
  } = pageState.menuConfig ?? {};

  const modalOrder = actionOrder ?? order;

  useEffect(() => {
    const el = itemsContainerRef.current;
    if (!el) {
      setHasMoreItemsBelow(false);
      return;
    }

    const updateScrollHint = () => {
      const nextHasMore = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
      setHasMoreItemsBelow(nextHasMore);
    };

    updateScrollHint();
    el.addEventListener('scroll', updateScrollHint);
    window.addEventListener('resize', updateScrollHint);

    return () => {
      el.removeEventListener('scroll', updateScrollHint);
      window.removeEventListener('resize', updateScrollHint);
    };
  }, [cardReady, order]);

  return (
    <>
      <div ref={rootRef} className="rounded-xl p-3 bg-white gap-5 flex flex-col shadow select-none h-[540px]" data-testid="order-card">
        <OrderHeader order={order} tempPrinted={tempPrinted}/>
        <OrderTimes order={order}/>
        <div className="separator h-[2px]" style={{'--size': '10px', '--space': '5px'} as CSSProperties}></div>
        <div className="relative h-[190px] overflow-hidden">
          <ScrollContainer className="h-full">
            <div ref={itemsContainerRef} className="overflow-y-auto overflow-x-hidden h-full min-h-[80px] pr-1">
            {!cardReady && (
              <div className="py-6 text-center text-sm text-neutral-500">
                {hydrateError ? (
                  <button type="button" className="underline" onClick={() => void retryHydrate()}>
                    {t('retryLoad')}
                  </button>
                ) : (
                  t('loadingItems')
                )}
              </div>
            )}
            {cardReady && getOrderDisplayItems(order).map((item, index) => (
              <OrderItemName
                item={item}
                showQuantity={showQuantityInOrderCard}
                showPrice={showPriceInOrderCard}
                showModifierPrice={showModifierPriceInOrderCard}
                key={index}
                showTotal={showTotalInOrderCard}
                showGroups={showGroupsInOrderCard}
                showModifiers={showModifiersInOrderCard}
                cancelled={order.status === OrderStatus.Cancelled || item.deleted_at != null}
              />
            ))}
            </div>
          </ScrollContainer>
          {hasMoreItemsBelow && (
            <div className="pointer-events-none absolute bottom-0 inset-x-0 flex justify-center pb-2">
              <div className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-neutral-600 shadow">
                <FontAwesomeIcon icon={faAnglesDown}/>
                <span>...</span>
              </div>
            </div>
          )}
        </div>
        <div className="separator h-[2px]" style={{'--size': '10px', '--space': '5px'} as CSSProperties}></div>
        {cardReady ? (
          <OrderTotals order={order} />
        ) : (
          <div className="h-8 rounded bg-neutral-100 animate-pulse" />
        )}
        <div className="flex gap-5" data-testid="order-card-actions">
          {merging && (order.status === OrderStatus['In Progress']) ? (
            <>
              <Checkbox
                disabled={!cardReady}
                onChange={() => {
                  if (!cardReady) return;
                  if (mergingOrderIds.includes(order.id.toString())) {
                    onMergeSelect?.(order, false);
                  } else {
                    onMergeSelect?.(order, true);
                  }
                }}
                checked={mergingOrderIds.includes(order.id.toString())}
                label={t('actions.selectToMerge')}
              />
            </>
          ) : (
            <>
              <Dropdown
                label={<><FontAwesomeIcon icon={faEllipsisV} className="mr-3"/> </>}
                btnSize="lg"
                btnFlat={true}
                className="flex-1"
                data-testid="order-card-menu"
                onAction={(key) => {
                  if (key === 'edit') {
                    void openOrderForEdit();
                    return;
                  }

                  if (key === 'temp_bill') {
                    printTempBill();
                  }

                  if (key === 'final_bill') {
                    printFinalCopy();
                  }

                  if (key === 'kot_copy') {
                    printKotCopy();
                  }

                  if (key === 'split_by_seats' && hasSeats) {
                    protectAction(() => {
                      void withFullOrder(() => setSplitBySeats(true));
                    }, {
                      module: 'orders.split_by_seats',
                      description: 'Split by seats',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'split_by_items') {
                    protectAction(() => {
                      void withFullOrder(() => setSplitByManually(true));
                    }, {
                      module: 'orders.split_by_items',
                      description: 'Split by items',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'split_by_amount') {
                    protectAction(() => {
                      void withFullOrder(() => setSplitByAmount(true));
                    }, {
                      module: 'orders.split_by_amount',
                      description: 'Split by amount',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'split_by_clients') {
                    protectAction(() => {
                      void withFullOrder(() => setSplitByClients(true));
                    }, {
                      module: 'orders.split_by_items',
                      description: 'Split by clients',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'transfer_customer') {
                    protectAction(() => {
                      void withFullOrder(() => setTransferCustomerOpen(true));
                    }, {
                      module: 'orders',
                      description: 'Transfer order to another client file',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'cancel') {
                    protectAction(() => {
                      void withFullOrder(() => setCancelOrderOpen(true));
                    }, {
                      module: 'orders.cancel',
                      description: 'Cancel order',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });

                    return;
                  }

                  if (key === 'merge') {
                    protectAction(() => {
                      if (!cardReady) return;
                      onMergeSelect?.(order, true);
                    }, {
                      module: 'orders.merge',
                      description: 'Merge orders',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });
                  }

                  if (key === 'refund') {
                    protectAction(() => {
                      void withFullOrder(() => setRefundOrderOpen(true));
                    }, {
                      module: 'orders.refund',
                      description: 'Refund order',
                      payload: {
                        order: snapshot.id.toString()
                      }
                    });

                    return;
                  }
                }}
              >
                {order.status === OrderStatus["In Progress"] && (
                  <>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="edit" key="edit"
                                  data-testid="order-menu-edit"
                                  className="min-w-[50px]">
                      <FontAwesomeIcon icon={faPenToSquare}/> {t('actions.editOrder')}
                    </DropdownItem>
                    <DropdownSeparator/>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="cancel" key="cancel"
                                  data-testid="order-menu-cancel"
                                  className="min-w-[50px] bg-danger-100 text-danger-500">
                      <FontAwesomeIcon icon={faMoneyBillTransfer}/> {t('actions.cancelOrder')}
                    </DropdownItem>
                    <DropdownSeparator/>
                    <DropdownItem isDisabled={mutationsBlocked || hasSeats !== true || isLoadingFull} id="split_by_seats"
                                  key="split_by_seats" data-testid="order-menu-split_by_seats" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faChair}/> {t('actions.splitBySeats')}
                    </DropdownItem>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="split_by_items" key="split_by_items"
                                  data-testid="order-menu-split_by_items" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faCodeBranch}/> {t('actions.splitByItems')}
                    </DropdownItem>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="split_by_amount" key="split_by_amount"
                                  data-testid="order-menu-split_by_amount" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faCodeBranch}/> {t('actions.splitByAmount')}
                    </DropdownItem>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="split_by_clients" key="split_by_clients"
                                  data-testid="order-menu-split_by_clients" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faUsers}/> {t('actions.splitByClients')}
                    </DropdownItem>
                    <DropdownItem isDisabled={mutationsBlocked || isLoadingFull} id="transfer_customer" key="transfer_customer"
                                  data-testid="order-menu-transfer_customer" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faUser}/> {t('actions.transferToClient')}
                    </DropdownItem>
                    <DropdownSeparator/>
                    <DropdownItem isDisabled={mutationsBlocked || !cardReady} id="merge" key="merge" data-testid="order-menu-merge" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faObjectGroup}/> {t('actions.mergeOrders')}
                    </DropdownItem>
                    <DropdownSeparator/>
                    <DropdownItem isDisabled={isLoadingFull} id="kot_copy" key="kot_copy" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faPrint}/> {t('actions.printKotCopy')}
                    </DropdownItem>
                  </>
                )}

                {order.status === OrderStatus["Paid"] && (
                  <>
                    <DropdownItem isDisabled={isLoadingFull} id="refund" key="refund" data-testid="order-menu-refund" className="min-w-[50px] bg-danger-100 text-danger-500">
                      <FontAwesomeIcon icon={faMoneyBillTransfer}/> {t('actions.refund')}
                    </DropdownItem>
                    <DropdownSeparator/>
                    <DropdownItem isDisabled={isLoadingFull} id="final_bill" key="final_bill" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faPrint}/> {t('actions.printFinalBillCopy')}
                    </DropdownItem>
                    <DropdownItem isDisabled={isLoadingFull} id="kot_copy" key="kot_copy" className="min-w-[50px]">
                      <FontAwesomeIcon icon={faPrint}/> {t('actions.printKotCopy')}
                    </DropdownItem>
                  </>
                )}
              </Dropdown>
              {order.status === OrderStatus["In Progress"] && (
                <>
                  <Button
                    variant="primary"
                    flat
                    size="lg"
                    className="flex-1"
                    disabled={mutationsBlocked || isLoadingFull}
                    onClick={() => void openOrderForEdit()}
                    icon={faPenToSquare}
                    data-testid="order-card-edit"
                    title={t('actions.editOrder')}
                  />
                  <span title={tempPrinted ? t('print.tempAlreadyPrinted') : undefined} className="flex-1 flex">
                    <Button
                      onClick={printTempBill}
                      variant={tempPrinted ? "warning" : "primary"}
                      flat
                      size="lg"
                      className="flex-1"
                      icon={faPrint}
                      disabled={isLoadingFull}
                      data-testid="order-card-temp-bill"
                    ></Button>
                  </span>
                  <Button
                    variant="warning"
                    filled
                    size="lg"
                    className="flex-1"
                    disabled={isLoadingFull}
                    onClick={() => {
                      void withFullOrder((full) => setPaymentOrder(full));
                    }}
                    icon={faCreditCard}
                    data-testid="order-card-pay"
                  >
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {paymentOrder && (
        <OrderPayment order={paymentOrder} onClose={() => {
          setPaymentOrder(null);
          setActionOrder(null);
          onAction && onAction();
        }}/>
      )}

      {splitBySeats && (
        <SplitBySeats order={modalOrder} onClose={() => {
          setSplitBySeats(false);
          setActionOrder(null);
          onAction && onAction();
        }}/>
      )}

      {splitByManually && (
        <SplitItems order={modalOrder} onClose={() => {
          setSplitByManually(false);
          setActionOrder(null);
          onAction && onAction();
        }}/>
      )}

      {splitByAmount && (
        <SplitAmount order={modalOrder} onClose={() => {
          setSplitByAmount(false);
          setActionOrder(null);
          onAction && onAction();
        }}/>
      )}

      {splitByClients && (
        <SplitByClients order={modalOrder} onClose={() => {
          setSplitByClients(false);
          setActionOrder(null);
          onAction && onAction();
        }}/>
      )}

      {transferCustomerOpen && (
        <Modal
          open={transferCustomerOpen}
          onClose={() => {
            setTransferCustomerOpen(false);
            setActionOrder(null);
          }}
          title={t('actions.transferToClient')}
          size="md"
          testId="order-transfer-customer"
        >
          <p className="text-sm text-neutral-600 mb-3">{t('customer.transferHint')}</p>
          <Customers
            onCustomerChosen={async (customer: Customer) => {
              if (!customer?.id) return;
              const currentId = modalOrder.customer?.id?.toString();
              if (currentId && currentId === customer.id.toString()) {
                toast.error(t('customer.transferSame'));
                return;
              }
              try {
                await db.merge(toRecordId(modalOrder.id), {
                  customer: toRecordId(customer.id),
                });
                toast.success(t('customer.transferred', {
                  name: customer.name || customer.guest_code || '',
                }));
                setTransferCustomerOpen(false);
                setActionOrder(null);
                onAction && onAction();
              } catch (error) {
                console.error(error);
                toast.error(t('customer.transferFailed'));
              }
            }}
            onAttach={() => undefined}
          />
        </Modal>
      )}

      {cancelOrderOpen && (
        <OrderCancelModal
          order={modalOrder}
          open={cancelOrderOpen}
          onClose={() => {
            setCancelOrderOpen(false);
            setActionOrder(null);
            onAction && onAction();
          }}
        />
      )}

      {refundOrderOpen && (
        <OrderRefundModal
          order={modalOrder}
          open={refundOrderOpen}
          onClose={() => {
            setRefundOrderOpen(false)
            setActionOrder(null);
            onAction && onAction();
          }}
        />
      )}
    </>
  );
}
