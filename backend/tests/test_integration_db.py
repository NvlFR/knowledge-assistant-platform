import os

import asyncpg
import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_seed_data_is_queryable():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set; skipping integration test")

    conn = await asyncpg.connect(dsn=database_url)
    try:
        row_count = await conn.fetchval("SELECT count(*) FROM employees")
        assert row_count > 0

        pgvector_installed = await conn.fetchval(
            "SELECT count(*) FROM pg_extension WHERE extname = 'vector'"
        )
        assert pgvector_installed == 1
    finally:
        await conn.close()
