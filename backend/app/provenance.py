from datetime import datetime, timezone
from typing import Any

from app.config import (
    BMKG_NOWCAST_CAP_BASE,
    BMKG_NOWCAST_RSS,
    BMKG_TEWS_BASE,
    BMKG_WEATHER_API,
    EARTHQUAKE_REFRESH_SECONDS,
    NOWCAST_REFRESH_SECONDS,
    WEATHER_CACHE_TTL_SECONDS,
)
from app.support.provenance_meta import SUPPORT_FETCH_LAYERS, firms_source_url_for_catalog

OFFICIAL_LAYERS: dict[str, dict[str, Any]] = {
    "earthquake_latest": {
        "label": "Gempa terbaru",
        "provider": "BMKG",
        "source_url": f"{BMKG_TEWS_BASE}/autogempa.json",
        "official": True,
        "refresh_interval_seconds": EARTHQUAKE_REFRESH_SECONDS,
    },
    "earthquake_recent": {
        "label": "Gempa M5+",
        "provider": "BMKG",
        "source_url": f"{BMKG_TEWS_BASE}/gempaterkini.json",
        "official": True,
        "refresh_interval_seconds": EARTHQUAKE_REFRESH_SECONDS,
    },
    "earthquake_felt": {
        "label": "Gempa dirasakan",
        "provider": "BMKG",
        "source_url": f"{BMKG_TEWS_BASE}/gempadirasakan.json",
        "official": True,
        "refresh_interval_seconds": EARTHQUAKE_REFRESH_SECONDS,
    },
    "nowcast_national": {
        "label": "Peringatan dini cuaca (CAP)",
        "provider": "BMKG",
        "source_url": BMKG_NOWCAST_RSS,
        "source_url_cap_template": f"{BMKG_NOWCAST_CAP_BASE}/{{alert_code}}_alert.xml",
        "official": True,
        "refresh_interval_seconds": NOWCAST_REFRESH_SECONDS,
    },
    "weather_adm4": {
        "label": "Prakiraan cuaca adm4",
        "provider": "BMKG",
        "source_url": BMKG_WEATHER_API,
        "official": True,
        "cache_ttl_seconds": WEATHER_CACHE_TTL_SECONDS,
    },
}

STATIC_SUPPORT_LAYERS: list[dict[str, Any]] = [
    {
        "id": "basemap",
        "label": "Peta dasar (UI)",
        "provider": "Esri World Imagery / OpenFreeMap",
        "source_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        "official": False,
        "note": "Pengguna memilih Hibrid/Satelit (Esri) atau Taktis (OpenFreeMap) di frontend.",
    },
    {
        "id": "daynight",
        "label": "Siang / malam (terminator)",
        "provider": "Indonesia COP (computed)",
        "official": False,
        "note": "Visualisasi astronomi; bukan produk resmi BMKG.",
    },
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stamp_layer(layer_id: str, *, fetched_at: str | None = None) -> dict[str, Any]:
    meta = dict(OFFICIAL_LAYERS[layer_id])
    meta["layer_id"] = layer_id
    meta["fetched_at"] = fetched_at or utc_now_iso()
    meta["ingested_at"] = meta["fetched_at"]
    return meta


def attach_payload_provenance(payload: dict[str, Any], layer_id: str) -> dict[str, Any]:
    stamped = stamp_layer(layer_id)
    payload = dict(payload)
    payload["_provenance"] = stamped
    return payload


def build_catalog(layer_runs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    official: list[dict[str, Any]] = []
    for layer_id, spec in OFFICIAL_LAYERS.items():
        run = layer_runs.get(layer_id, {})
        official.append(
            {
                **spec,
                "layer_id": layer_id,
                "fetched_at": run.get("fetched_at"),
                "last_success": run.get("last_success", False),
                "last_error": run.get("last_error"),
            }
        )
    fetched_support: list[dict[str, Any]] = []
    for layer_id, spec in SUPPORT_FETCH_LAYERS.items():
        run = layer_runs.get(layer_id, {})
        source_url = spec.get("source_url") or spec.get("source_url_template", "")
        if layer_id == "firms_nrt":
            source_url = firms_source_url_for_catalog()
        fetched_support.append(
            {
                **spec,
                "source_url": source_url,
                "fetched_at": run.get("fetched_at"),
                "last_success": run.get("last_success"),
                "last_error": run.get("last_error"),
            }
        )

    return {
        "generated_at": utc_now_iso(),
        "official_layers": official,
        "support_layers": [*fetched_support, *STATIC_SUPPORT_LAYERS],
    }
