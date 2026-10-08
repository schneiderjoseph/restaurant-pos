-- Shared anonymous cash guest = the existing walk-in named CASH (kept).
-- Folds an older customer:libre_anonymes_cash into CASH when present.
-- Idempotent: safe to re-run.

UPDATE customer SET
  tags = array::union(tags ?? [], ['walk-in', 'anonymous', 'cash']),
  notes = 'Client partagé pour les clients anonymes payant cash.'
WHERE deleted_at = NONE
  AND merged_into = NONE
  AND string::uppercase(name ?? '') = 'CASH';

UPDATE customer:libre_anonymes_cash SET
  merged_into = (
    SELECT VALUE id FROM customer
    WHERE deleted_at = NONE
      AND merged_into = NONE
      AND string::uppercase(name ?? '') = 'CASH'
    LIMIT 1
  )[0],
  deleted_at = deleted_at ?? time::now(),
  deleted_reason = 'merged',
  guest_code = NONE
WHERE merged_into = NONE OR deleted_at = NONE;

UPDATE order SET customer = (
  SELECT VALUE id FROM customer
  WHERE deleted_at = NONE
    AND merged_into = NONE
    AND string::uppercase(name ?? '') = 'CASH'
  LIMIT 1
)[0]
WHERE customer = customer:libre_anonymes_cash;
