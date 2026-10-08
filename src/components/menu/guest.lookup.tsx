import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import { Customer } from '@/api/model/customer.ts';
import { Floor } from '@/api/model/floor.ts';
import { Order, OrderStatus } from '@/api/model/order.ts';
import { Table } from '@/api/model/table.ts';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { getInvoiceNumber, translateOrderStatus } from '@/lib/order.ts';
import {
  formatGuestLabel,
  orderZoneLabel,
  generateWalkInGuestCode,
  canRegisterGuestFromSearch,
  previewGuestCode,
  searchGuests,
  dropSupersededStays,
  isAsiGuest,
} from '@/lib/guest.ts';
import {
  findCustomerByIdDocument,
  hasWalkInContact,
  ID_DOCUMENT_TYPES,
  maskIdDocument,
  normalizeIdDocument,
} from '@/lib/customer-id-document.ts';
import {
  ACTIVE_CUSTOMER,
  canEditCustomerIdentity,
  createWalkInCustomer,
  customerHistoryIds,
  CustomerIdDocumentTakenError,
  findWalkInMatches,
  LAST_ORDER_AT,
  updateCustomer,
  type CustomerMatch,
  type CustomerPatch,
} from '@/lib/customer.service.ts';
import { displayPhone } from '@/lib/phone.ts';
import { PhoneInput } from '@/components/customer/phone.input.tsx';
import { CustomerAlerts } from '@/components/customer/customer.alerts.tsx';
import { CustomerPreferencesForm } from '@/components/customer/customer.preferences.form.tsx';
import { CustomerMatchesModal } from '@/components/customer/customer.matches.modal.tsx';
import { useModuleAccess } from '@/providers/module-access.provider.tsx';
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
import { faNoteSticky, faPencil, faPlus, faSliders, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';

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
  const { can } = useModuleAccess();
  const canCreateCustomer = can('customers.create');
  const canEditPreferences = can('customers.preferences');
  const canViewIdDocument = can('customers.view_id_document');

  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<Customer[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [selected, setSelected] = useState<Customer | undefined>(state.customer);
  const [folio, setFolio] = useState<FolioOrder[]>([]);
  // A hotel room is not a table: it never pre-fills the table-number field.
  const initialTableNumber = isHotelRoomTable(state.table) ? '' : (state.table?.number ?? '');
  const [tableNumber, setTableNumber] = useState(initialTableNumber);
  // Table number and zone are optional: folded away until the server asks for them.
  const [showPlace, setShowPlace] = useState(Boolean(initialTableNumber));
  // Phone, ID document and note are read-only until the pencil is tapped.
  const [editInfo, setEditInfo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferOrder, setTransferOrder] = useState<FolioOrder | undefined>();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Known clients the walk-in being registered may be (same phone or name): staff choose.
  const [walkInMatches, setWalkInMatches] = useState<{ list: CustomerMatch[]; andStartOrder: boolean } | null>(null);
  // A name already known still registers a new client, from an explicit button.
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newIdDocumentType, setNewIdDocumentType] = useState('');
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

  // The name never identifies a client: a known name can be registered again, as a new client.
  const canRegisterFromSearch = canCreateCustomer && canRegisterGuestFromSearch(search);
  const showRegisterPanel = canRegisterFromSearch && (found.exact.length === 0 || registerOpen);

  const selectedLastOrderAt = folio[0]?.created_at ?? selected?.last_order_at;
  const selectedLastOrderLabel = selectedLastOrderAt
    ? t('menu:guest.lastOrder', {
        date: toLuxonDateTime(selectedLastOrderAt).toFormat('dd LLL yyyy'),
      })
    : t('menu:guest.noOrders');

  const displayCode = useMemo(() => previewGuestCode(search.trim()), [search]);

  useEffect(() => {
    setRegisterOpen(false);
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
      // ASI mode: PMS in-house + POSR walk-in / local guests (never hide local registry),
      // plus checked-out FD guests that carry a staff note. Deleted / merged clients never.
      const [list] = preferInHouse
        ? await db.query<Customer[]>(
            `SELECT *, ${LAST_ORDER_AT} FROM ${Tables.customers}
             WHERE ${ACTIVE_CUSTOMER} AND (
                in_house = true OR tags CONTAINS 'in-house'
                OR source = 'walk-in' OR tags CONTAINS 'walk-in'
                OR source = 'local'
                OR (notes != NONE AND notes != NULL AND notes != '')
             )
             ORDER BY in_house DESC, name
             LIMIT 500`
          )
        : await db.query<Customer[]>(
            `SELECT *, ${LAST_ORDER_AT} FROM ${Tables.customers}
             WHERE ${ACTIVE_CUSTOMER}
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

  const selectedGuestIdRef = useRef<string | undefined>(undefined);

  const loadFolio = async (customer: Customer) => {
    if (!customer?.id) {
      setFolio([]);
      return;
    }

    const requestedId = customer.id.toString();
    selectedGuestIdRef.current = requestedId;

    // Its own orders and those of the duplicates merged into it.
    const customers = await customerHistoryIds(db, customer.id);
    const [rows] = await db.query<FolioOrder[]>(
      `SELECT * FROM ${Tables.orders}
       WHERE customer IN $customers
       ORDER BY created_at DESC
       LIMIT 20
       FETCH floor, order_type, customer, table`,
      { customers }
    );

    // A slower folio for guest A must not overwrite guest B's panel.
    if (selectedGuestIdRef.current !== requestedId) {
      return;
    }

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
    setEditingName(false);
    setNameDraft(selected?.name ?? '');
    setEditingPhone(false);
    setPhoneDraft(
      selected?.phone != null && selected.phone !== ''
        ? String(selected.phone)
        : '',
    );
    setEditingIdDocument(false);
    setIdDocumentDraft('');
    setPreferencesOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset name/phone/ID editors when guest selection changes
  }, [selected?.id]);

  /** The stored customer replaces its copy everywhere on this screen and on the order. */
  const applyUpdatedGuest = (updated: Customer) => {
    setSelected(updated);
    setGuests((prev) =>
      prev.map((guest) =>
        guest.id?.toString() === updated.id?.toString() ? { ...guest, ...updated } : guest,
      ),
    );
    setState((prev) =>
      prev.customer?.id?.toString() === updated.id?.toString()
        ? { ...prev, customer: updated }
        : prev,
    );
  };

  /** Saves name, phone or ID document: only who may edit this client's identity. */
  const saveGuestIdentity = async (patch: CustomerPatch) => {
    if (!selected?.id || !canEditCustomerIdentity(selected, page?.user, can)) {
      return false;
    }
    const updated = await updateCustomer(db, selected.id, patch, page?.user);
    applyUpdatedGuest({ ...selected, ...updated, last_order_at: selected.last_order_at });
    return true;
  };

  const saveGuestName = async () => {
    const value = nameDraft.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(value)) {
      toast.error(t('menu:guest.nameRequired'));
      return;
    }
    setSavingName(true);
    try {
      if (await saveGuestIdentity({ name: value })) {
        toast.success(t('menu:customer.nameSaved'));
        setEditingName(false);
      }
    } catch (error) {
      console.error(error);
      toast.error(t('menu:customer.nameSaveFailed'));
    } finally {
      setSavingName(false);
    }
  };

  const saveGuestPhone = async () => {
    // A phone may be shared (a family, a company): no uniqueness check.
    setSavingPhone(true);
    try {
      if (await saveGuestIdentity({ phone: phoneDraft.trim() || null })) {
        toast.success(t('menu:guest.phoneSaved'));
        setEditingPhone(false);
      }
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.phoneSaveFailed'));
    } finally {
      setSavingPhone(false);
    }
  };

  const saveGuestIdDocument = async () => {
    if (!selected?.id) {
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
      // One ID, one client: the database refuses a second holder too.
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

      if (await saveGuestIdentity({ id_document_number: value })) {
        toast.success(t('menu:guest.idDocumentSaved'));
        setEditingIdDocument(false);
        setIdDocumentDraft('');
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('menu:guest.idDocumentTaken', {
              name: error.holder?.name || error.holder?.guest_code || '',
            })
          : t('menu:guest.idDocumentSaveFailed'),
      );
    } finally {
      setSavingIdDocument(false);
    }
  };

  const selectGuest = (customer: Customer) => {
    setSelected(customer);
    setEditInfo(false);
    setEditingName(false);
    setEditingPhone(false);
    setEditingIdDocument(false);
    // The field holds a dining table only; an empty field sends the order to the guest's room.
    if (customer.room) {
      setTableNumber('');
    }
    setState((prev) => ({
      ...prev,
      customer,
    }));
  };

  /** An existing client chosen instead of registering a new one. */
  const pickExistingGuest = async (customer: Customer, andStartOrder: boolean) => {
    selectGuest(customer);
    setGuests((prev) => {
      const id = customer.id?.toString();
      const without = prev.filter((item) => item.id?.toString() !== id);
      return [customer, ...without];
    });
    setSearch(customer.name?.trim() || search);
    setWalkInMatches(null);
    setNewPhone('');
    setNewIdDocument('');
    setNewIdDocumentType('');
    if (andStartOrder) {
      await startNewOrderFor(customer);
    }
  };

  /**
   * Registers the walk-in typed in the search. Its ID document is a known client's →
   * that client. Same phone or same name → staff choose between the known clients and a
   * new one (`confirmed` once they chose new). Otherwise a new client.
   */
  const createGuestFromSearch = async (andStartOrder = false, confirmed = false) => {
    const name = search.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(name)) {
      toast.error(t('menu:guest.nameRequired'));
      return;
    }

    if (!hasWalkInContact({ phone: newPhone, idDocument: newIdDocument })) {
      toast.error(t('menu:guest.contactRequired'));
      return;
    }

    if (normalizeIdDocument(newIdDocument)) {
      // A failed duplicate check must not block the registration.
      const byIdDocument = await findCustomerByIdDocument(db, newIdDocument).catch((error) => {
        console.error('ID document lookup failed', error);
        return undefined;
      });
      if (byIdDocument) {
        toast.message(
          t('menu:guest.idDocumentExists', {
            name: byIdDocument.name || byIdDocument.guest_code || '',
          }),
        );
        await pickExistingGuest(byIdDocument, andStartOrder);
        return;
      }
    }

    if (!confirmed) {
      const matches = await findWalkInMatches(db, { name, phone: newPhone }).catch((error) => {
        console.error('Walk-in match lookup failed', error);
        return [] as CustomerMatch[];
      });
      if (matches.length > 0) {
        setWalkInMatches({ list: matches, andStartOrder });
        return;
      }
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

      const guest = await createWalkInCustomer(db, {
        name,
        guestCode: guest_code,
        phone: newPhone,
        idDocument: newIdDocument,
        idDocumentType: newIdDocumentType,
        createdBy: page?.user,
      });

      setWalkInMatches(null);
      selectGuest(guest);
      setGuests((prev) => {
        const id = guest.id?.toString();
        const without = prev.filter((item) => item.id?.toString() !== id);
        return [guest, ...without];
      });
      setSearch(name);
      setNewPhone('');
      setNewIdDocument('');
      setNewIdDocumentType('');
      toast.success(t('menu:guest.created'));

      if (andStartOrder) {
        await startNewOrderFor(guest);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('menu:guest.idDocumentTaken', {
              name: error.holder?.name || error.holder?.guest_code || '',
            })
          : t('menu:guest.createFailed'),
      );
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

  // Name, phone, ID: a manager, or the server who registered this walk-in. Never an ASI guest.
  const selectedIdentityEditable =
    !isAsiGuest(selected) && canEditCustomerIdentity(selected, page?.user, can);
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
              const hasAllergies = (guest.allergies?.length ?? 0) > 0;
              const metaParts: string[] = [];
              if (guest.phone != null && String(guest.phone).trim()) {
                metaParts.push(displayPhone(guest.phone));
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
                      {hasAllergies ? (
                        <FontAwesomeIcon
                          icon={faTriangleExclamation}
                          className="ml-2 text-danger-600"
                          title={guest.allergies?.join(', ')}
                        />
                      ) : null}
                      {note ? (
                        <FontAwesomeIcon
                          icon={faNoteSticky}
                          className="ml-2 text-warning-500"
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

          {canRegisterFromSearch && !showRegisterPanel && (
            <Button
              variant="primary"
              flat
              className="mt-3 min-h-[48px] shrink-0"
              icon={faPlus}
              data-testid="guest-register-new-homonym"
              onClick={() => setRegisterOpen(true)}
            >
              {t('menu:customer.registerAnother', { name: search.trim() })}
            </Button>
          )}

          {showRegisterPanel && (
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
                <div className="flex-[2] min-w-[260px]">
                  <PhoneInput
                    label={t('menu:guest.phone')}
                    value={newPhone}
                    onChange={setNewPhone}
                    testId="guest-walkin-phone"
                  />
                </div>
                <div className="min-w-[120px]">
                  <label htmlFor="guest-walkin-id-type">{t('menu:customer.idDocumentType')}</label>
                  <select
                    id="guest-walkin-id-type"
                    className="input"
                    value={newIdDocumentType}
                    onChange={(event) => setNewIdDocumentType(event.target.value)}
                    data-testid="guest-walkin-id-type"
                  >
                    <option value="">—</option>
                    {ID_DOCUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`menu:customer.idType.${type}`)}</option>
                    ))}
                  </select>
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
                      <div className="text-sm uppercase text-neutral-500">
                        {t('menu:guest.selected')}
                      </div>
                      <div className="text-2xl font-black">{formatGuestLabel(selected)}</div>
                    </div>
                    {selectedIdentityEditable && (
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
                        setEditingName(false);
                        setEditingPhone(false);
                        setEditingIdDocument(false);
                      }}
                    />
                    )}
                  </div>
                  {(selected.phone != null && String(selected.phone).trim()) || selected.id_document_number ? (
                    <div className="text-neutral-600 mt-1" data-testid="guest-contact">
                      {[
                        selected.phone != null && String(selected.phone).trim()
                          ? displayPhone(selected.phone)
                          : '',
                        selected.id_document_number
                          ? `${selected.id_document_type
                              ? t(`menu:customer.idType.${selected.id_document_type}`, { defaultValue: t('menu:guest.idDocument') })
                              : t('menu:guest.idDocument')}: ${canViewIdDocument
                              ? selected.id_document_number
                              : maskIdDocument(selected.id_document_number)}`
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

                <CustomerAlerts customer={selected} />

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
                  {canEditPreferences && (
                    <Button
                      variant="neutral"
                      flat
                      className="min-h-[48px] !bg-neutral-200 !text-neutral-700 !border-transparent"
                      icon={faSliders}
                      data-testid="guest-preferences"
                      onClick={() => setPreferencesOpen(true)}
                    >
                      {t('menu:customer.preferences')}
                    </Button>
                  )}
                  {!editInfo || !selectedIdentityEditable ? null : editingName ? (
                    <div className="w-full space-y-2">
                      <Input
                        label={t('menu:customer.name')}
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        data-testid="guest-name-input"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          flat
                          className="min-h-[48px]"
                          data-testid="guest-name-save"
                          isLoading={savingName}
                          onClick={() => void saveGuestName()}
                        >
                          {t('common:actions.save')}
                        </Button>
                        <Button
                          variant="neutral"
                          flat
                          className="min-h-[48px]"
                          disabled={savingName}
                          onClick={() => {
                            setEditingName(false);
                            setNameDraft(selected.name ?? '');
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
                      data-testid="guest-name-edit"
                      onClick={() => {
                        setNameDraft(selected.name ?? '');
                        setEditingName(true);
                      }}
                    >
                      {t('menu:customer.editName')}
                    </Button>
                  )}
                  {!editInfo || !selectedIdentityEditable ? null : editingPhone ? (
                    <div className="w-full space-y-2">
                      <PhoneInput
                        label={t('menu:guest.phone')}
                        value={phoneDraft}
                        onChange={setPhoneDraft}
                        testId="guest-phone-input"
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

                  {!editInfo || !selectedIdentityEditable ? null : editingIdDocument ? (
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

      {walkInMatches && (
        <CustomerMatchesModal
          open
          name={search.trim().replace(/\s+/g, ' ')}
          matches={walkInMatches.list}
          creating={saving}
          onPick={(customer) => void pickExistingGuest(customer, walkInMatches.andStartOrder)}
          onCreateNew={() => void createGuestFromSearch(walkInMatches.andStartOrder, true)}
          onClose={() => setWalkInMatches(null)}
        />
      )}

      {selected && (
        <CustomerPreferencesForm
          open={preferencesOpen}
          customer={selected}
          onClose={() => setPreferencesOpen(false)}
          onSaved={(updated) => applyUpdatedGuest({ ...updated, last_order_at: selected.last_order_at })}
        />
      )}

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
