CREATE TABLE IF NOT EXISTS workspace_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  country TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','contacted','negotiating','sample','approved','rejected')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_suppliers_updated_at_idx ON workspace_suppliers(updated_at DESC);
CREATE INDEX IF NOT EXISTS workspace_suppliers_name_idx ON workspace_suppliers(name);

CREATE TABLE IF NOT EXISTS workspace_clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  city TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','contacted','follow_up','customer','inactive')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_clinics_updated_at_idx ON workspace_clinics(updated_at DESC);
CREATE INDEX IF NOT EXISTS workspace_clinics_name_idx ON workspace_clinics(name);

CREATE TABLE IF NOT EXISTS workspace_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('supplier','clinic')),
  entity_id UUID NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_activities_entity_idx ON workspace_activities(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_activities_due_idx ON workspace_activities(due_at) WHERE completed_at IS NULL;
