-- Loyverse JSON mirror + sync cursors (isolated loyverse/loyverse DB)

DEFINE TABLE loyverse_mirror TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD resource ON loyverse_mirror TYPE string PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON loyverse_mirror TYPE string PERMISSIONS FULL;
DEFINE FIELD payload ON loyverse_mirror TYPE any PERMISSIONS FULL;
DEFINE FIELD api_updated_at ON loyverse_mirror TYPE option<datetime> PERMISSIONS FULL;
DEFINE FIELD deleted_at ON loyverse_mirror TYPE option<datetime> PERMISSIONS FULL;
DEFINE FIELD synced_at ON loyverse_mirror TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE INDEX loyverse_mirror_resource_id ON loyverse_mirror FIELDS resource, loyverse_id UNIQUE;

DEFINE TABLE loyverse_sync_state TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD resource ON loyverse_sync_state TYPE string PERMISSIONS FULL;
DEFINE FIELD cursor ON loyverse_sync_state TYPE option<string> PERMISSIONS FULL;
DEFINE FIELD backfill_complete ON loyverse_sync_state TYPE bool DEFAULT false PERMISSIONS FULL;
DEFINE FIELD last_error ON loyverse_sync_state TYPE option<string> PERMISSIONS FULL;
DEFINE FIELD stats ON loyverse_sync_state TYPE any DEFAULT {} PERMISSIONS FULL;
DEFINE FIELD window_start ON loyverse_sync_state TYPE option<datetime> PERMISSIONS FULL;
DEFINE FIELD window_end ON loyverse_sync_state TYPE option<datetime> PERMISSIONS FULL;
DEFINE FIELD last_synced_at ON loyverse_sync_state TYPE option<datetime> PERMISSIONS FULL;
DEFINE INDEX loyverse_sync_state_resource ON loyverse_sync_state FIELDS resource UNIQUE;

DEFINE FIELD loyverse_receipt_number ON order TYPE none | string | null PERMISSIONS FULL;
DEFINE INDEX order_loyverse_receipt_number ON order FIELDS loyverse_receipt_number;
