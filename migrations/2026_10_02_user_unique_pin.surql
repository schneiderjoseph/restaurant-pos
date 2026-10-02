-- A PIN identifies one person: the app signs people in by PIN first, and for a
-- PIN user `login` IS the PIN. Two active users may not share a login.
-- Soft-deleted users release their login, so a PIN can be given to someone new.
--
-- A unique index on (login, deleted_at) does not work: rows whose deleted_at is
-- NONE are left out of a composite index. active_login holds the login only while
-- the user is active, and the unique index sits on it.
--
-- No transaction: an index defined in the same transaction as the backfill
-- misses the backfilled rows. If active users already share a login, the THROW
-- lists them and DEFINE INDEX fails without creating anything: change those
-- PINs under Manage > Users, then re-run. Idempotent (update-asi-prod.ps1
-- re-runs it on every update).

-- Duplicates are found without GROUP BY: on SurrealDB 3.0.x a GROUP BY turns
-- first_name / last_name into per-group arrays, and array::group() then fails
-- on the concatenated string. The message names the people, never the shared
-- login: for a PIN user the login is the PIN.
LET $active = (
  SELECT login, first_name, last_name FROM user
  WHERE deleted_at = NONE OR deleted_at = NULL
);
LET $logins = $active.map(|$u| $u.login);
LET $duplicates = array::distinct($logins.filter(|$l| array::len($logins.filter(|$m| $m = $l)) > 1));

IF array::len($duplicates) > 0 {
  THROW string::concat(
    'Active users share a login/PIN, fix them before re-running: ',
    array::join(
      $duplicates.map(|$l| array::join(
        $active.filter(|$u| $u.login = $l).map(|$u| string::trim(string::concat($u.first_name ?? '', ' ', $u.last_name ?? ''))),
        ' / '
      )),
      '; '
    )
  );
};

DEFINE FIELD IF NOT EXISTS active_login ON user TYPE option<string>
  VALUE IF deleted_at = NONE OR deleted_at = NULL { login } ELSE { NONE }
  PERMISSIONS FULL;

UPDATE user SET active_login = NONE
  WHERE active_login = NONE AND (deleted_at = NONE OR deleted_at = NULL);

DEFINE INDEX IF NOT EXISTS user_active_login_unique ON user FIELDS active_login UNIQUE;
