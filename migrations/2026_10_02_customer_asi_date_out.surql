-- ASI FrontDesk planned departure day on a stay (customer:asi_fd_{checkInID}),
-- written by asi-sync as "YYYY-MM-DD". Informational only: the POS shows
-- "departs today" at payment; ASI's check-out (in_house = false) is what blocks
-- a room charge. customer is SCHEMAFULL: apply before deploying asi-sync.

DEFINE FIELD IF NOT EXISTS asi_date_out ON customer TYPE none | string | null PERMISSIONS FULL;
