from typing import Any

import httpx

from app.config import BMKG_WEATHER_API


async def fetch_adm4_forecast(client: httpx.AsyncClient, adm4: str) -> dict[str, Any]:
    response = await client.get(BMKG_WEATHER_API, params={"adm4": adm4})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Unexpected BMKG weather response")
    return data
