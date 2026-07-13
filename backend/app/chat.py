import hashlib
import json
from collections.abc import AsyncGenerator

import redis.asyncio as redis
from openai import AsyncOpenAI

from app.config import settings
from app.mcp_client import call_tool, list_openai_tools

openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
redis_client = redis.from_url(settings.redis_url, decode_responses=True)

SYSTEM_PROMPT = """You are the Internal Company AI Assistant. You help employees by \
answering questions using three tools:

1. search_knowledge_base - for questions about company SOPs, policies, and internal \
   documentation.
2. query_database - for questions about company data/analytics (employees, sales, \
   support tickets). Only write SELECT statements.
3. web_search - for questions that require external/public information not available \
   internally.

Always prefer internal tools (search_knowledge_base, query_database) before falling back \
to web_search. Cite your sources: mention the source_file when using knowledge base \
results, and mention "web search" when using external results. If tools return no useful \
data, say so honestly instead of making up an answer.
"""

MAX_TOOL_ITERATIONS = 4


def _cache_key(messages: list[dict], enabled_tools: list[str] | None = None) -> str:
    payload = json.dumps(
        {"messages": messages, "tools": sorted(enabled_tools) if enabled_tools is not None else None},
        sort_keys=True,
    )
    return "chat_cache:" + hashlib.sha256(payload.encode()).hexdigest()


def _sse(payload: dict) -> dict:
    # sse_starlette's EventSourceResponse wraps each yielded dict into a proper
    # `data: ...\r\n\r\n` frame; we only supply the JSON payload here.
    return {"data": json.dumps(payload)}


_SNIPPET_LEN = 240


def _summarize_tool_result(name: str, arguments: dict, raw: str) -> dict:
    """Distills a raw tool-result JSON string into a UI-friendly payload the
    frontend renders as citations / source badges. Shape stays intentionally
    small so the SSE frame is cheap; full content stays server-side."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"name": name}

    if isinstance(data, dict) and data.get("error"):
        return {"name": name, "error": str(data["error"])}

    if name == "search_knowledge_base":
        results = data.get("results", []) if isinstance(data, dict) else []
        sources = [
            {
                "source_file": r.get("source_file"),
                "chunk_index": r.get("chunk_index"),
                "similarity": r.get("similarity"),
                "snippet": (r.get("content") or "")[:_SNIPPET_LEN],
            }
            for r in results
        ]
        return {"name": name, "kind": "knowledge", "sources": sources}

    if name == "query_database":
        return {
            "name": name,
            "kind": "database",
            "sql": arguments.get("sql"),
            "row_count": data.get("row_count") if isinstance(data, dict) else None,
        }

    if name == "web_search":
        results = data.get("results", []) if isinstance(data, dict) else []
        sources = [
            {"title": r.get("title"), "url": r.get("url"), "snippet": (r.get("content") or "")[:_SNIPPET_LEN]}
            for r in results
        ]
        return {"name": name, "kind": "web", "sources": sources}

    return {"name": name}


async def stream_chat_response(
    history: list[dict], enabled_tools: list[str] | None = None
) -> AsyncGenerator[dict, None]:
    """Runs the tool-calling loop, then streams the final answer as SSE events.

    ``enabled_tools`` restricts which tools the model may call (the UI mode
    toggles). ``None`` allows all; an empty list disables tools entirely."""

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]

    cache_key = _cache_key(messages, enabled_tools)
    cached = await redis_client.get(cache_key)
    if cached:
        yield _sse({"type": "token", "content": cached})
        yield _sse({"type": "done"})
        return

    try:
        tools = await list_openai_tools()
        if enabled_tools is not None:
            allowed = set(enabled_tools)
            tools = [t for t in tools if t["function"]["name"] in allowed]

        for _ in range(MAX_TOOL_ITERATIONS if tools else 0):
            # The model is deciding which (if any) tool to reach for next.
            yield _sse({"type": "phase", "value": "planning"})
            response = await openai_client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
            message = response.choices[0].message

            if not message.tool_calls:
                break

            messages.append(
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [tc.model_dump() for tc in message.tool_calls],
                }
            )

            for tool_call in message.tool_calls:
                name = tool_call.function.name
                try:
                    arguments = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}

                yield _sse({"type": "tool_call", "name": name, "arguments": arguments})

                tool_result = await call_tool(name, arguments)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_result,
                    }
                )

                yield _sse(
                    {"type": "tool_result", **_summarize_tool_result(name, arguments, tool_result)}
                )

        # Final answer without tools so the model is forced to produce text even if
        # it was still requesting tool calls when the iteration budget ran out.
        yield _sse({"type": "phase", "value": "generating"})
        full_answer = ""
        stream = await openai_client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_answer += delta
                yield _sse({"type": "token", "content": delta})
    except Exception as exc:  # noqa: BLE001 - surface upstream failures to the client
        yield _sse({"type": "error", "content": f"Assistant failed: {exc}"})
        return

    if full_answer:
        await redis_client.set(cache_key, full_answer, ex=settings.cache_ttl_seconds)

    yield _sse({"type": "done"})
