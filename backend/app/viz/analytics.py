import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.bmkg.earthquake_geojson import build_earthquake_geojson
from app.config import (
    GRID_CELL_DEG,
    INDONESIA_EAST,
    INDONESIA_NORTH,
    INDONESIA_SOUTH,
    INDONESIA_WEST,
)
from app.state import AppState
from app.viz.geometry import (
    geometry_bbox,
    iter_point_features,
    normalize_label,
    point_in_bbox,
    point_in_geometry,
)


@lru_cache(maxsize=1)
def _load_provinces() -> dict[str, Any]:
    path = Path(__file__).resolve().parent.parent / "data" / "id_provinces.geojson"
    return json.loads(path.read_text(encoding="utf-8"))


def _cell_index(lon: float, lat: float, cell: float) -> tuple[int, int] | None:
    if lon < INDONESIA_WEST or lon > INDONESIA_EAST or lat < INDONESIA_SOUTH or lat > INDONESIA_NORTH:
        return None
    ix = int((lon - INDONESIA_WEST) / cell)
    iy = int((lat - INDONESIA_SOUTH) / cell)
    return ix, iy


def _cell_bounds(ix: int, iy: int, cell: float) -> tuple[float, float, float, float]:
    west = INDONESIA_WEST + ix * cell
    south = INDONESIA_SOUTH + iy * cell
    east = west + cell
    north = south + cell
    return west, south, east, north


def _cell_polygon(ix: int, iy: int, cell: float) -> dict[str, Any]:
    west, south, east, north = _cell_bounds(ix, iy, cell)
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
            ]
        ],
    }


def _grid_dimensions(cell: float) -> tuple[int, int]:
    cols = int(math.ceil((INDONESIA_EAST - INDONESIA_WEST) / cell))
    rows = int(math.ceil((INDONESIA_NORTH - INDONESIA_SOUTH) / cell))
    return cols, rows


def _event_weight(props: dict[str, Any], source: str) -> float:
    if source == "earthquake":
        cat = props.get("category")
        if cat == "latest":
            return 4.0
        if cat == "strong":
            return 2.5
        if cat == "felt":
            return 1.0
        mag = props.get("magnitude")
        if mag is None:
            return 1.0
        try:
            return max(1.0, float(mag) - 2.0)
        except (TypeError, ValueError):
            return 1.0
    if source == "firms":
        frp = props.get("frp")
        if frp is None:
            return 0.75
        try:
            return min(4.0, 0.5 + float(frp) / 25.0)
        except (TypeError, ValueError):
            return 0.75
    if source == "nowcast":
        sev = props.get("severity")
        return {
            "Extreme": 5.0,
            "Severe": 3.5,
            "Moderate": 2.0,
            "Minor": 1.0,
        }.get(str(sev), 1.5)
    if source == "usgs":
        try:
            return max(1.0, float(props.get("magnitude", 4)) - 2.0)
        except (TypeError, ValueError):
            return 1.0
    return 1.0


def build_analytics_layers(
    *,
    earthquake_latest: dict[str, Any],
    earthquake_recent: dict[str, Any],
    earthquake_felt: dict[str, Any],
    nowcast_alerts: list[dict[str, Any]],
    firms_features: list[dict[str, Any]],
    usgs_features: list[dict[str, Any]],
    province_alert_labels: list[str],
) -> dict[str, Any]:
    cell = GRID_CELL_DEG
    grid_weights: dict[tuple[int, int], float] = {}
    grid_counts: dict[tuple[int, int], int] = {}

    def add_point(lon: float, lat: float, weight: float) -> None:
        idx = _cell_index(lon, lat, cell)
        if idx is None:
            return
        grid_weights[idx] = grid_weights.get(idx, 0.0) + weight
        grid_counts[idx] = grid_counts.get(idx, 0) + 1

    eq_collection = build_earthquake_geojson(
        earthquake_latest, earthquake_recent, earthquake_felt
    )
    for lon, lat, props in iter_point_features(eq_collection.get("features") or []):
        add_point(lon, lat, _event_weight(props, "earthquake"))

    for feature in firms_features:
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) >= 2:
            add_point(float(coords[0]), float(coords[1]), _event_weight(feature.get("properties") or {}, "firms"))

    for lon, lat, props in iter_point_features(usgs_features):
        add_point(lon, lat, _event_weight(props, "usgs"))

    nowcast_features: list[dict[str, Any]] = []
    for alert in nowcast_alerts:
        cap = alert.get("cap") or {}
        collection = cap.get("polygons_geojson") or {}
        for feature in collection.get("features") or []:
            props = dict(feature.get("properties") or {})
            props.update(
                {
                    "severity": cap.get("severity"),
                    "headline": cap.get("headline"),
                }
            )
            merged = {**feature, "properties": props}
            nowcast_features.append(merged)
            center = None
            geom = feature.get("geometry")
            if geom:
                from app.viz.geometry import feature_centroid

                center = feature_centroid(geom)
            if center:
                add_point(center[0], center[1], _event_weight(props, "nowcast"))

    max_grid = max(grid_weights.values()) if grid_weights else 1.0
    grid_feature_list: list[dict[str, Any]] = []
    for (ix, iy), weight in grid_weights.items():
        if weight <= 0:
            continue
        intensity = weight / max_grid
        grid_feature_list.append(
            {
                "type": "Feature",
                "geometry": _cell_polygon(ix, iy, cell),
                "properties": {
                    "weight": round(weight, 3),
                    "intensity": round(intensity, 4),
                    "event_count": grid_counts.get((ix, iy), 0),
                    "cell_km_approx": round(cell * 111.0, 1),
                },
            }
        )

    eq_points = list(iter_point_features(eq_collection.get("features") or []))
    fire_points: list[tuple[float, float]] = []
    for f in firms_features:
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) >= 2:
            fire_points.append((float(coords[0]), float(coords[1])))
    grid_centers: list[tuple[float, float, float]] = []
    for (ix, iy), weight in grid_weights.items():
        west, south, east, north = _cell_bounds(ix, iy, cell)
        grid_centers.append(((west + east) / 2, (south + north) / 2, weight))

    alert_norm = {normalize_label(p) for p in province_alert_labels if p}
    provinces_raw = _load_provinces()
    province_features: list[dict[str, Any]] = []
    max_prov_score = 1.0

    for feature in provinces_raw.get("features") or []:
        props = dict(feature.get("properties") or {})
        name = props.get("shapeName") or props.get("name") or "—"
        norm_name = normalize_label(name)
        geom = feature.get("geometry")
        bbox = geometry_bbox(geom)

        eq_n = 0
        fire_n = 0
        grid_sum = 0.0
        for lon, lat, _p in eq_points:
            if bbox and not point_in_bbox(lon, lat, bbox):
                continue
            if point_in_geometry(lon, lat, geom):
                eq_n += 1
        for lon, lat in fire_points:
            if bbox and not point_in_bbox(lon, lat, bbox):
                continue
            if point_in_geometry(lon, lat, geom):
                fire_n += 1
        for cx, cy, weight in grid_centers:
            if bbox and not point_in_bbox(cx, cy, bbox):
                continue
            if point_in_geometry(cx, cy, geom):
                grid_sum += weight

        alert_hit = 1 if any(norm_name in a or a in norm_name for a in alert_norm) else 0
        score = alert_hit * 40 + eq_n * 8 + fire_n * 0.05 + grid_sum * 2
        max_prov_score = max(max_prov_score, score)
        province_features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    **props,
                    "province_name": name,
                    "alert_active": bool(alert_hit),
                    "earthquake_points": eq_n,
                    "fire_points": fire_n,
                    "grid_weight_sum": round(grid_sum, 2),
                    "risk_score_raw": round(score, 2),
                },
            }
        )

    for feature in province_features:
        raw = feature["properties"]["risk_score_raw"]
        feature["properties"]["risk_score"] = round(
            min(100.0, (raw / max_prov_score) * 100.0), 1
        )

    cols, rows = _grid_dimensions(cell)
    return {
        "provinces": {
            "type": "FeatureCollection",
            "features": province_features,
        },
        "grid": {
            "type": "FeatureCollection",
            "features": grid_feature_list,
        },
        "grid_meta": {
            "cell_degrees": cell,
            "columns": cols,
            "rows": rows,
            "active_cells": len(grid_feature_list),
            "max_cell_weight": round(max_grid, 3),
        },
        "nowcast_features_for_map": nowcast_features,
    }


def rebuild_viz_analytics_cache(state: AppState) -> None:
    latest = state.earthquake_latest.get()
    recent = state.earthquake_recent.get()
    felt = state.earthquake_felt.get()
    nowcast = state.nowcast_national.get()
    if not latest or not recent or not felt or not nowcast:
        return
    firms = state.support_firms.get() or {}
    usgs = state.support_usgs.get() or {}
    state.viz_analytics = build_analytics_layers(
        earthquake_latest=latest,
        earthquake_recent=recent,
        earthquake_felt=felt,
        nowcast_alerts=nowcast.get("alerts") or [],
        firms_features=firms.get("features") or [],
        usgs_features=usgs.get("features") or [],
        province_alert_labels=nowcast.get("provinces_with_alerts") or [],
    )
