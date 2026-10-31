-- Keep the original free text alongside structured entries. Old records are
-- presented for classification by the application without guessing their type.
ALTER TABLE children ADD COLUMN food_restriction_items jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(food_restriction_items) = 'array');
