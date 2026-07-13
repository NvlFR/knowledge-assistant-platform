import os


class Settings:
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    openai_chat_model: str = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    mcp_server_url: str = os.environ.get("MCP_SERVER_URL", "http://mcp-server:8001/mcp")
    redis_url: str = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    cache_ttl_seconds: int = int(os.environ.get("CACHE_TTL_SECONDS", "300"))
    cors_origins: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:4448").split(",")


settings = Settings()
