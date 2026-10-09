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
import type { Stay } from '@/api/model/stay.ts';
import type { Table } from '@/api/model/table.ts';
import { appPage } from '@/store/jotai.ts';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';
import { RECEIVE_PAYMENT_MODULE } from '@/lib/payment-access.ts';
import { loadResortChambresFloor } from '@/lib/resort-floor-tables.ts';
import { normalizeRoomKey } from '@/lib/room-key.ts';
import { formatGuestLabel, generateWalkInGuestCode, isAsiGuest } from '@/lib/guest.ts';
import { hasWalkInContact } from '@/lib/customer-id-document.ts';
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
  isStayRoomSettled,
  listOpenStays,
  listRoomConflicts,
  loadOpenOrdersForCustomer,
  loadStayRoomPayments,
  loadStayRoomTotal,
  moveStay,
  settleStayRoom,
  stayRoomOutstanding,
} from '@/lib/stay.service.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { nowInAppTimezone } from '@/lib/datetime.ts';
import { withCurrency } from '@/lib/utils.ts';
import { PhoneInput } from '@/components/customer/phone.input.tsx';
import { CustomerMatchesModal } from '@/components/customer/customer.matches.modal.tsx';
import type { PaymentType } from '@/api/model/payment_type.ts';
import { isRoomPaymentType } from '@/lib/room-charge.ts';
import useApi, { type SettingsData } from '@/api/db/use.api.ts';

type TabId = 'stays' | 'checkin' | 'clients' | 'conflicts';

const todayYmd = () => nowInAppTimezone().toISODate() ?? '';

const guestOf = (stay: Stay): Customer | undefined => {
  const c = stay.customer;
  if (c && typeof c === 'object' && 'name' in c) return c as Customer;
  return undefined;
};

export const FrontDeskScreen = () => {
  const { t } = useTranslation(['frontdesk', 'toast', 'navigation']);
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
  const [conflicts, setConflicts] = useState<Array<{ roomKey: string; guests: Customer[] }>>([]);
  const [rooms, setRooms] = useState<Table[]>([]);
  const [occupiedKeys, setOccupiedKeys] = useState<Set<string>>(new Set());
  const [selectedStayId, setSelectedStayId] = useState<string>('');
  const [folioTotal, setFolioTotal] = useState(0);
  const [folioLines, setFolioLines] = useState<Array<{ id: unknown; amount?: number; comments?: string }>>([]);
  const [openOrders, setOpenOrders] = useState<Array<{ id: unknown; invoice_number?: unknown }>>([]);
  const [busy, setBusy] = useState(false);
  /** ASI guest who took the selected stay's room after the manual check-in. */
  const [asiTakeover, setAsiTakeover] = useState<Customer | undefined>();
  /** After checking out a stay ASI took over: offer to fold the manual record into the ASI one. */
  const [mergeOffer, setMergeOffer] = useState<{ manual: Customer; asi: Customer } | null>(null);

  // Check-in form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idDocument, setIdDocument] = useState('');
  const [room, setRoom] = useState('');
  const [dateIn, setDateIn] = useState(todayYmd);
  const [dateOut, setDateOut] = useState(todayYmd);
  const [notes, setNotes] = useState('');
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [walkInMatches, setWalkInMatches] = useState<CustomerMatch[] | null>(null);
  const [forceCreateNew, setForceCreateNew] = useState(false);
  const [settlePaymentTypeId, setSettlePaymentTypeId] = useState('');

  // Client search
  const [clientSearch, setClientSearch] = useState('');
  const [clientHits, setClientHits] = useState<Customer[]>([]);

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
      (pt) => !isRoomPaymentType(pt) && String(pt.type ?? '').toLowerCase() !== 'credit',
    ),
    [paymentTypesData],
  );

  const selectedStay = useMemo(
    () => stays.find((s) => String(s.id) === selectedStayId),
    [stays, selectedStayId],
  );

  const folioOutstanding = stayRoomOutstanding(folioTotal, selectedStay?.settled_amount);
  const folioSettled = isStayRoomSettled(folioTotal, selectedStay?.settled_amount);

  const refresh = useCallback(async () => {
    const [open, conflictList, chambres] = await Promise.all([
      listOpenStays(db),
      listRoomConflicts(db),
      loadResortChambresFloor(db),
    ]);
    setStays(open);
    setConflicts(conflictList);
    setRooms(chambres?.tables ?? []);

    const inHouse = await db.query(
      `SELECT room FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER}
         AND (in_house = true OR tags CONTAINS 'in-house')
         AND room != NONE AND room != NULL`,
    );
    const keys = new Set<string>();
    const rows = Array.isArray(inHouse) ? inHouse[0] : [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = normalizeRoomKey((row as { room?: string }).room);
      if (key) keys.add(key);
    }
    setOccupiedKeys(keys);
  }, [db]);

  useEffect(() => {
    void refresh().catch((error) => console.error('Front Desk refresh failed', error));
  }, [refresh]);

  useEffect(() => {
    if (!selectedStay?.id) {
      setFolioTotal(0);
      setFolioLines([]);
      setOpenOrders([]);
      setAsiTakeover(undefined);
      return;
    }
    let cancelled = false;
    setAsiTakeover(undefined);
    void (async () => {
      const [total, lines, orders, takeover] = await Promise.all([
        loadStayRoomTotal(db, selectedStay.id),
        loadStayRoomPayments(db, selectedStay.id),
        loadOpenOrdersForCustomer(db, selectedStay.customer),
        findAsiTakeover(db, selectedStay),
      ]);
      if (cancelled) return;
      setAsiTakeover(takeover);
      setFolioTotal(total);
      setFolioLines(lines.map((line) => ({
        id: line.id,
        amount: Number(line.amount) || 0,
        comments: line.comments,
      })));
      setOpenOrders(orders);
      setExtendDate(String(selectedStay.date_out ?? ''));
      setMoveRoom(String(selectedStay.room ?? ''));
    })().catch((error) => console.error('Folio load failed', error));
    return () => {
      cancelled = true;
    };
  }, [db, selectedStay?.id, selectedStay?.date_out, selectedStay?.room, selectedStay?.customer]);

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
    setBusy(true);
    try {
      if (isAsiGuest(customer) || customer.asi_checkin_id != null || customer.asi_guest_id != null) {
        throw new StayServiceError('asi_guest');
      }
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
    if (!hasWalkInContact({ phone, idDocument })) {
      toast.error(t('toast:customer.contactRequired', { defaultValue: 'Phone or ID required' }));
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
      setSelectedStayId('');
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

  const printFolio = () => {
    if (!selectedStay) return;
    const guest = guestOf(selectedStay);
    const lines = folioLines.length
      ? folioLines.map((l) => `${withCurrency(l.amount)} ${l.comments ?? ''}`).join('\n')
      : t('emptyFolio');
    const html = `<html><head><title>${t('folioTitle')}</title></head><body>
      <h1>${t('folioTitle')}</h1>
      <p>${formatGuestLabel(guest)} — ${t('room')} ${selectedStay.room}</p>
      <p>${t('dateIn')}: ${selectedStay.date_in} — ${t('dateOut')}: ${selectedStay.date_out}</p>
      <pre>${lines}</pre>
      <p><strong>${t('roomTotal')}: ${withCurrency(folioTotal)}</strong></p>
      </body></html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=480,height=640');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const searchClients = async () => {
    const q = clientSearch.trim();
    if (!q) {
      setClientHits([]);
      return;
    }
    const rows = await db.query(
      `SELECT * FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER}
         AND (
           string::lowercase(name ?? '') CONTAINS string::lowercase($q)
           OR string::lowercase(guest_code ?? '') CONTAINS string::lowercase($q)
           OR phone_e164 CONTAINS $q
           OR tags CONTAINS 'manual-stay'
         )
       ORDER BY name ASC
       LIMIT 40`,
      { q },
    );
    const list = Array.isArray(rows) ? rows[0] : [];
    setClientHits(Array.isArray(list) ? (list as Customer[]) : []);
  };

  const roomOptions = useMemo(() => {
    return [...rooms].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  }, [rooms]);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'stays', label: t('openStays') },
    { id: 'checkin', label: t('checkIn') },
    { id: 'clients', label: t('clients') },
    { id: 'conflicts', label: t('conflicts') },
  ];

  return (
    <Layout>
      <DocumentTitle parts={[t('navigation:sidebar.frontdesk')]} />
      <div className="p-4 max-w-6xl mx-auto space-y-4" data-testid="frontdesk-screen">
        <h1 className="text-2xl font-bold">{t('title')}</h1>

        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.id}
              variant={tab === item.id ? 'primary' : 'secondary'}
              onClick={() => setTab(item.id)}
              data-testid={`frontdesk-tab-${item.id}`}
            >
              {item.label}
              {item.id === 'conflicts' && conflicts.length > 0 ? ` (${conflicts.length})` : ''}
            </Button>
          ))}
        </div>

        {mergeOffer && (
          <div
            className="rounded-xl border border-primary-300 bg-primary-50 p-4 space-y-2"
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

        {tab === 'stays' && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="border rounded-xl p-3 space-y-2 bg-white">
              <h2 className="font-semibold">{t('openStays')}</h2>
              {stays.length === 0 && <p className="text-sm text-neutral-600">{t('noOpenStays')}</p>}
              <ul className="space-y-2 max-h-[60vh] overflow-auto">
                {stays.map((stay) => {
                  const guest = guestOf(stay);
                  return (
                    <li key={String(stay.id)}>
                      <button
                        type="button"
                        className={`w-full text-left rounded-lg border px-3 py-2 ${
                          String(stay.id) === selectedStayId ? 'border-primary-500 bg-primary-50' : 'border-neutral-200'
                        }`}
                        onClick={() => setSelectedStayId(String(stay.id))}
                        data-testid={`frontdesk-stay-${stay.id}`}
                      >
                        <div className="font-semibold">{formatGuestLabel(guest)}</div>
                        <div className="text-sm text-neutral-600">
                          {t('room')} {stay.room} · {stay.date_in} → {stay.date_out}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="border rounded-xl p-3 space-y-3 bg-white">
              {!selectedStay && <p className="text-sm text-neutral-600">{t('openStays')}</p>}
              {selectedStay && (
                <>
                  <h2 className="font-semibold">{formatGuestLabel(guestOf(selectedStay))}</h2>
                  <p className="text-sm">
                    {t('room')} {selectedStay.room} · {selectedStay.date_in} → {selectedStay.date_out}
                  </p>
                  {asiTakeover && (
                    <p
                      className="text-sm rounded-lg border border-danger-300 bg-danger-50 text-danger-800 px-3 py-2"
                      role="status"
                      data-testid="frontdesk-asi-takeover"
                    >
                      {t('asiTakeoverWarn', { name: formatGuestLabel(asiTakeover), room: selectedStay.room })}
                    </p>
                  )}
                  <p className="text-sm font-semibold">
                    {t('roomTotal')}: {withCurrency(folioTotal)}
                    {' · '}
                    {t('settledAmount', { defaultValue: 'Collected' })}: {withCurrency(Number(selectedStay.settled_amount) || 0)}
                    {' · '}
                    {t('outstanding', { defaultValue: 'Due' })}: {withCurrency(folioOutstanding)}
                    {' '}
                    {folioSettled ? (
                      <span className="text-success-700">({t('settled')})</span>
                    ) : (
                      <span className="text-warning-700">({t('notSettled')})</span>
                    )}
                  </p>
                  {openOrders.length > 0 && (
                    <p className="text-sm text-warning-800">{t('openOrdersWarn', { count: openOrders.length })}</p>
                  )}
                  <ul className="text-sm max-h-32 overflow-auto border rounded p-2">
                    {folioLines.length === 0 && <li>{t('emptyFolio')}</li>}
                    {folioLines.map((line) => (
                      <li key={String(line.id)}>{withCurrency(line.amount)} {line.comments}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 items-end">
                    <Button variant="secondary" onClick={printFolio}>{t('printFolio')}</Button>
                    {canSettle && folioOutstanding > 0 && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">{t('settleTender', { defaultValue: 'Tender' })}</label>
                          <select
                            className="border rounded px-2 py-2"
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
                      <p className="text-xs text-neutral-600 w-full">{t('settleHint')}</p>
                    )}
                    {canCheckOut && (
                      <Button
                        variant="danger"
                        disabled={busy || (folioOutstanding > 0)}
                        onClick={() => void onCheckOut()}
                        data-testid="frontdesk-checkout"
                      >
                        {t('confirmCheckout')}
                      </Button>
                    )}
                  </div>
                  {canMove && (
                    <div className="grid sm:grid-cols-2 gap-2 border-t pt-3">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">{t('move')}</label>
                        <select
                          className="w-full border rounded px-2 py-2"
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
                      <div className="space-y-1">
                        <label className="text-sm font-medium">{t('extend')}</label>
                        <Input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} />
                        <Button size="sm" disabled={busy} onClick={() => void onExtend()}>{t('extend')}</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'checkin' && canCheckIn && (
          <div className="border rounded-xl p-4 bg-white space-y-3 max-w-xl" data-testid="frontdesk-checkin">
            <h2 className="font-semibold">{t('checkIn')}</h2>
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
            <label className="block text-sm font-medium">{t('selectRoom')}</label>
            <select
              className="w-full border rounded px-2 py-2"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              data-testid="frontdesk-room"
            >
              <option value="">{t('selectRoom')}</option>
              {roomOptions.map((r) => {
                const key = normalizeRoomKey(r.number);
                const occupied = key && occupiedKeys.has(key);
                return (
                  <option key={String(r.id)} value={String(r.number)} disabled={Boolean(occupied)}>
                    {r.number}{r.asi_alias ? ` (${r.asi_alias})` : ''}{occupied ? ` — ${t('roomOccupied')}` : ''}
                  </option>
                );
              })}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm">{t('dateIn')}</label>
                <Input type="date" value={dateIn} onChange={(e) => setDateIn(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">{t('dateOut')}</label>
                <Input type="date" value={dateOut} onChange={(e) => setDateOut(e.target.value)} />
              </div>
            </div>
            <Input placeholder={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {pickedCustomer && (
              <p className="text-sm text-primary-800">
                {t('checkInExisting')}: {formatGuestLabel(pickedCustomer)}
              </p>
            )}
            <Button
              variant="primary"
              disabled={busy || !room || (!name.trim() && !pickedCustomer)}
              onClick={() => void onCreateAndCheckIn()}
              data-testid="frontdesk-create-checkin"
            >
              {pickedCustomer ? t('checkInExisting') : t('createAndCheckIn')}
            </Button>
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
          <div className="border rounded-xl p-4 bg-white space-y-3" data-testid="frontdesk-clients">
            <h2 className="font-semibold">{t('clients')}</h2>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder={t('searchGuest')}
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void searchClients(); }}
              />
              <Button onClick={() => void searchClients()}>{t('searchGuest')}</Button>
            </div>
            <ul className="divide-y border rounded max-h-[60vh] overflow-auto">
              {clientHits.map((c) => (
                <li key={String(c.id)} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{formatGuestLabel(c)}</div>
                    <div className="text-xs text-neutral-600">
                      {c.in_house ? `${t('room')} ${c.room}` : ''}
                      {c.tags?.includes('manual-stay') ? ` · ${t('badgeManualStay')}` : ''}
                      {isAsiGuest(c) ? ' · ASI' : ''}
                    </div>
                  </div>
                  {canCheckIn && !c.in_house && !isAsiGuest(c) && c.asi_checkin_id == null && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPickedCustomer(c);
                        setName(c.name ?? '');
                        setTab('checkin');
                      }}
                    >
                      {t('checkIn')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'conflicts' && (
          <div className="border rounded-xl p-4 bg-white space-y-2" data-testid="frontdesk-conflicts">
            <h2 className="font-semibold">{t('conflicts')}</h2>
            {conflicts.length === 0 && <p className="text-sm text-neutral-600">{t('noConflicts')}</p>}
            <ul className="space-y-3">
              {conflicts.map((c) => (
                <li key={c.roomKey} className="border border-danger-300 rounded-lg p-3 bg-danger-50">
                  <div className="font-semibold text-danger-800">
                    {t('conflictBadge')} — {t('room')} {c.roomKey}
                  </div>
                  <ul className="text-sm mt-1">
                    {c.guests.map((g) => (
                      <li key={String(g.id)}>
                        {formatGuestLabel(g)}
                        {isAsiGuest(g) ? ' · ASI' : ''}
                        {g.tags?.includes('manual-stay') ? ` · ${t('badgeManualStay')}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Layout>
  );
};
