import logging

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.bmkg import earthquake as eq
from app.bmkg.client import bmkg_client
from app.bmkg import nowcast as nc
from app.config import (
    EARTHQUAKE_REFRESH_SECONDS,
    NOWCAST_REFRESH_SECONDS,
    SUPPORT_REFRESH_SECONDS,
)
from app.provenance import attach_payload_provenance, utc_now_iso
from app.state import AppState
from app.support.firms import FirmsNotConfiguredError, fetch_indonesia_hotspots
from app.support.http import support_client
from app.support.usgs import fetch_indonesia_earthquakes
from app.viz.analytics import rebuild_viz_analytics_cache

logger = logging.getLogger(__name__)


async def refresh_earthquakes(state: AppState) -> None:
    fetched_at = utc_now_iso()
    async with bmkg_client() as client:
        latest = await eq.fetch_latest(client)
        recent = await eq.fetch_recent_strong(client)
        felt = await eq.fetch_felt(client)
    ttl = float(EARTHQUAKE_REFRESH_SECONDS) * 2
    state.earthquake_latest.set(attach_payload_provenance(latest, "earthquake_latest"), ttl)
    state.earthquake_recent.set(attach_payload_provenance(recent, "earthquake_recent"), ttl)
    state.earthquake_felt.set(attach_payload_provenance(felt, "earthquake_felt"), ttl)
    for layer_id in ("earthquake_latest", "earthquake_recent", "earthquake_felt"):
        state.layer_runs[layer_id] = {
            "fetched_at": fetched_at,
            "last_success": True,
            "last_error": None,
        }
    rebuild_viz_analytics_cache(state)


async def refresh_nowcast(state: AppState) -> None:
    fetched_at = utc_now_iso()
    async with bmkg_client() as client:
        payload = await nc.fetch_nowcast_national(client, enrich_cap=True)
    ttl = float(NOWCAST_REFRESH_SECONDS) * 2
    state.nowcast_national.set(attach_payload_provenance(payload, "nowcast_national"), ttl)
    state.layer_runs["nowcast_national"] = {
        "fetched_at": fetched_at,
        "last_success": True,
        "last_error": None,
    }
    rebuild_viz_analytics_cache(state)


async def _run_named(
    state: AppState,
    name: str,
    fn,
    *,
    layer_key: str | None = None,
) -> None:
    try:
        await fn(state)
    except Exception as exc:  # noqa: BLE001
        msg = f"{name}: {exc}"
        logger.exception(msg)
        state.last_refresh_errors.append(msg)
        state.last_refresh_errors[:] = state.last_refresh_errors[-20:]
        if layer_key is None:
            layer_key = "nowcast_national" if name == "nowcast" else "earthquake_latest"
        state.layer_runs[layer_key] = {
            "fetched_at": utc_now_iso(),
            "last_success": False,
            "last_error": str(exc),
        }


async def refresh_firms(state: AppState) -> None:
    fetched_at = utc_now_iso()
    try:
        async with support_client() as client:
            payload = await fetch_indonesia_hotspots(client)
    except FirmsNotConfiguredError as exc:
        state.support_firms.set(
            {
                "type": "FeatureCollection",
                "features": [],
                "feature_count": 0,
                "enabled": False,
                "message": str(exc),
            },
            float(SUPPORT_REFRESH_SECONDS) * 2,
        )
        state.layer_runs["firms_nrt"] = {
            "fetched_at": fetched_at,
            "last_success": False,
            "last_error": str(exc),
        }
        return

    prov = {
        "layer_id": "firms_nrt",
        "data_provider": "NASA FIRMS",
        "official": False,
        "ingested_at": fetched_at,
        "source_url": payload.get("source_url"),
    }
    payload = {**payload, "enabled": True, "_provenance": prov}
    state.support_firms.set(payload, float(SUPPORT_REFRESH_SECONDS) * 2)
    state.layer_runs["firms_nrt"] = {
        "fetched_at": fetched_at,
        "last_success": True,
        "last_error": None,
    }


async def refresh_usgs(state: AppState) -> None:
    fetched_at = utc_now_iso()
    try:
        async with support_client(read_seconds=90.0) as client:
            payload = await fetch_indonesia_earthquakes(client)
    except httpx.HTTPError as exc:
        cached = state.support_usgs.get()
        if cached is not None:
            logger.warning("USGS refresh gagal (%s); memakai cache terakhir.", exc)
            state.layer_runs["usgs_earthquake"] = {
                "fetched_at": cached.get("_provenance", {}).get("ingested_at") or fetched_at,
                "last_success": True,
                "last_error": f"Refresh gagal: {exc}",
            }
            return
        raise
    prov = {
        "layer_id": "usgs_earthquake",
        "data_provider": "USGS",
        "official": False,
        "ingested_at": fetched_at,
        "source_url": payload.get("source_url"),
    }
    payload = {**payload, "enabled": True, "_provenance": prov}
    state.support_usgs.set(payload, float(SUPPORT_REFRESH_SECONDS) * 2)
    state.layer_runs["usgs_earthquake"] = {
        "fetched_at": fetched_at,
        "last_success": True,
        "last_error": None,
    }


async def refresh_support(state: AppState) -> None:
    await _run_named(state, "firms", refresh_firms, layer_key="firms_nrt")
    await _run_named(state, "usgs", refresh_usgs, layer_key="usgs_earthquake")
    rebuild_viz_analytics_cache(state)


async def refresh_all(state: AppState) -> None:
    await _run_named(state, "earthquake", refresh_earthquakes)
    await _run_named(state, "nowcast", refresh_nowcast)
    await refresh_support(state)


def start_scheduler(state: AppState) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    async def earthquake_job() -> None:
        await _run_named(state, "earthquake", refresh_earthquakes)

    async def nowcast_job() -> None:
        await _run_named(state, "nowcast", refresh_nowcast)

    async def support_job() -> None:
        await refresh_support(state)

    scheduler.add_job(
        earthquake_job,
        "interval",
        seconds=EARTHQUAKE_REFRESH_SECONDS,
        id="refresh_earthquakes",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        nowcast_job,
        "interval",
        seconds=NOWCAST_REFRESH_SECONDS,
        id="refresh_nowcast",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        support_job,
        "interval",
        seconds=SUPPORT_REFRESH_SECONDS,
        id="refresh_support",
        replace_existing=True,
        max_instances=1,
    )
    return scheduler
