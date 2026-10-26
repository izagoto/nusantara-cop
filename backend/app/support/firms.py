import csv
import io
from typing import Any

import httpx

from app.config import (
    FIRMS_DAY_RANGE,
    FIRMS_MAP_KEY,
    FIRMS_SOURCE,
    INDONESIA_EAST,
    INDONESIA_NORTH,
    INDONESIA_SOUTH,
    INDONESIA_WEST,
)

FIRMS_AREA_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"


class FirmsNotConfiguredError(RuntimeError):
    pass


def firms_area_coordinates() -> str:
    """FIRMS expects west,south,east,north as one path segment (not slash-separated)."""
    return f"{INDONESIA_WEST},{INDONESIA_SOUTH},{INDONESIA_EAST},{INDONESIA_NORTH}"


def firms_area_url() -> str:
    if not FIRMS_MAP_KEY:
        raise FirmsNotConfiguredError("FIRMS_MAP_KEY belum di-set (NASA FIRMS Map Key).")
    return (
        f"{FIRMS_AREA_API}/{FIRMS_MAP_KEY}/{FIRMS_SOURCE}/"
        f"{firms_area_coordinates()}/{FIRMS_DAY_RANGE}"
    )


async def fetch_indonesia_hotspots(client: httpx.AsyncClient) -> dict[str, Any]:
    url = firms_area_url()
    response = await client.get(url)
    if response.status_code >= 400:
        detail = response.text.strip().replace("\n", " ")[:240]
        raise httpx.HTTPStatusError(
            f"FIRMS {response.status_code}: {detail or response.reason_phrase}",
            request=response.request,
            response=response,
        )
    text = response.text.strip()
    if not text:
        return {
            "type": "FeatureCollection",
            "features": [],
            "feature_count": 0,
            "source_url": url,
        }

    reader = csv.DictReader(io.StringIO(text))
    features: list[dict[str, Any]] = []
    for row in reader:
        try:
            lat = float(row.get("latitude") or row.get("lat") or "")
            lon = float(row.get("longitude") or row.get("lon") or "")
        except (TypeError, ValueError):
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "brightness": _float_or_none(row.get("brightness")),
                    "frp": _float_or_none(row.get("frp")),
                    "confidence": row.get("confidence") or row.get("conf"),
                    "satellite": row.get("satellite"),
                    "acq_date": row.get("acq_date"),
                    "acq_time": row.get("acq_time"),
                    "daynight": row.get("daynight"),
                    "source": "NASA FIRMS",
                    "data_provider": "NASA FIRMS",
                    "official": False,
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "feature_count": len(features),
        "source_url": url,
    }


def _float_or_none(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None
