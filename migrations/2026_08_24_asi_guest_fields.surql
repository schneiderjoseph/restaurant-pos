OPTION IMPORT;

-- ASI FrontDesk guest sync fields on customer (SCHEMAFULL)
-- Aligns with asi-sync guest-upsert: customer:asi_fd_{checkInID}

DEFINE FIELD OVERWRITE guest_code ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE room ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE in_house ON customer TYPE none | bool | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE asi_guest_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE asi_checkin_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE asi_folio_no ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE asi_unit_id ON customer TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE source ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD OVERWRITE asi_synced_at ON customer TYPE none | datetime | null PERMISSIONS FULL;

DEFINE INDEX OVERWRITE customer_guest_code ON customer FIELDS guest_code;
DEFINE INDEX OVERWRITE customer_asi_checkin_id ON customer FIELDS asi_checkin_id;
DEFINE INDEX OVERWRITE customer_asi_guest_id ON customer FIELDS asi_guest_id;
DEFINE INDEX OVERWRITE customer_room ON customer FIELDS room;
