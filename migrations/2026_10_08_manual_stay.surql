-- Manual Front Desk stays (POS, outside ASI).
-- stay is the event; customer.source is never changed.
-- open_room_key UNIQUE blocks concurrent manual check-ins on the same room.
-- customer / order_payment are SCHEMAFULL: fields must be defined before SPA writes.

DEFINE TABLE IF NOT EXISTS stay TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD IF NOT EXISTS customer ON stay TYPE record<customer> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room ON stay TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room_key ON stay TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS date_in ON stay TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS date_out ON stay TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS status ON stay TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS checked_in_by ON stay TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS checked_in_at ON stay TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS checked_out_by ON stay TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS checked_out_at ON stay TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room_total_at_checkout ON stay TYPE none | float | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room_settled_at ON stay TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room_settled_by ON stay TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS settled_amount ON stay TYPE none | float | null PERMISSIONS FULL;

-- Unique among open stays only; closed stays get NONE so history can share a room.
DEFINE FIELD OVERWRITE open_room_key ON stay VALUE
  IF status = 'open' AND room_key != NONE AND room_key != NULL AND room_key != ''
  { room_key } ELSE { NONE }
PERMISSIONS FULL;

DEFINE INDEX IF NOT EXISTS stay_open_room_key ON stay FIELDS open_room_key UNIQUE;
DEFINE INDEX IF NOT EXISTS stay_customer ON stay FIELDS customer;
DEFINE INDEX IF NOT EXISTS stay_status ON stay FIELDS status;

DEFINE FIELD IF NOT EXISTS current_stay ON customer TYPE none | record<stay> | null PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS stay ON order_payment TYPE none | record<stay> | null PERMISSIONS FULL;

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

-- One-shot: Front Desk role with check-in/out/move + customer registry, no menu/orders/cashier.
IF array::len(SELECT name FROM _schema_migration WHERE name = 'manual_stay_frontdesk_role') = 0 {
  LET $existing = SELECT id FROM user_role WHERE name = 'Front Desk' AND deleted_at = NONE LIMIT 1;
  IF array::len($existing) = 0 {
    CREATE user_role SET
      name = 'Front Desk',
      roles = [
        'frontdesk',
        'frontdesk.checkin',
        'frontdesk.checkout',
        'frontdesk.move',
        'customers.create',
        'customers.preferences',
        'customers.view_phone',
        'customers.view_id_document'
      ],
      priority = 50;
  } ELSE {
    UPDATE user_role
    SET roles = array::union(roles ?? [], [
      'frontdesk',
      'frontdesk.checkin',
      'frontdesk.checkout',
      'frontdesk.move',
      'customers.create',
      'customers.preferences',
      'customers.view_phone',
      'customers.view_id_document'
    ])
    WHERE name = 'Front Desk' AND deleted_at = NONE;
  };
  CREATE _schema_migration SET name = 'manual_stay_frontdesk_role', note = 'Front Desk role for manual stays';
};
