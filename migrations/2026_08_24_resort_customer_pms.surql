OPTION IMPORT;

-- Resort / PMS guest fields on customer (SCHEMAFULL)
-- Prefer migrations/2026_08_24_asi_guest_fields.surql for full ASI FD mapping.

DEFINE FIELD guest_code ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD room ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD in_house ON customer TYPE none | bool | null PERMISSIONS FULL;
DEFINE FIELD asi_guest_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD asi_checkin_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD asi_folio_no ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_unit_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD source ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_synced_at ON customer TYPE none | datetime | null PERMISSIONS FULL;

DEFINE INDEX customer_guest_code ON customer FIELDS guest_code;
DEFINE INDEX customer_asi_guest_id ON customer FIELDS asi_guest_id;
DEFINE INDEX customer_asi_checkin_id ON customer FIELDS asi_checkin_id;
DEFINE INDEX customer_room ON customer FIELDS room;
