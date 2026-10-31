-- Body-free recovery controls. Export a signed checkpoint separately from dumps.
CREATE TABLE recovery_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO recovery_identity(singleton) VALUES (true);
CREATE TABLE recovery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  household_id uuid,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION record_recovery_control() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_control jsonb; after_control jsonb;
BEGIN
  IF TG_TABLE_NAME IN ('plan_items','activity_records') THEN
    before_control := jsonb_build_object('deleted_at',OLD.deleted_at,'restore_until',OLD.restore_until,'body_purged_at',OLD.body_purged_at);
    after_control := jsonb_build_object('deleted_at',NEW.deleted_at,'restore_until',NEW.restore_until,'body_purged_at',NEW.body_purged_at);
  ELSIF TG_TABLE_NAME='memberships' THEN
    before_control := jsonb_build_object('role',OLD.role,'revoked_at',OLD.revoked_at);
    after_control := jsonb_build_object('role',NEW.role,'revoked_at',NEW.revoked_at);
  ELSIF TG_TABLE_NAME='users' THEN
    before_control := jsonb_build_object('credential_version',OLD.credential_version,'disabled_at',OLD.disabled_at);
    after_control := jsonb_build_object('credential_version',NEW.credential_version,'disabled_at',NEW.disabled_at);
  ELSE
    before_control := jsonb_build_object('revoked_at',OLD.revoked_at);
    after_control := jsonb_build_object('revoked_at',NEW.revoked_at);
  END IF;
  IF before_control IS DISTINCT FROM after_control THEN
    INSERT INTO recovery_events(resource_type,resource_id,household_id,before_state,after_state)
    VALUES (TG_TABLE_NAME,NEW.id,CASE WHEN TG_TABLE_NAME IN ('users','sessions') THEN NULL ELSE (to_jsonb(NEW)->>'household_id')::uuid END,before_control,after_control);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_item_control AFTER UPDATE ON plan_items FOR EACH ROW EXECUTE FUNCTION record_recovery_control();
CREATE TRIGGER recovery_record_control AFTER UPDATE ON activity_records FOR EACH ROW EXECUTE FUNCTION record_recovery_control();
CREATE TRIGGER recovery_member_control AFTER UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION record_recovery_control();
CREATE TRIGGER recovery_user_control AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION record_recovery_control();
CREATE TRIGGER recovery_session_control AFTER UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION record_recovery_control();
