from typing import Any, Iterable


def normalize_label(text: str) -> str:
    t = text.lower().strip()
    for prefix in ("provinsi ", "prop. ", "kota ", "daerah khusus ibukota ", "di "):
        if t.startswith(prefix):
            t = t[len(prefix) :].strip()
    return t


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (
            (yj - yi) or 1e-12
        ) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def geometry_bbox(geometry: dict[str, Any] | None) -> tuple[float, float, float, float] | None:
    if not geometry:
        return None
    west = east = south = north = None

    def walk(obj: Any) -> None:
        nonlocal west, east, south, north
        if isinstance(obj, (list, tuple)) and len(obj) >= 2 and isinstance(obj[0], (int, float)):
            lon, lat = float(obj[0]), float(obj[1])
            west = lon if west is None else min(west, lon)
            east = lon if east is None else max(east, lon)
            south = lat if south is None else min(south, lat)
            north = lat if north is None else max(north, lat)
        elif isinstance(obj, (list, tuple)):
            for part in obj:
                walk(part)

    walk(geometry.get("coordinates"))
    if west is None:
        return None
    return west, south, east, north


def point_in_bbox(lon: float, lat: float, bbox: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bbox
    return west <= lon <= east and south <= lat <= north


def point_in_geometry(lon: float, lat: float, geometry: dict[str, Any] | None) -> bool:
    if not geometry:
        return False
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if not coords:
        return False
    if gtype == "Polygon":
        if not point_in_ring(lon, lat, coords[0]):
            return False
        for hole in coords[1:]:
            if point_in_ring(lon, lat, hole):
                return False
        return True
    if gtype == "MultiPolygon":
        for poly in coords:
            if point_in_geometry(lon, lat, {"type": "Polygon", "coordinates": poly}):
                return True
        return False
    if gtype == "Point":
        return abs(coords[0] - lon) < 1e-9 and abs(coords[1] - lat) < 1e-9
    return False


def feature_centroid(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    if not geometry:
        return None
    points: list[tuple[float, float]] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, (list, tuple)) and len(obj) >= 2 and isinstance(obj[0], (int, float)):
            points.append((float(obj[0]), float(obj[1])))
        elif isinstance(obj, (list, tuple)):
            for part in obj:
                walk(part)

    walk(geometry.get("coordinates"))
    if not points:
        return None
    lon = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return lon, lat


def iter_point_features(features: Iterable[dict[str, Any]]) -> Iterable[tuple[float, float, dict[str, Any]]]:
    for feature in features:
        geom = feature.get("geometry") or {}
        if geom.get("type") == "Point":
            coords = geom.get("coordinates") or []
            if len(coords) >= 2:
                yield float(coords[0]), float(coords[1]), feature.get("properties") or {}
        else:
            center = feature_centroid(geom)
            if center:
                yield center[0], center[1], feature.get("properties") or {}
