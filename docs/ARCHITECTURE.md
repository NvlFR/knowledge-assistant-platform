# Architecture / Technical Design Document

## Internal Company AI Assistant Platform

**Author:** Noval Faturrahman
**Date:** 2026-07-13
**Version:** 1.0

---

## 1. Overview

This document describes the architecture of a web-based AI Chatbot Platform that serves as an
Internal Company Assistant. The system answers employee questions using two internal sources
of truth a markdown-based Knowledge Base (SOPs, internal docs) and a PostgreSQL database
holding company business data and can additionally reach out to the public internet via a
Web Search tool when internal knowledge is insufficient.

The design follows a **Retrieval-Augmented Generation (RAG) + Tool-Calling agent** pattern: an
LLM orchestrator decides, per user query, whether to retrieve from the knowledge base, query
the structured database, search the web, or combine several of these, then synthesizes a final
answer.

---

## 2. Goals & Non-Goals

**Goals**
- Answer natural-language questions grounded in internal SOP/knowledge documents.
- Answer natural-language questions about structured business data in PostgreSQL (data
  analytics / decision support), without requiring users to write SQL.
- Fall back to live web search for questions outside internal knowledge.
- Be fully containerized and reproducible via `docker-compose`.

**Non-Goals**
- Multi-tenant / multi-company support (single internal company scope).
- Fine-tuning or hosting our own LLM (we consume a hosted LLM API).
- Write access to the business database (the assistant is read-only for safety).

---

## 3. High-Level Architecture

```
                         HTTPS (REST)               SSE (token streaming)
        ┌─────────────┐ ───────────────────────────────────────────▶ ┌──────────────────────┐
        │   Frontend   │                                              │      Backend API       │
        │  (Next.js)   │ ◀─────────────────────────────────────────── │   (Python / FastAPI)   │
        └─────────────┘                                              └──────────┬────────────┘
                                                                                  │
                                        ┌─────────────────────────────────────────┼──────────────────────────────┐
                                        │                                         │                              │
                                 ┌──────▼───────┐                       ┌─────────▼─────────┐          ┌─────────▼─────────┐
                                 │  PostgreSQL   │                      │     MCP Server      │          │        Redis        │
                                 │  + pgvector   │                      │  (tool layer, MCP)  │          │  cache + job queue  │
                                 │ (business data│                      │ - query_database    │          └─────────┬─────────┘
                                 │ + doc vectors)│                      │ - search_knowledge   │                    │
                                 └──────▲────────┘                      │ - web_search         │           ┌────────▼────────┐
                                        │                                └─────────┬───────────┘           │  Async Worker    │
                                        │                                          │                        │ (doc ingestion,  │
                                        │                                ┌─────────▼───────────┐            │  chunk + embed)  │
                                        └────────────────────────────────┤   External Services   │◀─────────┘
                                                                          │  - OpenAI API (LLM)   │
                                                                          │  - Tavily API (search)│
                                                                          └───────────────────────┘
```

---

## 4. Components

### 4.1 Web Frontend - Next.js (MANDATORY)

- Chat UI with streaming responses (token-by-token) for a natural conversational feel.
- Renders answer citations (which document / which SQL query / which web source was used),
  so users can trust and verify the assistant's answers.
- **Why Next.js:** App Router supports React Server Components and streaming out of the box,
  which pairs naturally with SSE-based chat responses. It's also one of the frameworks
  preferred by the test brief and has the largest ecosystem for fast iteration.

### 4.2 Backend API - Python (FastAPI) (MANDATORY)

- Central orchestrator. Responsibilities:
  1. Receive chat requests from the frontend (REST endpoint).
  2. Maintain conversation state/history.
  3. Call the LLM (OpenAI) with the user's message and the available **tools** (exposed via
     the MCP server).
  4. Let the LLM decide which tool(s) to call knowledge base search, database query, or web
     search execute those tool calls through the MCP client, feed results back to the LLM.
  5. Stream the final synthesized answer back to the frontend over Server-Sent Events (SSE).
- **Why FastAPI/Python:** Python has the richest ecosystem for RAG/agent orchestration
  (official OpenAI SDK, official Anthropic MCP SDK, embedding/text-splitting libraries).
  FastAPI natively supports async I/O and SSE streaming, which is required for a responsive
  chat experience while waiting on LLM/tool latency.

### 4.3 Database - PostgreSQL + pgvector (MANDATORY)

A single PostgreSQL instance serves two roles:

1. **System of record for business data** the "big data" the company already stores
   (e.g. sales, orders, inventory tables). Used as the Single Source of Truth for
   analytics-style questions.
2. **Vector store for the Knowledge Base** using the `pgvector` extension, markdown
   documents (SOPs, internal docs) are chunked, embedded, and stored as vectors in the same
   Postgres instance for semantic similarity search.

- **Why one Postgres instead of a dedicated vector DB (e.g. Qdrant/Weaviate):** for the scale
  of an internal company knowledge base, `pgvector` performance is sufficient, and keeping a
  single database reduces operational complexity (one connection pool, one backup strategy,
  one place to reason about consistency) appropriate trade-off for this system's size.
  This is a deliberate simplicity choice, not a knowledge gap; it can be split out later if
  vector search load grows.

### 4.4 MCP Server - Tool Layer (PLUS POINT)

An [MCP](https://modelcontextprotocol.io) server exposes three tools to the LLM orchestrator
using the standardized Model Context Protocol, instead of hardcoding tool-calling logic
directly in the backend:

| Tool | Description |
|---|---|
| `search_knowledge_base` | Embeds the query, performs a similarity search against `pgvector`, returns top-k relevant document chunks with source citations. |
| `query_database` | Converts a natural-language analytics question into a **read-only** SQL query (restricted to `SELECT`, executed via a least-privilege DB role) against the business data tables, returns tabular results. |
| `web_search` | Calls the Tavily API to fetch and summarize external knowledge when the query is outside internal scope. |

- **Why MCP:** decouples "what tools exist" from "how the orchestrator uses them." Tools can
  be added, versioned, or reused by other clients (e.g. a future Slack bot) without touching
  backend orchestration logic. This mirrors how the current generation of AI coding/agent
  tools standardize tool access, and directly demonstrates understanding of it as requested
  by the test brief.
- **Protocol:** MCP over the **Streamable HTTP** transport. The MCP server runs as its own
  container (`mcp.run(transport="streamable-http")`, listening on `:8001/mcp`) and the backend
  connects as an MCP client over HTTP (`streamablehttp_client` → `http://mcp-server:8001/mcp`).
  HTTP is used (rather than stdio) precisely because the tool layer is a **separate, network-
  reachable container** that can be scaled and redeployed independently of the backend — stdio
  would require the server to be a child process of the backend, which it is not.

### 4.5 Redis - Cache + Async Job Queue (PLUS POINT)

- **Cache:** stores final LLM answers for identical questions within a TTL window, keyed by a
  hash of the conversation messages + enabled tools (`chat_cache:<sha256>` in
  `backend/app/chat.py`), reducing repeated LLM API cost and latency on repeated questions.
  (Embedding-level caching is a natural next step but is not implemented yet.)
- **Queue:** backs the async document ingestion pipeline when a new/updated markdown file is
  added to the knowledge base, a job is pushed to Redis rather than processed synchronously in
  the request path.
- **Why Redis:** single tool covering both needs (cache + lightweight queue via lists/streams),
  minimal operational overhead compared to running a dedicated message broker (e.g. RabbitMQ/
  Kafka) for a system at this scale.

### 4.6 Async Worker (PLUS POINT)

- A separate worker process (Python) that consumes ingestion jobs from the Redis
  `ingestion_queue` list (`blpop`): reads markdown files → splits into chunks → generates
  embeddings via OpenAI's embedding model → writes vectors into `pgvector`. On startup it also
  bulk-ingests the seed documents mounted at `KB_DIR`.
- Documents reach the queue two ways: the seed knowledge base in `infrastructure/knowledge_base`,
  and files **uploaded at runtime** through the frontend/backend (stored in the shared
  `kb_uploads` volume, whose path is pushed onto the queue). Queue entries are validated against
  path traversal before processing.
- **Why separate from the API:** ingesting/re-embedding documents is I/O and potentially
  slow (batch embedding calls); running it out-of-band keeps the chat API responsive and
  allows independent horizontal scaling of ingestion throughput.

---

## 5. Data Flow (Example: RAG Query)

1. User submits a question in the Next.js chat UI → `POST /chat` to FastAPI backend (REST).
2. Backend loads conversation history, sends the message + tool definitions to OpenAI's
   Chat Completions API (function/tool-calling mode).
3. OpenAI's model decides to call `search_knowledge_base` (via MCP) with a refined query.
4. Backend's MCP client invokes the tool → MCP server embeds the query, queries `pgvector`,
   returns top-k chunks with source file names.
5. Backend appends tool results to the conversation, sends back to OpenAI for the final
   answer.
6. Backend streams the final answer to the frontend via SSE, including citations.
7. Frontend renders the streamed tokens live and displays citation links/badges.

For a data-analytics question, step 3–4 instead call `query_database`; for an out-of-scope
question, `web_search` is called. The LLM may call multiple tools in sequence for a single
question (e.g. knowledge base for policy + database for current numbers).

---

## 6. Communication Protocols Summary

| Link | Protocol | Reason |
|---|---|---|
| Frontend ↔ Backend | REST (HTTPS) for request/history, SSE for streaming responses | SSE is simpler than WebSocket for one-directional token streaming and works over standard HTTP infra |
| Backend ↔ MCP Server | MCP (JSON-RPC over Streamable HTTP) | Standardized tool-calling protocol; HTTP lets the MCP server run as an independently deployable/scalable container instead of a child process of the backend |
| Backend/Worker ↔ PostgreSQL | SQL over TCP (asyncpg/psycopg) | Standard, connection-pooled |
| Backend ↔ Redis | RESP protocol | Standard Redis client |
| Backend ↔ OpenAI / Tavily | HTTPS REST | External hosted APIs |

---

## 7. Security Considerations

- **Authentication:** the API is gated by a single shared password (`APP_PASSWORD`) —
  sufficient to keep a VPS-deployed internal tool private without standing up a full user
  store. On login the backend mints a **stateless HMAC-signed Bearer token** (`AUTH_SECRET`,
  no DB/session store, configurable TTL) that the frontend sends on every subsequent request
  (`backend/app/auth.py`). Auth is automatically disabled when `APP_PASSWORD` is unset, for
  frictionless local development.
- The `query_database` tool only ever executes `SELECT` statements through a Postgres role
  with `SELECT`-only grants no `INSERT`/`UPDATE`/`DELETE`/DDL privileges mitigating prompt
  injection attempts that try to get the LLM to issue destructive SQL.
- LLM-generated SQL is validated (allow-list of statement type, query timeout, row limit)
  before execution.
- API keys (OpenAI, Tavily) are injected via environment variables / Docker secrets, never
  committed to the repo.

---

## 8. Deployment (Containerization)

All components run as separate services in `docker-compose.yaml`:

- `frontend` - Next.js app
- `backend` - FastAPI app
- `mcp-server` - MCP tool server
- `worker` - async ingestion worker
- `postgres` - PostgreSQL with `pgvector` extension enabled
- `redis` - cache + queue

This satisfies the mandatory Docker containerization requirement and mirrors the repo
structure (`backend/`, `frontend/`, `infrastructure/`).

---

## 9. Tech Stack Summary

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js (React) | Streaming-friendly, preferred stack, large ecosystem |
| Backend | Python + FastAPI | Best RAG/agent ecosystem, native async/SSE support |
| LLM | OpenAI API (GPT-4o / GPT-4o-mini) | Reliable tool-calling support, well documented |
| Database | PostgreSQL + pgvector | Single source of truth + vector search, low operational overhead |
| Tool layer | MCP Server | Standardized, decoupled tool-calling |
| Cache/Queue | Redis | Covers both needs with minimal ops overhead |
| Web Search | Tavily API | Purpose-built for AI agent consumption, has free tier |
| Containerization | Docker / docker-compose | Mandatory requirement, reproducible local dev |
