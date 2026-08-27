'use strict';

/**
 * Loyverse API v1.0 resource registry.
 * @typedef {object} LoyverseResource
 * @property {string} resource   Mirror key (singular)
 * @property {string} path       API path
 * @property {string} listKey    Response array key (empty = singleton object)
 * @property {'id'|'receipt_number'|'composite'} idKind
 * @property {string} [idField]    Field for idKind=id (default id)
 * @property {string[]} [compositeFields] variant_id + store_id for inventory
 * @property {boolean} [catalog] Included in default catalog mirror pass
 * @property {boolean} [paginated] Uses cursor pagination
 * @property {string} [envFlag]  Config flag name; omit = always on when mirror enabled
 * @property {string[]} [scopes] PAT scopes (documentation)
 */

/** @type {LoyverseResource[]} */
const RESOURCES = [
  {
    resource: 'category',
    path: '/categories',
    listKey: 'categories',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['CATEGORIES_READ'],
  },
  {
    resource: 'item',
    path: '/items',
    listKey: 'items',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['ITEMS_READ'],
  },
  {
    resource: 'tax',
    path: '/taxes',
    listKey: 'taxes',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['TAXES_READ'],
  },
  {
    resource: 'modifier',
    path: '/modifiers',
    listKey: 'modifiers',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['MODIFIERS_READ'],
  },
  {
    resource: 'discount',
    path: '/discounts',
    listKey: 'discounts',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['DISCOUNTS_READ'],
  },
  {
    resource: 'customer',
    path: '/customers',
    listKey: 'customers',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['CUSTOMERS_READ'],
  },
  {
    resource: 'payment_type',
    path: '/payment_types',
    listKey: 'payment_types',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['PAYMENT_TYPES_READ'],
  },
  {
    resource: 'store',
    path: '/stores',
    listKey: 'stores',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['STORES_READ'],
  },
  {
    resource: 'employee',
    path: '/employees',
    listKey: 'employees',
    idKind: 'id',
    catalog: true,
    paginated: true,
    scopes: ['EMPLOYEES_READ'],
  },
  {
    resource: 'supplier',
    path: '/suppliers',
    listKey: 'suppliers',
    idKind: 'id',
    catalog: false,
    paginated: true,
    envFlag: 'syncSuppliers',
    scopes: ['SUPPLIERS_READ'],
  },
  {
    resource: 'pos_device',
    path: '/pos_devices',
    listKey: 'pos_devices',
    idKind: 'id',
    catalog: false,
    paginated: true,
    envFlag: 'syncPosDevices',
    scopes: ['POS_DEVICES_READ'],
  },
  {
    resource: 'merchant',
    path: '/merchant',
    listKey: '',
    idKind: 'id',
    idField: 'id',
    catalog: false,
    paginated: false,
    envFlag: 'syncMerchant',
    scopes: ['MERCHANT_READ'],
  },
  {
    resource: 'inventory',
    path: '/inventory',
    listKey: 'inventory',
    idKind: 'composite',
    compositeFields: ['variant_id', 'store_id'],
    catalog: false,
    paginated: true,
    envFlag: 'syncInventory',
    scopes: ['INVENTORY_READ'],
  },
  {
    resource: 'receipt',
    path: '/receipts',
    listKey: 'receipts',
    idKind: 'receipt_number',
    idField: 'receipt_number',
    catalog: false,
    paginated: true,
    envFlag: 'syncReceipts',
    scopes: ['RECEIPTS_READ'],
  },
  {
    resource: 'shift',
    path: '/shifts',
    listKey: 'shifts',
    idKind: 'id',
    catalog: false,
    paginated: true,
    envFlag: 'syncShifts',
    scopes: ['SHIFTS_READ'],
  },
];

/** @type {Map<string, LoyverseResource>} */
const BY_RESOURCE = new Map(RESOURCES.map((r) => [r.resource, r]));

function getResource(name) {
  const r = BY_RESOURCE.get(name);
  if (!r) throw new Error(`Unknown Loyverse resource: ${name}`);
  return r;
}

function catalogResources() {
  return RESOURCES.filter((r) => r.catalog);
}

function mirrorIdForRecord(def, record) {
  if (def.idKind === 'receipt_number') {
    const n = record?.[def.idField || 'receipt_number'];
    if (n == null || n === '') throw new Error(`${def.resource}: missing receipt_number`);
    return String(n);
  }
  if (def.idKind === 'composite') {
    const parts = (def.compositeFields || []).map((f) => {
      const v = record?.[f];
      if (v == null || v === '') throw new Error(`${def.resource}: missing ${f}`);
      return String(v);
    });
    return parts.join(':');
  }
  const field = def.idField || 'id';
  const id = record?.[field];
  if (id == null || id === '') throw new Error(`${def.resource}: missing ${field}`);
  return String(id);
}

function parseApiDatetime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

module.exports = {
  RESOURCES,
  getResource,
  catalogResources,
  mirrorIdForRecord,
  parseApiDatetime,
};
