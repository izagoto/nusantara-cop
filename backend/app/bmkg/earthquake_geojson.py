from typing import Any


def _parse_coordinates(raw: str) -> tuple[float, float] | None:
    try:
        lat_str, lon_str = raw.split(",", 1)
        return float(lat_str.strip()), float(lon_str.strip())
    except (ValueError, AttributeError):
        return None


def _gempa_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    info = payload.get("Infogempa") or {}
    gempa = info.get("gempa")
    if not gempa:
        return []
    if isinstance(gempa, list):
        return gempa
    return [gempa]


def _mag_value(raw: str | None) -> float:
    if not raw:
        return 0.0
    try:
        return float(str(raw).replace(",", ".").split()[0])
    except ValueError:
        return 0.0


def build_earthquake_geojson(
    latest: dict[str, Any],
    recent: dict[str, Any],
    felt: dict[str, Any],
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _lineage(payload: dict[str, Any]) -> dict[str, Any]:
        prov = payload.get("_provenance") or {}
        return {
            "data_provider": prov.get("provider", "BMKG"),
            "source_url": prov.get("source_url"),
            "ingested_at": prov.get("ingested_at"),
            "official": prov.get("official", True),
        }

    def add_entries(
        entries: list[dict[str, Any]],
        category: str,
        lineage: dict[str, Any],
    ) -> None:
        for entry in entries:
            coords_raw = entry.get("Coordinates")
            if not coords_raw:
                continue
            parsed = _parse_coordinates(coords_raw)
            if parsed is None:
                continue
            lat, lon = parsed
            key = f"{entry.get('DateTime')}|{lat}|{lon}"
            if key in seen:
                continue
            seen.add(key)
            magnitude = _mag_value(entry.get("Magnitude"))
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "category": category,
                        "magnitude": magnitude,
                        "depth": entry.get("Kedalaman"),
                        "region": entry.get("Wilayah"),
                        "datetime": entry.get("DateTime"),
                        "local_time": f"{entry.get('Tanggal')} {entry.get('Jam')}",
                        "potential": entry.get("Potensi"),
                        "felt": entry.get("Dirasakan"),
                        **lineage,
                    },
                }
            )

    add_entries(_gempa_entries(latest), "latest", _lineage(latest))
    add_entries(_gempa_entries(recent), "strong", _lineage(recent))
    add_entries(_gempa_entries(felt), "felt", _lineage(felt))

    ingested = [
        (latest.get("_provenance") or {}).get("ingested_at"),
        (recent.get("_provenance") or {}).get("ingested_at"),
        (felt.get("_provenance") or {}).get("ingested_at"),
    ]
    ingested_at = next((t for t in ingested if t), None)

    return {
        "type": "FeatureCollection",
        "features": features,
        "provenance": {
            "data_provider": "BMKG",
            "official": True,
            "ingested_at": ingested_at,
            "source_layers": ["earthquake_latest", "earthquake_recent", "earthquake_felt"],
        },
    }
