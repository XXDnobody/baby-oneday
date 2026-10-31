ALTER TABLE plan_items ADD COLUMN body_purged_at timestamptz;
ALTER TABLE activity_records ADD COLUMN body_purged_at timestamptz;
ALTER TABLE print_snapshots ADD COLUMN body_purged_at timestamptz;
