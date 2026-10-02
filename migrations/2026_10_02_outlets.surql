-- Points of sale (outlets): Bar, Restaurant, … Not the HR `department` table.
-- Set on top-level categories (sub-categories inherit through `parent`), optionally on
-- kitchens to suggest a category's outlet, and copied onto each order line when sold
-- (outlet_id + outlet name) so sales reports split by outlet without moving past sales
-- when a category is reclassified.

DEFINE TABLE IF NOT EXISTS outlet TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON outlet TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS priority ON outlet TYPE int DEFAULT 0 PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS color ON outlet TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS deleted_at ON outlet TYPE none | datetime | null PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS outlet ON category TYPE none | record<outlet> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS outlet ON kitchen TYPE none | record<outlet> | null PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS outlet ON order_item TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS outlet_id ON order_item TYPE none | record<outlet> | string | null PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS order_item_outlet_id ON order_item FIELDS outlet_id;

INSERT IGNORE INTO outlet [
  { id: outlet:bar, name: 'Bar', priority: 1 },
  { id: outlet:restaurant, name: 'Restaurant', priority: 2 }
];
