-- Optional KDS board that displays every ticket (expo / pass).
-- Station kitchens still own dishes exclusively via `items`.
DEFINE FIELD OVERWRITE shows_all ON kitchen TYPE bool DEFAULT false PERMISSIONS FULL;
UPDATE kitchen SET shows_all = false WHERE shows_all = none OR shows_all = NULL;
