CREATE TABLE household_agreements (
  household_id uuid PRIMARY KEY REFERENCES households(id),
  items jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
