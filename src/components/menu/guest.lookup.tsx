import { useEffect, useMemo, useState } from 'react';
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
import { getInvoiceNumber } from '@/lib/order.ts';
import {
  formatGuestLabel,
  guestCodeLabel,
  orderZoneLabel,
  generateWalkInGuestCode,
  canRegisterGuestFromSearch,
  previewGuestCode,
  guestMatchesSearchTerm,
  namesAreSamePerson,
  dropSupersededStays,
} from '@/lib/guest.ts';
import { findCustomerByPhone } from '@/lib/customer-phone.ts';
import { toLuxonDateTime, nowSurrealDateTime } from '@/lib/datetime.ts';
import {
  ensureResortFloorTables,
  findRoomByNumber,
  findTableByNumber,
  loadResortChambresFloor,
} from '@/lib/resort-floor-tables.ts';
import { usesAsiPmsRooms } from '@/lib/pos-mode.ts';
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
import { faNoteSticky } from '@fortawesome/free-solid-svg-icons';

type FolioOrder = Order & { item_count?: number };

export const GuestLookup = () => {
  const db = useDB();
  const navigate = useNavigate();
  const { t } = useTranslation(['menu', 'orders', 'common']);
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
  const [tableNumber, setTableNumber] = useState(state.table?.number ?? '');
  const [saving, setSaving] = useState(false);
  const [transferOrder, setTransferOrder] = useState<FolioOrder | undefined>();
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const floors: Floor[] = settings.floors ?? [];

  const results = useMemo(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      return guests;
    }
    return guests.filter((guest) => guestMatchesSearchTerm(guest, trimmed));
  }, [guests, search]);

  const canRegisterFromSearch =
    results.length === 0 && canRegisterGuestFromSearch(search);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset note/phone editors when guest selection changes
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
    if (!selected?.id) {
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

  const selectGuest = (customer: Customer) => {
    setSelected(customer);
    if (customer.room) {
      setTableNumber(String(customer.room));
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
    const wantedTable = tableNumber.trim() || String(guest.room ?? '').trim();
    if (wantedTable) {
      table =
        (await findRoomByNumber(db, wantedTable)) ??
        (await findTableByNumber(db, wantedTable));
      if (!table) {
        toast.error(t('menu:guest.tableNotFound', { number: wantedTable }));
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

  return (
    <div className="p-5 max-w-5xl mx-auto" data-testid="guest-lookup">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
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
          data-testid="guest-open-floor"
          onClick={() => void openFloorWalkIn()}
        >
          {t('menu:guest.openFloor')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="bg-white rounded-xl p-5 shadow space-y-4">
          <Input
            label={t('menu:guest.search')}
            placeholder={t('menu:guest.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
            data-testid="guest-search"
          />
          <div
            className="divide-y rounded-lg border border-neutral-200 max-h-[320px] overflow-auto"
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
              if (guest.room) {
                metaParts.push(`${t('menu:guest.room')} ${guest.room}`);
              } else if (guest.source === 'walk-in' || guest.tags?.includes('walk-in')) {
                metaParts.push(t('menu:guest.walkInBadge'));
              }
              if (guest.phone != null && String(guest.phone).trim()) {
                metaParts.push(String(guest.phone).trim());
              }
              if (guest.last_order_at) {
                metaParts.push(
                  t('menu:guest.lastOrder', {
                    date: toLuxonDateTime(guest.last_order_at).toFormat('dd LLL yyyy'),
                  }),
                );
              } else {
                metaParts.push(t('menu:guest.noOrders'));
              }

              return (
                <button
                  type="button"
                  key={guest.id?.toString()}
                  className={cn(
                    'w-full text-left p-3 hover:bg-primary-50',
                    selected?.id?.toString() === guest.id?.toString() && 'bg-primary-100'
                  )}
                  onClick={() => selectGuest(guest)}
                >
                  <div className="font-bold text-lg">
                    {formatGuestLabel(guest)}
                    {note ? (
                      <FontAwesomeIcon
                        icon={faNoteSticky}
                        className="ml-2 text-amber-500"
                        title={note}
                      />
                    ) : null}
                  </div>
                  <div className="text-sm text-neutral-600">
                    {metaParts.join(' · ')}
                  </div>
                </button>
              );
            })}
          </div>

          {canRegisterFromSearch && (
            <div
              className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-3"
              data-testid="guest-register-from-search"
            >
              <div>
                <div className="font-semibold text-lg">
                  {t('menu:guest.registerFromSearchTitle', { name: search.trim() })}
                </div>
                <p className="text-sm text-neutral-600 mt-1">
                  {t('menu:guest.registerFromSearchHint')}
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
                    placeholder={t('menu:guest.phonePlaceholder')}
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    data-testid="guest-walkin-phone"
                  />
                </div>
                <Button
                  variant="neutral"
                  flat
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
                  className="w-full"
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
                  className="w-full"
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

        <div className="bg-white rounded-xl p-5 shadow space-y-4">
          {selected ? (
            <>
              <div>
                <div className="text-sm uppercase text-neutral-500">{t('menu:guest.selected')}</div>
                <div className="text-2xl font-black">{formatGuestLabel(selected)}</div>
                <div className="text-neutral-600">
                  {selected.guest_code && selected.name?.trim() ? `#${guestCodeLabel(selected)}` : ''}
                  {selected.guest_code && selected.name?.trim() && selected.room ? ' · ' : ''}
                  {selected.room ? `${t('menu:guest.room')} ${selected.room}` : ''}
                </div>
              </div>

              <div className="text-neutral-600">
                {selectedLastOrderLabel}
              </div>

              {editingPhone ? (
                <div className="space-y-2">
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
                      data-testid="guest-phone-save"
                      isLoading={savingPhone}
                      onClick={() => void saveGuestPhone()}
                    >
                      {t('common:actions.save')}
                    </Button>
                    <Button
                      variant="neutral"
                      flat
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
                  {selected.phone != null && String(selected.phone).trim() ? (
                    <div className="text-neutral-600">
                      {t('menu:guest.phone')}: {String(selected.phone).trim()}
                    </div>
                  ) : null}
                  <Button
                    variant="neutral"
                    flat
                    size="sm"
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

              {editingNote ? (
                <div className="space-y-2">
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
                      data-testid="guest-note-save"
                      isLoading={savingNote}
                      onClick={() => void saveGuestNote()}
                    >
                      {t('common:actions.save')}
                    </Button>
                    <Button
                      variant="neutral"
                      flat
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
              ) : selected.notes?.trim() ? (
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3"
                  data-testid="guest-note-banner"
                >
                  <div className="font-bold text-sm mb-1">{t('menu:guest.notes')}</div>
                  <div className="whitespace-pre-wrap text-lg">{selected.notes}</div>
                  <Button
                    variant="neutral"
                    flat
                    size="sm"
                    className="mt-2"
                    data-testid="guest-note-edit"
                    onClick={() => {
                      setNoteDraft(selected.notes ?? '');
                      setEditingNote(true);
                    }}
                  >
                    {t('menu:guest.editNote')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="neutral"
                  flat
                  data-testid="guest-note-add"
                  onClick={() => {
                    setNoteDraft('');
                    setEditingNote(true);
                  }}
                >
                  {t('menu:guest.addNote')}
                </Button>
              )}

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
                      active={state.floor?.id?.toString() === floor.id?.toString()}
                      onClick={() => setState((prev) => ({ ...prev, floor }))}
                    >
                      {floor.name}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                variant="success"
                filled
                size="lg"
                className="w-full"
                onClick={() => void startNewOrder()}
              >
                {t('menu:guest.startOrder')}
              </Button>

              <div>
                <h2 className="font-semibold mb-2">{t('menu:guest.folio')}</h2>
                {folio.length === 0 && (
                  <div className="text-neutral-500">{t('menu:guest.folioEmpty')}</div>
                )}
                <div className="space-y-2 max-h-[280px] overflow-auto">
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
                          {order.status}
                          {order.table?.number ? ` · T${order.table.number}` : ''}
                          {!order.table?.number && orderZoneLabel(order) ? ` · ${orderZoneLabel(order)}` : ''}
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
                            size="sm"
                            data-testid="guest-folio-edit"
                            isLoading={editingOrderId === order.id?.toString()}
                            onClick={() => void openFolioOrderForEdit(order)}
                          >
                            {t('orders:actions.editOrder')}
                          </Button>
                          <Button
                            variant="primary"
                            flat
                            size="sm"
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
            </>
          ) : (
            <div className="text-neutral-500 py-10 text-center">
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
