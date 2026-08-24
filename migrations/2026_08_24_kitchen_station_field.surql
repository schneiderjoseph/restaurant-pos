OPTION IMPORT;

-- Resort F&B: tag kitchens as Cuisine (KDS) or Bar (BDS)

DEFINE FIELD station ON kitchen TYPE none | string | null PERMISSIONS FULL;
