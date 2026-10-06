import React, { useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import { Customer } from '@/api/model/customer.ts';
import { Floor } from '@/api/model/floor.ts';
import { Order, OrderStatus } from '@/api/model/order.ts';
import { Table } from '@/api/model/table.ts';
import { Input } from '@/components/common/input/input.tsx';
import { Textarea } from '@/components/common/input/textarea.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { getInvoiceNumber, translateOrderStatus } from '@/lib/order.ts';
import {
  formatGuestLabel,
  guestCodeLabel,
  orderZoneLabel,
  generateWalkInGuestCode,
  canRegisterGuestFromSearch,
  previewGuestCode,
  searchGuests,
  namesAreSamePerson,
  dropSupersededStays,
  isAsiGuest,
} from '@/lib/guest.ts';
import { findCustomerByPhone } from '@/lib/customer-phone.ts';
import {
  findCustomerByIdDocument,
  hasWalkInContact,
  maskIdDocument,
  normalizeIdDocument,
} from '@/lib/customer-id-document.ts';
import { toLuxonDateTime, nowSurrealDateTime } from '@/lib/datetime.ts';
import { getGuestDeparture } from '@/lib/guest-departure.ts';
import {
  ensureResortFloorTables,
  findRoomByNumber,
  findTableByNumber,
  loadResortChambresFloor,
} from '@/lib/resort-floor-tables.ts';
import { usesAsiPmsRooms } from '@/lib/pos-mode.ts';
import { formatTableLabel } from '@/lib/table-label.ts';
import { isHotelRoomTable } from '@/lib/kitchen-ticket-label.ts';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn, toRecordId } from '@/lib/utils.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Customers } from '@/components/customer/customer.tsx';
import { canEditOrder } from '@/lib/order-edit.ts';
import { buildOrderEditSession, commitOrderEditSession } from '@/lib/commit-order-edit.ts';
import { fetchOrderById } from '@/lib/order-fetch.ts';
import { ORDER_FETCHES } from '@/api/model/order.ts';
import { MENU } from '@/routes/posr.ts';
import { useNavigate } from 'react-router';
import { appPage, appSettings, appState } from '@/store/jotai.ts';
import { orderEditSessionAtom } from '@/store/order-edit-session.ts';
import { flushSync } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faNoteSticky, faPencil, faPlus } from '@fortawesome/free-solid-svg-icons';

type FolioOrder = Order & { item_count?: number };

export const GuestLookup = () => {
  const db = useDB();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['menu', 'orders', 'common']);
  const { t: tOrders } = useTranslation('orders');
  const [state, setState] = useAtom(appState);
  const [, setEditSession] = useAtom(orderEditSessionAtom);
  const [settings, setSettings] = useAtom(appSettings);
  const [page] = useAtom(appPage);
  const preferInHouse = usesAsiPmsRooms();
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<Customer[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [selected, setSelected] = useState<Customer | undefined>(state.customer);
  const [folio, setFolio] = useState<FolioOrder[]>([]);
  /** Only set when user clicks "Nouveau code" — otherwise preview is stable from the name. */
  const [codeOverride, setCodeOverride] = useState<string | null>(null);
  // A hotel room is not a table: it never pre-fills the table-number field.
  const initialTableNumber = isHotelRoomTable(state.table) ? '' : (state.table?.number ?? '');
  const [tableNumber, setTableNumber] = useState(initialTableNumber);
  // Table number and zone are optional: folded away until the server asks for them.
  const [showPlace, setShowPlace] = useState(Boolean(initialTableNumber));
  // Phone, ID document and note are read-only until the pencil is tapped.
  const [editInfo, setEditInfo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferOrder, setTransferOrder] = useState<FolioOrder | undefined>();
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);
  const [newIdDocument, setNewIdDocument] = useState('');
  const [editingIdDocument, setEditingIdDocument] = useState(false);
  const [idDocumentDraft, setIdDocumentDraft] = useState('');
  const [savingIdDocument, setSavingIdDocument] = useState(false);

  const floors: Floor[] = settings.floors ?? [];

  // Exact matches first, then names only spelled close to the search.
  const found = useMemo(() => searchGuests(guests, search), [guests, search]);
  const results = useMemo(() => [...found.exact, ...found.close], [found]);
  const firstCloseId = found.close[0]?.id?.toString();

  // A close spelling is a hint, not the same person: the new name can still be registered.
  const canRegisterFromSearch =
    found.exact.length === 0 && canRegisterGuestFromSearch(search);

  const selectedLastOrderAt = folio[0]?.created_at ?? selected?.last_order_at;
  const selectedLastOrderLabel = selectedLastOrderAt
    ? t('menu:guest.lastOrder', {
        date: toLuxonDateTime(selectedLastOrderAt).toFormat('dd LLL yyyy'),
      })
    : t('menu:guest.noOrders');

  const displayCode = useMemo(() => {
    if (codeOverride) {
      return codeOverride;
    }
    return previewGuestCode(search.trim());
  }, [codeOverride, search]);

  useEffect(() => {
    // Name changed → drop manual override so the stable preview tracks the typed name.
    setCodeOverride(null);
  }, [search]);

  useEffect(() => {
    void (async () => {
      try {
        const seeded = await ensureResortFloorTables(db);
        const chambres = await loadResortChambresFloor(db);
        setSettings((prev) => {
          const floorMap = new Map(
            (prev.floors ?? []).map((floor) => [floor.id?.toString(), floor]),
          );
          floorMap.set(seeded.floor.id?.toString(), seeded.floor);
          if (chambres?.floor?.id) {
            floorMap.set(chambres.floor.id.toString(), chambres.floor);
          }
          const tableMap = new Map(
            (prev.tables ?? []).map((table) => [table.id?.toString(), table]),
          );
          for (const table of seeded.tables) {
            tableMap.set(table.id?.toString(), table);
          }
          for (const table of chambres?.tables ?? []) {
            tableMap.set(table.id?.toString(), table);
          }
          return {
            ...prev,
            floors: Array.from(floorMap.values()),
            tables: Array.from(tableMap.values()),
          };
        });
      } catch (error) {
        console.error('Failed to ensure resort floor tables', error);
      }
    })();
  }, [db, setSettings]);

  const loadGuests = async () => {
    setLoadingGuests(true);
    try {
      const lastOrderAt = `(SELECT VALUE created_at FROM ${Tables.orders}
         WHERE customer = $parent.id
         ORDER BY created_at DESC LIMIT 1)[0] AS last_order_at`;
      // ASI mode: PMS in-house + POSR walk-in / local guests (never hide local registry),
      // plus checked-out FD guests that carry a staff note.
      const [list] = preferInHouse
        ? await db.query<Customer[]>(
            `SELECT *, ${lastOrderAt} FROM ${Tables.customers}
             WHERE in_house = true OR tags CONTAINS 'in-house'
                OR source = 'walk-in' OR tags CONTAINS 'walk-in'
                OR source = 'local'
                OR (notes != NONE AND notes != NULL AND notes != '')
             ORDER BY in_house DESC, name
             LIMIT 500`
          )
        : await db.query<Customer[]>(
            `SELECT *, ${lastOrderAt} FROM ${Tables.customers}
             ORDER BY name
             LIMIT 500`
          );

      setGuests(dropSupersededStays(Array.isArray(list) ? list : []));
    } catch (error) {
      console.error('Guest list failed', error);
      setGuests([]);
    } finally {
      setLoadingGuests(false);
    }
  };

  const loadFolio = async (customer: Customer) => {
    if (!customer?.id) {
      setFolio([]);
      return;
    }

    const [rows] = await db.query<FolioOrder[]>(
      `SELECT * FROM ${Tables.orders}
       WHERE customer = $customer
       ORDER BY created_at DESC
       LIMIT 20
       FETCH floor, order_type, customer, table`,
      { customer: customer.id }
    );

    setFolio(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => {
    void loadGuests();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per PMS mode; db identity changes every render
  }, [preferInHouse]);

  useEffect(() => {
    // Clear first: the previous guest's folio must not flash under the new one
    // (it also feeds the "last order" line).
    setFolio([]);
    if (selected?.id) {
      void loadFolio(selected);
    } else {
      setFolio([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload folio when guest selection changes
  }, [selected?.id]);

  useEffect(() => {
    setEditingNote(false);
    setNoteDraft(selected?.notes ?? '');
    setEditingPhone(false);
    setPhoneDraft(
      selected?.phone != null && selected.phone !== ''
        ? String(selected.phone)
        : '',
    );
    setEditingIdDocument(false);
    setIdDocumentDraft('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset note/phone/ID editors when guest selection changes
  }, [selected?.id]);

  const saveGuestNote = async () => {
    if (!selected?.id) {
      return;
    }

    const value = noteDraft.trim() || null;
    setSavingNote(true);
    try {
      await db.merge(toRecordId(selected.id), { notes: value });
      const updated = { ...selected, notes: value };
      setSelected(updated);
      setGuests((prev) =>
        prev.map((guest) =>
          guest.id?.toString() === updated.id?.toString() ? updated : guest,
        ),
      );
      setState((prev) =>
        prev.customer?.id?.toString() === updated.id?.toString()
          ? { ...prev, customer: updated }
          : prev,
      );
      toast.success(t('menu:guest.noteSaved'));
      setEditingNote(false);
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.noteSaveFailed'));
    } finally {
      setSavingNote(false);
    }
  };

  const saveGuestPhone = async () => {
    if (!selected?.id || isAsiGuest(selected)) {
      return;
    }

    const value = phoneDraft.trim() || null;
    setSavingPhone(true);
    try {
      if (value) {
        const byPhone = await findCustomerByPhone(db, value);
        if (
          byPhone &&
          byPhone.id?.toString() !== selected.id?.toString()
        ) {
          toast.error(
            t('menu:guest.phoneTaken', {
              name: byPhone.name || byPhone.guest_code || '',
            }),
          );
          return;
        }
      }

      await db.merge(toRecordId(selected.id), { phone: value });
      const updated = { ...selected, phone: value };
      setSelected(updated);
      setGuests((prev) =>
        prev.map((guest) =>
          guest.id?.toString() === updated.id?.toString() ? updated : guest,
        ),
      );
      setState((prev) =>
        prev.customer?.id?.toString() === updated.id?.toString()
          ? { ...prev, customer: updated }
          : prev,
      );
      toast.success(t('menu:guest.phoneSaved'));
      setEditingPhone(false);
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.phoneSaveFailed'));
    } finally {
      setSavingPhone(false);
    }
  };

  const saveGuestIdDocument = async () => {
    if (!selected?.id || isAsiGuest(selected)) {
      return;
    }

    // The editor is never prefilled, so an empty draft means "no change", not "erase".
    const value = normalizeIdDocument(idDocumentDraft);
    if (!value) {
      setEditingIdDocument(false);
      return;
    }
    setSavingIdDocument(true);
    try {
      const byIdDocument = await findCustomerByIdDocument(db, value);
      if (
        byIdDocument &&
        byIdDocument.id?.toString() !== selected.id?.toString()
      ) {
        toast.error(
          t('menu:guest.idDocumentTaken', {
            name: byIdDocument.name || byIdDocument.guest_code || '',
          }),
        );
        return;
      }

      await db.merge(toRecordId(selected.id), { id_document_number: value });
      const updated = { ...selected, id_document_number: value };
      setSelected(updated);
      setGuests((prev) =>
        prev.map((guest) =>
          guest.id?.toString() === updated.id?.toString() ? updated : guest,
        ),
      );
      setState((prev) =>
        prev.customer?.id?.toString() === updated.id?.toString()
          ? { ...prev, customer: updated }
          : prev,
      );
      toast.success(t('menu:guest.idDocumentSaved'));
      setEditingIdDocument(false);
      setIdDocumentDraft('');
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.idDocumentSaveFailed'));
    } finally {
      setSavingIdDocument(false);
    }
  };

  const selectGuest = (customer: Customer) => {
    setSelected(customer);
    setEditInfo(false);
    setEditingPhone(false);
    setEditingIdDocument(false);
    setEditingNote(false);
    // The field holds a dining table only; an empty field sends the order to the guest's room.
    if (customer.room) {
      setTableNumber('');
    }
    setState((prev) => ({
      ...prev,
      customer,
    }));
  };

  const createGuestFromSearch = async (andStartOrder = false) => {
    const name = search.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(name)) {
      toast.error(t('menu:guest.nameRequired'));
      return;
    }

    if (newPhone.trim()) {
      // A failed duplicate check must not block the registration.
      const byPhone = await findCustomerByPhone(db, newPhone).catch((error) => {
        console.error('Phone lookup failed', error);
        return undefined;
      });
      if (byPhone) {
        selectGuest(byPhone);
        setGuests((prev) => {
          const id = byPhone.id?.toString();
          const without = prev.filter((item) => item.id?.toString() !== id);
          return [byPhone, ...without];
        });
        setSearch(byPhone.name?.trim() || name);
        toast.message(
          t('menu:guest.phoneExists', {
            name: byPhone.name || byPhone.guest_code || '',
          }),
        );
        if (andStartOrder) {
          await startNewOrderFor(byPhone);
        }
        return;
      }
    }

    if (normalizeIdDocument(newIdDocument)) {
      // A failed duplicate check must not block the registration.
      const byIdDocument = await findCustomerByIdDocument(db, newIdDocument).catch((error) => {
        console.error('ID document lookup failed', error);
        return undefined;
      });
      if (byIdDocument) {
        selectGuest(byIdDocument);
        setGuests((prev) => {
          const id = byIdDocument.id?.toString();
          const without = prev.filter((item) => item.id?.toString() !== id);
          return [byIdDocument, ...without];
        });
        setSearch(byIdDocument.name?.trim() || name);
        toast.message(
          t('menu:guest.idDocumentExists', {
            name: byIdDocument.name || byIdDocument.guest_code || '',
          }),
        );
        if (andStartOrder) {
          await startNewOrderFor(byIdDocument);
        }
        return;
      }
    }

    // Same words, any order → treat as existing client (John Michel ≈ Michel John)
    const samePerson = guests.find((guest) => namesAreSamePerson(guest.name, name));
    if (samePerson) {
      selectGuest(samePerson);
      setSearch(samePerson.name?.trim() || name);
      toast.message(t('menu:guest.alreadyExists', { name: samePerson.name }));
      if (andStartOrder) {
        await startNewOrderFor(samePerson);
      }
      return;
    }

    if (!hasWalkInContact({ phone: newPhone, idDocument: newIdDocument })) {
      toast.error(t('menu:guest.contactRequired'));
      return;
    }

    setSaving(true);
    try {
      let guest_code = displayCode.trim().toUpperCase() || generateWalkInGuestCode(name);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code }
        );
        if (!Array.isArray(existing) || !existing[0]) {
          break;
        }
        guest_code = generateWalkInGuestCode(name);
      }

      const [created] = await db.insert(Tables.customers, {
        name,
        guest_code,
        room: null,
        in_house: false,
        source: 'walk-in',
        tags: ['walk-in'],
        phone: newPhone.trim() || null,
        // Only named when set: keeps this insert valid on a DB without
        // migrations/2026_10_02_customer_id_document.surql (customer is SCHEMAFULL).
        ...(normalizeIdDocument(newIdDocument)
          ? { id_document_number: normalizeIdDocument(newIdDocument) }
          : {}),
      });
      if (!created) {
        toast.error(t('menu:guest.createFailed'));
        return;
      }

      const guest = created as unknown as Customer;
      selectGuest(guest);
      setGuests((prev) => {
        const id = guest.id?.toString();
        const without = prev.filter((item) => item.id?.toString() !== id);
        return [guest, ...without];
      });
      setSearch(name);
      setNewPhone('');
      setNewIdDocument('');
      toast.success(t('menu:guest.created'));

      if (andStartOrder) {
        await startNewOrderFor(guest);
      }
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const startNewOrderFor = async (guest: Customer) => {
    let table: Table | undefined;
    // The typed number is a dining table; only the guest's own room resolves to a hotel room.
    const wantedTable = tableNumber.trim();
    const guestRoom = String(guest.room ?? '').trim();
    if (wantedTable) {
      table = await findTableByNumber(db, wantedTable);
      if (!table) {
        toast.error(t('menu:guest.tableNotFound', { number: wantedTable }));
        return;
      }
    } else if (guestRoom) {
      table = await findRoomByNumber(db, guestRoom);
      if (!table) {
        toast.error(t('menu:guest.roomNotFound', { number: guestRoom }));
        return;
      }
    }

    const floorFromTable = table?.floor;
    setEditSession(null);
    setState((prev) => ({
      ...prev,
      customer: guest,
      table,
      resortEntry: 'guest',
      showFloor: false,
      showPersons: false,
      order: { id: 'new', order: undefined },
      dueAt: undefined,
      cart: [],
      seats: [],
      seat: undefined,
      floor: floorFromTable ?? prev.floor ?? floors[0],
      orderType: prev.orderType ?? settings.order_types[0],
    }));
  };

  const startNewOrder = async () => {
    if (!selected?.id) {
      toast.error(t('menu:guest.required'));
      return;
    }
    await startNewOrderFor(selected);
  };

  const openFolioOrderForEdit = async (folioOrder: FolioOrder) => {
    if (!canEditOrder(folioOrder)) {
      toast.error(t('orders:actions.editOnlyUnpaid'));
      return;
    }

    const orderId = folioOrder.id?.toString();
    if (!orderId) {
      return;
    }

    setEditingOrderId(orderId);
    try {
      const full = await fetchOrderById(db, folioOrder.id, [...ORDER_FETCHES, 'floor', 'table.floor', 'customer']);
      if (!full || !canEditOrder(full)) {
        toast.error(t('orders:actions.editOnlyUnpaid'));
        return;
      }

      const session = buildOrderEditSession(full, selected ?? undefined);
      if (!session) {
        toast.error(t('orders:loadFailed'));
        return;
      }

      flushSync(() => {
        commitOrderEditSession(
          { setSession: setEditSession, setAppState: setState },
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

      toast.success(t('orders:actions.editOpened'));
      navigate(MENU, { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(t('orders:loadFailed'));
    } finally {
      setEditingOrderId(null);
    }
  };

  const openFloorWalkIn = async () => {
    try {
      const seeded = await ensureResortFloorTables(db);
      const chambres = await loadResortChambresFloor(db);
      setSettings((prev) => {
        const floorMap = new Map(
          (prev.floors ?? []).map((floor) => [floor.id?.toString(), floor]),
        );
        floorMap.set(seeded.floor.id?.toString(), seeded.floor);
        if (chambres?.floor?.id) {
          floorMap.set(chambres.floor.id.toString(), chambres.floor);
        }
        const tableMap = new Map(
          (prev.tables ?? []).map((table) => [table.id?.toString(), table]),
        );
        for (const table of seeded.tables) {
          tableMap.set(table.id?.toString(), table);
        }
        for (const table of chambres?.tables ?? []) {
          tableMap.set(table.id?.toString(), table);
        }
        return {
          ...prev,
          floors: Array.from(floorMap.values()),
          tables: Array.from(tableMap.values()),
        };
      });
      setState((prev) => ({
        ...prev,
        resortEntry: 'floor',
        showFloor: true,
        showPersons: false,
        customer: undefined,
        table: undefined,
        order: undefined,
        dueAt: undefined,
        orders: [],
        cart: [],
        seats: [],
        seat: undefined,
        floor: seeded.floor ?? prev.floor ?? floors[0],
        orderType: prev.orderType ?? settings.order_types[0],
      }));
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.floorOpenFailed'));
    }
  };

  const selectedFromAsi = isAsiGuest(selected);
  const selectedDeparture = selected?.room
    ? getGuestDeparture(selected.asi_date_out)
    : null;
  const selectedDepartureLabel = selectedDeparture
    ? selectedDeparture.relative === 'today'
      ? t('menu:guest.departureToday')
      : t('menu:guest.departure', {
          date: selectedDeparture.date.setLocale(i18n.language).toFormat('dd LLL'),
        })
    : null;
  const selectedDepartureUrgent =
    selectedDeparture?.relative === 'today' || selectedDeparture?.relative === 'past';

  return (
    <div className="p-3 md:p-5 h-[calc(100vh-1rem)] max-h-[100vh] flex flex-col max-w-6xl mx-auto" data-testid="guest-lookup">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 shrink-0">
        <div>
          <h1 className="text-3xl font-bold mb-1">{t('menu:guest.title')}</h1>
          <p className="text-neutral-500">
            {t(preferInHouse ? 'menu:guest.subtitlePms' : 'menu:guest.subtitle')}
          </p>
        </div>
        <Button
          variant="primary"
          filled
          size="lg"
          className="min-h-[48px]"
          data-testid="guest-open-floor"
          onClick={() => void openFloorWalkIn()}
        >
          {t('menu:guest.openFloor')}
        </Button>
      </div>

      <div className="grid gap-4 grid-rows-[minmax(12rem,1fr)_minmax(16rem,1.2fr)] lg:grid-rows-1 lg:grid-cols-2 flex-1 min-h-0">
        <div className="bg-white rounded-xl p-4 shadow flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0 mb-3">
            <Input
              label={t('menu:guest.search')}
              placeholder={t('menu:guest.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
              data-testid="guest-search"
            />
          </div>
          <div
            className="divide-y rounded-lg border border-neutral-200 flex-1 min-h-0 overflow-auto"
            data-testid="guest-search-results"
          >
            {loadingGuests && results.length === 0 && (
              <div className="p-4 text-neutral-500">{t('menu:guest.searching')}</div>
            )}
            {!loadingGuests && results.length === 0 && !canRegisterFromSearch && (
              <div className="p-4 text-neutral-500">{t('menu:guest.noResults')}</div>
            )}
            {results.map((guest) => {
              const note = guest.notes?.trim();
              const metaParts: string[] = [];
              if (guest.guest_code && guest.name?.trim()) {
                metaParts.push(`#${guestCodeLabel(guest)}`);
              }
              if (guest.phone != null && String(guest.phone).trim()) {
                metaParts.push(String(guest.phone).trim());
              }

              return (
                <React.Fragment key={guest.id?.toString()}>
                {firstCloseId && firstCloseId === guest.id?.toString() && (
                  <div
                    className="px-3 py-1 text-sm font-medium text-neutral-500 bg-neutral-100"
                    data-testid="guest-close-matches"
                  >
                    {t('menu:guest.closeMatches')}
                  </div>
                )}
                <button
                  type="button"
                  className={cn(
                    'w-full text-left px-3 py-2 min-h-[64px] flex items-center gap-3 hover:bg-primary-50 active:bg-primary-100',
                    selected?.id?.toString() === guest.id?.toString() && 'bg-primary-100'
                  )}
                  onClick={() => selectGuest(guest)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xl leading-tight">
                      {formatGuestLabel(guest)}
                      {note ? (
                        <FontAwesomeIcon
                          icon={faNoteSticky}
                          className="ml-2 text-amber-500"
                          title={note}
                        />
                      ) : null}
                    </div>
                    {metaParts.length > 0 && (
                      <div className="text-base text-neutral-600 mt-0.5">
                        {metaParts.join(' · ')}
                      </div>
                    )}
                  </div>
                  {guest.room ? (
                    <span className="shrink-0 rounded-lg bg-primary-100 text-primary-800 px-3 py-2 text-base font-semibold">
                      {t('menu:guest.room')} {guest.room}
                    </span>
                  ) : (guest.source === 'walk-in' || guest.tags?.includes('walk-in')) ? (
                    <span className="shrink-0 rounded-lg bg-neutral-200 text-neutral-700 px-3 py-2 text-sm font-medium">
                      {t('menu:guest.walkInBadge')}
                    </span>
                  ) : null}
                </button>
                </React.Fragment>
              );
            })}
          </div>

          {canRegisterFromSearch && (
            <div
              className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-3 mt-3 shrink-0 max-h-[40%] overflow-auto"
              data-testid="guest-register-from-search"
            >
              <div>
                <div className="font-semibold text-lg">
                  {t('menu:guest.registerFromSearchTitle', { name: search.trim() })}
                </div>
                <p className="text-sm text-neutral-600 mt-1">
                  {t('menu:guest.registerFromSearchHint')}
                </p>
                <p className="text-sm text-neutral-600 mt-1" data-testid="guest-walkin-contact-hint">
                  {t('menu:guest.contactHint')}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <Input
                    label={t('menu:guest.code')}
                    value={displayCode}
                    readOnly
                    data-testid="guest-walkin-code"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <Input
                    type="tel"
                    inputMode="tel"
                    label={t('menu:guest.phone')}
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    data-testid="guest-walkin-phone"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <Input
                    label={t('menu:guest.idDocument')}
                    placeholder={t('menu:guest.idDocumentPlaceholder')}
                    value={newIdDocument}
                    onChange={(event) => setNewIdDocument(event.target.value)}
                    autoComplete="off"
                    data-testid="guest-walkin-id-document"
                  />
                </div>
                <Button
                  variant="neutral"
                  flat
                  className="min-h-[48px]"
                  onClick={() => setCodeOverride(generateWalkInGuestCode(search.trim()))}
                  data-testid="guest-walkin-regen"
                >
                  {t('menu:guest.regenCode')}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  flat
                  size="lg"
                  className="w-full min-h-[48px]"
                  isLoading={saving}
                  onClick={() => void createGuestFromSearch(false)}
                  data-testid="guest-register"
                >
                  {t('menu:guest.register')}
                </Button>
                <Button
                  variant="primary"
                  filled
                  size="lg"
                  className="w-full min-h-[48px]"
                  isLoading={saving}
                  onClick={() => void createGuestFromSearch(true)}
                  data-testid="guest-create-and-order"
                >
                  {t('menu:guest.registerAndOrder')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow flex flex-col min-h-0 overflow-hidden">
          {selected ? (
            <>
              <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm uppercase text-neutral-500">{t('menu:guest.selected')}</div>
                      <div className="text-2xl font-black">{formatGuestLabel(selected)}</div>
                    </div>
                    <Button
                      variant="neutral"
                      flat
                      iconButton
                      className={editInfo
                        ? '!bg-neutral-700 !text-white !border-transparent'
                        : '!bg-neutral-200 !text-neutral-700 !border-transparent'}
                      size="lg"
                      icon={faPencil}
                      active={editInfo}
                      aria-label={t('common:actions.edit')}
                      title={t('common:actions.edit')}
                      data-testid="guest-edit-toggle"
                      onClick={() => {
                        setEditInfo((prev) => !prev);
                        setEditingPhone(false);
                        setEditingIdDocument(false);
                        setEditingNote(false);
                      }}
                    />
                  </div>
                  {(selected.phone != null && String(selected.phone).trim()) || selected.id_document_number ? (
                    <div className="text-neutral-600 mt-1" data-testid="guest-contact">
                      {[
                        selected.phone != null && String(selected.phone).trim()
                          ? String(selected.phone).trim()
                          : '',
                        selected.id_document_number
                          ? `${t('menu:guest.idDocument')}: ${maskIdDocument(selected.id_document_number)}`
                          : '',
                      ].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                  {selected.room ? (
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <span className="rounded-lg bg-primary-100 text-primary-800 px-3 py-2 text-base font-semibold">
                        {t('menu:guest.room')} {selected.room}
                      </span>
                      {selectedDepartureLabel ? (
                        <span
                          className={cn(
                            'text-base font-medium px-3 py-2 rounded-lg',
                            selectedDepartureUrgent
                              ? 'bg-warning-100 text-warning-700'
                              : 'bg-neutral-100 text-neutral-700',
                          )}
                        >
                          {selectedDepartureLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-neutral-600 text-lg mt-2" data-testid="guest-last-order">
                    {selectedLastOrderLabel}
                  </div>
                </div>

                {selected.notes?.trim() && !editingNote ? (
                  <div
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3"
                    data-testid="guest-note-banner"
                  >
                    <div className="font-bold text-sm mb-1">{t('menu:guest.notes')}</div>
                    <div className="whitespace-pre-wrap text-lg">{selected.notes}</div>
                  </div>
                ) : null}

                {showPlace && (
                <div className="rounded-lg border border-neutral-200 p-3 space-y-3" data-testid="guest-place">
                <Input
                  label={t('menu:guest.table')}
                  placeholder={t('menu:guest.tablePlaceholder')}
                  value={tableNumber}
                  onChange={(event) => setTableNumber(event.target.value)}
                  enableKeyboard
                />

                <div>
                  <div className="font-semibold mb-2">{t('menu:guest.zone')}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="neutral"
                      flat
                      className="min-h-[48px]"
                      active={!state.floor}
                      onClick={() => setState((prev) => ({ ...prev, floor: undefined }))}
                    >
                      {t('menu:guest.noZone')}
                    </Button>
                    {floors.map((floor) => (
                      <Button
                        key={floor.id?.toString()}
                        variant="primary"
                        flat
                        className="min-h-[48px]"
                        active={state.floor?.id?.toString() === floor.id?.toString()}
                        onClick={() => setState((prev) => ({ ...prev, floor }))}
                      >
                        {floor.name}
                      </Button>
                    ))}
                  </div>
                </div>
                </div>
                )}

                <div className="border-t border-neutral-200 pt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2" data-testid="guest-actions">
                  {!showPlace && (
                    <Button
                      variant="neutral"
                      flat
                      className="min-h-[48px] !bg-neutral-200 !text-neutral-700 !border-transparent"
                      icon={faPlus}
                      data-testid="guest-place-toggle"
                      onClick={() => setShowPlace(true)}
                    >
                      {t('menu:guest.addPlace')}
                    </Button>
                  )}
                  {!editInfo || selectedFromAsi ? null : editingPhone ? (
                    <div className="w-full space-y-2">
                      <Input
                        type="tel"
                        inputMode="tel"
                        label={t('menu:guest.phone')}
                        value={phoneDraft}
                        onChange={(event) => setPhoneDraft(event.target.value)}
                        data-testid="guest-phone-input"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-phone-save"
                          isLoading={savingPhone}
                          onClick={() => void saveGuestPhone()}
                        >
                          {t('common:actions.save')}
                        </Button>
                        <Button
                          variant="neutral"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-phone-cancel"
                          disabled={savingPhone}
                          onClick={() => {
                            setEditingPhone(false);
                            setPhoneDraft(
                              selected.phone != null && selected.phone !== ''
                                ? String(selected.phone)
                                : '',
                            );
                          }}
                        >
                          {t('common:actions.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="neutral"
                        flat
                        className="min-h-[48px] !bg-neutral-200 !text-neutral-700 !border-transparent"
                        data-testid="guest-phone-edit"
                        onClick={() => {
                          setPhoneDraft(
                            selected.phone != null && selected.phone !== ''
                              ? String(selected.phone)
                              : '',
                          );
                          setEditingPhone(true);
                        }}
                      >
                        {selected.phone != null && String(selected.phone).trim()
                          ? t('menu:guest.editPhone')
                          : t('menu:guest.addPhone')}
                      </Button>
                    </div>
                  )}

                  {!editInfo || selectedFromAsi ? null : editingIdDocument ? (
                    <div className="w-full space-y-2">
                      <Input
                        label={t('menu:guest.idDocument')}
                        placeholder={t('menu:guest.idDocumentPlaceholder')}
                        value={idDocumentDraft}
                        onChange={(event) => setIdDocumentDraft(event.target.value)}
                        autoComplete="off"
                        data-testid="guest-id-document-input"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-id-document-save"
                          isLoading={savingIdDocument}
                          onClick={() => void saveGuestIdDocument()}
                        >
                          {t('common:actions.save')}
                        </Button>
                        <Button
                          variant="neutral"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-id-document-cancel"
                          disabled={savingIdDocument}
                          onClick={() => {
                            setEditingIdDocument(false);
                            setIdDocumentDraft('');
                          }}
                        >
                          {t('common:actions.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="neutral"
                        flat
                        className="min-h-[48px] !bg-neutral-200 !text-neutral-700 !border-transparent"
                        data-testid="guest-id-document-edit"
                        onClick={() => {
                          setIdDocumentDraft('');
                          setEditingIdDocument(true);
                        }}
                      >
                        {selected.id_document_number
                          ? t('menu:guest.editIdDocument')
                          : t('menu:guest.addIdDocument')}
                      </Button>
                    </div>
                  )}

                  {!editInfo ? null : editingNote ? (
                    <div className="w-full space-y-2">
                      <Textarea
                        data-testid="guest-note-input"
                        rows={3}
                        placeholder={t('menu:guest.notePlaceholder')}
                        value={noteDraft}
                        onChange={(event) => setNoteDraft((event.target as HTMLTextAreaElement).value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-note-save"
                          isLoading={savingNote}
                          onClick={() => void saveGuestNote()}
                        >
                          {t('common:actions.save')}
                        </Button>
                        <Button
                          variant="neutral"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-note-cancel"
                          disabled={savingNote}
                          onClick={() => {
                            setEditingNote(false);
                            setNoteDraft(selected.notes ?? '');
                          }}
                        >
                          {t('common:actions.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="neutral"
                      flat
                      className="min-h-[48px] !bg-neutral-200 !text-neutral-700 !border-transparent"
                      data-testid={selected.notes?.trim() ? 'guest-note-edit' : 'guest-note-add'}
                      onClick={() => {
                        setNoteDraft(selected.notes ?? '');
                        setEditingNote(true);
                      }}
                    >
                      {selected.notes?.trim()
                        ? t('menu:guest.editNote')
                        : t('menu:guest.addNote')}
                    </Button>
                  )}
                  </div>

                  <div>
                    <h2 className="font-semibold mb-2">{t('menu:guest.folio')}</h2>
                    {folio.length === 0 && (
                      <div className="text-neutral-500">{t('menu:guest.folioEmpty')}</div>
                    )}
                    <div className="space-y-2">
                      {folio.map((order) => (
                        <div
                          key={order.id?.toString()}
                          className="border rounded-lg p-3 flex justify-between gap-3 items-start"
                        >
                          <div>
                            <div className="font-bold">
                              {t('menu:header.orderNumber', { number: getInvoiceNumber(order) })}
                            </div>
                            <div className="text-sm text-neutral-600">
                              {translateOrderStatus(tOrders, order.status)}
                              {order.table ? ` · ${formatTableLabel(order.table)}` : ''}
                              {!order.table && orderZoneLabel(order) ? ` · ${orderZoneLabel(order)}` : ''}
                            </div>
                            <div className="text-sm text-neutral-500 mt-1">
                              {toLuxonDateTime(order.created_at).toFormat('dd LLL HH:mm')}
                            </div>
                          </div>
                          {order.status === OrderStatus['In Progress'] && (
                            <div className="flex flex-col gap-2 shrink-0">
                              <Button
                                variant="primary"
                                filled
                                className="min-h-[44px]"
                                data-testid="guest-folio-edit"
                                isLoading={editingOrderId === order.id?.toString()}
                                onClick={() => void openFolioOrderForEdit(order)}
                              >
                                {t('orders:actions.editOrder')}
                              </Button>
                              <Button
                                variant="primary"
                                flat
                                className="min-h-[44px]"
                                data-testid="guest-folio-transfer"
                                onClick={() => setTransferOrder(order)}
                              >
                                {t('orders:actions.transferToClient')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-neutral-200 bg-white p-4 sticky bottom-0">
                <Button
                  variant="success"
                  filled
                  size="lg"
                  className="w-full min-h-[52px] text-lg"
                  onClick={() => void startNewOrder()}
                >
                  {t('menu:guest.startOrder')}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-neutral-500 py-10 text-center px-4">
              {t(preferInHouse ? 'menu:guest.pickGuestPms' : 'menu:guest.pickGuest')}
            </div>
          )}
        </div>
      </div>

      {transferOrder && (
        <Modal
          open={Boolean(transferOrder)}
          onClose={() => setTransferOrder(undefined)}
          title={t('orders:actions.transferToClient')}
          size="md"
          testId="guest-transfer-order"
        >
          <p className="text-sm text-neutral-600 mb-3">{t('orders:customer.transferHint')}</p>
          <Customers
            onCustomerChosen={async (customer) => {
              if (!customer?.id || !transferOrder?.id) return;
              if (selected?.id?.toString() === customer.id.toString()) {
                toast.error(t('orders:customer.transferSame'));
                return;
              }
              try {
                await db.merge(toRecordId(transferOrder.id), {
                  customer: toRecordId(customer.id),
                });
                toast.success(t('orders:customer.transferred', {
                  name: customer.name || customer.guest_code || '',
                }));
                setTransferOrder(undefined);
                if (selected?.id) {
                  void loadFolio(selected);
                }
              } catch (error) {
                console.error(error);
                toast.error(t('orders:customer.transferFailed'));
              }
            }}
            onAttach={() => undefined}
          />
        </Modal>
      )}
    </div>
  );
};
