'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

function loyverseGroupRecordId(loyverseId) {
  const key = String(loyverseId).replace(/-/g, '');
  return `modifier_group:loyverse_${key}`;
}

function loyverseModifierRecordId(loyverseId) {
  const key = String(loyverseId).replace(/-/g, '');
  return `modifier:loyverse_${key}`;
}

function loyverseOptionDishId(loyverseId) {
  const key = String(loyverseId).replace(/-/g, '');
  return `menu_item:loyverse_mod_${key}`;
}

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

async function ensureOptionDish(db, option) {
  const dishId = loyverseOptionDishId(option.loyverseId);
  const existing = await queryRows(db, `SELECT id FROM ${dishId}`);
  const plu = `LV-MO-${String(option.loyverseId).replace(/-/g, '').slice(0, 10)}`;
  if (existing[0]?.id) {
    await queryRows(
      db,
      `UPDATE $id SET name = $name, price = $price, source = 'loyverse_modifier_option', deleted_at = NONE`,
      { id: asRecord(existing[0].id), name: option.name, price: option.price },
    );
    return dishId;
  }
  await queryRows(
    db,
    `CREATE ${dishId} SET
      name = $name,
      number = $plu,
      price = $price,
      source = 'loyverse_modifier_option',
      deleted_at = NONE`,
    { name: option.name, plu, price: option.price },
  );
  return dishId;
}

/**
 * Create modifier_group + modifier records from Loyverse modifier groups.
 * @returns {{ groups: number, options: number, groupMap: Map<string, string> }}
 */
async function upsertModifiersToPosr(db, modifiers) {
  /** @type {Map<string, string>} */
  const groupMap = new Map();
  let options = 0;
  const keepGroups = new Set();

  for (const group of modifiers) {
    keepGroups.add(group.loyverseId);
    const groupId = loyverseGroupRecordId(group.loyverseId);
    groupMap.set(group.loyverseId, groupId);

    /** @type {string[]} */
    const modifierRefs = [];
    for (const option of group.options || []) {
      const dishId = await ensureOptionDish(db, option);
      const modId = loyverseModifierRecordId(option.loyverseId);
      const existingMod = await queryRows(db, `SELECT id FROM ${modId}`);
      if (existingMod[0]?.id) {
        await queryRows(
          db,
          `UPDATE $id SET modifier = $dish, price = $price, loyverse_id = $loyverse_id`,
          {
            id: asRecord(existingMod[0].id),
            dish: asRecord(dishId),
            price: option.price,
            loyverse_id: option.loyverseId,
          },
        );
      } else {
        await queryRows(
          db,
          `CREATE ${modId} SET modifier = $dish, price = $price, loyverse_id = $loyverse_id`,
          {
            dish: asRecord(dishId),
            price: option.price,
            loyverse_id: option.loyverseId,
          },
        );
      }
      modifierRefs.push(modId);
      options += 1;
    }

    const modRecords = modifierRefs.map(asRecord);
    const existingGroup = await queryRows(db, `SELECT id FROM ${groupId}`);
    if (existingGroup[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          priority = $priority,
          modifiers = $modifiers,
          source = 'loyverse',
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        {
          id: asRecord(existingGroup[0].id),
          name: group.name,
          priority: group.priority,
          modifiers: modRecords,
          loyverse_id: group.loyverseId,
        },
      );
    } else {
      await queryRows(
        db,
        `CREATE ${groupId} SET
          name = $name,
          priority = $priority,
          modifiers = $modifiers,
          source = 'loyverse',
          loyverse_id = $loyverse_id,
          deleted_at = NONE`,
        {
          name: group.name,
          priority: group.priority,
          modifiers: modRecords,
          loyverse_id: group.loyverseId,
        },
      );
    }
  }

  const existingGroups = await queryRows(
    db,
    `SELECT id, loyverse_id FROM modifier_group
     WHERE source = 'loyverse' AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  for (const row of existingGroups) {
    if (!keepGroups.has(String(row.loyverse_id || ''))) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, { id: asRecord(row.id) });
    }
  }

  // Legacy setting meta (UI fallback)
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

  return { groups: modifiers.length, options, groupMap };
}

/**
 * Link menu_item ↔ modifier_group from item.modifier_ids.
 * @param {Map<string, string>} groupMap loyverse modifier group id → Surreal id
 */
async function linkItemModifierGroups(db, variants, groupMap) {
  let linked = 0;
  for (const variant of variants) {
    if (variant.deleted || !variant.available) continue;
    const dishRows = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE loyverse_variant_id = $vid LIMIT 1`,
      { vid: variant.loyverseVariantId },
    );
    if (!dishRows[0]?.id) continue;
    const dishId = recordIdString(dishRows[0].id);

    for (let i = 0; i < (variant.modifierIds || []).length; i += 1) {
      const lvGroupId = variant.modifierIds[i];
      const groupId = groupMap.get(lvGroupId);
      if (!groupId) continue;

      const rel = await queryRows(
        db,
        `SELECT id FROM menu_item_modifier_group
         WHERE in = $dish AND out = $group LIMIT 1`,
        { dish: asRecord(dishId), group: asRecord(groupId) },
      );
      if (rel[0]?.id) {
        await queryRows(
          db,
          `UPDATE $id SET priority = $priority, has_required_modifiers = false, required_modifiers = 0`,
          { id: asRecord(rel[0].id), priority: i },
        );
      } else {
        await queryRows(
          db,
          `RELATE $dish->menu_item_modifier_group->$group SET
            priority = $priority,
            has_required_modifiers = false,
            required_modifiers = 0`,
          { dish: asRecord(dishId), group: asRecord(groupId), priority: i },
        );
      }
      linked += 1;
    }
  }
  return { linked };
}

/** @deprecated use upsertModifiersToPosr */
async function upsertModifiers(db, modifiers) {
  return upsertModifiersToPosr(db, modifiers);
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
  upsertModifiersToPosr,
  linkItemModifierGroups,
  upsertStoreMeta,
  upsertEmployeeMeta,
};
