import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { appSettings, appState } from '@/store/jotai.ts';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import { Customer } from '@/api/model/customer.ts';
import { Floor } from '@/api/model/floor.ts';
import { Order } from '@/api/model/order.ts';
import { Table } from '@/api/model/table.ts';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { getInvoiceNumber } from '@/lib/order.ts';
import { formatGuestLabel, guestCodeLabel, orderZoneLabel } from '@/lib/guest.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import {
  ensureResortFloorTables,
  findRoomByNumber,
  findTableByNumber,
  loadResortChambresFloor,
} from '@/lib/resort-floor-tables.ts';
import { isAsiMode } from '@/lib/pos-mode.ts';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.ts';

type FolioOrder = Order & { item_count?: number };

export const GuestLookup = () => {
  const db = useDB();
  const { t } = useTranslation(['menu', 'orders', 'common']);
  const [state, setState] = useAtom(appState);
  const [settings, setSettings] = useAtom(appSettings);
  const preferInHouse = isAsiMode();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | undefined>(state.customer);
  const [folio, setFolio] = useState<FolioOrder[]>([]);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoom, setNewRoom] = useState('');
  const [tableNumber, setTableNumber] = useState(state.table?.number ?? '');
  const [saving, setSaving] = useState(false);

  const floors: Floor[] = settings.floors ?? [];

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
  const loadGuests = async (term: string) => {
    const trimmed = term.trim();
    // ASI FD sync: tags contain 'in-house' (+ in_house bool mirror).
    const inHouseClause = preferInHouse
      ? "AND (in_house = true OR tags CONTAINS 'in-house')"
      : '';

    if (trimmed.length === 0) {
      if (!preferInHouse) {
        setResults([]);
        return;
      }
      const [list] = await db.query<Customer[]>(
        `SELECT * FROM ${Tables.customers}
         WHERE in_house = true OR tags CONTAINS 'in-house'
         ORDER BY room, name
         LIMIT 50`
      );
      setResults(Array.isArray(list) ? list : []);
      return;
    }

    const [list] = await db.query<Customer[]>(
      `SELECT * FROM ${Tables.customers}
       WHERE (guest_code CONTAINS $q
          OR name CONTAINS $q
          OR room CONTAINS $q)
       ${inHouseClause}
       ORDER BY name
       LIMIT 20`,
      { q: trimmed }
    );

    setResults(Array.isArray(list) ? list : []);
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
    const handle = window.setTimeout(() => {
      void loadGuests(search);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (selected?.id) {
      void loadFolio(selected);
    } else {
      setFolio([]);
    }
  }, [selected?.id]);

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

  const createGuest = async () => {
    const guest_code = newCode.trim().toUpperCase();
    const name = newName.trim() || guest_code;
    if (!name) {
      toast.error(t('menu:guest.nameOrCodeRequired'));
      return;
    }

    setSaving(true);
    try {
      if (guest_code) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code }
        );
        if (Array.isArray(existing) && existing[0]) {
          toast.error(t('menu:guest.codeTaken'));
          selectGuest(existing[0]);
          return;
        }
      }

      const [created] = await db.insert(Tables.customers, {
        name,
        guest_code: guest_code || null,
        room: newRoom.trim() || null,
        in_house: preferInHouse ? true : null,
        source: preferInHouse ? 'local' : null,
        tags: [],
      });
      if (created) {
        selectGuest(created as Customer);
        setNewCode('');
        setNewName('');
        setNewRoom('');
        toast.success(t('menu:guest.created'));
      }
    } catch (error) {
      console.error(error);
      toast.error(t('menu:guest.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const startNewOrder = async () => {
    if (!selected?.id) {
      toast.error(t('menu:guest.required'));
      return;
    }

    let table: Table | undefined;
    const wantedTable = tableNumber.trim() || String(selected.room ?? '').trim();
    if (wantedTable) {
      // Prefer hotel room when the guest has a PMS room; dining table only if typed as such.
      table =
        (await findRoomByNumber(db, wantedTable)) ??
        (await findTableByNumber(db, wantedTable));
      if (!table) {
        toast.error(t('menu:guest.tableNotFound', { number: wantedTable }));
        return;
      }
    }

    const floorFromTable = table?.floor;
    setState((prev) => ({
      ...prev,
      customer: selected,
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
            enableKeyboard
          />
          <div className="divide-y rounded-lg border border-neutral-200 max-h-[280px] overflow-auto">
            {results.length === 0 && (search.trim() || preferInHouse) && (
              <div className="p-4 text-neutral-500">{t('menu:guest.noResults')}</div>
            )}
            {results.map((guest) => (
              <button
                type="button"
                key={guest.id?.toString()}
                className={cn(
                  'w-full text-left p-3 hover:bg-primary-50',
                  selected?.id?.toString() === guest.id?.toString() && 'bg-primary-100'
                )}
                onClick={() => selectGuest(guest)}
              >
                <div className="font-bold text-lg">{formatGuestLabel(guest)}</div>
                <div className="text-sm text-neutral-600">
                  {guest.guest_code && guest.name?.trim() ? `#${guestCodeLabel(guest)} · ` : ''}
                  {guest.room ? `${t('menu:guest.room')} ${guest.room}` : ''}
                </div>
              </button>
            ))}
          </div>

          {!preferInHouse && (
          <div className="pt-4 border-t">
            <h2 className="font-semibold mb-3">{t('menu:guest.createTitle')}</h2>
            <div className="flex flex-col gap-3">
              <Input
                label={t('orders:customer.name')}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                enableKeyboard
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('menu:guest.code')}
                  placeholder="A184"
                  value={newCode}
                  onChange={(event) => setNewCode(event.target.value)}
                  enableKeyboard
                />
                <Input
                  label={t('menu:guest.room')}
                  placeholder="184"
                  value={newRoom}
                  onChange={(event) => setNewRoom(event.target.value)}
                  enableKeyboard
                />
              </div>
              <Button
                variant="primary"
                filled
                size="lg"
                className="w-full"
                isLoading={saving}
                onClick={() => void createGuest()}
              >
                {t('menu:guest.create')}
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
                      className="border rounded-lg p-3 flex justify-between gap-3"
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
                      </div>
                      <div className="text-sm text-neutral-500">
                        {toLuxonDateTime(order.created_at).toFormat('dd LLL HH:mm')}
                      </div>
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
    </div>
  );
};
