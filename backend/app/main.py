import asyncio
import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.chat import redis_client, stream_chat_response
from app.config import settings
from app.mcp_client import call_tool, list_openai_tools

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/uploads"))
INGESTION_QUEUE = "ingestion_queue"
ALLOWED_EXTENSIONS = {".md", ".txt", ".pdf"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def _safe_filename(name: str) -> str:
    """Strips any directory component and reduces the name to a conservative
    charset so a hostile filename can't escape UPLOAD_DIR or break the queue."""
    base = os.path.basename(name or "").strip()
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    base = base.lstrip(".") or "document"
    return base[:120]

app = FastAPI(title="Internal Company AI Assistant - Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    # Tool names the user enabled in the UI. None = allow all (backward compatible).
    enabled_tools: list[str] | None = None


@app.get("/health")
async def health():
    return {"status": "ok"}


async def _check_redis() -> bool:
    try:
        return bool(await asyncio.wait_for(redis_client.ping(), timeout=3))
    except Exception:  # noqa: BLE001
        return False


async def _check_mcp_and_docs() -> tuple[bool, int | None, bool]:
    """Returns (mcp_ready, document_count, database_connected). The document
    count doubles as our database liveness probe — one MCP round-trip, no extra
    credentials in the backend."""
    try:
        await asyncio.wait_for(list_openai_tools(), timeout=5)
    except Exception:  # noqa: BLE001
        return False, None, False

    try:
        raw = await asyncio.wait_for(
            call_tool("query_database", {"sql": "SELECT count(*) AS n FROM kb_documents"}),
            timeout=5,
        )
        data = json.loads(raw)
        rows = data.get("rows") or []
        count = int(rows[0]["n"]) if rows else None
        return True, count, "error" not in data and count is not None
    except Exception:  # noqa: BLE001
        return True, None, False


@app.get("/status")
async def status():
    redis_ok, (mcp_ready, doc_count, db_ok) = await asyncio.gather(
        _check_redis(), _check_mcp_and_docs()
    )
    return {
        "knowledge": {"connected": db_ok, "documents": doc_count},
        "database": {"connected": db_ok},
        "web": {"ready": mcp_ready},
        "cache": {"connected": redis_ok},
        "mcp": {"ready": mcp_ready},
    }


@app.get("/documents")
async def list_documents():
    """Lists ingested knowledge-base documents (distinct source_file + chunk
    count) by asking the MCP database tool — no extra DB credentials here."""
    try:
        raw = await call_tool(
            "query_database",
            {
                "sql": (
                    "SELECT source_file, count(*) AS chunks, max(created_at) AS updated_at "
                    "FROM kb_documents GROUP BY source_file ORDER BY max(created_at) DESC"
                )
            },
        )
        data = json.loads(raw)
        return {"documents": data.get("rows", [])}
    except Exception:  # noqa: BLE001
        return {"documents": []}


@app.post("/documents")
async def upload_document(file: UploadFile):
    filename = _safe_filename(file.filename or "")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 10 MB limit.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / filename).write_bytes(contents)

    # Hand off to the async worker so chunking + embedding never blocks the API.
    await redis_client.rpush(INGESTION_QUEUE, filename)

    return {"filename": filename, "status": "queued"}


@app.post("/chat")
async def chat(request: ChatRequest):
    history = [{"role": m.role, "content": m.content} for m in request.messages]
    return EventSourceResponse(stream_chat_response(history, request.enabled_tools))
