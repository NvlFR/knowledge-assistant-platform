import os
import re

import asyncpg

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.environ["READONLY_DATABASE_URL"],
            min_size=1,
            max_size=5,
        )
    return _pool


# Only SELECT statements are allowed through the query_database tool.
# This is a defense-in-depth check on top of the readonly_bot Postgres role,
# which itself only has SELECT grants.
FORBIDDEN_KEYWORDS = (
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "truncate",
    "grant",
    "revoke",
    "create",
)

# Word-boundary matching so column names like "created_at" or "updated_at" aren't
# mistaken for the SQL keywords "create"/"update".
_FORBIDDEN_PATTERN = re.compile(
    r"\b(" + "|".join(FORBIDDEN_KEYWORDS) + r")\b", re.IGNORECASE
)

# Strips single-quoted string literals, dollar-quoted bodies, and comments so the
# keyword/statement checks below only look at actual SQL syntax not user text
# such as WHERE subject = 'please create a ticket'.
_STRIP_PATTERN = re.compile(
    r"'(?:[^']|'')*'"        # single-quoted strings (with '' escapes)
    r"|\$[^$]*\$.*?\$[^$]*\$"  # dollar-quoted strings
    r"|--[^\n]*"             # line comments
    r"|/\*.*?\*/",           # block comments
    re.DOTALL,
)


def _strip_literals_and_comments(sql: str) -> str:
    return _STRIP_PATTERN.sub(" ", sql)


def is_safe_select(sql: str) -> bool:
    stripped = _strip_literals_and_comments(sql).strip()

    # Reject anything after the first statement terminator (multi-statement / stacked
    # queries like "SELECT 1; DROP TABLE ...").
    if ";" in stripped.rstrip(";"):
        return False

    normalized = stripped.lower().lstrip("(")
    # Allow plain SELECT and read-only CTEs (WITH ... SELECT).
    if not (normalized.startswith("select") or normalized.startswith("with")):
        return False

    return _FORBIDDEN_PATTERN.search(stripped) is None
