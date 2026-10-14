import {Button} from "@/components/common/input/button.tsx";
import {cn, toRecordId, withCurrency} from "@/lib/utils.ts";
import {
  convertPayToPrimary,
  convertPrimaryToPay,
  formatInCurrency,
  getAppCurrency,
  type PayCurrencyCode,
} from "@/lib/currency.ts";
import {PaymentCurrencyToggle} from "@/components/common/currency/payment-currency-toggle.tsx";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";
import {useCurrencyDisplay} from "@/hooks/useCurrencyDisplay.ts";
import {faClose, faPrint} from "@fortawesome/free-solid-svg-icons";
import * as React from "react";
import {useEffect, useMemo, useState} from "react";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {PaymentType} from "@/api/model/payment_type.ts";
import {Tables} from "@/api/db/tables.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {useDB} from "@/api/db/db.ts";
import {Table} from "@/api/model/table.ts";
import {Tax} from "@/api/model/tax.ts";
import {DiscountType} from "@/api/model/discount.ts";
import {Coupon} from "@/api/model/coupon.ts";
import {OrderPayment} from "@/api/model/order_payment.ts";
import {nanoid} from "nanoid";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useAtom} from "jotai";
import {appAlert, appPage} from "@/store/jotai.ts";
import {dispatchPrint} from "@/lib/print.service.ts";
import {PRINT_TYPE} from "@/lib/print.registry.tsx";
import {StringRecordId} from "surrealdb";
import {calculateChangeDue} from "@/lib/cart.ts";
import {syncOrderTaxes} from "@/lib/order-tax.service.ts";
import {getExcludedTaxIds} from "@/lib/tax-calculator.ts";
import {syncOrderPayments} from "@/lib/order-payment-sync.ts";
import {
  isRemotePaymentType,
  RemotePaymentPendingSlot,
  RemotePaymentProvider,
  useRemotePayment,
} from "@/components/orders/payment/remote";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";
import {filterPaymentTypesForRole, RECEIVE_PAYMENT_MODULE} from "@/lib/payment-access.ts";
import {nowInAppTimezone, nowSurrealDateTime} from "@/lib/datetime.ts";
import {
  checkRoomCharge,
  isRoomPaymentType,
  loadCustomerForRoomCharge,
  stayIdOf,
  type RoomChargeCheck,
  type RoomChargeRefusal,
} from "@/lib/room-charge.ts";
import {
  checkCreditCharge,
  isCreditPaymentType,
  loadCustomerForCreditCharge,
  type CreditChargeCheck,
  type CreditChargeRefusal,
} from "@/lib/credit-charge.ts";
import {
  CreditServiceError,
  loadCustomerCreditOutstanding,
  settleCustomerCredit,
} from "@/lib/credit.service.ts";
import {
  CREDIT_REQUEST_DECIDED_EVENT,
  createCreditRequest,
  CreditRequestError,
  findPendingCreditRequest,
} from "@/lib/credit-request.ts";
import {findOpenStayForCustomerRoom, loadManualStayRoomContext} from "@/lib/stay.service.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {useTranslation} from "react-i18next";
import {useIntegrationManager} from "@/providers/integration.provider.tsx";
import { hasTempPrint, requestBillPrint } from "@/lib/order-print.ts";
import { chooseTempBillCurrency } from "@/components/common/currency/choose-temp-bill-currency.tsx";
import { fetchOrderFull } from "@/lib/order-fetch.ts";
import {
  fiscalShouldBlockBeforePaid,
  loadOrderForFiscal,
  runFiscalSettlementForOrder,
} from "@/integrations/providers/fiscal/settlement.ts";
import { publishSaleCompleted } from "@/integrations/accounting/events/publish.ts";
import {
  publishInvoiceCreated,
  publishPaymentCompleted,
} from "@/integrations/events/publish/payments.ts";
import {toast} from "sonner";
import {recordKey} from "@/lib/kitchen/routing.ts";

const customerRefKey = (value: unknown): string => {
  const key = recordKey(value);
  return key && key !== '[object Object]' ? key : recordKey((value as { id?: unknown })?.id);
};

export type PaymentCompleteOptions = {
  /** When true, parent should print the final bill after closing. */
  print?: boolean;
};

interface Props {
  order: Order
  total: number
  resolvePayable: (taxOverride?: Tax | null, paymentTypeId?: string) => number
  onComplete: (opts?: PaymentCompleteOptions) => void

  extras: Record<string, number>

  setTax?: (tax?: Tax) => void;
  tax?: Tax
  taxAmount?: number

  discountAmount?: number
  /** Notify parent of selected tender so payment-gated discounts can evaluate */
  onPaymentTypeSelected?: (paymentTypeId: string) => void

  tip: number
  tipType?: DiscountType
  tipAmount: number

  payments: OrderPayment[]
  setPayments: (paymentType: OrderPayment[] | ((prev: OrderPayment[]) => OrderPayment[])) => void;

  itemsTotal: number

  setServiceChargeAmount: (amt: number) => void
  serviceChargeAmount: number
  serviceCharge: number
  serviceChargeType: DiscountType

  notes: string
  coupon?: Coupon
  couponAmount?: number
}

type ContentProps = Props & {
  selectedAmount: string
  setSelectedAmount: React.Dispatch<React.SetStateAction<string>>
};

export const OrderPaymentReceiving = (props: Props) => {
  const [page] = useAtom(appPage);
  const [selectedAmount, setSelectedAmount] = useState("");

  return (
    <RemotePaymentProvider
      order={props.order}
      setPayments={props.setPayments}
      page={page?.page}
      user={page?.user}
      onRemotePaymentStarted={() => setSelectedAmount("")}
    >
      <OrderPaymentReceivingContent
        {...props}
        selectedAmount={selectedAmount}
        setSelectedAmount={setSelectedAmount}
      />
    </RemotePaymentProvider>
  );
};

const OrderPaymentReceivingContent = ({
  total,
  resolvePayable,
  order,
  onComplete,
  extras,
  setTax,
  tax,
  taxAmount,
  discountAmount,
  onPaymentTypeSelected,
  tipType,
  tip,
  tipAmount,
  payments,
  setPayments,
  itemsTotal: _itemsTotal,
  serviceChargeAmount,
  serviceCharge,
  serviceChargeType,
  notes,
  coupon,
  couponAmount,
  selectedAmount,
  setSelectedAmount,
}: ContentProps) => {
  const {t} = useTranslation('payment');
  useCurrencyDisplay();
  const remote = useRemotePayment();
  const db = useDB();
  const {protectAction} = useSecurity();
  const isVisible = useActionVisible();
  const { manager: integrationManager } = useIntegrationManager();
  const [page] = useAtom(appPage);
  const [tempPrinted, setTempPrinted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hasTempPrint(db, order.id.toString()).then((v) => {
      if (!cancelled) setTempPrinted(v);
    });
    return () => {
      cancelled = true;
    };
  }, [db, order.id]);

  const [, setAlert] = useAtom(appAlert);

  const roomRefusalMessage: Record<RoomChargeRefusal, string> = {
    'checked-out': t('receiving.roomCheckedOut'),
    'manual-stay-closed': t('receiving.roomManualStayClosed'),
    'room-taken-by-asi': t('receiving.roomTakenByAsi'),
    'sync-stale': t('receiving.roomSyncStale'),
    'not-hotel-guest': t('receiving.roomNotHotelGuest'),
  };

  const creditRefusalMessage: Record<CreditChargeRefusal, string> = {
    'no-customer': t('receiving.creditNoCustomer'),
    'not-allowed': t('receiving.creditNotAllowed'),
    'over-limit': t('receiving.creditOverLimit'),
    'deleted': t('receiving.creditDeleted'),
  };

  /** Room tender state for this order's guest, read from the database (shown on the buttons). */
  const [roomCheck, setRoomCheck] = useState<RoomChargeCheck>();
  /** Credit tender eligibility (probe with a tiny amount against current outstanding). */
  const [creditCheck, setCreditCheck] = useState<CreditChargeCheck>();
  const [creditOutstanding, setCreditOutstanding] = useState(0);
  const [creditSettleTenderId, setCreditSettleTenderId] = useState('');
  const [creditSettling, setCreditSettling] = useState(false);
  const [creditRequestPending, setCreditRequestPending] = useState(false);
  const [creditRequesting, setCreditRequesting] = useState(false);

  /**
   * The guest and their manual stay as stored right now. A failed read throws: the callers
   * refuse the Room tender (fail closed), never charge a room ASI may have taken.
   */
  const readRoomCheck = async (): Promise<RoomChargeCheck> => {
    const customer = await loadCustomerForRoomCharge(db, order?.customer);
    // Multi-room Front Desk guest: charge the stay of the order's room when known.
    let stayId = stayIdOf(customer?.current_stay);
    const table = order?.table;
    if (customer?.id && table?.source === 'asi-room') {
      const matched = await findOpenStayForCustomerRoom(
        db,
        customer.id,
        table.number ?? table.asi_alias,
      );
      if (matched?.id) stayId = stayIdOf(matched.id);
    }
    const context = await loadManualStayRoomContext(db, customer, stayId);
    return checkRoomCharge(
      customer ? { ...customer, current_stay: stayId ?? customer.current_stay } : customer,
      nowInAppTimezone(),
      context,
    );
  };

  /** Reads the stay again right now: the guest may have checked out since the order was taken. */
  const verifyRoomCharge = async (): Promise<RoomChargeCheck> => {
    const check = await readRoomCheck();
    setRoomCheck(check);
    return check;
  };

  /** Refuses the Room tender with the reason shown to the cashier; true when it may proceed. */
  const ensureRoomChargeAllowed = async (): Promise<boolean> => {
    let check: RoomChargeCheck;
    try {
      check = await verifyRoomCharge();
    } catch (error) {
      console.error('Room charge check failed', error);
      check = {ok: false, reason: 'sync-stale'};
      setRoomCheck(check);
    }
    if (!check.ok) {
      setAlert(prev => ({
        ...prev,
        opened: true,
        type: 'error',
        message: roomRefusalMessage[check.reason],
      }));
      return false;
    }
    return true;
  };

  const customerKey = String((order?.customer as { id?: unknown } | undefined)?.id ?? order?.customer ?? '');

  const ticketCreditPending = useMemo(
    () => payments
      .filter((payment) => isCreditPaymentType(payment.payment_type))
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
    [payments],
  );

  const readCreditState = async (): Promise<{
    check: CreditChargeCheck;
    outstanding: number;
  }> => {
    const customer = await loadCustomerForCreditCharge(db, order?.customer);
    const outstanding = customer?.id
      ? await loadCustomerCreditOutstanding(db, customer.id)
      : 0;
    // Probe with 0.01 so the button reflects eligibility / headroom, not the keypad amount.
    const check = checkCreditCharge(customer, 0.01, outstanding + ticketCreditPending);
    return { check, outstanding };
  };

  const refreshCreditState = async (): Promise<{
    check: CreditChargeCheck;
    outstanding: number;
  }> => {
    const result = await readCreditState();
    setCreditOutstanding(result.outstanding);
    setCreditCheck(result.check);
    return result;
  };

  const ensureCreditChargeAllowed = async (amount: number): Promise<boolean> => {
    let customer;
    let outstanding = 0;
    try {
      customer = await loadCustomerForCreditCharge(db, order?.customer);
      outstanding = customer?.id
        ? await loadCustomerCreditOutstanding(db, customer.id)
        : 0;
    } catch (error) {
      console.error('Credit charge check failed', error);
      setCreditCheck({ ok: false, reason: 'not-allowed' });
      setAlert((prev) => ({
        ...prev,
        opened: true,
        type: 'error',
        message: creditRefusalMessage['not-allowed'],
      }));
      return false;
    }
    const check = checkCreditCharge(customer, amount, outstanding + ticketCreditPending);
    setCreditOutstanding(outstanding);
    setCreditCheck(checkCreditCharge(customer, 0.01, outstanding + ticketCreditPending));
    if (!check.ok) {
      setAlert((prev) => ({
        ...prev,
        opened: true,
        type: 'error',
        message: creditRefusalMessage[check.reason ?? 'not-allowed'],
      }));
      return false;
    }
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    void readRoomCheck()
      .then((check) => {
        if (!cancelled) setRoomCheck(check);
      })
      .catch((error) => {
        console.error('Room charge check failed', error);
        if (!cancelled) setRoomCheck({ok: false, reason: 'sync-stale'});
      });
    void readCreditState()
      .then((result) => {
        if (cancelled) return;
        setCreditOutstanding(result.outstanding);
        setCreditCheck(result.check);
      })
      .catch((error) => {
        console.error('Credit charge check failed', error);
        if (!cancelled) setCreditCheck({ ok: false, reason: 'not-allowed' });
      });
    void findPendingCreditRequest(db, order?.customer)
      .then((pending) => {
        if (!cancelled) setCreditRequestPending(Boolean(pending));
      })
      .catch(() => {
        if (!cancelled) setCreditRequestPending(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check when the order's customer or ticket credit changes
  }, [customerKey, ticketCreditPending]);

  useEffect(() => {
    const onDecided = (event: Event) => {
      const detail = (event as CustomEvent<{ customerId?: string }>).detail;
      const thisCustomer = customerRefKey(order?.customer);
      if (detail?.customerId && thisCustomer && detail.customerId !== thisCustomer) {
        return;
      }
      void refreshCreditState().catch((error) => {
        console.error('Credit charge refresh after approval failed', error);
      });
      void findPendingCreditRequest(db, order?.customer)
        .then((pending) => setCreditRequestPending(Boolean(pending)))
        .catch(() => setCreditRequestPending(false));
    };
    window.addEventListener(CREDIT_REQUEST_DECIDED_EVENT, onDecided);
    return () => window.removeEventListener(CREDIT_REQUEST_DECIDED_EVENT, onDecided);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order customer + db for this ticket only
  }, [customerKey]);

  const {
    data: allPaymentTypes
  } = useApi<SettingsData<PaymentType>>(Tables.payment_types, ['deleted_at = none'], ['priority asc'], 0, 99999, ['tax']);

  const tableId = order?.table?.id?.toString();

  const {
    data: table
  } = useApi<SettingsData<Table>>(tableId, ['deleted_at = none'], [], 0, 1, ['payment_types', 'payment_types.tax'], {enabled: !!tableId});

  // Who may cash, and with which payment types, is set on the role (Manage → Roles).
  const {can} = useModuleAccess();
  const canReceivePayment = can(RECEIVE_PAYMENT_MODULE);
  const userId = page?.user?.id?.toString();
  const [rolePaymentTypes, setRolePaymentTypes] = useState<unknown[] | null | undefined>(
    page?.user?.user_role?.payment_types
  );
  useEffect(() => {
    if (!userId) {
      return;
    }
    let cancelled = false;
    // Read again from the database: the role may have changed since this user signed in.
    db.query(`SELECT * FROM ONLY ${toRecordId(userId)} WHERE deleted_at = none FETCH user_role`)
      .then(([row]: any) => {
        if (!cancelled && row?.user_role) {
          setRolePaymentTypes(row.user_role.payment_types);
        }
      })
      .catch((error: unknown) => {
        // Keeps the list read at sign-in.
        console.error('Role payment types read failed', error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per user; db identity changes every render
  }, [userId]);

  const paymentTypes: PaymentType[] = useMemo(() => {
    const forTable = table?.data?.[0]?.payment_types && table?.data?.[0]?.payment_types?.length > 0
      ? table?.data?.[0]?.payment_types
      : allPaymentTypes?.data;

    return filterPaymentTypesForRole(forTable, rolePaymentTypes);
  }, [table, allPaymentTypes, rolePaymentTypes]);

  const settleCreditPaymentTypes = useMemo(
    () => (paymentTypes ?? []).filter(
      (pt) => !isRoomPaymentType(pt) && !isCreditPaymentType(pt),
    ),
    [paymentTypes],
  );

  /** Cash / Card / Room / … — Credit is a house charge, not till money. */
  const collectedPaymentTypes = useMemo(
    () => (paymentTypes ?? []).filter((pt) => !isCreditPaymentType(pt)),
    [paymentTypes],
  );
  const creditPaymentTypes = useMemo(
    () => (paymentTypes ?? []).filter((pt) => isCreditPaymentType(pt)),
    [paymentTypes],
  );
  const canRequestCredit = Boolean(
    canReceivePayment
    && creditPaymentTypes.length > 0
    && order?.customer
    && creditCheck
    && creditCheck.reason === 'not-allowed'
    && !creditRequestPending,
  );

  const onRequestCredit = async () => {
    const customerId = (order?.customer as { id?: unknown } | undefined)?.id ?? order?.customer;
    if (!customerId || !page?.user?.id) return;
    setCreditRequesting(true);
    try {
      await createCreditRequest(db, {
        customerId,
        requestedBy: page.user.id,
        orderId: order.id,
      });
      setCreditRequestPending(true);
      toast.success(t('receiving.creditRequestSent'));
      postOrderTracking({
        module: 'payments.receive',
        page: page?.page,
        orderId: String(order.id),
        payload: { action: 'credit_request', customer: customerRefKey(customerId) },
        user: page?.user,
      });
    } catch (error) {
      if (error instanceof CreditRequestError && error.code === 'already_pending') {
        setCreditRequestPending(true);
        toast.info(t('receiving.creditRequestPending'));
        return;
      }
      console.error('Credit request failed', error);
      toast.error(t('receiving.creditRequestFailed'));
    } finally {
      setCreditRequesting(false);
    }
  };

  const onSettleCredit = async () => {
    const customerId = (order?.customer as { id?: unknown } | undefined)?.id ?? order?.customer;
    if (!customerId || creditOutstanding <= 0.009) return;
    const paymentTypeId = creditSettleTenderId || settleCreditPaymentTypes[0]?.id;
    const paymentType = settleCreditPaymentTypes.find((pt) => String(pt.id) === String(paymentTypeId))
      ?? settleCreditPaymentTypes[0];
    if (!paymentType?.id) {
      toast.error(t('receiving.creditSelectSettleTender'));
      return;
    }
    setCreditSettling(true);
    try {
      await settleCustomerCredit(db, {
        customerId,
        paymentTypeId: paymentType.id,
        paymentType,
        user: page?.user,
      });
      toast.success(t('receiving.creditSettledOk'));
      await refreshCreditState();
    } catch (error) {
      if (error instanceof CreditServiceError) {
        toast.error(t(`receiving.creditSettleError.${error.code}`, { defaultValue: error.message }));
      } else {
        console.error('Credit settle failed', error);
        toast.error(t('receiving.creditSettleFailed'));
      }
    } finally {
      setCreditSettling(false);
    }
  };

  // const [paymentType, setPaymentType] = useState<string>();
  const [payCurrency, setPayCurrency] = useState<PayCurrencyCode>(() => getAppCurrency() as PayCurrencyCode);

  const keyboardKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0];

  const [closing, setClosing] = useState(false);

  const formatPay = (amountPrimary: number) =>
    formatInCurrency(convertPrimaryToPay(amountPrimary, payCurrency), payCurrency);

  const toPrimary = (amountInPay: number) => convertPayToPrimary(amountInPay, payCurrency);

  const isTaxObject = (value: unknown): value is Tax => {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Tax).rate === 'number' &&
      typeof (value as Tax).name === 'string'
    );
  }

  const getPaymentTypeTax = (paymentType?: PaymentType): Tax | undefined => {
    return isTaxObject(paymentType?.tax) ? paymentType?.tax : undefined;
  }

  const closeOrder = async (opts?: PaymentCompleteOptions) => {
    setClosing(true);

    try {
      const blockBeforePaid = await fiscalShouldBlockBeforePaid(integrationManager, db);
      let fiscalOrderSnapshot: Order | undefined;

      if (blockBeforePaid) {
        fiscalOrderSnapshot = await loadOrderForFiscal(db, String(order.id));
        if (fiscalOrderSnapshot) {
          const preResult = await runFiscalSettlementForOrder(
            integrationManager,
            db,
            {
              ...fiscalOrderSnapshot,
              tax: tax ?? fiscalOrderSnapshot.tax,
              tax_amount: taxAmount ?? fiscalOrderSnapshot.tax_amount,
              discount_amount: discountAmount ?? fiscalOrderSnapshot.discount_amount,
              tip,
              tip_amount: tipAmount,
              tip_type: tipType,
              service_charge: serviceCharge,
              service_charge_amount: serviceChargeAmount,
              service_charge_type: serviceChargeType,
              payments: payments.length > 0 ? payments : fiscalOrderSnapshot.payments,
            }
          );
          if (preResult.blocked) {
            toast.error(preResult.blockedError ?? t('receiving.fiscalFailed'));
            return;
          }
          if (Object.values(preResult.resultsByProvider).some((row) => row.status === 'failed')) {
            toast.warning(t('receiving.fiscalPartialFailure'));
          }
        }
      }

      // Last check before money is recorded: a Room tender added earlier may now be on a closed stay.
      if (payments.some(payment => isRoomPaymentType(payment.payment_type)) && !(await ensureRoomChargeAllowed())) {
        return;
      }

      const creditOnTicket = payments
        .filter((payment) => isCreditPaymentType(payment.payment_type))
        .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      if (creditOnTicket > 0) {
        // Re-check limit against DB outstanding only (ticket lines are not settled yet).
        const customer = await loadCustomerForCreditCharge(db, order?.customer);
        const outstanding = customer?.id
          ? await loadCustomerCreditOutstanding(db, customer.id)
          : 0;
        const check = checkCreditCharge(customer, creditOnTicket, outstanding);
        if (!check.ok) {
          setAlert((prev) => ({
            ...prev,
            opened: true,
            type: 'error',
            message: creditRefusalMessage[check.reason ?? 'not-allowed'],
          }));
          return;
        }
      }

      // Sync payments incrementally — reuse existing order_payment rows when present
      const {paymentIds: orderPayments, payments: syncedPayments} = await syncOrderPayments(
        db,
        payments,
        order?.payments,
        total,
      );
      setPayments(syncedPayments);

      // Replace the extras saved so far (autosave may have written newer ones than this
      // order prop knows): read them back, unlink, delete, then create the final set.
      const [savedExtraIds] = await db.query<[unknown[] | null]>(
        'SELECT VALUE extras FROM ONLY $id',
        {id: toRecordId(order.id)},
      );
      await db.merge(toRecordId(order.id), {extras: []});
      for (const extraId of savedExtraIds ?? []) {
        try {
          await db.delete(toRecordId(extraId));
        } catch {
          // Already gone after an earlier race — continue.
        }
      }

      const extraOptions = [];
      for (const extra of Object.keys(extras)) {
        const record = await db.create(Tables.order_extras, {
          name: extra,
          value: extras[extra]
        });

        extraOptions.push(record[0].id);
      }

      const resolvedDiscountAmount = discountAmount ?? order.discount_amount ?? 0;
      const resolvedDiscountId = order.discount?.id;

      let orderCouponId: string | null = order?.coupon?.id
        ? String(order.coupon.id)
        : null;
      const hasCoupon = coupon && couponAmount && couponAmount > 0;

      if (hasCoupon) {
        if (order?.coupon?.id) {
          await db.merge(order.coupon.id, {
            coupon: coupon.id,
            discount: couponAmount,
          });
          orderCouponId = String(order.coupon.id);
        } else {
          const [created] = await db.create(Tables.order_coupons, {
            coupon: coupon.id,
            discount: couponAmount,
            created_at: nowSurrealDateTime(),
          });
          orderCouponId = (created as unknown as { id?: string })?.id?.toString?.() ?? String((created as unknown as {
            id: string
          }).id);
        }
      }

      const mergePayload: Record<string, unknown> = {
        status: OrderStatus.Paid,
        payments: orderPayments,
        extras: extraOptions,
        tax: tax?.id ? toRecordId(tax.id) : null,
        tax_amount: taxAmount,
        excluded_taxes: [...getExcludedTaxIds(order)].map((id) => toRecordId(id)),
        discount_amount: resolvedDiscountAmount,
        tip: tip,
        tip_amount: tipAmount,
        tip_type: tipType,
        service_charge: serviceCharge,
        service_charge_amount: serviceChargeAmount,
        service_charge_type: serviceChargeType,
        cashier: new StringRecordId(page?.user?.id.toString()),
        notes: notes,
        completed_at: nowSurrealDateTime(),
      };

      if (resolvedDiscountId) {
        mergePayload.discount = toRecordId(resolvedDiscountId);
      }

      if (orderCouponId) {
        mergePayload.coupon = orderCouponId;
      }

      await db.merge(order.id, mergePayload);
      await syncOrderTaxes(db, order, tax ?? null);

      if (hasCoupon) {
        await db.create(Tables.coupon_redemptions, {
          coupon: coupon.id,
          user: page?.user?.id ? new StringRecordId(page.user.id.toString()) : null,
          order: order.id,
          discount_amount: couponAmount,
          redeemed_at: nowSurrealDateTime(),
        });
      }

      if (!blockBeforePaid) {
        const settledOrder = await loadOrderForFiscal(db, String(order.id));
        if (settledOrder) {
          const fiscalResult = await runFiscalSettlementForOrder(
            integrationManager,
            db,
            settledOrder
          );
          if (Object.values(fiscalResult.resultsByProvider).some((row) => row.status === 'failed')) {
            toast.warning(t('receiving.fiscalPartialFailure'));
          }
        }
      }

      const saleOrder = await loadOrderForFiscal(db, String(order.id));
      if (saleOrder && integrationManager) {
        try {
          await publishSaleCompleted(integrationManager, saleOrder);
          await publishInvoiceCreated(integrationManager, {
            orderId: String(saleOrder.id),
            invoiceNumber: saleOrder.invoice_number,
            total: Number(saleOrder.payments?.reduce((s, p) => s + Number(p?.amount || 0), 0) || total),
            totalCollected: Number(saleOrder.payments?.reduce((s, p) => s + Number(p?.amount || 0), 0) || total),
            taxAmount: Number(saleOrder.tax_amount || taxAmount || 0),
            customerId: saleOrder.customer?.id
              ? String(saleOrder.customer.id)
              : undefined,
            completedAt: new Date().toISOString(),
          });
          for (const payment of syncedPayments) {
            if (!payment?.id) continue;
            await publishPaymentCompleted(integrationManager, {
              paymentId: String(payment.id),
              orderId: String(order.id),
              amount: Number(payment.amount || 0),
              paymentTypeId: payment.payment_type?.id
                ? String(payment.payment_type.id)
                : undefined,
              paymentTypeName: payment.payment_type?.name,
              tipAmount: tipAmount,
            });
          }
        } catch (publishError) {
          console.warn('Failed publishing settlement integration events', publishError);
        }
      }

      postOrderTracking({
        module: "orders.complete_payment",
        page: page?.page,
        orderId: order.id,
        payload: {
          payment_count: payments.length,
          coupon: coupon?.id?.toString(),
          total,
          print: opts?.print === true,
        },
        user: page?.user,
      });

      onComplete({ print: opts?.print === true });
    } catch (e) {
      throw e;
    } finally {
      setClosing(false);
    }
  }

  const runComplete = async (opts?: PaymentCompleteOptions) => {
    await protectAction(async () => await closeOrder(opts), {
      module: 'orders.complete',
      description: opts?.print ? 'Complete order and print' : 'Complete order',
      payload: {
        order: order.id.toString(),
        print: opts?.print === true,
      },
    });
  };

  useEffect(() => {
    if (payments.length > 0) {
      // find largest tax and apply it
      const paymentsWithTaxes = payments.filter(item => !!getPaymentTypeTax(item.payment_type));
      let highest: Tax | undefined;
      if (paymentsWithTaxes.length > 0) {
        paymentsWithTaxes.forEach(pt => {
          const paymentTax = getPaymentTypeTax(pt.payment_type);
          if (!paymentTax) {
            return;
          }

          if (!highest) {
            highest = paymentTax;
          }

          if (highest.rate < paymentTax.rate) {
            highest = paymentTax;
          }
        });

        if (highest) {
          setTax && setTax(highest);
        }
      }
    }
  }, [setTax, payments]);

  const tendered = useMemo(() => {
    return payments.reduce((prev, item) => prev + item.amount, 0)
  }, [payments])

  const changeDue = useMemo(() => {
    return calculateChangeDue(tendered, total);
  }, [total, tendered]);

  const addPayment = async (amount: string | number, paymentType: PaymentType, payable: number) => {
    if (amount.toString().length === 0) {
      return;
    }

    if (isRemotePaymentType(paymentType)) {
      await remote.startRemotePayment(amount, paymentType, payable);
      return;
    }

    let roomStayId: unknown;
    if (isRoomPaymentType(paymentType)) {
      const check = await verifyRoomCharge();
      if (!check.ok) {
        setAlert(prev => ({
          ...prev,
          opened: true,
          type: 'error',
          message: roomRefusalMessage[check.reason],
        }));
        return;
      }
      roomStayId = check.stayId;
    }

    // Compute change due relative to this payable (may include tax for selected payment type)
    const localChangeDue = tendered - payable;

    if (paymentType.type === 'Card' && localChangeDue >= 0) {
      setAlert(prev => ({
        ...prev,
        opened: true,
        type: 'error',
        message: t('receiving.cannotAddCard')
      }));

      return;
    }

    if (paymentType.type === 'Card' && Number(amount) > Number(-1 * localChangeDue)) {
      setAlert(prev => ({
        ...prev,
        opened: true,
        type: 'warning',
        message: t('receiving.exactCardAmount')
      }));

      amount = -1 * localChangeDue;
    }

    // Credit must not overpay the ticket: excess would inflate house AR with no goods due.
    if (isCreditPaymentType(paymentType)) {
      if (localChangeDue >= 0) {
        setAlert((prev) => ({
          ...prev,
          opened: true,
          type: 'error',
          message: t('receiving.cannotAddCredit'),
        }));
        return;
      }
      if (Number(amount) > Number(-1 * localChangeDue)) {
        setAlert((prev) => ({
          ...prev,
          opened: true,
          type: 'warning',
          message: t('receiving.exactCreditAmount'),
        }));
        amount = -1 * localChangeDue;
      }
      if (!(await ensureCreditChargeAllowed(Number(amount)))) {
        return;
      }
    }

    setPayments(prev => [
      ...prev,
      {
        payment_type: paymentType,
        amount: Number(amount),
        payable: payable,
        id: nanoid(),
        ...(roomStayId != null ? { stay: roomStayId } : {}),
      }
    ])
    setSelectedAmount('');
  }

  const getHighestTaxObject = (candidate?: Tax): Tax | undefined => {
    const existingTaxes = payments
      .map(p => getPaymentTypeTax(p.payment_type))
      .filter((paymentTax): paymentTax is Tax => !!paymentTax);
    let highest: Tax | undefined = existingTaxes.length > 0
      ? existingTaxes.reduce((acc, t) => (acc.rate >= t.rate ? acc : t))
      : undefined;
    if (candidate) {
      if (!highest || candidate.rate >= highest.rate) {
        highest = candidate;
      }
    }
    return highest;
  }

  const applyPaymentTypeTaxAndDiscount = (paymentType: PaymentType): number => {
    const paymentTypeId = String(paymentType.id);
    onPaymentTypeSelected?.(paymentTypeId);
    const candidateTax = getPaymentTypeTax(paymentType);
    const hasTax = !!candidateTax;
    const highestTax = hasTax ? getHighestTaxObject(candidateTax) : getHighestTaxObject(undefined);
    if (hasTax) {
      setTax && setTax(highestTax);
    }
    return resolvePayable(hasTax ? highestTax : undefined, paymentTypeId);
  }

  const {
    data: allTaxes
  } = useApi<SettingsData<Tax>>(Tables.taxes, ['deleted_at = none'])

  return (
    <div
      className="flex flex-col gap-3 bg-white rounded-xl p-3 h-[calc(100vh_-_120px)] overflow-y-auto"
      data-testid="payment-receiving"
    >
      <div className="flex flex-col gap-3" data-testid="payment-tender-panel">
        <PaymentCurrencyToggle
          value={payCurrency}
          onChange={(code) => {
            setPayCurrency(code);
            setSelectedAmount('');
          }}
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-neutral-100 px-3 py-2 text-center">
            <div className="text-sm text-neutral-500">{t('receiving.toPay')}</div>
            <div className="text-2xl font-bold tabular-nums" data-testid="payment-total">
              {formatPay(total)}
            </div>
          </div>
          <div className="rounded-xl bg-neutral-100 px-3 py-2 text-center">
            <div className="text-sm text-neutral-500">{t('receiving.tendered')}</div>
            <div className="text-2xl font-bold tabular-nums" data-testid="payment-tendered">
              {formatPay(tendered)}
            </div>
          </div>
          <div
            data-testid="payment-change-due"
            className={cn(
              "rounded-xl px-3 py-2 text-center",
              changeDue < 0 && 'bg-danger-100 text-danger-700',
              changeDue > 0 && 'bg-success-100 text-success-700',
              changeDue === 0 && 'bg-neutral-100'
            )}
          >
            <div className="text-sm">{changeDue < 0 ? t('receiving.remaining') : t('receiving.change')}</div>
            <div className="text-2xl font-bold tabular-nums">{formatPay(Math.abs(changeDue))}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2 empty:hidden" data-testid="payment-lines">
          <RemotePaymentPendingSlot/>
          {payments.map(payment => (
            <div
              className="flex justify-between items-center text-lg cursor-pointer rounded-lg border border-neutral-200 px-2 py-1"
              key={payment.id}
              data-testid="payment-line"
              onClick={() => {
                setPayments(prev => prev.filter(item => item.id !== payment.id))
              }}
            >
              <strong className="flex gap-3 justify-center items-center">
                <FontAwesomeIcon icon={faClose}
                                 className="text-danger-500 p-2 px-3 rounded border border-danger-500"/>
                {payment.payment_type.name}
              </strong>
              <span><DualCurrency amount={payment.amount} layout="inline" /></span>
            </div>
          ))}
        </div>

        {!canReceivePayment && (
          <div className="alert alert-warning" role="status" data-testid="payment-not-allowed">
            {t('receiving.notAllowed')}
          </div>
        )}
        {canReceivePayment && (
        <>
        {paymentTypes?.some(item => isRoomPaymentType(item)) && roomCheck && (
          !roomCheck.ok ? (
            roomCheck.reason !== 'not-hotel-guest' && (
              <div className="alert alert-warning" role="status" data-testid="payment-room-refused">
                {roomRefusalMessage[roomCheck.reason]}
              </div>
            )
          ) : roomCheck.departsToday && (
            <div className="alert alert-info" role="status" data-testid="payment-room-departs-today">
              {t('receiving.roomDepartsToday')}
            </div>
          )
        )}
        {creditPaymentTypes.length > 0 && creditCheck && !creditCheck.ok && creditCheck.reason !== 'not-allowed' && (
          <div className="alert alert-warning" role="status" data-testid="payment-credit-refused">
            {creditRefusalMessage[creditCheck.reason ?? 'not-allowed']}
          </div>
        )}
        {creditOutstanding > 0.009 && (
          <div
            className="rounded-lg border border-warning-300 bg-warning-50 p-3 space-y-2"
            data-testid="payment-credit-settle"
          >
            <p className="text-sm font-semibold">
              {t('receiving.creditOutstanding', { amount: withCurrency(creditOutstanding) })}
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('receiving.creditSettleTender')}</label>
                <select
                  className="border rounded px-2 py-2"
                  value={creditSettleTenderId || String(settleCreditPaymentTypes[0]?.id ?? '')}
                  onChange={(e) => setCreditSettleTenderId(e.target.value)}
                  data-testid="payment-credit-settle-tender"
                >
                  {settleCreditPaymentTypes.map((pt) => (
                    <option key={String(pt.id)} value={String(pt.id)}>{pt.name}</option>
                  ))}
                </select>
              </div>
              <Button
                variant="primary"
                disabled={creditSettling || settleCreditPaymentTypes.length === 0}
                onClick={() => void onSettleCredit()}
                data-testid="payment-credit-settle-btn"
              >
                {t('receiving.creditSettle')} ({withCurrency(creditOutstanding)})
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto" data-testid="payment-types">
          {collectedPaymentTypes.map(item => (
            <Button
              className="flex-1 whitespace-nowrap"
              variant="primary"
              key={item.id}
              data-testid="payment-type"
              disabled={isRoomPaymentType(item) && roomCheck?.ok !== true}
              onClick={() => {
                const payable = applyPaymentTypeTaxAndDiscount(item);

                if (selectedAmount.trim().length > 0) {
                  void addPayment(toPrimary(Number(selectedAmount)), item, payable)
                } else if (changeDue < 0) {
                  const remaining = payable - tendered;
                  void addPayment(remaining, item, payable)
                }
              }}
              size="lg"
            >
              {item.name}
            </Button>
          ))}
        </div>
        {creditPaymentTypes.length > 0 && (
          <div
            className="rounded-lg border border-neutral-300 bg-neutral-50 p-3 space-y-2"
            data-testid="payment-credit-account"
          >
            <p className="text-sm font-semibold text-neutral-800">{t('receiving.creditAccountTitle')}</p>
            <p className="text-xs text-neutral-600">{t('receiving.creditNotAPayment')}</p>
            <div className="flex flex-wrap gap-2">
              {creditCheck?.ok === true && creditPaymentTypes.map((item) => (
                <Button
                  className="flex-1 whitespace-nowrap"
                  variant="primary"
                  key={item.id}
                  data-testid="payment-type-credit"
                  onClick={() => {
                    const payable = applyPaymentTypeTaxAndDiscount(item);
                    if (selectedAmount.trim().length > 0) {
                      void addPayment(toPrimary(Number(selectedAmount)), item, payable);
                    } else if (changeDue < 0) {
                      void addPayment(payable - tendered, item, payable);
                    }
                  }}
                  size="lg"
                >
                  {t('receiving.creditCharge')}
                </Button>
              ))}
              {canRequestCredit && (
                <Button
                  className="flex-1 whitespace-nowrap"
                  variant="warning"
                  filled
                  disabled={creditRequesting}
                  isLoading={creditRequesting}
                  data-testid="payment-credit-request"
                  onClick={() => void onRequestCredit()}
                  size="lg"
                >
                  {t('receiving.creditRequest')}
                </Button>
              )}
              {creditRequestPending && creditCheck?.reason === 'not-allowed' && (
                <div
                  className="flex-1 rounded-lg bg-warning-100 text-warning-800 px-3 py-2 text-sm font-semibold text-center"
                  data-testid="payment-credit-request-pending"
                >
                  {t('receiving.creditRequestPending')}
                </div>
              )}
              {!order?.customer && creditCheck?.reason === 'no-customer' && (
                <div className="text-sm text-neutral-600">{creditRefusalMessage['no-customer']}</div>
              )}
            </div>
          </div>
        )}
        </>
        )}

        <div
          className="flex justify-center items-center text-2xl font-bold h-[40px] rounded-lg border border-neutral-200 tabular-nums"
          data-testid="payment-amount-entry"
        >
          {selectedAmount.trim().length > 0 && (
            <>{selectedAmount} {payCurrency}</>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 grid-rows-4 gap-2 flex-1 min-h-[232px]" data-testid="payment-keypad">
        {keyboardKeys.map(item => (
          <Button key={item} size="xl" flat variant="primary" className="!h-full" onClick={() => {
            const key = item.toString();
            // One decimal point at most, or the amount parses to NaN.
            setSelectedAmount((prev: string) => (key === '.' && prev.includes('.') ? prev : prev + key));
          }}>
            {item}
          </Button>
        ))}
        <Button size="xl" flat variant="primary" className="!h-full" onClick={() => {
          setSelectedAmount('')
        }}>
          C
        </Button>
      </div>
      <div className="flex gap-3" data-testid="payment-finish-actions">
        {isVisible('orders.print_temp') && (
        <>
        <span title={tempPrinted ? t('receiving.tempAlreadyPrinted') : undefined} className="flex-1 flex">
          <Button
            variant={tempPrinted ? "warning" : "primary"}
            className="flex-1"
            flat
            icon={faPrint}
            size="xl"
            data-testid="payment-temp-bill"
            onClick={() => {
              void (async () => {
                const printCurrency = await chooseTempBillCurrency({ defaultCurrency: payCurrency });
                if (!printCurrency) return;
                await requestBillPrint({
                  db,
                  protectAction,
                  orderId: order.id.toString(),
                  printType: 'temp',
                  printModule: 'orders.print_temp',
                  description: 'Print temp bill',
                  payload: { order: order.id.toString() },
                  userId: page?.user?.id?.toString?.() ?? page?.user?.id,
                  doPrint: async () => {
                    const full = await fetchOrderFull(db, order.id);
                    if (!full) {
                      throw new Error('Failed to load order for temp bill print');
                    }
                    return dispatchPrint(db, PRINT_TYPE.presale_bill, {
                      order: full,
                      taxes: allTaxes?.data
                    }, { userId: page?.user?.id, printCurrency });
                  },
                  onPrinted: () => setTempPrinted(true),
                });
              })();
            }}
          >{t('receiving.tempBill')}</Button>
        </span>
        <span className="flex-1 flex">
          <Button
            variant="secondary"
            className="flex-1"
            flat
            icon={faPrint}
            size="xl"
            data-testid="payment-proforma"
            onClick={() => {
              void (async () => {
                const printCurrency = await chooseTempBillCurrency({
                  defaultCurrency: payCurrency,
                  documentKind: 'proforma',
                });
                if (!printCurrency) return;
                void protectAction(() => {
                  void (async () => {
                    const full = await fetchOrderFull(db, order.id);
                    if (!full) {
                      throw new Error('Failed to load order for proforma print');
                    }
                    await dispatchPrint(db, PRINT_TYPE.presale_bill, {
                      order: full,
                      taxes: allTaxes?.data,
                      documentKind: 'proforma',
                    }, { userId: page?.user?.id, printCurrency });
                  })();
                }, {
                  module: 'orders.print_temp',
                  description: t('receiving.proforma'),
                  payload: { order: order.id.toString(), documentKind: 'proforma' },
                });
              })();
            }}
          >{t('receiving.proforma')}</Button>
        </span>
        </>
        )}
        {canReceivePayment && isVisible('orders.complete') && (
          <>
            <Button
              variant="success"
              className="flex-1"
              size="xl"
              data-testid="payment-complete"
              onClick={() => void runComplete({ print: false })}
              disabled={changeDue < 0 || closing || remote.isProcessing}
              flat
            >{t('receiving.complete')}</Button>
            <Button
              variant="success"
              className="flex-[2]"
              filled
              size="xl"
              icon={faPrint}
              data-testid="payment-complete-and-print"
              onClick={() => void runComplete({ print: true })}
              disabled={changeDue < 0 || closing || remote.isProcessing}
              flat
            >{t('receiving.completeAndPrint')}</Button>
          </>
        )}
      </div>
    </div>
  )
}
