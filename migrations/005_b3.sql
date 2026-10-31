ALTER TABLE plan_items DROP CONSTRAINT plan_items_source_check;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_source_check CHECK (source IN ('manual','automatic','ai'));
CREATE TABLE plan_slot_guards (
  household_id uuid NOT NULL,
  child_id uuid NOT NULL,
  plan_date date NOT NULL,
  time text NOT NULL,
  PRIMARY KEY (household_id,child_id,plan_date,time),
  FOREIGN KEY (household_id,child_id) REFERENCES children(household_id,id)
);
INSERT INTO plan_slot_guards SELECT DISTINCT i.household_id,i.child_id,p.plan_date,i.time FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id;
CREATE FUNCTION protect_plan_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.protected OR NEW.source IN ('manual','ai') OR NEW.deleted_at IS NOT NULL OR NEW.status='cancelled' THEN
    INSERT INTO plan_slot_guards SELECT NEW.household_id,NEW.child_id,plan_date,NEW.time FROM daily_plans WHERE id=NEW.plan_id ON CONFLICT DO NOTHING;
    IF TG_OP='UPDATE' THEN
      INSERT INTO plan_slot_guards SELECT OLD.household_id,OLD.child_id,plan_date,OLD.time FROM daily_plans WHERE id=OLD.plan_id ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_plan_slot AFTER INSERT OR UPDATE ON plan_items FOR EACH ROW EXECUTE FUNCTION protect_plan_slot();

CREATE TABLE household_automation (
  household_id uuid PRIMARY KEY REFERENCES households(id),
  enabled boolean NOT NULL DEFAULT false,
  run_time text NOT NULL DEFAULT '20:00' CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  revision integer NOT NULL DEFAULT 1,
  configured_by uuid REFERENCES users(id)
);
CREATE TABLE weather_locations (
  household_id uuid PRIMARY KEY REFERENCES households(id),
  label text NOT NULL,
  latitude numeric(5,2) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(5,2) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  provenance text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  confirmed_by uuid NOT NULL REFERENCES users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE weather_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  location_revision integer NOT NULL,
  location jsonb NOT NULL,
  provider text NOT NULL,
  product text NOT NULL CHECK (product IN ('current','hourly')),
  state text NOT NULL,
  reason text NOT NULL DEFAULT '',
  valid_from timestamptz,
  valid_to timestamptz,
  provider_time timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  stale_after timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  data jsonb,
  attributions jsonb NOT NULL DEFAULT '[]',
  source_url text NOT NULL,
  test_service boolean NOT NULL DEFAULT false
);
CREATE INDEX weather_family_product ON weather_snapshots(household_id,location_revision,product,fetched_at DESC);
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  from_date date NOT NULL,
  to_date date NOT NULL CHECK (to_date>=from_date AND to_date-from_date<=30),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id,owner_id,id)
);
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  turn integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  text text NOT NULL,
  dependency_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id,turn,role),
  FOREIGN KEY(household_id,owner_id,conversation_id) REFERENCES ai_conversations(household_id,owner_id,id)
);
CREATE TABLE b3_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK (kind IN ('automatic','ai','weather')),
  owner_id uuid REFERENCES users(id),
  conversation_id uuid,
  business_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','retry','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  error_code text,
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((kind='ai')=(owner_id IS NOT NULL AND conversation_id IS NOT NULL)),
  FOREIGN KEY(household_id,owner_id,conversation_id) REFERENCES ai_conversations(household_id,owner_id,id)
);
CREATE INDEX b3_jobs_ready ON b3_jobs(state,available_at);
CREATE TABLE change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  turn integer NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','superseded','executed')),
  operations jsonb NOT NULL,
  preview jsonb NOT NULL,
  dependency_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id,turn),
  UNIQUE(household_id,owner_id,id),
  FOREIGN KEY(household_id,owner_id,conversation_id) REFERENCES ai_conversations(household_id,owner_id,id)
);
CREATE TABLE proposal_executions (
  proposal_id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  result jsonb NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(household_id,owner_id,proposal_id) REFERENCES change_proposals(household_id,owner_id,id)
);
CREATE TABLE service_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  owner_id uuid REFERENCES users(id),
  job_id uuid REFERENCES b3_jobs(id),
  lease_token uuid,
  service text NOT NULL CHECK (service IN ('weather','ai')),
  provider text NOT NULL,
  model text,
  region text,
  test_service boolean NOT NULL,
  state text NOT NULL DEFAULT 'started',
  reserved_tokens integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  usage_known boolean NOT NULL DEFAULT false,
  cost numeric,
  currency text,
  duration_ms integer,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX service_daily_usage ON service_calls(service,provider,started_at);
