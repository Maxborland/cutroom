ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'editor';

ALTER TABLE auth_invites
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'editor';

ALTER TABLE auth_users
  DROP CONSTRAINT IF EXISTS auth_users_role_check;

ALTER TABLE auth_users
  ADD CONSTRAINT auth_users_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));

ALTER TABLE auth_invites
  DROP CONSTRAINT IF EXISTS auth_invites_role_check;

ALTER TABLE auth_invites
  ADD CONSTRAINT auth_invites_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'));

UPDATE auth_invites
SET role = 'owner'
WHERE invited_by_user_id IS NULL;

UPDATE auth_users
SET role = 'owner'
WHERE email IN (
  SELECT email
  FROM auth_invites
  WHERE invited_by_user_id IS NULL
);
