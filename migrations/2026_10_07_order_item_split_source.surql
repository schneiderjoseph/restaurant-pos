-- Split by amount re-creates every line on each split order, at a share of its price.
-- split_source: the original line the kitchen still cooks; the split orders follow its
-- kitchen tickets (ready / not ready). split_share: the share of the line's units the copy
-- stands for, so item reports count 2 burgers split in two as 2, not 4.
-- NONE = an ordinary line. order_item is SCHEMAFULL: apply before deploying the SPA, or
-- splitting by amount fails. Idempotent.

DEFINE FIELD IF NOT EXISTS split_source ON order_item TYPE none | record<order_item> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS split_share ON order_item TYPE none | float | null PERMISSIONS FULL;
