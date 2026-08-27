'use strict';

const { loadMirrorPayloads } = require('./mirror-upsert');

/**
 * Pick store-specific pricing row when LOYVERSE_STORE_ID is set.
 * @param {object} variant
 * @param {string|null} storeId
 */
function resolveVariantPrice(variant, storeId) {
  const stores = Array.isArray(variant?.stores) ? variant.stores : [];
  let row = null;
  if (storeId) {
    row = stores.find((s) => s.store_id === storeId) || null;
  }
  if (!row && stores.length === 1) {
    row = stores[0];
  }
  if (!row && stores.length > 1) {
    row = stores.find((s) => s.available_for_sale !== false) || stores[0];
  }

  const available = row ? row.available_for_sale !== false : true;
  let price = null;
  if (row && row.price != null && Number.isFinite(Number(row.price))) {
    price = Number(row.price);
  } else if (variant?.default_price != null && Number.isFinite(Number(variant.default_price))) {
    price = Number(variant.default_price);
  } else {
    price = 0;
  }

  return { price, available, pricingType: row?.pricing_type || variant?.default_pricing_type || null };
}

function variantDisplayName(item, variant) {
  const base = String(item.item_name || item.handle || 'Item').trim();
  const parts = [variant.option1_value, variant.option2_value, variant.option3_value]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  if (parts.length === 0) return base;
  return `${base} — ${parts.join(' / ')}`;
}

function variantPlu(variant) {
  const sku = String(variant?.sku || '').trim();
  if (sku) return sku;
  const id = String(variant?.variant_id || '').replace(/-/g, '').slice(0, 12);
  return `LV-${id || 'unknown'}`;
}

function mapPaymentType(loyverseType) {
  const t = String(loyverseType || 'OTHER').toUpperCase();
  if (t === 'CASH') return 'cash';
  if (t === 'CHECK') return 'cheque';
  if (t.includes('CARD')) return 'card';
  return 'other';
}

function mapDiscount(d, idx) {
  const type = String(d.type || '').toUpperCase();
  let valueType = 'percent';
  let value = 0;
  if (type === 'FIXED_PERCENT' || type === 'VARIABLE_PERCENT') {
    valueType = 'percent';
    value = Number(d.discount_percent) || 0;
  } else if (type === 'FIXED_AMOUNT' || type === 'VARIABLE_AMOUNT') {
    valueType = 'amount';
    value = Number(d.discount_amount) || 0;
  } else {
    valueType = 'percent';
    value = Number(d.discount_percent) || 0;
  }
  return {
    loyverseId: String(d.id),
    name: String(d.name || 'Discount').trim() || 'Discount',
    type: valueType === 'percent' ? 'percentage' : 'fixed',
    valueType,
    value,
    requiresApproval: !!d.restricted_access,
    priority: (idx + 1) * 10,
    loyverseType: type,
  };
}

/**
 * Build POSR-shaped catalogue from raw Loyverse API objects (full payloads).
 * @param {object} raw
 * @param {string|null} storeId
 */
function buildCatalogFromRaw(raw, storeId) {
  const categories = raw.categories || [];
  const items = raw.items || [];
  const taxes = raw.taxes || [];
  const stores = raw.stores || [];
  const modifiers = raw.modifiers || [];
  const customers = raw.customers || [];
  const paymentTypes = raw.payment_types || [];
  const discounts = raw.discounts || [];
  const employees = raw.employees || [];

  const resolvedStoreId = storeId || (stores[0]?.id ?? null);

  const mappedCategories = categories.map((c, idx) => ({
    loyverseId: String(c.id),
    name: String(c.name || 'Category').trim() || 'Category',
    color: c.color || null,
    deleted: !!c.deleted_at,
    priority: (idx + 1) * 10,
  }));

  const mappedVariants = [];
  for (const item of items) {
    const itemDeleted = !!item.deleted_at;
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const taxIds = Array.isArray(item.tax_ids) ? item.tax_ids.map(String) : [];
    const modifierIds = Array.isArray(item.modifier_ids) ? item.modifier_ids.map(String) : [];

    for (const variant of variants) {
      const { price, available } = resolveVariantPrice(variant, resolvedStoreId);
      mappedVariants.push({
        loyverseItemId: String(item.id),
        loyverseVariantId: String(variant.variant_id),
        categoryId: item.category_id ? String(item.category_id) : null,
        name: variantDisplayName(item, variant),
        number: variantPlu(variant),
        price,
        cost:
          variant.cost != null && Number.isFinite(Number(variant.cost))
            ? Number(variant.cost)
            : null,
        available: available && !itemDeleted && !variant.deleted_at,
        deleted: itemDeleted || !!variant.deleted_at,
        taxIds,
        modifierIds,
        description: item.description || null,
        trackStock: !!item.track_stock,
        rawItem: item,
        rawVariant: variant,
      });
    }
  }

  const mappedTaxes = taxes
    .filter((t) => !t.deleted_at)
    .map((t, idx) => ({
      loyverseId: String(t.id),
      name: String(t.name || 'Tax').trim() || 'Tax',
      rate: Number(t.rate) || 0,
      type: String(t.type || 'ADDED'),
      priority: (idx + 1) * 10,
    }));

  const mappedModifiers = (modifiers || [])
    .filter((m) => !m.deleted_at)
    .map((m, idx) => ({
      loyverseId: String(m.id),
      name: String(m.name || 'Modifier').trim() || 'Modifier',
      priority: (idx + 1) * 10,
      options: (Array.isArray(m.options) ? m.options : [])
        .filter((o) => !o.deleted_at)
        .map((o, oidx) => ({
          loyverseId: String(o.id),
          name: String(o.name || 'Option').trim() || 'Option',
          price: Number(o.price) || 0,
          priority: (oidx + 1) * 10,
        })),
    }));

  const mappedCustomers = (customers || [])
    .filter((c) => !c.deleted_at && !c.permanent_deletion_at)
    .map((c) => ({
      loyverseId: String(c.id),
      name: String(c.name || 'Customer').trim() || 'Customer',
      email: c.email || null,
      phone: c.phone_number || null,
      address: c.address || null,
      city: c.city || null,
      postalCode: c.postal_code || null,
      note: c.note || null,
      customerCode: c.customer_code || null,
      totalPoints: Number(c.total_points) || 0,
      totalSpent: Number(c.total_spent) || 0,
      totalVisits: Number(c.total_visits) || 0,
    }));

  const mappedPaymentTypes = (paymentTypes || [])
    .filter((p) => !p.deleted_at)
    .map((p, idx) => ({
      loyverseId: String(p.id),
      name: String(p.name || 'Payment').trim() || 'Payment',
      type: mapPaymentType(p.type),
      priority: (idx + 1) * 10,
    }));

  const mappedDiscounts = (discounts || [])
    .filter((d) => !d.deleted_at)
    .map((d, idx) => mapDiscount(d, idx));

  const mappedEmployees = (employees || [])
    .filter((e) => !e.deleted_at)
    .map((e) => ({
      loyverseId: String(e.id),
      name: String(e.name || 'Employee').trim() || 'Employee',
      email: e.email || null,
      phone: e.phone_number || null,
      isOwner: !!e.is_owner,
      stores: Array.isArray(e.stores) ? e.stores.map(String) : [],
    }));

  const mappedStores = (stores || []).map((s) => ({
    loyverseId: String(s.id),
    name: String(s.name || 'Store').trim() || 'Store',
    address: s.address || null,
    city: s.city || null,
    phone: s.phone_number || null,
    deleted: !!s.deleted_at,
  }));

  return {
    storeId: resolvedStoreId,
    stores: mappedStores,
    categories: mappedCategories,
    variants: mappedVariants,
    taxes: mappedTaxes,
    modifiers: mappedModifiers,
    customers: mappedCustomers,
    paymentTypes: mappedPaymentTypes,
    discounts: mappedDiscounts,
    employees: mappedEmployees,
  };
}

/**
 * Load catalogue projection from loyverse_mirror table.
 * @param {import('surrealdb').Surreal} db
 * @param {string|null} storeId
 */
async function loadCatalogFromMirror(db, storeId) {
  const [categories, items, taxes, stores, modifiers, customers, paymentTypes, discounts, employees] =
    await Promise.all([
      loadMirrorPayloads(db, 'category', { activeOnly: false }),
      loadMirrorPayloads(db, 'item', { activeOnly: false }),
      loadMirrorPayloads(db, 'tax', { activeOnly: false }),
      loadMirrorPayloads(db, 'store', { activeOnly: false }),
      loadMirrorPayloads(db, 'modifier', { activeOnly: false }),
      loadMirrorPayloads(db, 'customer', { activeOnly: false }),
      loadMirrorPayloads(db, 'payment_type', { activeOnly: false }),
      loadMirrorPayloads(db, 'discount', { activeOnly: false }),
      loadMirrorPayloads(db, 'employee', { activeOnly: false }),
    ]);

  return buildCatalogFromRaw(
    {
      categories,
      items,
      taxes,
      stores,
      modifiers,
      customers,
      payment_types: paymentTypes,
      discounts,
      employees,
    },
    storeId,
  );
}

/**
 * Pull every catalogue-related resource directly from Loyverse API (legacy path).
 * @param {{ token: string, baseUrl: string, storeId: string|null }} cfg
 */
async function fetchLoyverseCatalog(cfg) {
  const { LoyverseClient } = require('./loyverse-client');
  const client = new LoyverseClient({ token: cfg.token, baseUrl: cfg.baseUrl });

  const [categories, items, taxes, stores, modifiers, customers, paymentTypes, discounts, employees] =
    await Promise.all([
      client.listAll('/categories', 'categories'),
      client.listAll('/items', 'items'),
      client.listAll('/taxes', 'taxes'),
      client.listAll('/stores', 'stores'),
      client.listAll('/modifiers', 'modifiers'),
      client.listAll('/customers', 'customers'),
      client.listAll('/payment_types', 'payment_types'),
      client.listAll('/discounts', 'discounts'),
      client.listAll('/employees', 'employees'),
    ]);

  return buildCatalogFromRaw(
    {
      categories,
      items,
      taxes,
      stores,
      modifiers,
      customers,
      payment_types: paymentTypes,
      discounts,
      employees,
    },
    cfg.storeId,
  );
}

module.exports = {
  fetchLoyverseCatalog,
  loadCatalogFromMirror,
  buildCatalogFromRaw,
  resolveVariantPrice,
  variantDisplayName,
  variantPlu,
};
