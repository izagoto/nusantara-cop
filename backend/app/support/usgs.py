from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import INDONESIA_EAST, INDONESIA_NORTH, INDONESIA_SOUTH, INDONESIA_WEST

USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


async def fetch_indonesia_earthquakes(client: httpx.AsyncClient) -> dict[str, Any]:
    start = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    params = {
        "format": "geojson",
        "starttime": start,
        "minlatitude": INDONESIA_SOUTH,
        "maxlatitude": INDONESIA_NORTH,
        "minlongitude": INDONESIA_WEST,
        "maxlongitude": INDONESIA_EAST,
        "minmagnitude": 4,
        "orderby": "time",
        "limit": 200,
    }
    response = await client.get(USGS_QUERY_URL, params=params)
    response.raise_for_status()
    payload = response.json()
    features: list[dict[str, Any]] = []
    for raw in payload.get("features") or []:
        props = dict(raw.get("properties") or {})
        mag = props.get("mag")
        features.append(
            {
                "type": "Feature",
                "geometry": raw.get("geometry"),
                "properties": {
                    "magnitude": mag,
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "updated": props.get("updated"),
                    "url": props.get("url"),
                    "tsunami": props.get("tsunami"),
                    "depth_km": (raw.get("geometry") or {})
                    .get("coordinates", [None, None, None])[2],
                    "source": "USGS",
                    "data_provider": "USGS",
                    "official": False,
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "feature_count": len(features),
        "source_url": str(response.url),
    }
