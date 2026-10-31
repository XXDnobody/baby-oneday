CREATE TABLE pantry_snapshots (
  household_id uuid PRIMARY KEY REFERENCES households(id),
  items jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1,
  confirmed_at timestamptz,
  updated_by uuid REFERENCES users(id)
);
CREATE TABLE recent_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK (kind IN ('like','avoid','note')),
  scope text NOT NULL CHECK (scope IN ('meal','activity','all')),
  text text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  ended boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX preferences_family_dates ON recent_preferences(household_id, starts_on, ends_on);
CREATE TABLE content_settings (
  household_id uuid PRIMARY KEY REFERENCES households(id),
  revision integer NOT NULL DEFAULT 1
);
CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK (kind IN ('recipe','activity')),
  current_version integer NOT NULL DEFAULT 1,
  enabled_version integer,
  revision integer NOT NULL DEFAULT 1,
  import_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  UNIQUE (household_id, import_key)
);
CREATE TABLE content_versions (
  household_id uuid NOT NULL,
  content_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, content_id, version),
  FOREIGN KEY (household_id, content_id) REFERENCES content_items(household_id, id)
);
ALTER TABLE content_items ADD CONSTRAINT enabled_content_version FOREIGN KEY (household_id,id,enabled_version) REFERENCES content_versions(household_id,content_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE content_import_results (
  household_id uuid NOT NULL REFERENCES households(id),
  import_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('imported','failed')),
  content_id uuid,
  error text,
  attempts integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, import_key),
  FOREIGN KEY (household_id, content_id) REFERENCES content_items(household_id, id)
);
ALTER TABLE plan_items
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  ADD COLUMN scene text NOT NULL DEFAULT 'either' CHECK (scene IN ('indoor','outdoor','either')),
  ADD COLUMN content_id uuid,
  ADD COLUMN content_version integer,
  ADD COLUMN content_snapshot jsonb,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES users(id),
  ADD COLUMN restore_until timestamptz,
  ADD CONSTRAINT item_content_version FOREIGN KEY (household_id,content_id,content_version) REFERENCES content_versions(household_id,content_id,version),
  ADD CONSTRAINT paired_content CHECK ((content_id IS NULL) = (content_version IS NULL)),
  ADD CONSTRAINT paired_item_deletion CHECK ((deleted_at IS NULL) = (restore_until IS NULL));
CREATE TABLE activity_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  child_id uuid NOT NULL,
  occurred_on date NOT NULL,
  occurred_time text CHECK (occurred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  text text NOT NULL DEFAULT '',
  participation text CHECK (participation IN ('joined','partial','not_joined')),
  interest text CHECK (interest IN ('interested','neutral','not_interested')),
  author_id uuid NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  plan_item_id uuid,
  plan_snapshot jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id),
  restore_until timestamptz,
  UNIQUE (household_id,id),
  FOREIGN KEY (household_id,child_id) REFERENCES children(household_id,id),
  FOREIGN KEY (household_id,child_id,plan_item_id) REFERENCES plan_items(household_id,child_id,id),
  CHECK ((deleted_at IS NULL) = (restore_until IS NULL))
);
CREATE INDEX records_calendar ON activity_records(household_id,occurred_on,id);
CREATE TABLE record_revisions (
  household_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  correction_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id,record_id,revision),
  FOREIGN KEY (household_id,record_id) REFERENCES activity_records(household_id,id)
);
CREATE TABLE business_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL,
  revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE print_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  snapshot jsonb NOT NULL,
  source_item_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
