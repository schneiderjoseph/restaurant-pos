OPTION IMPORT;

-- ASI hotel-room sync (cUnit → floor_table on Chambres)

DEFINE FIELD asi_unit_id ON floor_table TYPE none | int | null PERMISSIONS FULL;
DEFINE INDEX floor_table_asi_unit_id ON floor_table FIELDS asi_unit_id;
