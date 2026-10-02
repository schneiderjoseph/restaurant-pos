-- Username/password ("form") login was removed: a PIN is the only way to sign in.
-- An active user still on login_method 'form' could no longer sign in, so the
-- update stops here and lists them. Give each one a 4-digit PIN under
-- Manage > Users (saving the user converts it to PIN), then re-run.
-- Read-only and idempotent (update-asi-prod.ps1 re-runs it on every update).

LET $form_users = (
  SELECT login, string::concat(first_name, ' ', last_name) AS name
  FROM user
  WHERE login_method = 'form' AND (deleted_at = NONE OR deleted_at = NULL)
);

IF array::len($form_users) > 0 {
  THROW string::concat(
    'Active users still sign in with a password, give them a PIN before re-running: ',
    <string>$form_users.map(|$u| string::concat($u.name, ' (', $u.login, ')'))
  );
};
