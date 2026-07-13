"""Async worker that ingests markdown knowledge base documents into pgvector.

Two triggers:
1. On startup, ingest every .md file found in KB_DIR.
2. Continuously listen on a Redis list ("ingestion_queue") for file paths pushed by
   the backend (e.g. after a document upload), and (re-)ingest them without blocking
   the chat API's request path.
"""

import asyncio
import os
from pathlib import Path

import asyncpg
import redis.asyncio as redis
from openai import AsyncOpenAI
from pypdf import PdfReader

KB_DIR = Path(os.environ.get("KB_DIR", "/knowledge_base"))
# Writable directory shared with the backend, holding user-uploaded documents.
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/uploads"))
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
EMBEDDING_MODEL = "text-embedding-3-small"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
QUEUE_KEY = "ingestion_queue"
SUPPORTED_SUFFIXES = {".md", ".txt", ".pdf"}

openai_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


def read_document(file_path: Path) -> str:
    """Extracts plain text from a supported document (markdown, text, or PDF)."""
    if file_path.suffix.lower() == ".pdf":
        reader = PdfReader(str(file_path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    return file_path.read_text(encoding="utf-8")


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        start = end - overlap
    return [c.strip() for c in chunks if c.strip()]


async def ingest_file(pool: asyncpg.Pool, file_path: Path) -> None:
    content = read_document(file_path)
    chunks = chunk_text(content)
    source_file = file_path.name

    print(f"[worker] Ingesting {source_file} ({len(chunks)} chunks)")

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Remove any stale chunks first so a shortened/edited document does not
            # leave orphaned rows with a now-out-of-range chunk_index.
            await conn.execute(
                "DELETE FROM kb_documents WHERE source_file = $1", source_file
            )

            for idx, chunk in enumerate(chunks):
                embedding_response = await openai_client.embeddings.create(
                    model=EMBEDDING_MODEL, input=chunk
                )
                embedding = embedding_response.data[0].embedding

                await conn.execute(
                    """
                    INSERT INTO kb_documents (source_file, chunk_index, content, embedding)
                    VALUES ($1, $2, $3, $4::vector)
                    """,
                    source_file,
                    idx,
                    chunk,
                    str(embedding),
                )

    print(f"[worker] Done ingesting {source_file}")


async def ingest_all(pool: asyncpg.Pool) -> None:
    # Seed documents shipped with the repo (markdown) plus anything already
    # uploaded in a previous run, so a restart rebuilds the full index.
    for directory, patterns in ((KB_DIR, ("*.md",)), (UPLOAD_DIR, ("*.md", "*.txt", "*.pdf"))):
        if not directory.exists():
            print(f"[worker] {directory} does not exist, skipping.")
            continue
        for pattern in patterns:
            for file_path in sorted(directory.glob(pattern)):
                await ingest_file(pool, file_path)


async def listen_for_jobs(pool: asyncpg.Pool) -> None:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    print(f"[worker] Listening for ingestion jobs on Redis list '{QUEUE_KEY}'...")
    while True:
        job = await redis_client.blpop(QUEUE_KEY, timeout=30)
        if job is None:
            continue
        _, filename = job
        # Only accept a bare filename directly inside UPLOAD_DIR; reject path
        # traversal (e.g. "../../etc/passwd") or absolute paths off the queue.
        candidate = (UPLOAD_DIR / filename).resolve()
        if (
            candidate.parent != UPLOAD_DIR.resolve()
            or candidate.suffix.lower() not in SUPPORTED_SUFFIXES
        ):
            print(f"[worker] Rejecting unsafe queue entry: {filename}")
            continue
        if candidate.exists():
            await ingest_file(pool, candidate)
        else:
            print(f"[worker] Skipping unknown file: {filename}")


async def main() -> None:
    pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=3)
    await ingest_all(pool)
    await listen_for_jobs(pool)


if __name__ == "__main__":
    asyncio.run(main())
