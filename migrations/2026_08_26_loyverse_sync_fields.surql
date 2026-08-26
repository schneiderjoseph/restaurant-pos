OPTION IMPORT;

-- Loyverse catalogue sync metadata (SCHEMAFULL category / menu_item / tax)

DEFINE FIELD source ON category TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON category TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON menu_item TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON menu_item TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_variant_id ON menu_item TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON tax TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON tax TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD guest_code ON customer TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON payment_type TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON payment_type TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON discount TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON discount TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON modifier_group TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON modifier_group TYPE none | string | null PERMISSIONS FULL;

DEFINE FIELD source ON modifier TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD loyverse_id ON modifier TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD price ON modifier TYPE none | float | null PERMISSIONS FULL;

DEFINE INDEX category_loyverse_id ON category FIELDS loyverse_id;
DEFINE INDEX menu_item_loyverse_variant_id ON menu_item FIELDS loyverse_variant_id;
DEFINE INDEX tax_loyverse_id ON tax FIELDS loyverse_id;
DEFINE INDEX customer_loyverse_id ON customer FIELDS loyverse_id;
DEFINE INDEX payment_type_loyverse_id ON payment_type FIELDS loyverse_id;
DEFINE INDEX discount_loyverse_id ON discount FIELDS loyverse_id;
DEFINE INDEX modifier_group_loyverse_id ON modifier_group FIELDS loyverse_id;
DEFINE INDEX modifier_loyverse_id ON modifier FIELDS loyverse_id;
