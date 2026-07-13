-- Enable pgvector extension for knowledge base embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================================
-- Business data tables (Single Source of Truth for analytics)
-- ==========================================================

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    role TEXT NOT NULL,
    hire_date DATE NOT NULL,
    salary NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    sold_at DATE NOT NULL,
    region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    subject TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    created_at DATE NOT NULL,
    resolved_at DATE
);

-- ==========================================================
-- Knowledge base vector store
-- ==========================================================

CREATE TABLE IF NOT EXISTS kb_documents (
    id SERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536), -- text-embedding-3-small dimension
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_file, chunk_index)
);

-- No ANN index (ivfflat/hnsw) for now: with only a handful of dummy documents,
-- an ivfflat index (which needs a decent number of rows per list to be useful)
-- degrades similarity search to near-zero recall. Exact sequential scan is both
-- correct and fast enough at this scale. Add an ivfflat/hnsw index once the
-- knowledge base grows into the thousands of chunks.

-- ==========================================================
-- Dummy data (for demo purposes)
-- ==========================================================

INSERT INTO employees (full_name, department, role, hire_date, salary) VALUES
    ('Ayu Lestari', 'Engineering', 'Backend Engineer', '2022-03-01', 15000000),
    ('Budi Santoso', 'Engineering', 'Frontend Engineer', '2021-07-15', 14000000),
    ('Citra Wulandari', 'Product', 'Product Manager', '2020-01-10', 22000000),
    ('Dimas Prakoso', 'Sales', 'Account Executive', '2023-02-20', 12000000),
    ('Eka Putri', 'HR', 'HR Generalist', '2019-11-05', 11000000),
    ('Fajar Nugroho', 'Engineering', 'DevOps Engineer', '2022-09-12', 16000000),
    ('Gita Ramadhani', 'Sales', 'Sales Manager', '2018-05-22', 25000000),
    ('Hendra Wijaya', 'Finance', 'Financial Analyst', '2021-01-18', 13000000)
ON CONFLICT DO NOTHING;

INSERT INTO sales (product_name, category, quantity, unit_price, sold_at, region) VALUES
    ('AI Assistant License', 'Software', 12, 5000000, '2026-01-15', 'Jakarta'),
    ('AI Assistant License', 'Software', 8, 5000000, '2026-02-10', 'Surabaya'),
    ('Data Analytics Add-on', 'Software', 5, 3000000, '2026-02-20', 'Jakarta'),
    ('AI Assistant License', 'Software', 20, 5000000, '2026-03-05', 'Bandung'),
    ('Onboarding Service', 'Service', 3, 10000000, '2026-03-18', 'Jakarta'),
    ('Data Analytics Add-on', 'Software', 10, 3000000, '2026-04-02', 'Surabaya'),
    ('AI Assistant License', 'Software', 15, 5000000, '2026-04-22', 'Jakarta'),
    ('Onboarding Service', 'Service', 4, 10000000, '2026-05-11', 'Bandung')
ON CONFLICT DO NOTHING;

INSERT INTO support_tickets (subject, status, priority, created_at, resolved_at) VALUES
    ('Cannot login to internal portal', 'resolved', 'high', '2026-05-01', '2026-05-01'),
    ('Knowledge base search returns no results', 'closed', 'medium', '2026-05-03', '2026-05-04'),
    ('Slow response from chatbot', 'in_progress', 'medium', '2026-06-10', NULL),
    ('Need access to Finance dashboard', 'open', 'low', '2026-06-15', NULL),
    ('Database connection timeout', 'resolved', 'critical', '2026-06-20', '2026-06-20')
ON CONFLICT DO NOTHING;

-- Read-only role used by the MCP query_database tool
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'readonly_bot') THEN
        CREATE ROLE readonly_bot LOGIN PASSWORD 'readonly_bot_password';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE knowledge_assistant TO readonly_bot;
GRANT USAGE ON SCHEMA public TO readonly_bot;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_bot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_bot;
