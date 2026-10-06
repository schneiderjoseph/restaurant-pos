-- Station accounts: one user per station (user.kitchen), signed in on the station's
-- tablet. The "Station" role opens the station screen only, and that screen shows the
-- account's own station only. The accounts themselves (with a free PIN each) are created
-- by the app: Manage > Stations gives one to every station that has none.
-- Idempotent (update-asi-prod.ps1 re-runs it on every update).

DEFINE FIELD IF NOT EXISTS kitchen ON user TYPE none | record<kitchen> | null PERMISSIONS FULL;

INSERT IGNORE INTO user_role { id: user_role:station, name: 'Station', roles: ['kitchen'] };
