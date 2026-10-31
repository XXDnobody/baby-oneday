-- Keep detailed one-off AI recipes with the selected plan, independently of
-- private conversations and the household's reviewed content library.
ALTER TABLE plan_items ADD COLUMN ai_suggestion jsonb;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_ai_suggestion_object
  CHECK (ai_suggestion IS NULL OR jsonb_typeof(ai_suggestion)='object');
