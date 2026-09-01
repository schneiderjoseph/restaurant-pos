import {atomWithStorage, createJSONStorage, unwrap} from "jotai/utils";
import {atom} from 'jotai';
import {Dish} from "@/api/model/dish.ts";
import {Table} from "@/api/model/table.ts";
import {Category} from "@/api/model/category.ts";
import {ModifierGroup} from "@/api/model/modifier_group.ts";
import {Floor} from "@/api/model/floor.ts";
import {Customer} from "@/api/model/customer.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {MenuItem} from "@/api/model/cart_item.ts";
import {OrderType} from "@/api/model/order_type.ts";
import {User} from "@/api/model/user.ts";
import {LabelValue} from "@/api/model/common.ts";
import {Kitchen} from "@/api/model/kitchen.ts";
import {createStore, del, get, set} from 'idb-keyval'
import {PaymentType} from "@/api/model/payment_type.ts";
import {DishModifierGroup} from "@/api/model/dish_modifier_group.ts";
import {Menu} from "@/api/model/menu.ts";
import {Tax} from "@/api/model/tax.ts";
import {DEFAULT_LANGUAGE, DEFAULT_TEXT_DIRECTION, type AppTextDirection} from "@/lib/languages.ts";


export interface AppStateInterface {
  loggedIn: boolean
  floor?: Floor
  table?: Table
  customer?: Customer
  orderType?: OrderType
  persons?: string
  category?: Category
  dish?: Dish
  order?: {
    id?: string | 'new'
    order?: Order
  }
  orders: Order[]
  showFloor?: boolean
  showPersons?: boolean
  cart: MenuItem[]
  seats: string[]
  seat?: string
  switchTable?: boolean
  hideTableSelection?: boolean
  /** Resort F&B entry: guest lookup vs walk-in floor (ignored when VITE_RESORT_FB is off). */
  resortEntry?: 'guest' | 'floor'
  ordersFilters: {
    users: LabelValue[]
    floors: LabelValue[]
    statuses: LabelValue[]
    orderTypes: LabelValue[]
    customers: LabelValue[]
  }
  orderDisplayFilters: {
    statuses: LabelValue[]
    orderTypes: LabelValue[]
  }
}

/** Persist UI flags only — cart/order graphs belong in memory / orderEditSessionAtom. */
function slimAppStateForStorage(value: AppStateInterface): AppStateInterface {
  return {
    ...value,
    cart: [],
    orders: [],
    order: value.order?.id
      ? { id: typeof value.order.id === 'string' ? value.order.id : String(value.order.id), order: undefined }
      : undefined,
    // Keep customer/table as light refs when possible (ids + names only would be ideal;
    // full objects are usually small enough compared to order item graphs).
  };
}

const appStateJsonStorage = createJSONStorage<AppStateInterface>(() => ({
  getItem: (key) => {
    const raw = localStorage.getItem(key);
    return raw;
  },
  setItem: (key, value) => {
    try {
      const parsed = JSON.parse(value) as AppStateInterface;
      localStorage.setItem(key, JSON.stringify(slimAppStateForStorage(parsed)));
    } catch {
      // Quota / circular — keep last good persisted snapshot; memory atom still holds live state.
      try {
        localStorage.setItem(key, value);
      } catch {
        // ignore
      }
    }
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
  },
}));

export const appState = atomWithStorage<AppStateInterface>(
  "app-state",
  {
    loggedIn: false,
    persons: '1',
    orders: [],
    showFloor: true,
    cart: [],
    seats: [],
    ordersFilters: {
      users: [],
      floors: [],
      statuses: [],
      orderTypes: [],
      customers: [],
    },
    orderDisplayFilters: {
      statuses: [{ label: OrderStatus['In Progress'], value: OrderStatus['In Progress'] }],
      orderTypes: [],
    },
  },
  appStateJsonStorage,
  { getOnInit: true },
);

export type DishSearchType = 'number' | 'both';

export interface MenuConfigInterface {
  showTotalInCart?: boolean

  showTotalInOrderCard?: boolean
  showGroupsInOrderCard?: boolean
  showQuantityInOrderCard?: boolean
  showPriceInOrderCard?: boolean
  showModifierPriceInOrderCard?: boolean
  showModifiersInOrderCard?: boolean
  /** Show touch dish search on the POS menu (this device). */
  enableDishSearch?: boolean
  /** Show #number badge on dish tiles. */
  showDishNumber?: boolean
  /**
   * Show dish photos on menu tiles.
   * Off by default until a reliable photo source exists; keep the flag to re-enable later.
   */
  showDishPhotos?: boolean
  /** Search by dish number only, or by name and number. */
  dishSearchType?: DishSearchType
  /**
   * Kitchen / station tickets: how to show the guest.
   * name = display name (shortened), code = guest code, both = name · #CODE
   */
  kitchenGuestLabel?: 'name' | 'code' | 'both'
}

export interface AppPageInterface {
  page: string
  locked?: boolean
  lockedBy?: User
  user?: User
  touch?: boolean
  language?: string
  direction?: AppTextDirection
  /** Last What's New release date dismissed on this device (YYYY-MM-DD). */
  whatsNewDismissedDate?: string
  /** @deprecated Prefer whatsNewDismissedDate */
  whatsNewDismissedVersion?: string

  menuConfig?: MenuConfigInterface
}

export const appPage = atomWithStorage<AppPageInterface>(
  "app-page",
  {
    page: "Login",
    touch: true,
    language: DEFAULT_LANGUAGE,
    direction: DEFAULT_TEXT_DIRECTION,
    menuConfig: {
      showTotalInCart: false,
      showTotalInOrderCard: false,
      showGroupsInOrderCard: false,
      showQuantityInOrderCard: false,
      showPriceInOrderCard: false,
      showModifierPriceInOrderCard: false,
      showModifiersInOrderCard: false,
      enableDishSearch: false,
      showDishNumber: false,
      showDishPhotos: false,
      dishSearchType: 'number',
      kitchenGuestLabel: 'name',
    }
  },
  createJSONStorage<AppPageInterface>(),
  {getOnInit: true}
);

/** Increment / set true from Settings to force-open the What's New dialog. */
export const whatsNewOpenRequest = atom(false);

/** Terminal-scoped printer routing (this browser). Delivery stays user/global DB. */
export interface SystemPrinterSettings {
  useSystemPrinters: boolean
  temp_print_printers: string[]
  final_print_printers: string[]
  refund_print_printers: string[]
  summary_print_printers: string[]
}

export const defaultSystemPrinterSettings: SystemPrinterSettings = {
  useSystemPrinters: false,
  temp_print_printers: [],
  final_print_printers: [],
  refund_print_printers: [],
  summary_print_printers: [],
};

export const systemPrinterSettings = atomWithStorage<SystemPrinterSettings>(
  'system-printers',
  defaultSystemPrinterSettings,
  createJSONStorage<SystemPrinterSettings>(),
  {getOnInit: true}
);

const appStorageStore = createStore('posr-react', 'jotai-storage')

export const indexedDBStorage = {
  getItem: async (key: string) => {
    const storedValue = await get<string>(key, appStorageStore)
    if (storedValue !== undefined) {
      return storedValue
    }

    if (typeof window === 'undefined') {
      return null
    }

    const legacyValue = window.localStorage.getItem(key)
    if (legacyValue !== null) {
      await set(key, legacyValue, appStorageStore)
      window.localStorage.removeItem(key)
    }

    return legacyValue
  },
  setItem: async (key: string, value: string) => {
    await set(key, value, appStorageStore)
  },
  removeItem: async (key: string) => {
    await del(key, appStorageStore)
  },
}

export interface AppSettingsInterface {
  order_types: OrderType[]
  categories: Category[]
  dishes: Dish[]
  modifier_groups: ModifierGroup[]
  groups_dishes: DishModifierGroup[]
  floors: Floor[]
  tables: Table[]
  kitchens: Kitchen[]
  payment_types: PaymentType[]
  menus: Menu[]
  taxes: Tax[]
}

const defaultAppSettings: AppSettingsInterface = {
  order_types: [],
  categories: [],
  modifier_groups: [],
  groups_dishes: [],
  floors: [],
  tables: [],
  kitchens: [],
  dishes: [],
  payment_types: [],
  menus: [],
  taxes: [],
}

const normalizeAppSettings = (settings?: Partial<AppSettingsInterface>): AppSettingsInterface => ({
  ...defaultAppSettings,
  ...settings
})

const appSettingsStorageAtom = atomWithStorage<AppSettingsInterface>(
  'app-settings',
  defaultAppSettings,
  createJSONStorage<AppSettingsInterface>(() => indexedDBStorage),
  {getOnInit: true}
);

const appSettingsStorageAtomUnwrapped = unwrap(
  appSettingsStorageAtom, () => defaultAppSettings
)

export const appSettings = atom(
  (get) => normalizeAppSettings(get(appSettingsStorageAtomUnwrapped)),
  (
    get,
    set,
    update: AppSettingsInterface | ((prev: AppSettingsInterface) => AppSettingsInterface)
  ) => {
    const current = normalizeAppSettings(get(appSettingsStorageAtomUnwrapped))
    const nextValue =
      typeof update === 'function' ? update(current) : update

    set(appSettingsStorageAtom, normalizeAppSettings(nextValue))
  }
);

export interface AppAlertInterface {
  opened: boolean
  message: string
  type: "info" | "error" | "warning" | "success"
}

export const appAlert = atom<AppAlertInterface>({
  opened: false,
  message: '',
  type: 'info'
})

export const defaultClosingEnforcementState = {
  orderTakingBlocked: false,
  orderMutationsBlocked: false,
  cycleEndedAt: null as Date | null,
  dayClosingCompleted: false,
  message: null as string | null,
};

export type ClosingEnforcementAtomState = typeof defaultClosingEnforcementState;

export const closingEnforcementAtom = atom<ClosingEnforcementAtomState>(defaultClosingEnforcementState);