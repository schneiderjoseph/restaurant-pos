'use strict';

const { queryRows, recordIdString, asRecord } = require('./surreal');

/** Every ASI modifier; attach it to dishes in Manage when ASI has no per-item list. */
const ASI_ALL_GROUP_ID = 'modifier_group:asi_all';
const ASI_GROUP_NAME = 'Accompagnements';
const ASI_SET_GROUP_PREFIX = 'modifier_group:asi_set_';
const ASI_MODIFIER_PREFIX = 'modifier:asi_';
const ASI_MODIFIER_DISH_SOURCE = 'asi_modifier';

const modifierDishId = (asiModifierId) => `menu_item:asi_mod_${asiModifierId}`;
const modifierRecordId = (asiModifierId) => `${ASI_MODIFIER_PREFIX}${asiModifierId}`;

/**
 * POSR modifiers point at a dish, so each ASI modifier gets a hidden one.
 * Name follows ASI; price is only set on create (ASI has none, Manage may set one).
 */
async function ensureModifier(db, modifier) {
  const dishId = modifierDishId(modifier.asiModifierId);
  // Prefixed so a dish sharing the alias never adopts this row by PLU.
  const plu = `MOD-${modifier.alias || modifier.asiModifierId}`;
  const dish = await queryRows(db, `SELECT id FROM ${dishId}`);
  if (dish[0]?.id) {
    await queryRows(
      db,
      `UPDATE ${dishId} SET name = $name, number = $plu, source = $source, deleted_at = NONE`,
      { name: modifier.name, plu, source: ASI_MODIFIER_DISH_SOURCE },
    );
  } else {
    await queryRows(
      db,
      `CREATE ${dishId} SET name = $name, number = $plu, price = 0, categories = [], source = $source, deleted_at = NONE`,
      { name: modifier.name, plu, source: ASI_MODIFIER_DISH_SOURCE },
    );
  }

  const modId = modifierRecordId(modifier.asiModifierId);
  const existing = await queryRows(db, `SELECT id FROM ${modId}`);
  if (existing[0]?.id) {
    await queryRows(db, `UPDATE ${modId} SET modifier = $dish`, { dish: asRecord(dishId) });
  } else {
    await queryRows(db, `CREATE ${modId} SET modifier = $dish, price = 0`, {
      dish: asRecord(dishId),
    });
  }
  return modId;
}

/** Name, colour and priority stay editable in Manage: only the option list follows ASI. */
async function ensureGroup(db, groupId, modifierIds) {
  const modifiers = modifierIds.map(asRecord);
  const existing = await queryRows(db, `SELECT id FROM ${groupId}`);
  if (existing[0]?.id) {
    await queryRows(db, `UPDATE ${groupId} SET modifiers = $modifiers, deleted_at = NONE`, {
      modifiers,
    });
    return;
  }
  await queryRows(
    db,
    `CREATE ${groupId} SET name = $name, priority = 1, modifiers = $modifiers, deleted_at = NONE`,
    { name: ASI_GROUP_NAME, modifiers },
  );
}

/**
 * Mirror ASI modifiers into POSR.
 * - `modifier_group:asi_all` holds every modifier (links to it are never touched).
 * - Items listed in tItemModifier get a group per distinct modifier set
 *   (`modifier_group:asi_set_3_4`), linked and unlinked to follow ASI.
 * @param {Map<number, string>} dishIdByAsiItemId synced dishes
 */
async function upsertModifiers(db, { modifiers = [], itemModifiers = [] }, dishIdByAsiItemId) {
  /** @type {Map<number, string>} */
  const modIdByAsiId = new Map();
  for (const modifier of modifiers) {
    modIdByAsiId.set(modifier.asiModifierId, await ensureModifier(db, modifier));
  }

  const allIds = [...modIdByAsiId.values()];
  if (allIds.length > 0) {
    await ensureGroup(db, ASI_ALL_GROUP_ID, allIds);
  } else {
    await queryRows(
      db,
      `UPDATE modifier_group SET deleted_at = time::now()
       WHERE id = $id AND deleted_at = NONE`,
      { id: asRecord(ASI_ALL_GROUP_ID) },
    );
  }

  // Modifiers removed from ASI: hide their dish and drop the option.
  const keepDishes = modifiers.map((m) => asRecord(modifierDishId(m.asiModifierId)));
  await queryRows(
    db,
    `UPDATE menu_item SET deleted_at = time::now()
     WHERE source = $source AND deleted_at = NONE AND id NOTINSIDE $keep`,
    { source: ASI_MODIFIER_DISH_SOURCE, keep: keepDishes },
  );
  await queryRows(
    db,
    `DELETE modifier
     WHERE string::starts_with(type::string(id), $prefix) AND id NOTINSIDE $keep`,
    { prefix: ASI_MODIFIER_PREFIX, keep: allIds.map(asRecord) },
  );

  /** @type {Map<number, number[]>} */
  const modifiersByItem = new Map();
  for (const link of itemModifiers) {
    if (!modIdByAsiId.has(link.asiModifierId) || !dishIdByAsiItemId.has(link.asiItemId)) continue;
    const list = modifiersByItem.get(link.asiItemId) || [];
    if (!list.includes(link.asiModifierId)) list.push(link.asiModifierId);
    modifiersByItem.set(link.asiItemId, list);
  }

  /** @type {Set<string>} */
  const wantedGroups = new Set();
  /** @type {Set<string>} `${dishId}|${groupId}` */
  const wantedLinks = new Set();
  for (const [asiItemId, asiModifierIds] of modifiersByItem) {
    const sorted = [...asiModifierIds].sort((a, b) => a - b);
    const groupId = `${ASI_SET_GROUP_PREFIX}${sorted.join('_')}`;
    if (!wantedGroups.has(groupId)) {
      await ensureGroup(db, groupId, sorted.map((id) => modIdByAsiId.get(id)));
      wantedGroups.add(groupId);
    }
    wantedLinks.add(`${dishIdByAsiItemId.get(asiItemId)}|${groupId}`);
  }

  const existingLinks = await queryRows(
    db,
    `SELECT id, in, out FROM menu_item_modifier_group
     WHERE string::starts_with(type::string(out), $prefix)`,
    { prefix: ASI_SET_GROUP_PREFIX },
  );
  /** @type {Set<string>} */
  const alreadyLinked = new Set();
  for (const row of existingLinks) {
    const key = `${recordIdString(row.in)}|${recordIdString(row.out)}`;
    if (wantedLinks.has(key) && !alreadyLinked.has(key)) {
      alreadyLinked.add(key);
      continue;
    }
    await queryRows(db, `DELETE $id`, { id: asRecord(row.id) });
  }
  for (const key of wantedLinks) {
    if (alreadyLinked.has(key)) continue;
    const [dishId, groupId] = key.split('|');
    await queryRows(
      db,
      `RELATE $dish->menu_item_modifier_group->$group SET
        priority = 0,
        has_required_modifiers = false,
        required_modifiers = 0`,
      { dish: asRecord(dishId), group: asRecord(groupId) },
    );
  }

  await queryRows(
    db,
    `UPDATE modifier_group SET deleted_at = time::now()
     WHERE string::starts_with(type::string(id), $prefix)
       AND deleted_at = NONE
       AND id NOTINSIDE $keep`,
    { prefix: ASI_SET_GROUP_PREFIX, keep: [...wantedGroups].map(asRecord) },
  );

  return { modifiers: allIds.length, itemsLinked: wantedLinks.size, groups: wantedGroups.size };
}

module.exports = {
  upsertModifiers,
  ASI_ALL_GROUP_ID,
};
