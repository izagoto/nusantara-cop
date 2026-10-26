from dataclasses import dataclass, field
from typing import Any

from app.cache import KeyedTTLCache, TTLCache


@dataclass
class AppState:
    earthquake_latest: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    earthquake_recent: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    earthquake_felt: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    nowcast_national: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    support_firms: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    support_usgs: TTLCache[dict[str, Any]] = field(default_factory=TTLCache)
    weather_by_adm4: KeyedTTLCache[dict[str, Any]] = field(default_factory=KeyedTTLCache)
    layer_runs: dict[str, dict[str, Any]] = field(default_factory=dict)
    weather_fetches: list[dict[str, Any]] = field(default_factory=list)
    last_refresh_errors: list[str] = field(default_factory=list)
    viz_analytics: dict[str, Any] | None = None
