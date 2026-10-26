import re
import xml.etree.ElementTree as ET
from typing import Any

CAP_NS = {"cap": "urn:oasis:names:tc:emergency:cap:1.2"}


def _cap_polygons_to_geojson(polygons: list[str]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for idx, poly_text in enumerate(polygons):
        ring: list[list[float]] = []
        for pair in poly_text.strip().split():
            lat_str, lon_str = pair.split(",", 1)
            ring.append([float(lon_str), float(lat_str)])
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "properties": {"part": idx},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def parse_cap_alert(xml_text: str) -> dict[str, Any]:
    root = ET.fromstring(xml_text)
    info = root.find("cap:info", CAP_NS)
    if info is None:
        raise ValueError("CAP document missing info element")

    def text(tag: str) -> str | None:
        el = info.find(f"cap:{tag}", CAP_NS)
        return el.text.strip() if el is not None and el.text else None

    polygons: list[str] = []
    area_desc: list[str] = []
    for area in info.findall("cap:area", CAP_NS):
        desc_el = area.find("cap:areaDesc", CAP_NS)
        if desc_el is not None and desc_el.text:
            area_desc.append(desc_el.text.strip())
        for poly_el in area.findall("cap:polygon", CAP_NS):
            if poly_el.text:
                polygons.append(poly_el.text.strip())

    identifier_el = root.find("cap:identifier", CAP_NS)
    sent_el = root.find("cap:sent", CAP_NS)

    return {
        "identifier": identifier_el.text if identifier_el is not None else None,
        "sent": sent_el.text if sent_el is not None else None,
        "headline": text("headline"),
        "event": text("event"),
        "description": text("description"),
        "urgency": text("urgency"),
        "severity": text("severity"),
        "certainty": text("certainty"),
        "effective": text("effective"),
        "expires": text("expires"),
        "area_desc": area_desc,
        "polygons_geojson": _cap_polygons_to_geojson(polygons) if polygons else None,
    }


def alert_code_from_link(link: str) -> str | None:
    match = re.search(r"/([A-Z0-9]+)_alert\.xml", link)
    return match.group(1) if match else None
