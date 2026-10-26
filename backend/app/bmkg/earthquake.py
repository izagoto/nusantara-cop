from typing import Any

import httpx

from app.config import BMKG_TEWS_BASE


async def fetch_json(client: httpx.AsyncClient, path: str) -> dict[str, Any]:
    url = f"{BMKG_TEWS_BASE}/{path}"
    response = await client.get(url)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError(f"Unexpected BMKG response for {path}")
    return data


async def fetch_latest(client: httpx.AsyncClient) -> dict[str, Any]:
    return await fetch_json(client, "autogempa.json")


async def fetch_recent_strong(client: httpx.AsyncClient) -> dict[str, Any]:
    return await fetch_json(client, "gempaterkini.json")


async def fetch_felt(client: httpx.AsyncClient) -> dict[str, Any]:
    return await fetch_json(client, "gempadirasakan.json")
