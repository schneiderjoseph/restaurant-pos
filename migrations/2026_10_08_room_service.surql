-- Room service (ASI item "Room Service", 390, untaxed): an "En chambre" order type next to
-- Sur place / À emporter, and a "Service chambre" extra tied to it. Choosing En chambre
-- shows the extra in the cart footer like the taxes; it is saved on the order when sent
-- (pre-bill) and kept at payment. Amount and name are edited in Manage > Extras.
-- Data only, idempotent: INSERT IGNORE leaves Manage edits alone on a re-run.

INSERT IGNORE INTO order_type { id: order_type:en_chambre, name: 'En chambre', priority: 3, allow_service_charges: false };

INSERT IGNORE INTO extra {
  id: extra:service_chambre,
  name: 'Service chambre',
  value: 390,
  order_types: [order_type:en_chambre],
  payment_types: [],
  tables: [],
  apply_to_all: false,
  delivery: false
};
