OPTION IMPORT;

-- ASI dining-table sync metadata (SCHEMAFULL floor_table)

DEFINE FIELD source ON floor_table TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_table_id ON floor_table TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD asi_alias ON floor_table TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD asi_synced_at ON floor_table TYPE none | datetime | null PERMISSIONS FULL;

DEFINE INDEX floor_table_asi_table_id ON floor_table FIELDS asi_table_id;
DEFINE INDEX floor_table_source ON floor_table FIELDS source;
