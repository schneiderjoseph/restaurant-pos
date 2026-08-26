'use strict';

const { queryRows, asRecord } = require('./surreal');

async function upsertCustomers(db, customers) {
  let created = 0;
  let updated = 0;
  const active = new Set();

  for (const c of customers) {
    active.add(c.loyverseId);
    let found = await queryRows(
      db,
      `SELECT id FROM customer WHERE loyverse_id = $lid LIMIT 1`,
      { lid: c.loyverseId },
    );

    const guestCode = c.customerCode || `LV-${c.loyverseId.replace(/-/g, '').slice(0, 10)}`;
    const tags = ['loyverse'];
    const payload = {
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      points: c.totalPoints,
      guest_code: guestCode,
      source: 'loyverse',
      loyverse_id: c.loyverseId,
      tags,
    };

    if (found[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          email = $email,
          phone = $phone,
          address = $address,
          points = $points,
          guest_code = $guest_code,
          source = $source,
          loyverse_id = $loyverse_id,
          tags = $tags`,
        { id: asRecord(found[0].id), ...payload },
      );
      updated += 1;
    } else {
      await queryRows(
        db,
        `CREATE customer SET
          name = $name,
          email = $email,
          phone = $phone,
          address = $address,
          points = $points,
          guest_code = $guest_code,
          source = $source,
          loyverse_id = $loyverse_id,
          tags = $tags`,
        payload,
      );
      created += 1;
    }
  }

  // Soft-clear: we don't have deleted_at on all customer schemas consistently —
  // mark missing as tag without loyverse-active via source keep; optional soft delete if field exists
  const existing = await queryRows(
    db,
    `SELECT id, loyverse_id FROM customer WHERE source = 'loyverse'`,
  );
  let deactivated = 0;
  for (const row of existing) {
    if (!active.has(String(row.loyverse_id || ''))) {
      try {
        await queryRows(db, `UPDATE $id SET tags = ['loyverse', 'inactive']`, {
          id: asRecord(row.id),
        });
        deactivated += 1;
      } catch {
        // ignore
      }
    }
  }

  return { created, updated, deactivated, total: customers.length };
}

async function upsertPaymentTypes(db, paymentTypes) {
  let upserted = 0;
  const keep = new Set();

  for (const p of paymentTypes) {
    keep.add(p.loyverseId);
    let found = await queryRows(
      db,
      `SELECT id FROM payment_type WHERE loyverse_id = $lid LIMIT 1`,
      { lid: p.loyverseId },
    );
    const payload = {
      name: p.name,
      type: p.type,
      priority: p.priority,
      source: 'loyverse',
      loyverse_id: p.loyverseId,
    };
    if (found[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          type = $type,
          priority = $priority,
          source = $source,
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        { id: asRecord(found[0].id), ...payload },
      );
    } else {
      await queryRows(
        db,
        `CREATE payment_type SET
          name = $name,
          type = $type,
          priority = $priority,
          source = $source,
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        payload,
      );
    }
    upserted += 1;
  }

  const existing = await queryRows(
    db,
    `SELECT id, loyverse_id FROM payment_type
     WHERE source = 'loyverse' AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  let deactivated = 0;
  for (const row of existing) {
    if (!keep.has(String(row.loyverse_id || ''))) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
        id: asRecord(row.id),
      });
      deactivated += 1;
    }
  }

  return { upserted, deactivated };
}

async function upsertDiscounts(db, discounts) {
  let upserted = 0;
  const keep = new Set();

  for (const d of discounts) {
    // Skip points-only discounts that have no usable value for POSR cart
    if (d.loyverseType === 'DISCOUNT_BY_POINTS' && !(d.value > 0)) {
      continue;
    }
    keep.add(d.loyverseId);
    let found = await queryRows(
      db,
      `SELECT id FROM discount WHERE loyverse_id = $lid LIMIT 1`,
      { lid: d.loyverseId },
    );
    const payload = {
      name: d.name,
      type: d.type,
      value: d.value,
      value_type: d.valueType,
      priority: d.priority,
      requires_approval: d.requiresApproval,
      is_active: true,
      source: 'loyverse',
      loyverse_id: d.loyverseId,
    };
    if (found[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          type = $type,
          value = $value,
          value_type = $value_type,
          priority = $priority,
          requires_approval = $requires_approval,
          is_active = true,
          source = $source,
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        { id: asRecord(found[0].id), ...payload },
      );
    } else {
      await queryRows(
        db,
        `CREATE discount SET
          name = $name,
          type = $type,
          value = $value,
          value_type = $value_type,
          priority = $priority,
          requires_approval = $requires_approval,
          is_active = true,
          source = $source,
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        payload,
      );
    }
    upserted += 1;
  }

  const existing = await queryRows(
    db,
    `SELECT id, loyverse_id FROM discount
     WHERE source = 'loyverse' AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  let deactivated = 0;
  for (const row of existing) {
    if (!keep.has(String(row.loyverse_id || ''))) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now(), is_active = false`, {
        id: asRecord(row.id),
      });
      deactivated += 1;
    }
  }

  return { upserted, deactivated };
}

/**
 * POSR modifiers are dish-linked (modifier.modifier → menu_item), unlike Loyverse
 * option lists. Persist Loyverse modifiers as setting meta for now; dish wiring later.
 */
async function upsertModifiers(db, modifiers) {
  const settings = await queryRows(
    db,
    `SELECT id FROM setting WHERE key = 'loyverse_modifiers' AND is_global = true LIMIT 1`,
  );
  if (settings[0]?.id) {
    await queryRows(db, `UPDATE $id SET values = $values`, {
      id: asRecord(settings[0].id),
      values: modifiers,
    });
  } else {
    await queryRows(
      db,
      `CREATE setting SET key = 'loyverse_modifiers', is_global = true, values = $values`,
      { values: modifiers },
    );
  }
  const options = modifiers.reduce((n, m) => n + (m.options?.length || 0), 0);
  return { groups: modifiers.length, options, groupMap: new Map() };
}

async function upsertStoreMeta(db, stores, activeStoreId) {
  const payload = {
    stores,
    active_store_id: activeStoreId,
    synced_at: new Date().toISOString(),
  };
  const settings = await queryRows(
    db,
    `SELECT id FROM setting WHERE key = 'loyverse_stores' AND is_global = true LIMIT 1`,
  );
  if (settings[0]?.id) {
    await queryRows(db, `UPDATE $id SET values = $values`, {
      id: asRecord(settings[0].id),
      values: [payload],
    });
  } else {
    await queryRows(
      db,
      `CREATE setting SET key = 'loyverse_stores', is_global = true, values = [$values]`,
      { values: payload },
    );
  }

  const empSettings = await queryRows(
    db,
    `SELECT id FROM setting WHERE key = 'loyverse_employees' AND is_global = true LIMIT 1`,
  );
  return { stores: stores.length, settingUpdated: true, empSettings: empSettings.length };
}

async function upsertEmployeeMeta(db, employees) {
  const settings = await queryRows(
    db,
    `SELECT id FROM setting WHERE key = 'loyverse_employees' AND is_global = true LIMIT 1`,
  );
  if (settings[0]?.id) {
    await queryRows(db, `UPDATE $id SET values = $values`, {
      id: asRecord(settings[0].id),
      values: employees,
    });
  } else {
    await queryRows(
      db,
      `CREATE setting SET key = 'loyverse_employees', is_global = true, values = $values`,
      { values: employees },
    );
  }
  return { employees: employees.length };
}

module.exports = {
  upsertCustomers,
  upsertPaymentTypes,
  upsertDiscounts,
  upsertModifiers,
  upsertStoreMeta,
  upsertEmployeeMeta,
};
