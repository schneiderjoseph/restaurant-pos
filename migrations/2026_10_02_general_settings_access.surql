-- Establishment-wide settings (currency, restaurant profile, closing cycle, ...)
-- moved from the Settings screen to a Manage tab gated by admin.general_settings.
-- Only the Master role gets it; grant it to other roles from the role editor.
-- Idempotent: array::union leaves the role unchanged once the code is there.

UPDATE user_role
SET roles = array::union(roles ?? [], ['admin.general_settings'])
WHERE name = 'Master';
