CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1,
  can_create_household boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  credential_version integer NOT NULL,
  remembered boolean NOT NULL,
  device text NOT NULL,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE bootstrap_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  token_hash text NOT NULL UNIQUE,
  consumed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  setup_complete boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  revision integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id),
  UNIQUE (household_id, id)
);
CREATE TABLE children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL UNIQUE REFERENCES households(id),
  name text NOT NULL,
  birth_date date,
  age_months integer CHECK (age_months BETWEEN 0 AND 216),
  age_as_of date NOT NULL,
  food_status text NOT NULL CHECK (food_status IN ('unknown', 'none', 'restricted')),
  food_restrictions text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (household_id, id),
  CHECK (birth_date IS NOT NULL OR age_months IS NOT NULL),
  CHECK (food_status <> 'restricted' OR length(trim(food_restrictions)) > 0)
);
CREATE TABLE household_templates (
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK (kind IN ('weekday', 'weekend')),
  slots jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (household_id, kind)
);
CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_by uuid NOT NULL REFERENCES users(id),
  accepted_by uuid REFERENCES users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_key text NOT NULL,
  grant_kind text NOT NULL CHECK (grant_kind IN ('bootstrap', 'invite')),
  grant_id uuid NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  ticket_hash text UNIQUE,
  ticket_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX challenges_email ON email_challenges(email_key, created_at DESC);
CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  credential_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  window_start timestamptz NOT NULL
);
CREATE TABLE daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  child_id uuid NOT NULL,
  plan_date date NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, child_id, plan_date),
  UNIQUE (household_id, child_id, id),
  FOREIGN KEY (household_id, child_id) REFERENCES children(household_id, id)
);
CREATE TABLE plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  child_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meal', 'activity', 'routine')),
  title text NOT NULL,
  time text NOT NULL CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  notes text NOT NULL DEFAULT '',
  caregiver_id uuid,
  caregiver_name text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  protected boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, child_id, id),
  FOREIGN KEY (household_id, child_id, plan_id) REFERENCES daily_plans(household_id, child_id, id),
  FOREIGN KEY (household_id, caregiver_id) REFERENCES memberships(household_id, id)
);
CREATE INDEX items_plan ON plan_items(household_id, plan_id, time);
CREATE TABLE plan_item_versions (
  household_id uuid NOT NULL,
  child_id uuid NOT NULL,
  plan_item_id uuid NOT NULL,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, child_id, plan_item_id, revision),
  FOREIGN KEY (household_id, child_id, plan_item_id) REFERENCES plan_items(household_id, child_id, id)
);
CREATE TABLE household_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_household ON household_events(household_id, id);
CREATE TABLE idempotency_requests (
  user_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);
