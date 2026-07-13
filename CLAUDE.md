# CLAUDE.md

This file guides Claude Code (or any AI coding agent) when working in this repository.

## Project

Internal Company AI Assistant Platform a RAG + tool-calling chatbot that answers
questions from an internal markdown knowledge base, a PostgreSQL business database, and
live web search. See `docs/ARCHITECTURE.md` for the full design rationale.

## Structure

- `backend/` - FastAPI orchestrator (chat endpoint, SSE streaming, OpenAI tool-calling
  loop, MCP client).
- `mcp-server/` - MCP server exposing `search_knowledge_base`, `query_database`, and
  `web_search` tools.
- `worker/` - async ingestion worker (chunks + embeds markdown docs into pgvector).
- `frontend/` - Next.js chat UI.
- `infrastructure/` - Postgres init SQL + dummy knowledge base documents.
- `docs/ARCHITECTURE.md` - Architecture / Technical Design Document (Question 1).

## Conventions

- Backend/worker/MCP server are all Python; keep dependency versions pinned in each
  `requirements.txt`.
- The `query_database` tool must remain read-only (`SELECT`-only, enforced both by the
  `readonly_bot` Postgres role and the `is_safe_select` guard in `mcp-server/db.py`).
  Do not relax this without an explicit request.
- Chat responses are streamed via SSE (`text/event-stream`), not WebSocket keep the
  event shape (`{"type": "token" | "tool_call" | "error" | "done", ...}`) consistent
  between `backend/app/chat.py` and `frontend/components/Chat.tsx`.
- No comments explaining *what* code does only *why*, when non-obvious.

## Testing

- Backend: `cd backend && pytest`
- Run the full stack locally: `docker compose up --build`
