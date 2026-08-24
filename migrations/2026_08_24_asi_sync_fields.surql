OPTION IMPORT;

-- ASI menu sync metadata (SCHEMAFULL category / menu_item)

DEFINE FIELD source ON category TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_group_id ON category TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD asi_alias ON category TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON menu_item TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_item_id ON menu_item TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD asi_alias ON menu_item TYPE none | string | null PERMISSIONS FULL;

-- Application enforces ASI-{id} uniqueness; avoid UNIQUE (legacy empty numbers).
DEFINE INDEX menu_item_number ON menu_item FIELDS number;
DEFINE INDEX menu_item_asi_item_id ON menu_item FIELDS asi_item_id;
DEFINE INDEX category_asi_group_id ON category FIELDS asi_group_id;
