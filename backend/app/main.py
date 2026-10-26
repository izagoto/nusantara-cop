import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.bmkg.client import bmkg_client
from app.bmkg.earthquake_geojson import build_earthquake_geojson
from app.bmkg import weather as wx
from app.config import ATTRIBUTION, BMKG_NOWCAST_CAP_BASE, WEATHER_CACHE_TTL_SECONDS
from app.provenance import build_catalog, stamp_layer, utc_now_iso
from app.scheduler import refresh_all, start_scheduler
from app.state import AppState
from app.viz.analytics import rebuild_viz_analytics_cache
from app.wilayah import match_province_label, search_wilayah

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

state = AppState()


def _meta() -> dict[str, Any]:
    return {
        "attribution": ATTRIBUTION,
        "coverage": "Indonesia (nasional)",
        "data_policy": "Layer resmi BMKG di-fetch langsung; tidak ada data mock.",
    }


def _layer_provenance_summary() -> dict[str, Any]:
    return build_catalog(state.layer_runs)


def _require_cached(cache_value: dict[str, Any] | None, label: str) -> dict[str, Any]:
    if cache_value is None:
        raise HTTPException(
            status_code=503,
            detail=f"{label} belum tersedia; scheduler masih mengambil data BMKG.",
        )
    return cache_value


@asynccontextmanager
async def lifespan(_app: FastAPI):
    scheduler = start_scheduler(state)
    scheduler.start()
    logger.info("BMKG national fetchers started")

    async def initial_refresh() -> None:
        try:
            await refresh_all(state)
            rebuild_viz_analytics_cache(state)
            logger.info("Initial BMKG refresh complete")
        except Exception:
            logger.exception("Initial BMKG refresh failed")

    boot_task = asyncio.create_task(initial_refresh())

    yield

    boot_task.cancel()
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Indonesia COP API",
    description="Agregator data terbuka BMKG — gempa & peringatan dini cuaca nasional.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/loans", include_in_schema=False)
async def loans_compat() -> dict[str, Any]:
    """Beberapa client dev mem-poll `/api/v1/loans` ke port 8080 — bukan fitur COP."""
    return {
        "service": "indonesia-cop",
        "loans": [],
        "data": [],
        "total": 0,
        "notice": "Indonesia COP (cuaca & bencana). Tidak ada modul pinjaman.",
        **_meta(),
    }


@app.get("/api/v1/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "layers": {
            "earthquake_latest": state.earthquake_latest.get() is not None,
            "nowcast_national": state.nowcast_national.get() is not None,
            "firms_nrt": state.support_firms.get() is not None,
            "usgs_earthquake": state.support_usgs.get() is not None,
        },
        "last_refresh_errors": state.last_refresh_errors,
        "provenance_summary": _layer_provenance_summary(),
        **_meta(),
    }


@app.get("/api/v1/provenance")
async def provenance() -> dict[str, Any]:
    return {
        **_meta(),
        **_layer_provenance_summary(),
        "recent_weather_fetches": state.weather_fetches[-10:],
    }


@app.get("/api/v1/national/summary")
async def national_summary() -> dict[str, Any]:
    nowcast = state.nowcast_national.get() or {}
    latest_eq = state.earthquake_latest.get() or {}
    return {
        "nowcast_active": nowcast.get("active_count", 0),
        "provinces_with_weather_alerts": nowcast.get("provinces_with_alerts", []),
        "latest_earthquake": latest_eq.get("Infogempa", latest_eq.get("gempa")),
        **_meta(),
    }


@app.get("/api/v1/earthquake/latest")
async def earthquake_latest() -> dict[str, Any]:
    return {**_require_cached(state.earthquake_latest.get(), "Gempa terbaru"), **_meta()}


@app.get("/api/v1/earthquake/recent")
async def earthquake_recent() -> dict[str, Any]:
    return {**_require_cached(state.earthquake_recent.get(), "Gempa M5+"), **_meta()}


@app.get("/api/v1/earthquake/felt")
async def earthquake_felt() -> dict[str, Any]:
    return {**_require_cached(state.earthquake_felt.get(), "Gempa dirasakan"), **_meta()}


@app.get("/api/v1/earthquake/geojson")
async def earthquake_geojson() -> dict[str, Any]:
    latest = _require_cached(state.earthquake_latest.get(), "Gempa terbaru")
    recent = _require_cached(state.earthquake_recent.get(), "Gempa M5+")
    felt = _require_cached(state.earthquake_felt.get(), "Gempa dirasakan")
    collection = build_earthquake_geojson(latest, recent, felt)
    return {
        **collection,
        "feature_count": len(collection["features"]),
        **_meta(),
    }


@app.get("/api/v1/nowcast/active")
async def nowcast_active() -> dict[str, Any]:
    return {**_require_cached(state.nowcast_national.get(), "Nowcast"), **_meta()}


@app.get("/api/v1/nowcast/geojson")
async def nowcast_geojson() -> dict[str, Any]:
    payload = _require_cached(state.nowcast_national.get(), "Nowcast")
    prov = payload.get("_provenance") or {}
    ingested_at = prov.get("ingested_at")
    features: list[dict[str, Any]] = []
    for alert in payload.get("alerts", []):
        cap = alert.get("cap") or {}
        collection = cap.get("polygons_geojson")
        if not collection:
            continue
        alert_code = alert.get("alert_code")
        cap_url = (
            f"{BMKG_NOWCAST_CAP_BASE}/{alert_code}_alert.xml" if alert_code else None
        )
        for feature in collection.get("features", []):
            props = dict(feature.get("properties") or {})
            props.update(
                {
                    "headline": cap.get("headline"),
                    "severity": cap.get("severity"),
                    "urgency": cap.get("urgency"),
                    "expires": cap.get("expires"),
                    "effective": cap.get("effective"),
                    "alert_code": alert_code,
                    "cap_identifier": cap.get("identifier"),
                    "source_url": cap_url,
                    "rss_url": alert.get("link"),
                    "data_provider": "BMKG",
                    "official": True,
                    "ingested_at": ingested_at,
                }
            )
            features.append(
                {
                    "type": "Feature",
                    "geometry": feature.get("geometry"),
                    "properties": props,
                }
            )
    return {
        "type": "FeatureCollection",
        "features": features,
        "active_count": payload.get("active_count", 0),
        "provenance": {
            "data_provider": prov.get("provider", "BMKG"),
            "official": True,
            "ingested_at": ingested_at,
            "source_url": prov.get("source_url"),
        },
        **_meta(),
    }


@app.get("/api/v1/weather/adm4/{adm4_code}")
async def weather_adm4(adm4_code: str) -> dict[str, Any]:
    cached = state.weather_by_adm4.get(adm4_code)
    if cached is not None:
        return {
            **cached,
            **_meta(),
            "cached": True,
            "provenance": cached.get("_provenance"),
        }

    fetched_at = utc_now_iso()
    async with bmkg_client() as client:
        try:
            data = await wx.fetch_adm4_forecast(client, adm4_code)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"BMKG weather: {exc}") from exc

    prov = stamp_layer("weather_adm4", fetched_at=fetched_at)
    prov["adm4"] = adm4_code
    data = {**data, "_provenance": prov}
    state.weather_by_adm4.set(adm4_code, data, float(WEATHER_CACHE_TTL_SECONDS))
    state.weather_fetches.append(
        {"adm4": adm4_code, "fetched_at": fetched_at, "cached": False}
    )
    state.weather_fetches[:] = state.weather_fetches[-50:]
    return {**data, **_meta(), "cached": False, "provenance": prov}


@app.get("/api/v1/weather/adm4")
async def weather_adm4_query(
    adm4: str = Query(..., description="Kode wilayah adm4, contoh 31.74.04.1006"),
) -> dict[str, Any]:
    return await weather_adm4(adm4)


@app.get("/api/v1/viz/analytics/geojson")
async def viz_analytics_geojson() -> dict[str, Any]:
    if state.viz_analytics is None:
        _require_cached(state.earthquake_latest.get(), "Gempa terbaru")
        _require_cached(state.earthquake_recent.get(), "Gempa M5+")
        _require_cached(state.earthquake_felt.get(), "Gempa dirasakan")
        _require_cached(state.nowcast_national.get(), "Nowcast")
        rebuild_viz_analytics_cache(state)
    if state.viz_analytics is None:
        raise HTTPException(status_code=503, detail="Analitik belum tersedia.")
    return {
        **state.viz_analytics,
        "official": False,
        "attribution_boundaries": "geoBoundaries.org (CC BY 4.0)",
        **_meta(),
    }


def _support_geojson(cache_value: dict[str, Any] | None, label: str) -> dict[str, Any]:
    if cache_value is None:
        raise HTTPException(
            status_code=503,
            detail=f"{label} belum tersedia; scheduler masih mengambil data.",
        )
    prov = cache_value.get("_provenance") or {}
    return {
        "type": cache_value.get("type", "FeatureCollection"),
        "features": cache_value.get("features") or [],
        "feature_count": cache_value.get("feature_count", len(cache_value.get("features") or [])),
        "enabled": cache_value.get("enabled", True),
        "message": cache_value.get("message"),
        "provenance": prov,
        "official": False,
        **_meta(),
    }


@app.get("/api/v1/support/firms/geojson")
async def support_firms_geojson() -> dict[str, Any]:
    return _support_geojson(state.support_firms.get(), "NASA FIRMS")


@app.get("/api/v1/support/usgs/earthquake/geojson")
async def support_usgs_earthquake_geojson() -> dict[str, Any]:
    return _support_geojson(state.support_usgs.get(), "USGS earthquake")


@app.get("/api/v1/wilayah/search")
async def wilayah_search(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(10, ge=1, le=25),
) -> dict[str, Any]:
    return {
        "query": q,
        "results": search_wilayah(q, limit=limit),
        **_meta(),
    }


@app.get("/api/v1/wilayah/match")
async def wilayah_match(
    label: str = Query(..., min_length=1, max_length=120),
) -> dict[str, Any]:
    hit = match_province_label(label)
    if hit is None:
        raise HTTPException(status_code=404, detail="Provinsi tidak cocok dengan preset MVP.")
    return {**hit, **_meta()}
