CREATE TABLE wardrobe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  photo bytea NOT NULL CHECK (octet_length(photo) BETWEEN 1 AND 2097152),
  photo_version integer NOT NULL DEFAULT 1 CHECK (photo_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wardrobe_items_household ON wardrobe_items(household_id, created_at, id);
