-- Personal AI assistant: tenant-scoped conversations, memory, tasks and agent telemetry.
-- Apply after 004_operations.sql. No external side effects are enabled by this migration.

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Percakapan baru' CHECK (char_length(title) BETWEEN 1 AND 180),
  channel TEXT NOT NULL DEFAULT 'workspace' CHECK (channel IN ('workspace','telegram','whatsapp','discord','api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_conversations_actor_updated_idx
  ON assistant_conversations(actor, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','agent','system')),
  agent_name TEXT,
  content TEXT NOT NULL CHECK (char_length(content) <= 24000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_messages_conversation_created_idx
  ON assistant_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS assistant_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('preference','project','workflow','fact','general')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_memories_actor_updated_idx
  ON assistant_memories(actor, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  schedule_at TIMESTAMPTZ,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_tasks_actor_status_idx
  ON assistant_tasks(actor, status, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  conversation_id UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_agent_runs_actor_created_idx
  ON assistant_agent_runs(actor, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assistant_approvals_actor_status_idx
  ON assistant_approvals(actor, status, created_at DESC);
