from typing import Any

from app.config import (
    FIRMS_DAY_RANGE,
    FIRMS_SOURCE,
    INDONESIA_EAST,
    INDONESIA_NORTH,
    INDONESIA_SOUTH,
    INDONESIA_WEST,
    SUPPORT_REFRESH_SECONDS,
)
from app.support.firms import firms_area_coordinates, firms_area_url
from app.support.usgs import USGS_QUERY_URL

SUPPORT_FETCH_LAYERS: dict[str, dict[str, Any]] = {
    "firms_nrt": {
        "id": "firms_nrt",
        "label": "Hotspot kebakaran (FIRMS)",
        "provider": "NASA FIRMS",
        "source_url_template": (
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/"
            f"{FIRMS_SOURCE}/{firms_area_coordinates()}/{FIRMS_DAY_RANGE}"
        ),
        "official": False,
        "refresh_interval_seconds": SUPPORT_REFRESH_SECONDS,
        "note": "Butuh FIRMS_MAP_KEY di .env — bukan data BMKG.",
    },
    "usgs_earthquake": {
        "id": "usgs_earthquake",
        "label": "Gempa USGS (M4+ · 7 hari)",
        "provider": "USGS",
        "source_url": USGS_QUERY_URL,
        "official": False,
        "refresh_interval_seconds": SUPPORT_REFRESH_SECONDS,
        "note": "Referensi global; operasional Indonesia tetap BMKG TEWS.",
    },
}


def firms_source_url_for_catalog() -> str:
    try:
        return firms_area_url()
    except Exception:
        return SUPPORT_FETCH_LAYERS["firms_nrt"]["source_url_template"]
