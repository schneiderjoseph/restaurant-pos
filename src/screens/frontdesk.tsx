import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/screens/partials/layout.tsx';
import { DocumentTitle } from '@/components/common/document-title.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { Order } from '@/api/model/order.ts';
import type { Stay } from '@/api/model/stay.ts';
import type { Table } from '@/api/model/table.ts';
import { appPage } from '@/store/jotai.ts';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';
import { RECEIVE_PAYMENT_MODULE } from '@/lib/payment-access.ts';
import { loadResortChambresFloor } from '@/lib/resort-floor-tables.ts';
import { normalizeRoomKey } from '@/lib/room-key.ts';
import {
  dropSupersededStays,
  formatGuestLabel,
  generateWalkInGuestCode,
  isAsiGuest,
  searchGuests,
} from '@/lib/guest.ts';
import { walkInRefusal } from '@/lib/customer-id-document.ts';
import {
  createWalkInCustomer,
  CustomerIdDocumentTakenError,
  findWalkInMatches,
  mergeCustomers,
  type CustomerMatch,
  updateCustomer,
} from '@/lib/customer.service.ts';
import {
  StayServiceError,
  appendCustomerNote,
  checkInStay,
  checkOutStay,
  collectRoomCandidates,
  extendStay,
  findAsiOccupant,
  findAsiTakeover,
  isStayOverdue,
  isStayRoomSettled,
  customerRoomFolioTotal,
  listAsiInHouseGuests,
  listOpenStays,
  listRoomChargedOrders,
  loadCustomerRoomFolioOrders,
  loadInHouseRoomOccupancy,
  loadOpenOrdersForCustomer,
  loadStayFolioOrders,
  loadStayRoomTotal,
  loadStaySettlements,
  moveStay,
  orderRoomLabel,
  settleStayRoom,
  stayRoomOutstanding,
} from '@/lib/stay.service.ts';
import {
  buildStayFolioBillHtml,
  getStayBillLabels,
  openStayBillPrintWindow,
  orderRoomChargeAmount,
  type StayBillLang,
  writeAndPrintStayBillWindow,
} from '@/lib/stay-folio-bill.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { getAppTimezone, nowInAppTimezone, toLuxonDateTime } from '@/lib/datetime.ts';
import { DateTime } from 'luxon';
import { RoomOrderModal } from '@/components/frontdesk/room-order.modal.tsx';
import { getInvoiceNumber } from '@/lib/order.ts';
import { cn, withCurrency } from '@/lib/utils.ts';
import { DualCurrency } from '@/components/common/currency/dual-currency.tsx';
import { chooseTempBillCurrency } from '@/components/common/currency/choose-temp-bill-currency.tsx';
import { PhoneInput } from '@/components/customer/phone.input.tsx';
import { CustomerMatchesModal } from '@/components/customer/customer.matches.modal.tsx';
import type { PaymentType } from '@/api/model/payment_type.ts';
import { isRoomPaymentType } from '@/lib/room-charge.ts';
import { isCreditPaymentType } from '@/lib/credit-charge.ts';
import {
  CreditServiceError,
  customerCreditFolioTotal,
  customerCreditOutstanding,
  isCustomerCreditSettled,
  listCreditCustomers,
  loadCustomerCreditFolioOrders,
  loadCustomerCreditSettledTotal,
  orderCreditChargeTotal,
  settleCustomerCredit,
} from '@/lib/credit.service.ts';
import useApi, { type SettingsData } from '@/api/db/use.api.ts';
import {
  getCachedRestaurantLogoDataUrl,
  getCachedRestaurantProfile,
} from '@/lib/restaurant-profile.ts';
import type { PayCurrencyCode } from '@/lib/currency.ts';

type TabId = 'stays' | 'room' | 'checkin' | 'clients' | 'conflicts' | 'credit';
/** Manual stay or ASI in-house guest selected in the room-folio panel. */
type FolioSelection =
  | { kind: 'manual'; stayId: string }
  | { kind: 'asi'; customerId: string };

const todayYmd = () => nowInAppTimezone().toISODate() ?? '';

const guestOf = (stay: Stay): Customer | undefined => {
  const c = stay.customer;
  if (c && typeof c === 'object' && 'name' in c) return c as Customer;
  return undefined;
};

const selectionKey = (sel: FolioSelection | null): string => {
  if (!sel) return '';
  return sel.kind === 'manual' ? `manual:${sel.stayId}` : `asi:${sel.customerId}`;
};

export const FrontDeskScreen = () => {
  const { t } = useTranslation(['frontdesk', 'toast', 'navigation', 'menu']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const { can } = useModuleAccess();

  const canCheckIn = can('frontdesk.checkin') || can('frontdesk');
  const canCheckOut = can('frontdesk.checkout') || can('frontdesk');
  const canMove = can('frontdesk.move') || can('frontdesk');
  const canSettle = can(RECEIVE_PAYMENT_MODULE);
  const canCreate = can('customers.create');

  const [tab, setTab] = useState<TabId>('stays');
  const [stays, setStays] = useState<Stay[]>([]);
  const [asiGuests, setAsiGuests] = useState<Customer[]>([]);
  const [conflicts, setConflicts] = useState<Array<{ roomKey: string; guests: Customer[] }>>([]);
  const [rooms, setRooms] = useState<Table[]>([]);
  const [occupiedKeys, setOccupiedKeys] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<FolioSelection | null>(null);
  /** Order whose full receipt is open in the viewer. */
  const [viewOrderId, setViewOrderId] = useState<unknown>(null);
  const [roomFrom, setRoomFrom] = useState(() => nowInAppTimezone().minus({ days: 6 }).toISODate() ?? '');
  const [roomTo, setRoomTo] = useState(() => todayYmd());
  const [roomSearch, setRoomSearch] = useState('');
  const [roomOrders, setRoomOrders] = useState<Order[]>([]);
  const [roomLoading, setRoomLoading] = useState(false);
  const [folioTotal, setFolioTotal] = useState(0);
  const [folioOrders, setFolioOrders] = useState<Order[]>([]);
  const [openOrders, setOpenOrders] = useState<Array<{ id: unknown; invoice_number?: unknown }>>([]);
  const [busy, setBusy] = useState(false);
  /** ASI guest who took the selected stay's room after the manual check-in. */
  const [asiTakeover, setAsiTakeover] = useState<Customer | undefined>();
  /** After checking out a stay ASI took over: offer to fold the manual record into the ASI one. */
  const [mergeOffer, setMergeOffer] = useState<{ manual: Customer; asi: Customer } | null>(null);

  // Check-in form (several rooms allowed for one guest)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idDocument, setIdDocument] = useState('');
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [dateIn, setDateIn] = useState(todayYmd);
  const [dateOut, setDateOut] = useState(todayYmd);
  const [notes, setNotes] = useState('');
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [walkInMatches, setWalkInMatches] = useState<CustomerMatch[] | null>(null);
  const [forceCreateNew, setForceCreateNew] = useState(false);
  const [settlePaymentTypeId, setSettlePaymentTypeId] = useState('');

  // Client registry (hotel guests — same scope as Client / guest lookup)
  const [clientSearch, setClientSearch] = useState('');
  const [clientRegistry, setClientRegistry] = useState<Customer[]>([]);

  const [moveRoom, setMoveRoom] = useState('');
  const [extendDate, setExtendDate] = useState('');

  const { data: paymentTypesData } = useApi<SettingsData<PaymentType>>(
    Tables.payment_types,
    ['deleted_at = none'],
    ['priority asc'],
    0,
    99999,
  );

  const settlePaymentTypes = useMemo(
    () => (paymentTypesData?.data ?? []).filter(
      (pt) => !isRoomPaymentType(pt) && !isCreditPaymentType(pt),
    ),
    [paymentTypesData],
  );

  const [creditCustomers, setCreditCustomers] = useState<Customer[]>([]);
  const [creditSelectionId, setCreditSelectionId] = useState<string | null>(null);
  const [creditOrders, setCreditOrders] = useState<Order[]>([]);
  const [creditCharged, setCreditCharged] = useState(0);
  const [creditSettledAmt, setCreditSettledAmt] = useState(0);
  const [creditSettleTenderId, setCreditSettleTenderId] = useState('');

  const selectedCreditCustomer = useMemo(
    () => creditCustomers.find((c) => String(c.id) === creditSelectionId),
    [creditCustomers, creditSelectionId],
  );
  const creditDue = customerCreditOutstanding(creditCharged, creditSettledAmt);
  const creditSettled = isCustomerCreditSettled(creditCharged, creditSettledAmt);

  const refreshCreditPanel = useCallback(async () => {
    const list = await listCreditCustomers(db);
    setCreditCustomers(list);
    if (creditSelectionId && !list.some((c) => String(c.id) === creditSelectionId)) {
      setCreditSelectionId(null);
    }
  }, [db, creditSelectionId]);

  const selectedStay = useMemo(
    () => (selection?.kind === 'manual'
      ? stays.find((s) => String(s.id) === selection.stayId)
      : undefined),
    [stays, selection],
  );

  const selectedAsiGuest = useMemo(
    () => (selection?.kind === 'asi'
      ? asiGuests.find((g) => String(g.id) === selection.customerId)
      : undefined),
    [asiGuests, selection],
  );

  const isAsiSelection = selection?.kind === 'asi';
  const folioOutstanding = isAsiSelection
    ? folioTotal
    : stayRoomOutstanding(folioTotal, selectedStay?.settled_amount);
  const folioSettled = isAsiSelection
    ? folioTotal <= 0.009
    : isStayRoomSettled(folioTotal, selectedStay?.settled_amount);

  const refresh = useCallback(async () => {
    const [open, asi, chambres, occupancy] = await Promise.all([
      listOpenStays(db),
      listAsiInHouseGuests(db),
      loadResortChambresFloor(db),
      loadInHouseRoomOccupancy(db),
    ]);
    setStays(open);
    setAsiGuests(asi);
    setConflicts(occupancy.conflicts);
    setRooms(chambres?.tables ?? []);
    setOccupiedKeys(new Set(occupancy.byRoomKey.keys()));
  }, [db]);

  useEffect(() => {
    void refresh().catch((error) => console.error('Front Desk refresh failed', error));
  }, [refresh]);

  useEffect(() => {
    if (selection?.kind === 'manual') {
      const stillThere = stays.some((s) => String(s.id) === selection.stayId);
      if (!stillThere) setSelection(null);
      return;
    }
    if (selection?.kind === 'asi') {
      const stillThere = asiGuests.some((g) => String(g.id) === selection.customerId);
      if (!stillThere) setSelection(null);
    }
  }, [stays, asiGuests, selection]);

  useEffect(() => {
    if (!selectedStay?.id && !selectedAsiGuest?.id) {
      setFolioTotal(0);
      setFolioOrders([]);
      setOpenOrders([]);
      setAsiTakeover(undefined);
      return;
    }
    let cancelled = false;
    setAsiTakeover(undefined);
    void (async () => {
      if (selectedAsiGuest?.id) {
        const [stayOrders, open] = await Promise.all([
          loadCustomerRoomFolioOrders(db, selectedAsiGuest.id),
          loadOpenOrdersForCustomer(db, selectedAsiGuest.id),
        ]);
        if (cancelled) return;
        setFolioOrders(stayOrders);
        setFolioTotal(customerRoomFolioTotal(stayOrders));
        setOpenOrders(open);
        return;
      }
      if (!selectedStay?.id) return;
      const [total, stayOrders, open, takeover] = await Promise.all([
        loadStayRoomTotal(db, selectedStay.id),
        loadStayFolioOrders(db, selectedStay.id),
        loadOpenOrdersForCustomer(db, selectedStay.customer),
        findAsiTakeover(db, selectedStay),
      ]);
      if (cancelled) return;
      setAsiTakeover(takeover);
      setFolioTotal(total);
      setFolioOrders(stayOrders);
      setOpenOrders(open);
      setExtendDate(String(selectedStay.date_out ?? ''));
      setMoveRoom(String(selectedStay.room ?? ''));
    })().catch((error) => console.error('Folio load failed', error));
    return () => {
      cancelled = true;
    };
  }, [
    db,
    selectedStay?.id,
    selectedStay?.date_out,
    selectedStay?.room,
    selectedStay?.customer,
    selectedAsiGuest?.id,
  ]);

  const mapError = (error: unknown): string => {
    if (error instanceof StayServiceError) {
      const map: Record<StayServiceError['code'], string> = {
        asi_guest: t('asiGuestBlocked'),
        invalid_dates: t('invalidDates'),
        room_required: t('selectRoom'),
        room_occupied_asi: t('roomOccupiedAsi'),
        room_occupied_manual: t('roomOccupiedManual'),
        already_in_house: t('alreadyInHouse'),
        stay_not_open: t('stay_not_open', { defaultValue: 'Stay is not open' }),
        room_unsettled: t('checkoutBlockedUnsettled'),
        nothing_to_settle: t('nothingToSettle', { defaultValue: 'Nothing left to collect' }),
        invalid_settle: t('invalidSettle', { defaultValue: 'Invalid settlement' }),
        not_found: t('not_found', { defaultValue: 'Not found' }),
      };
      return map[error.code] ?? error.message;
    }
    if (error instanceof CustomerIdDocumentTakenError) {
      return t('toast:customer.idDocumentTaken', { defaultValue: 'ID document already registered' });
    }
    return error instanceof Error ? error.message : String(error);
  };

  const doCheckIn = async (customer: Customer) => {
    if (!canCheckIn) return;
    const rooms = [...new Set(selectedRooms.map((r) => r.trim()).filter(Boolean))];
    if (rooms.length === 0) {
      toast.error(t('selectRoom'));
      return;
    }
    setBusy(true);
    try {
      if (isAsiGuest(customer) || customer.asi_checkin_id != null || customer.asi_guest_id != null) {
        throw new StayServiceError('asi_guest');
      }
      for (const room of rooms) {
        const candidates = await collectRoomCandidates(db, room);
        const asi = await findAsiOccupant(db, candidates);
        if (asi) throw new StayServiceError('room_occupied_asi');
        await checkInStay(db, {
          customer,
          room,
          dateIn,
          dateOut,
          user: page?.user,
        });
      }
      // Notes only after a successful check-in, appended (never overwrite).
      if (notes.trim()) {
        const merged = appendCustomerNote(customer.notes, notes);
        if (merged !== (customer.notes ?? null)) {
          await updateCustomer(db, customer.id, { notes: merged }, page?.user);
        }
      }
      toast.success(t('checkedIn'));
      setName('');
      setPhone('');
      setIdDocument('');
      setSelectedRooms([]);
      setNotes('');
      setPickedCustomer(null);
      setWalkInMatches(null);
      setForceCreateNew(false);
      setTab('stays');
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleRoom = (number: string) => {
    setSelectedRooms((prev) =>
      prev.includes(number) ? prev.filter((r) => r !== number) : [...prev, number],
    );
  };

  const onCreateAndCheckIn = async (confirmedNew = false) => {
    if (!canCheckIn) return;
    const trimmed = name.trim();
    if (!trimmed && !pickedCustomer) return;

    // Existing registry pick: identity already on the customer — do not require form contact.
    if (pickedCustomer) {
      await doCheckIn(pickedCustomer);
      return;
    }

    if (!canCreate) return;
    const refusal = walkInRefusal({ name: trimmed, phone, idDocument }, { contactOptional: true });
    if (refusal) {
      toast.error(t(refusal));
      return;
    }
    setBusy(true);
    try {
      if (!confirmedNew && !forceCreateNew) {
        const matches = await findWalkInMatches(db, { name: trimmed, phone });
        if (matches.length > 0) {
          setWalkInMatches(matches);
          setBusy(false);
          return;
        }
      }
      const customer = await createWalkInCustomer(db, {
        name: trimmed,
        guestCode: generateWalkInGuestCode(trimmed),
        phone,
        idDocument,
        createdBy: page?.user,
      });
      setForceCreateNew(false);
      setWalkInMatches(null);
      await doCheckIn(customer);
    } catch (error) {
      toast.error(mapError(error));
      setBusy(false);
    }
  };

  const onCheckOut = async () => {
    if (!canCheckOut || !selectedStay) return;
    const guest = guestOf(selectedStay);
    if (!guest?.id) return;
    setBusy(true);
    try {
      // Re-read stay for settled flag
      const [fresh] = await db.query(`SELECT * FROM ONLY $id`, { id: selectedStay.id }) as Stay[][];
      const stay = (Array.isArray(fresh) ? fresh[0] : fresh) as Stay | undefined;
      if (!stay) throw new StayServiceError('not_found');
      await checkOutStay(db, {
        stay,
        customer: guest,
        user: page?.user,
      });
      toast.success(t('checkedOut'));
      // ASI took the room: often the same person registered in ASI later. Staff decide.
      if (asiTakeover && can('admin.customers.merge')) {
        setMergeOffer({ manual: guest, asi: asiTakeover });
      }
      setSelection(null);
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  /** Folds the checked-out manual record into the ASI guest (notes, allergies, phone, ID, orders). */
  const onMergeIntoAsi = async () => {
    if (!mergeOffer) return;
    setBusy(true);
    try {
      const [rows] = await db.query<[Customer[]]>(
        `SELECT * FROM ${Tables.customers} WHERE id IN $ids`,
        { ids: [mergeOffer.asi.id, mergeOffer.manual.id] },
      );
      const keep = rows?.find((row) => String(row.id) === String(mergeOffer.asi.id));
      const drop = rows?.find((row) => String(row.id) === String(mergeOffer.manual.id));
      if (!keep || !drop) throw new StayServiceError('not_found');
      await mergeCustomers(db, keep, drop, page?.user);
      toast.success(t('mergedIntoAsi'));
      setMergeOffer(null);
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  const onSettle = async () => {
    if (!canSettle || !selectedStay) return;
    const paymentTypeId = settlePaymentTypeId || settlePaymentTypes[0]?.id;
    if (!paymentTypeId) {
      toast.error(t('selectSettleTender', { defaultValue: 'Choose Cash or Card' }));
      return;
    }
    setBusy(true);
    try {
      const stay = await settleStayRoom(db, {
        stay: selectedStay,
        paymentTypeId,
        user: page?.user,
      });
      toast.success(t('settledOk'));
      setStays((prev) => prev.map((s) => (String(s.id) === String(stay.id) ? { ...s, ...stay } : s)));
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  const onSettleCredit = async () => {
    if (!canSettle || !selectedCreditCustomer?.id || creditDue <= 0.009) return;
    const paymentTypeId = creditSettleTenderId || settlePaymentTypes[0]?.id;
    const paymentType = settlePaymentTypes.find((pt) => String(pt.id) === String(paymentTypeId))
      ?? settlePaymentTypes[0];
    if (!paymentType?.id) {
      toast.error(t('selectSettleTender', { defaultValue: 'Choose Cash or Card' }));
      return;
    }
    setBusy(true);
    try {
      await settleCustomerCredit(db, {
        customerId: selectedCreditCustomer.id,
        paymentTypeId: paymentType.id,
        paymentType,
        user: page?.user,
      });
      toast.success(t('creditSettledOk'));
      const [orders, settled] = await Promise.all([
        loadCustomerCreditFolioOrders(db, selectedCreditCustomer.id),
        loadCustomerCreditSettledTotal(db, selectedCreditCustomer.id),
      ]);
      setCreditOrders(orders);
      setCreditCharged(customerCreditFolioTotal(orders));
      setCreditSettledAmt(settled);
      await refreshCreditPanel();
    } catch (error) {
      if (error instanceof CreditServiceError) {
        toast.error(t(`creditSettle_${error.code}`, { defaultValue: error.message }));
      } else {
        toast.error(mapError(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const onMove = async () => {
    if (!canMove || !selectedStay) return;
    setBusy(true);
    try {
      await moveStay(db, { stay: selectedStay, room: moveRoom, user: page?.user });
      toast.success(t('moved'));
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  const onExtend = async () => {
    if (!canMove || !selectedStay) return;
    setBusy(true);
    try {
      await extendStay(db, selectedStay, extendDate, page?.user);
      toast.success(t('extended'));
      await refresh();
    } catch (error) {
      toast.error(mapError(error));
    } finally {
      setBusy(false);
    }
  };

  const printStayBill = async (
    orders: Order[] | null,
    opts?: {
      singleOrder?: boolean;
      lang?: StayBillLang;
      /** Single slip printed from the Room charges list, outside any selected stay. */
      context?: { guestName: string; room: string };
    },
  ) => {
    if (!opts?.context && !selectedStay && !selectedAsiGuest) return;
    const guest = opts?.context ? undefined : selectedAsiGuest ?? guestOf(selectedStay!);
    const room = opts?.context?.room ?? String(selectedAsiGuest?.room ?? selectedStay?.room ?? '');
    const dateIn = String(selectedStay?.date_in ?? '');
    const dateOut = String(selectedAsiGuest?.asi_date_out ?? selectedStay?.date_out ?? '');

    const lang: StayBillLang = opts?.lang === 'en' ? 'en' : 'fr';
    // Open the print window on the currency-button click (user gesture) so the
    // browser does not block it after the USD/HTG dialog.
    let printWindow: Window | null = null;
    const printCurrency = await chooseTempBillCurrency({
      documentKind: 'folio',
      onBeforeResolve: () => {
        printWindow = openStayBillPrintWindow();
      },
    });
    if (!printCurrency) return;
    if (!printWindow) {
      toast.error(t('toast:generic.error'));
      return;
    }
    setBusy(true);
    try {
      const loadOrders = async (): Promise<Order[]> => {
        if (orders != null) return orders;
        if (selectedAsiGuest?.id) return loadCustomerRoomFolioOrders(db, selectedAsiGuest.id);
        if (selectedStay?.id) return loadStayFolioOrders(db, selectedStay.id);
        return [];
      };
      const [settlements, loadedOrders] = await Promise.all([
        opts?.singleOrder || !selectedStay?.id
          ? Promise.resolve([])
          : loadStaySettlements(db, selectedStay.id),
        loadOrders(),
      ]);
      const profile = getCachedRestaurantProfile();
      const contact = [profile.phone, profile.email].filter(Boolean).join(' · ');
      const locale = lang === 'en' ? 'en-US' : 'fr-HT';
      const roomTotal = selectedAsiGuest
        ? customerRoomFolioTotal(loadedOrders)
        : folioTotal;
      const settledAmount = selectedAsiGuest ? 0 : Number(selectedStay?.settled_amount) || 0;
      const outstanding = selectedAsiGuest
        ? roomTotal
        : stayRoomOutstanding(roomTotal, selectedStay?.settled_amount);
      const html = buildStayFolioBillHtml({
        guestName: opts?.context?.guestName ?? formatGuestLabel(guest),
        room,
        dateIn,
        dateOut,
        restaurantName: profile.name || undefined,
        restaurantAddress: profile.address || undefined,
        restaurantContact: contact || undefined,
        restaurantLogoDataUrl: getCachedRestaurantLogoDataUrl(),
        orders: loadedOrders,
        roomTotal,
        settledAmount,
        outstanding,
        settlements: settlements.map((row) => ({
          amount: Number(row.amount) || 0,
          label: row.payment_type?.name,
          comments: row.comments,
          at: row.created_at != null
            ? new Date(String(row.created_at)).toLocaleString(locale)
            : undefined,
        })),
        labels: getStayBillLabels(lang, { singleOrder: opts?.singleOrder }),
        printedAt: new Date().toLocaleString(locale),
        locale,
        printCurrency: printCurrency as PayCurrencyCode,
        // ASI has no POS settlement ledger — list charges only (check-out stays in ASI).
        showStaySummary: !opts?.singleOrder && !selectedAsiGuest,
      });
      writeAndPrintStayBillWindow(printWindow, html);
    } catch (error) {
      console.error('Stay folio print failed', error);
      try {
        printWindow.close();
      } catch {
        // ignore
      }
      toast.error(t('toast:generic.error'));
    } finally {
      setBusy(false);
    }
  };

  const printFolio = async (lang: StayBillLang = 'fr') => {
    await printStayBill(folioOrders.length > 0 ? folioOrders : null, { lang });
  };

  const printOneFiche = async (order: Order, lang: StayBillLang = 'fr') => {
    await printStayBill([order], { singleOrder: true, lang });
  };

  /** Slip of one Room-charged order from the Room charges list (no stay selected). */
  const printRoomOrder = async (order: Order, lang: StayBillLang = 'fr') => {
    const guest = order.customer && typeof order.customer === 'object' ? order.customer : undefined;
    await printStayBill([order], {
      singleOrder: true,
      lang,
      context: { guestName: formatGuestLabel(guest), room: orderRoomLabel(order) },
    });
  };

  const loadRoomOrders = useCallback(async () => {
    const zone = getAppTimezone();
    const from = DateTime.fromISO(roomFrom, { zone }).startOf('day');
    const to = DateTime.fromISO(roomTo, { zone }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid || to <= from) {
      setRoomOrders([]);
      return;
    }
    setRoomLoading(true);
    try {
      setRoomOrders(await listRoomChargedOrders(db, { from: from.toJSDate(), to: to.toJSDate() }));
    } catch (error) {
      console.error('Room charges load failed', error);
      toast.error(t('toast:generic.error'));
    } finally {
      setRoomLoading(false);
    }
  }, [db, roomFrom, roomTo, t]);

  useEffect(() => {
    if (tab !== 'room') return;
    void loadRoomOrders();
  }, [tab, loadRoomOrders]);

  const roomOrdersShown = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    if (!q) return roomOrders;
    return roomOrders.filter((order) => {
      const guest = order.customer && typeof order.customer === 'object' ? order.customer : undefined;
      return [orderRoomLabel(order), formatGuestLabel(guest), String(getInvoiceNumber(order))]
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [roomOrders, roomSearch]);
  const roomOrdersTotal = roomOrdersShown.reduce((sum, order) => sum + orderRoomChargeAmount(order), 0);

  // Same hotel registry as Client / guest lookup: in-house, walk-in, manual stay, local, notes.
  const loadClientRegistry = useCallback(async () => {
    try {
      const [list] = await db.query<Customer[]>(
        `SELECT * FROM ${Tables.customers}
         WHERE ${ACTIVE_CUSTOMER} AND (
            in_house = true OR tags CONTAINS 'in-house'
            OR source = 'walk-in' OR tags CONTAINS 'walk-in'
            OR tags CONTAINS 'manual-stay'
            OR current_stay != NONE
            OR source = 'local'
            OR (notes != NONE AND notes != NULL AND notes != '')
         )
         ORDER BY in_house DESC, name
         LIMIT 500`,
      );
      setClientRegistry(dropSupersededStays(Array.isArray(list) ? list : []));
    } catch (error) {
      console.error('Front Desk client registry failed', error);
      setClientRegistry([]);
    }
  }, [db]);

  useEffect(() => {
    if (tab !== 'clients') return;
    void loadClientRegistry();
  }, [tab, loadClientRegistry]);

  useEffect(() => {
    if (tab !== 'credit') return;
    void refreshCreditPanel().catch((error) => console.error('Credit customers load failed', error));
  }, [tab, refreshCreditPanel]);

  useEffect(() => {
    // Clear first so the previous guest's folio does not flash under the new name.
    setCreditOrders([]);
    setCreditCharged(0);
    setCreditSettledAmt(0);
    if (!selectedCreditCustomer?.id) return;
    let cancelled = false;
    void (async () => {
      const [orders, settled] = await Promise.all([
        loadCustomerCreditFolioOrders(db, selectedCreditCustomer.id),
        loadCustomerCreditSettledTotal(db, selectedCreditCustomer.id),
      ]);
      if (cancelled) return;
      setCreditOrders(orders);
      setCreditCharged(customerCreditFolioTotal(orders));
      setCreditSettledAmt(settled);
    })().catch((error) => console.error('Credit folio load failed', error));
    return () => {
      cancelled = true;
    };
  }, [db, selectedCreditCustomer?.id]);

  const clientHits = useMemo(() => {
    const found = searchGuests(clientRegistry, clientSearch);
    return [...found.exact, ...found.close];
  }, [clientRegistry, clientSearch]);

  const roomOptions = useMemo(() => {
    return [...rooms].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  }, [rooms]);

  const tabs: Array<{ id: TabId; label: string; badge?: number }> = [
    { id: 'stays', label: t('openStays'), badge: stays.length + asiGuests.length },
    { id: 'room', label: t('roomChargesTab') },
    { id: 'checkin', label: t('checkIn') },
    { id: 'credit', label: t('creditAccounts'), badge: creditCustomers.length || undefined },
    { id: 'clients', label: t('clients') },
    { id: 'conflicts', label: t('conflicts'), badge: conflicts.length || undefined },
  ];

  const inHouseTotal = stays.length + asiGuests.length;

  /** Manual stays past their departure day: check them out before ASI gives the room away. */
  const overdueStays = useMemo(() => {
    const today = todayYmd();
    return stays
      .filter((stay) => isStayOverdue(stay, today))
      .sort((a, b) => String(a.date_out).localeCompare(String(b.date_out)));
  }, [stays]);
  const overdueIds = useMemo(() => new Set(overdueStays.map((stay) => String(stay.id))), [overdueStays]);

  return (
    <Layout overflowHidden containerClassName="h-full flex flex-col">
      <DocumentTitle parts={[t('navigation:sidebar.frontdesk')]} />
      <div
        className="px-4 py-3 lg:px-6 w-full flex-1 min-h-0 flex flex-col gap-3"
        data-testid="frontdesk-screen"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 shrink-0">
          <nav
            className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-neutral-100 border border-neutral-200"
            aria-label={t('title')}
          >
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'min-h-11 px-3.5 rounded-lg text-sm font-semibold transition-colors',
                    active
                      ? 'bg-white text-neutral-900 shadow-sm border border-neutral-200'
                      : 'text-neutral-600 hover:bg-white/70 border border-transparent',
                    item.id === 'conflicts' && (item.badge ?? 0) > 0 && !active
                      ? 'text-danger-700'
                      : '',
                  )}
                  onClick={() => setTab(item.id)}
                  data-testid={`frontdesk-tab-${item.id}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                  {item.badge != null && item.badge > 0 ? (
                    <span
                      className={cn(
                        'ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full text-xs',
                        item.id === 'conflicts'
                          ? 'bg-danger-100 text-danger-800'
                          : 'bg-neutral-200 text-neutral-700',
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          {tab === 'stays' && (
            <p className="text-sm text-neutral-600">
              {t('inHouseCount', { count: inHouseTotal, defaultValue: '{{count}} in house' })}
            </p>
          )}
        </header>

        {mergeOffer && (
          <div
            className="rounded-xl border border-primary-300 bg-primary-50 p-4 space-y-2 shrink-0"
            data-testid="frontdesk-merge-asi"
          >
            <p className="font-semibold">
              {t('mergeIntoAsiTitle', {
                manual: formatGuestLabel(mergeOffer.manual),
                asi: formatGuestLabel(mergeOffer.asi),
              })}
            </p>
            <p className="text-sm text-neutral-700">{t('mergeIntoAsiHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void onMergeIntoAsi()}>
                {t('mergeIntoAsi')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setMergeOffer(null)}>
                {t('mergeDifferent')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'stays' && overdueStays.length > 0 && (
          <div
            className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 space-y-2 shrink-0"
            data-testid="frontdesk-overdue"
          >
            <div>
              <p className="font-semibold text-warning-900">
                {t('overdueTitle', { count: overdueStays.length })}
              </p>
              <p className="text-sm text-warning-800">{t('overdueHint')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {overdueStays.map((stay) => {
                const active = selectionKey({ kind: 'manual', stayId: String(stay.id) }) === selectionKey(selection);
                return (
                  <button
                    key={String(stay.id)}
                    type="button"
                    className={cn(
                      'min-h-11 px-3 rounded-lg border text-sm text-left flex items-center gap-2 transition-colors',
                      active
                        ? 'bg-white border-warning-500 shadow-sm'
                        : 'bg-white/70 border-warning-300 hover:bg-white',
                    )}
                    onClick={() => setSelection({ kind: 'manual', stayId: String(stay.id) })}
                    data-testid={`frontdesk-overdue-${stay.id}`}
                  >
                    <span className="font-bold tabular-nums">{stay.room}</span>
                    <span className="truncate max-w-48">{formatGuestLabel(guestOf(stay))}</span>
                    <span className="text-warning-800 tabular-nums">
                      {t('overdueSince', { date: stay.date_out })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'stays' && (
          <div className="grid lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] gap-3 flex-1 min-h-0">
            <aside className="border rounded-2xl bg-white flex flex-col min-h-0 h-full shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b shrink-0 flex items-center justify-between gap-2">
                <h2 className="font-semibold">{t('openStays')}</h2>
                <span className="text-xs font-medium text-neutral-500 tabular-nums">{inHouseTotal}</span>
              </div>
              {stays.length === 0 && asiGuests.length === 0 ? (
                <p className="text-sm text-neutral-600 p-4">{t('noOpenStays')}</p>
              ) : (
                <ul className="flex-1 min-h-0 overflow-auto divide-y">
                  {asiGuests.map((guest) => {
                    const key = selectionKey({ kind: 'asi', customerId: String(guest.id) });
                    const active = key === selectionKey(selection);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={cn(
                            'w-full text-left min-h-16 px-4 py-3 flex items-center gap-3 transition-colors',
                            active ? 'bg-primary-50' : 'hover:bg-neutral-50',
                          )}
                          onClick={() => setSelection({ kind: 'asi', customerId: String(guest.id) })}
                          data-testid={`frontdesk-asi-${guest.id}`}
                        >
                          <span className="shrink-0 inline-flex items-center justify-center min-w-12 h-10 px-2 rounded-lg bg-neutral-900 text-white text-sm font-bold tabular-nums">
                            {guest.room}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold truncate">{formatGuestLabel(guest)}</span>
                            <span className="block text-sm text-neutral-600 truncate">
                              {t('badgeAsi')}
                              {guest.asi_date_out ? ` · → ${guest.asi_date_out}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {stays.map((stay) => {
                    const guest = guestOf(stay);
                    const key = selectionKey({ kind: 'manual', stayId: String(stay.id) });
                    const active = key === selectionKey(selection);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={cn(
                            'w-full text-left min-h-16 px-4 py-3 flex items-center gap-3 transition-colors',
                            active ? 'bg-primary-50' : 'hover:bg-neutral-50',
                          )}
                          onClick={() => setSelection({ kind: 'manual', stayId: String(stay.id) })}
                          data-testid={`frontdesk-stay-${stay.id}`}
                        >
                          <span className="shrink-0 inline-flex items-center justify-center min-w-12 h-10 px-2 rounded-lg bg-primary-700 text-white text-sm font-bold tabular-nums">
                            {stay.room}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold truncate">{formatGuestLabel(guest)}</span>
                            <span className="block text-sm text-neutral-600 truncate">
                              {t('badgeManualStay')} · {stay.date_in} → {stay.date_out}
                              {overdueIds.has(String(stay.id)) && (
                                <span className="ml-1.5 font-semibold text-warning-800">
                                  · {t('overdueBadge')}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className="border rounded-2xl bg-white flex flex-col min-h-0 h-full shadow-sm overflow-hidden">
              {!selectedStay && !selectedAsiGuest ? (
                <div className="flex-1 flex items-center justify-center p-8 text-center">
                  <div className="max-w-sm space-y-2">
                    <h2 className="text-lg font-semibold text-neutral-800">
                      {t('pickStay', { defaultValue: 'Select a stay' })}
                    </h2>
                    <p className="text-sm text-neutral-600">
                      {t('pickStayHelp', {
                        defaultValue: 'Choose an open stay to view the folio, print invoices, collect payment, or check out.',
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b shrink-0 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-xl font-bold truncate">
                          {formatGuestLabel(selectedAsiGuest ?? guestOf(selectedStay!))}
                        </h2>
                        <p className="text-sm text-neutral-600 mt-0.5">
                          <span className="font-semibold text-neutral-800">
                            {t('room')} {selectedAsiGuest?.room ?? selectedStay?.room}
                          </span>
                          {selectedStay
                            ? ` · ${selectedStay.date_in} → ${selectedStay.date_out}`
                            : (selectedAsiGuest?.asi_date_out ? ` · → ${selectedAsiGuest.asi_date_out}` : '')}
                          {' · '}
                          {selectedAsiGuest ? t('badgeAsi') : t('badgeManualStay')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <Button
                          variant="secondary"
                          disabled={busy || folioOrders.length === 0}
                          onClick={() => void printFolio('fr')}
                          data-testid="frontdesk-print-folio-fr"
                        >
                          {t('printAllFolioFr')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || folioOrders.length === 0}
                          onClick={() => void printFolio('en')}
                          data-testid="frontdesk-print-folio-en"
                        >
                          {t('printAllFolioEn')}
                        </Button>
                      </div>
                    </div>

                    {selectedStay && asiTakeover && (
                      <p
                        className="text-sm rounded-lg border border-danger-300 bg-danger-50 text-danger-800 px-3 py-2"
                        role="status"
                        data-testid="frontdesk-asi-takeover"
                      >
                        {t('asiTakeoverWarn', { name: formatGuestLabel(asiTakeover), room: selectedStay.room })}
                      </p>
                    )}

                    {selectedAsiGuest ? (
                      <div className="rounded-xl bg-neutral-50 border px-4 py-3 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('roomTotal')}</div>
                          <DualCurrency amount={folioTotal} layout="inline" primaryClassName="text-xl font-bold" />
                        </div>
                        <p className="text-sm text-neutral-600">{t('asiFolioHint')}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-neutral-50 border px-3 py-2.5">
                          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('roomTotal')}</div>
                          <DualCurrency amount={folioTotal} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                        </div>
                        <div className="rounded-xl bg-neutral-50 border px-3 py-2.5">
                          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('settledAmount')}</div>
                          <DualCurrency amount={Number(selectedStay?.settled_amount) || 0} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                        </div>
                        <div className={cn(
                          'rounded-xl border px-3 py-2.5',
                          folioSettled ? 'bg-success-50 border-success-200' : 'bg-warning-50 border-warning-200',
                        )}>
                          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('outstanding')}</div>
                          <DualCurrency amount={folioOutstanding} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                          <div className={cn('text-xs font-semibold mt-1', folioSettled ? 'text-success-700' : 'text-warning-800')}>
                            {folioSettled ? t('settled') : t('notSettled')}
                          </div>
                        </div>
                      </div>
                    )}

                    {openOrders.length > 0 && (
                      <p className="text-sm text-warning-800 font-medium">{t('openOrdersWarn', { count: openOrders.length })}</p>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
                    <h3 className="text-sm font-semibold text-neutral-700">{t('stayFiches')}</h3>
                    {folioOrders.length === 0 ? (
                      <p className="text-sm text-neutral-500 border border-dashed rounded-xl p-4 text-center">{t('emptyFolio')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {folioOrders.map((order) => (
                          <li
                            key={String(order.id)}
                            className="border rounded-xl px-3 py-3 flex justify-between gap-3 items-center bg-white hover:border-neutral-300"
                            data-testid={`frontdesk-fiche-${order.id}`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold">
                                {t('menu:header.orderNumber', { number: getInvoiceNumber(order) })}
                              </div>
                              <div className="text-sm text-neutral-600 flex flex-wrap items-center gap-x-2">
                                <span>{toLuxonDateTime(order.created_at).toFormat('dd LLL HH:mm')}</span>
                                <DualCurrency amount={orderRoomChargeAmount(order)} layout="inline" />
                              </div>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setViewOrderId(order.id)}
                                data-testid={`frontdesk-view-fiche-${order.id}`}
                              >
                                {t('viewOrder')}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => void printOneFiche(order, 'fr')}
                                data-testid={`frontdesk-print-fiche-fr-${order.id}`}
                              >
                                {t('printFicheFr')}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => void printOneFiche(order, 'en')}
                                data-testid={`frontdesk-print-fiche-en-${order.id}`}
                              >
                                {t('printFicheEn')}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {selectedStay && canMove && (
                      <div className="grid sm:grid-cols-2 gap-3 border-t pt-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">{t('move')}</label>
                          <select
                            className="w-full border rounded-lg px-3 py-2.5 min-h-11"
                            value={moveRoom}
                            onChange={(e) => setMoveRoom(e.target.value)}
                          >
                            {roomOptions.map((r) => (
                              <option key={String(r.id)} value={String(r.number)}>
                                {r.number}{r.asi_alias ? ` (${r.asi_alias})` : ''}
                              </option>
                            ))}
                          </select>
                          <Button size="sm" disabled={busy} onClick={() => void onMove()}>{t('move')}</Button>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">{t('extend')}</label>
                          <Input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} />
                          <Button size="sm" disabled={busy} onClick={() => void onExtend()}>{t('extend')}</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedStay && (
                    <div className="shrink-0 border-t bg-neutral-50 px-4 py-3 flex flex-wrap gap-2 items-end">
                      {canSettle && folioOutstanding > 0 && (
                        <>
                          <div className="space-y-1">
                            <label className="text-xs font-medium">{t('settleTender')}</label>
                            <select
                              className="border rounded-lg px-3 py-2.5 min-h-11 bg-white"
                              value={settlePaymentTypeId || String(settlePaymentTypes[0]?.id ?? '')}
                              onChange={(e) => setSettlePaymentTypeId(e.target.value)}
                              data-testid="frontdesk-settle-tender"
                            >
                              {settlePaymentTypes.map((pt) => (
                                <option key={String(pt.id)} value={String(pt.id)}>{pt.name}</option>
                              ))}
                            </select>
                          </div>
                          <Button
                            variant="primary"
                            disabled={busy || settlePaymentTypes.length === 0}
                            onClick={() => void onSettle()}
                            data-testid="frontdesk-settle"
                          >
                            {t('settle')} ({withCurrency(folioOutstanding)})
                          </Button>
                        </>
                      )}
                      {!canSettle && folioOutstanding > 0 && (
                        <p className="text-xs text-neutral-600 flex-1">{t('settleHint')}</p>
                      )}
                      {canCheckOut && (
                        <Button
                          variant="danger"
                          disabled={busy || folioOutstanding > 0}
                          onClick={() => void onCheckOut()}
                          data-testid="frontdesk-checkout"
                          className="ml-auto"
                        >
                          {t('confirmCheckout')}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {tab === 'credit' && (
          <div className="grid lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] gap-3 flex-1 min-h-0" data-testid="frontdesk-credit">
            <aside className="border rounded-2xl bg-white flex flex-col min-h-0 h-full shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b shrink-0">
                <h2 className="font-semibold">{t('creditAccounts')}</h2>
              </div>
              {creditCustomers.length === 0 ? (
                <p className="text-sm text-neutral-600 p-4">{t('noCreditAccounts')}</p>
              ) : (
                <ul className="flex-1 min-h-0 overflow-auto divide-y">
                  {creditCustomers.map((guest) => {
                    const active = String(guest.id) === creditSelectionId;
                    return (
                      <li key={String(guest.id)}>
                        <button
                          type="button"
                          className={cn(
                            'w-full text-left min-h-16 px-4 py-3 transition-colors',
                            active ? 'bg-primary-50' : 'hover:bg-neutral-50',
                          )}
                          onClick={() => setCreditSelectionId(String(guest.id))}
                          data-testid={`frontdesk-credit-${guest.id}`}
                        >
                          <div className="font-semibold truncate">{formatGuestLabel(guest)}</div>
                          <div className="text-sm text-neutral-600">
                            {guest.credit_limit != null
                              ? t('creditLimitLabel', { amount: withCurrency(Number(guest.credit_limit)) })
                              : t('creditUnlimited')}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className="border rounded-2xl bg-white flex flex-col min-h-0 h-full shadow-sm overflow-hidden">
              {!selectedCreditCustomer ? (
                <div className="flex-1 flex items-center justify-center p-8 text-center">
                  <p className="text-sm text-neutral-600">{t('creditPickCustomer')}</p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b shrink-0 space-y-3">
                    <h2 className="text-xl font-bold truncate">{formatGuestLabel(selectedCreditCustomer)}</h2>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-neutral-50 border px-3 py-2.5">
                        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('creditCharged')}</div>
                        <DualCurrency amount={creditCharged} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                      </div>
                      <div className="rounded-xl bg-neutral-50 border px-3 py-2.5">
                        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('settledAmount')}</div>
                        <DualCurrency amount={creditSettledAmt} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                      </div>
                      <div className={cn(
                        'rounded-xl border px-3 py-2.5',
                        creditSettled ? 'bg-success-50 border-success-200' : 'bg-warning-50 border-warning-200',
                      )}>
                        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t('outstanding')}</div>
                        <DualCurrency amount={creditDue} layout="stack" primaryClassName="text-lg font-bold" className="items-start" />
                        <div className={cn('text-xs font-semibold mt-1', creditSettled ? 'text-success-700' : 'text-warning-800')}>
                          {creditSettled ? t('creditSettled') : t('creditNotSettled')}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-2">
                    <h3 className="text-sm font-semibold text-neutral-700">{t('creditOrders')}</h3>
                    {creditOrders.length === 0 ? (
                      <p className="text-sm text-neutral-500 border border-dashed rounded-xl p-4 text-center">{t('emptyCreditFolio')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {creditOrders.map((order) => (
                          <li
                            key={String(order.id)}
                            className="border rounded-xl px-3 py-3 flex justify-between gap-3 items-center"
                            data-testid={`frontdesk-credit-order-${order.id}`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold">
                                {t('menu:header.orderNumber', { number: getInvoiceNumber(order) })}
                              </div>
                              <div className="text-sm text-neutral-600 flex flex-wrap items-center gap-x-2">
                                <span>{toLuxonDateTime(order.created_at).toFormat('dd LLL HH:mm')}</span>
                                <DualCurrency amount={orderCreditChargeTotal(order)} layout="inline" />
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="shrink-0 border-t bg-neutral-50 px-4 py-3 flex flex-wrap gap-2 items-end">
                    {canSettle && creditDue > 0 && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">{t('settleTender')}</label>
                          <select
                            className="border rounded-lg px-3 py-2.5 min-h-11 bg-white"
                            value={creditSettleTenderId || String(settlePaymentTypes[0]?.id ?? '')}
                            onChange={(e) => setCreditSettleTenderId(e.target.value)}
                            data-testid="frontdesk-credit-settle-tender"
                          >
                            {settlePaymentTypes.map((pt) => (
                              <option key={String(pt.id)} value={String(pt.id)}>{pt.name}</option>
                            ))}
                          </select>
                        </div>
                        <Button
                          variant="primary"
                          disabled={busy || settlePaymentTypes.length === 0}
                          onClick={() => void onSettleCredit()}
                          data-testid="frontdesk-credit-settle"
                        >
                          {t('settleCredit')} ({withCurrency(creditDue)})
                        </Button>
                      </>
                    )}
                    {!canSettle && creditDue > 0 && (
                      <p className="text-xs text-neutral-600 w-full">{t('creditSettleHint')}</p>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {tab === 'checkin' && canCheckIn && (
          <div
            className="border rounded-2xl bg-white shadow-sm flex-1 min-h-0 overflow-auto"
            data-testid="frontdesk-checkin"
          >
            <div className="grid lg:grid-cols-2 gap-0 min-h-full">
              <div className="p-5 space-y-3 border-b lg:border-b-0 lg:border-r">
                <h2 className="text-lg font-bold">{t('checkIn')}</h2>
                <Input
                  placeholder={t('name')}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setPickedCustomer(null); }}
                  data-testid="frontdesk-name"
                />
                <PhoneInput value={phone} onChange={setPhone} testId="frontdesk-phone" />
                <Input
                  placeholder={t('idDocument')}
                  value={idDocument}
                  onChange={(e) => setIdDocument(e.target.value)}
                  data-testid="frontdesk-id"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">{t('dateIn')}</label>
                    <Input type="date" value={dateIn} onChange={(e) => setDateIn(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t('dateOut')}</label>
                    <Input type="date" value={dateOut} onChange={(e) => setDateOut(e.target.value)} />
                  </div>
                </div>
                <Input placeholder={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
                {pickedCustomer && (
                  <p className="text-sm rounded-lg bg-primary-50 border border-primary-200 text-primary-900 px-3 py-2">
                    {t('checkInExisting')}: {formatGuestLabel(pickedCustomer)}
                  </p>
                )}
              </div>
              <div className="p-5 flex flex-col gap-3 min-h-0">
                <div>
                  <label className="block text-sm font-semibold">{t('selectRooms')}</label>
                  <p className="text-xs text-neutral-600 mt-0.5">{t('selectRoomsHelp')}</p>
                </div>
                <div
                  className="flex-1 min-h-48 max-h-80 overflow-auto border rounded-xl p-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5 content-start"
                  data-testid="frontdesk-rooms"
                >
                  {roomOptions.map((r) => {
                    const number = String(r.number);
                    const key = normalizeRoomKey(r.number);
                    const occupied = Boolean(key && occupiedKeys.has(key));
                    const checked = selectedRooms.includes(number);
                    return (
                      <label
                        key={String(r.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm min-h-11 border',
                          occupied && !checked
                            ? 'opacity-50 cursor-not-allowed border-transparent'
                            : 'hover:bg-neutral-50 cursor-pointer',
                          checked ? 'bg-primary-50 border-primary-300' : 'border-transparent',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={occupied && !checked}
                          onChange={() => toggleRoom(number)}
                          data-testid={`frontdesk-room-${number}`}
                        />
                        <span>
                          {r.number}{r.asi_alias ? ` (${r.asi_alias})` : ''}
                          {occupied && !checked ? ` — ${t('roomOccupied')}` : ''}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {selectedRooms.length > 0 && (
                  <p className="text-sm text-primary-800 font-medium">
                    {t('roomsSelected', { rooms: selectedRooms.join(', ') })}
                  </p>
                )}
                <Button
                  variant="primary"
                  className="w-full justify-center min-h-12"
                  disabled={busy || selectedRooms.length === 0 || (!name.trim() && !pickedCustomer)}
                  onClick={() => void onCreateAndCheckIn()}
                  data-testid="frontdesk-create-checkin"
                >
                  {pickedCustomer
                    ? (pickedCustomer.in_house ? t('addRooms') : t('checkInExisting'))
                    : t('createAndCheckIn')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {walkInMatches && (
          <CustomerMatchesModal
            open
            name={name.trim()}
            matches={walkInMatches}
            creating={busy}
            onPick={(customer) => {
              if (isAsiGuest(customer) || customer.asi_checkin_id != null) {
                toast.error(t('asiGuestBlocked'));
                return;
              }
              setPickedCustomer(customer);
              setName(customer.name ?? '');
              setWalkInMatches(null);
            }}
            onCreateNew={() => {
              setForceCreateNew(true);
              setWalkInMatches(null);
              void onCreateAndCheckIn(true);
            }}
            onClose={() => setWalkInMatches(null)}
          />
        )}

        {tab === 'clients' && (
          <div className="border rounded-2xl bg-white shadow-sm space-y-3 flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="frontdesk-clients">
            <div className="px-4 py-3 border-b shrink-0 space-y-3">
              <h2 className="font-semibold">{t('clients')}</h2>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder={t('searchGuest')}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void loadClientRegistry(); }}
                />
                <Button onClick={() => void loadClientRegistry()}>{t('searchGuest')}</Button>
              </div>
            </div>
            {clientHits.length === 0 ? (
              <p className="text-sm text-neutral-600 px-4" data-testid="frontdesk-clients-empty">
                {t('noClients')}
              </p>
            ) : (
              <ul className="divide-y flex-1 min-h-0 overflow-auto" data-testid="frontdesk-clients-list">
                {clientHits.map((c) => (
                  <li key={String(c.id)} className="px-4 py-3 min-h-16 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      {c.in_house && c.room ? (
                        <span className="shrink-0 inline-flex items-center justify-center min-w-12 h-10 px-2 rounded-lg bg-neutral-900 text-white text-sm font-bold tabular-nums">
                          {c.room}
                        </span>
                      ) : null}
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{formatGuestLabel(c)}</div>
                        <div className="text-xs text-neutral-600">
                          {c.tags?.includes('manual-stay') ? t('badgeManualStay') : ''}
                          {isAsiGuest(c) ? `${c.tags?.includes('manual-stay') ? ' · ' : ''}${t('badgeAsi')}` : ''}
                        </div>
                      </div>
                    </div>
                    {canCheckIn && !isAsiGuest(c) && c.asi_checkin_id == null && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setPickedCustomer(c);
                          setName(c.name ?? '');
                          setTab('checkin');
                        }}
                      >
                        {c.in_house ? t('addRooms') : t('checkIn')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'room' && (
          <div className="border rounded-2xl bg-white shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="frontdesk-room-charges">
            <div className="px-4 py-3 border-b shrink-0 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('roomChargesFrom')}</label>
                <Input type="date" value={roomFrom} onChange={(e) => setRoomFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('roomChargesTo')}</label>
                <Input type="date" value={roomTo} onChange={(e) => setRoomTo(e.target.value)} />
              </div>
              <div className="space-y-1 flex-1 min-w-48">
                <label className="text-xs font-medium">{t('roomChargesSearch')}</label>
                <Input
                  value={roomSearch}
                  onChange={(e) => setRoomSearch(e.target.value)}
                  placeholder={t('roomChargesSearchPlaceholder')}
                />
              </div>
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t('roomChargesCount', { count: roomOrdersShown.length })}
                </div>
                <DualCurrency amount={roomOrdersTotal} layout="inline" primaryClassName="text-lg font-bold" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {roomLoading ? (
                <p className="text-sm text-neutral-500 p-6 text-center">{t('roomOrderLoading')}</p>
              ) : roomOrdersShown.length === 0 ? (
                <p className="text-sm text-neutral-500 p-6 text-center">{t('roomChargesEmpty')}</p>
              ) : (
                <ul className="divide-y">
                  {roomOrdersShown.map((order) => {
                    const guest = order.customer && typeof order.customer === 'object' ? order.customer : undefined;
                    return (
                      <li
                        key={String(order.id)}
                        className="px-4 py-3 flex flex-wrap items-center gap-3"
                        data-testid={`frontdesk-room-charge-${order.id}`}
                      >
                        <span className="shrink-0 inline-flex items-center justify-center min-w-12 h-10 px-2 rounded-lg bg-neutral-900 text-white text-sm font-bold tabular-nums">
                          {orderRoomLabel(order) || '—'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{formatGuestLabel(guest)}</div>
                          <div className="text-sm text-neutral-600 flex flex-wrap items-center gap-x-2">
                            <span>{t('menu:header.orderNumber', { number: getInvoiceNumber(order) })}</span>
                            <span>{toLuxonDateTime(order.created_at).toFormat('dd LLL HH:mm')}</span>
                          </div>
                        </div>
                        <DualCurrency amount={orderRoomChargeAmount(order)} layout="stack" primaryClassName="font-bold" />
                        <div className="flex gap-1.5 shrink-0">
                          <Button size="sm" variant="primary" onClick={() => setViewOrderId(order.id)}>
                            {t('viewOrder')}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void printRoomOrder(order, 'fr')}>
                            {t('printFicheFr')}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void printRoomOrder(order, 'en')}>
                            {t('printFicheEn')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'conflicts' && (
          <div className="border rounded-2xl bg-white shadow-sm flex-1 min-h-0 overflow-auto" data-testid="frontdesk-conflicts">
            <div className="px-4 py-3 border-b">
              <h2 className="font-semibold">{t('conflicts')}</h2>
            </div>
            <div className="p-4 space-y-3">
              {conflicts.length === 0 && <p className="text-sm text-neutral-600">{t('noConflicts')}</p>}
              <ul className="space-y-3">
                {conflicts.map((c) => (
                  <li key={c.roomKey} className="border border-danger-300 rounded-xl p-4 bg-danger-50">
                    <div className="font-semibold text-danger-800 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center min-w-12 h-9 px-2 rounded-lg bg-danger-700 text-white text-sm font-bold tabular-nums">
                        {c.roomKey}
                      </span>
                      {t('conflictBadge')}
                    </div>
                    <ul className="text-sm mt-2 space-y-1">
                      {c.guests.map((g) => (
                        <li key={String(g.id)}>
                          {formatGuestLabel(g)}
                          {isAsiGuest(g) ? ` · ${t('badgeAsi')}` : ''}
                          {g.tags?.includes('manual-stay') ? ` · ${t('badgeManualStay')}` : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      <RoomOrderModal
        orderId={viewOrderId}
        onClose={() => setViewOrderId(null)}
        onPrint={(order, lang) => {
          setViewOrderId(null);
          void (tab === 'room' ? printRoomOrder(order, lang) : printOneFiche(order, lang));
        }}
      />
    </Layout>
  );
};
