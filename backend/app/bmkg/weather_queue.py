"""Antrian fetch cuaca adm4 — prioritas CAP, rolling, on-demand."""

from __future__ import annotations

import heapq
import logging
import time
from typing import Any

import httpx

from app.bmkg import weather as wx
from app.bmkg.client import bmkg_client
from app.config import WEATHER_CACHE_TTL_SECONDS, WEATHER_ROLLING_BATCH_SIZE
from app.provenance import utc_now_iso
from app.state import AppState
from app.wilayah import all_adm4_codes, entries_for_cap_provinces, rolling_adm4_batch

logger = logging.getLogger(__name__)

# Prioritas: angka lebih kecil = lebih dulu
PRIORITY_ON_DEMAND = 0
PRIORITY_CAP = 1
PRIORITY_ROLLING = 2

_counter = 0


def _next_seq() -> int:
    global _counter  # noqa: PLW0603
    _counter += 1
    return _counter


def enqueue_adm4(state: AppState, adm4: str, priority: int, *, reason: str = "") -> bool:
    code = adm4.strip()
    if not code or code in state.weather_queue_seen:
        return False
    if state.weather_by_adm4.get(code) is not None:
        return False
    state.weather_queue_seen.add(code)
    heapq.heappush(state.weather_queue, (priority, time.monotonic(), _next_seq(), code, reason))
    return True


def enqueue_cap_from_nowcast(state: AppState, nowcast_payload: dict[str, Any]) -> int:
    provinces = nowcast_payload.get("provinces_with_alerts") or []
    if not provinces:
        return 0
    added = 0
    for entry in entries_for_cap_provinces(provinces):
        adm4 = entry.get("adm4")
        if adm4 and enqueue_adm4(state, str(adm4), PRIORITY_CAP, reason="cap_province"):
            added += 1
    return added


def enqueue_rolling_batch(state: AppState) -> int:
    codes = rolling_adm4_batch(state, WEATHER_ROLLING_BATCH_SIZE)
    added = 0
    for adm4 in codes:
        if enqueue_adm4(state, adm4, PRIORITY_ROLLING, reason="rolling"):
            added += 1
    return added


def queue_depth(state: AppState) -> int:
    return len(state.weather_queue)


def seed_rolling_cursor(state: AppState) -> None:
    codes = all_adm4_codes()
    if codes:
        state.weather_rolling_codes = codes
        state.weather_rolling_cursor = 0


async def process_weather_queue(state: AppState, *, max_per_run: int) -> dict[str, Any]:
    fetched = 0
    errors = 0
    skipped = 0

    if not state.weather_rolling_codes:
        seed_rolling_cursor(state)

    async with bmkg_client() as client:
        while fetched + errors < max_per_run and state.weather_queue:
            _priority, _ts, _seq, adm4, _reason = heapq.heappop(state.weather_queue)
            state.weather_queue_seen.discard(adm4)
            if state.weather_by_adm4.get(adm4) is not None:
                skipped += 1
                continue
            try:
                data = await wx.fetch_adm4_forecast(client, adm4)
            except httpx.HTTPError as exc:
                errors += 1
                logger.warning("Antrian cuaca gagal adm4=%s: %s", adm4, exc)
                continue
            fetched_at = utc_now_iso()
            state.weather_by_adm4.set(adm4, data, float(WEATHER_CACHE_TTL_SECONDS))
            state.weather_fetches.append(
                {"adm4": adm4, "fetched_at": fetched_at, "cached": False, "source": "queue"},
            )
            state.weather_fetches[:] = state.weather_fetches[-50:]
            fetched += 1

    return {"fetched": fetched, "errors": errors, "skipped": skipped, "remaining": queue_depth(state)}
