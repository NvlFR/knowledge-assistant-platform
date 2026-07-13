"""
MCP Server exposing the tools used by the AI Company Assistant:

- search_knowledge_base: semantic search over internal SOP/knowledge markdown docs
- query_database: read-only natural-language-driven SQL access to business data
- web_search: external web search via Tavily for out-of-scope questions

Runs as a standalone MCP server over the Streamable HTTP transport so it can be
deployed as a sibling container and reused by any MCP-compatible client.
"""

import asyncio
import json
import os
import re

from mcp.server.fastmcp import FastMCP
from openai import AsyncOpenAI
from tavily import TavilyClient

from db import (
    FORBIDDEN_KEYWORDS,
    _strip_literals_and_comments,
    get_pool,
    is_safe_select,
)

EMBEDDING_MODEL = "text-embedding-3-small"

openai_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
tavily_client = TavilyClient(api_key=os.environ.get("TAVILY_API_KEY", ""))

mcp = FastMCP(
    "knowledge-assistant-tools",
    host="0.0.0.0",
    port=int(os.environ.get("MCP_SERVER_PORT", "8001")),
)


@mcp.tool()
async def search_knowledge_base(query: str, top_k: int = 5) -> str:
    """Search the internal SOP / knowledge base markdown documents using semantic
    similarity search. Returns the most relevant chunks with their source file names.

    Args:
        query: The natural-language question or topic to search for.
        top_k: Number of top matching chunks to return (default 5).
    """
    embedding_response = await openai_client.embeddings.create(
        model=EMBEDDING_MODEL, input=query
    )
    query_embedding = embedding_response.data[0].embedding

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT source_file, chunk_index, content,
               1 - (embedding <=> $1::vector) AS similarity
        FROM kb_documents
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        """,
        str(query_embedding),
        top_k,
    )

    if not rows:
        return json.dumps({"results": [], "message": "No knowledge base documents indexed yet."})

    results = [
        {
            "source_file": row["source_file"],
            "chunk_index": row["chunk_index"],
            "content": row["content"],
            "similarity": round(float(row["similarity"]), 4),
        }
        for row in rows
    ]
    return json.dumps({"results": results})


@mcp.tool()
async def query_database(sql: str) -> str:
    """Execute a READ-ONLY SQL SELECT query against the company business database.
    Only SELECT statements are permitted; any write/DDL statement is rejected.
    Use this for data-analytics style questions.

    Schema:
        employees(id, full_name, department, role, hire_date, salary)
        sales(id, product_name, category, quantity, unit_price, sold_at, region)
        support_tickets(id, subject, status, priority, created_at, resolved_at)

    Args:
        sql: A single valid PostgreSQL SELECT statement using only the columns
            listed above. Compute derived values (e.g. revenue) as
            `quantity * unit_price` rather than assuming a precomputed column.
    """
    if not is_safe_select(sql):
        return json.dumps(
            {
                "error": (
                    "Rejected: only single SELECT statements are allowed "
                    f"(forbidden keywords: {', '.join(FORBIDDEN_KEYWORDS)})."
                )
            }
        )

    pool = await get_pool()
    cleaned_sql = sql.strip().rstrip(";")
    # Detect an existing LIMIT against the literal/comment-stripped SQL so a string
    # like '...limit...' doesn't suppress the safety cap, and append on a new line so
    # a trailing single-line comment can't swallow the clause.
    if not re.search(r"\blimit\b", _strip_literals_and_comments(cleaned_sql), re.IGNORECASE):
        cleaned_sql += "\nLIMIT 200"

    try:
        rows = await pool.fetch(cleaned_sql)
    except Exception as exc:  # noqa: BLE001 - surface DB errors back to the LLM
        return json.dumps({"error": str(exc)})

    results = [dict(row) for row in rows]
    return json.dumps({"row_count": len(results), "rows": results}, default=str)


@mcp.tool()
async def web_search(query: str, max_results: int = 5) -> str:
    """Search the public internet for information not available in the internal
    knowledge base or database. Use this only when internal sources are insufficient.

    Args:
        query: The search query.
        max_results: Maximum number of results to return (default 5).
    """
    if not os.environ.get("TAVILY_API_KEY"):
        return json.dumps({"error": "Web search is not configured (missing TAVILY_API_KEY)."})

    # tavily_client.search is synchronous; offload it so it doesn't block the event loop.
    response = await asyncio.to_thread(
        tavily_client.search, query=query, max_results=max_results
    )
    results = [
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "content": item.get("content"),
        }
        for item in response.get("results", [])
    ]
    return json.dumps({"results": results})


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
