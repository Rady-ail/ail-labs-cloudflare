CREATE TABLE IF NOT EXISTS product_interest(id TEXT PRIMARY KEY,session_id TEXT,product_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversion_events(id TEXT PRIMARY KEY,session_id TEXT,event_type TEXT NOT NULL,country TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS market_campaigns(id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT,start_at TEXT,end_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS supplier_quotes(id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES suppliers(id),product_id TEXT REFERENCES products(id),moq INTEGER,unit_price REAL,currency TEXT,lead_time_days INTEGER,incoterm TEXT,payment_terms TEXT,landed_cost REAL,score REAL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
-- TODO Phase 3: R2 documents, compliance completeness, supplier score, landed cost.
-- TODO Phase 4: campaign, hourly traffic and category popularity.
-- GOLDEN RULE: BUY/PAY locked until lab_test_result = YES.