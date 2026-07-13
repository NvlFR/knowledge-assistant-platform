"""Thin wrapper around the MCP client to list and call tools exposed by the
MCP server, and to translate them into the OpenAI tool-calling schema."""

import json
from contextlib import asynccontextmanager

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from app.config import settings


@asynccontextmanager
async def mcp_session():
    async with streamablehttp_client(settings.mcp_server_url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_openai_tools() -> list[dict]:
    """Fetch MCP tool definitions and convert them to OpenAI function-calling format."""
    async with mcp_session() as session:
        tools_result = await session.list_tools()

    openai_tools = []
    for tool in tools_result.tools:
        openai_tools.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.inputSchema,
                },
            }
        )
    return openai_tools


async def call_tool(name: str, arguments: dict) -> str:
    async with mcp_session() as session:
        result = await session.call_tool(name, arguments)

    text_parts = [content.text for content in result.content if content.type == "text"]
    if not text_parts:
        return json.dumps({"result": "empty"})
    return "\n".join(text_parts)
