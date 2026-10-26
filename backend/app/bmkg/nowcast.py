import asyncio
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from app.bmkg.cap import alert_code_from_link, parse_cap_alert
from app.config import BMKG_NOWCAST_CAP_BASE, BMKG_NOWCAST_RSS, NOWCAST_CAP_CONCURRENCY


def _parse_nowcast_rss(xml_text: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    items: list[dict[str, Any]] = []
    for item in root.findall(".//item"):
        title = item.findtext("title")
        link = item.findtext("link")
        description = item.findtext("description")
        pub_date = item.findtext("pubDate")
        guid = item.findtext("guid")
        code = alert_code_from_link(link or "") if link else None
        items.append(
            {
                "title": title,
                "link": link,
                "description": description,
                "pub_date": pub_date,
                "guid": guid,
                "alert_code": code,
            }
        )
    return items


async def _fetch_cap(client: httpx.AsyncClient, alert_code: str) -> dict[str, Any]:
    url = f"{BMKG_NOWCAST_CAP_BASE}/{alert_code}_alert.xml"
    response = await client.get(url)
    response.raise_for_status()
    return parse_cap_alert(response.text)


async def fetch_nowcast_national(
    client: httpx.AsyncClient,
    *,
    enrich_cap: bool = True,
) -> dict[str, Any]:
    response = await client.get(BMKG_NOWCAST_RSS)
    response.raise_for_status()
    alerts = _parse_nowcast_rss(response.text)

    if enrich_cap and alerts:
        sem = asyncio.Semaphore(NOWCAST_CAP_CONCURRENCY)

        async def enrich(alert: dict[str, Any]) -> dict[str, Any]:
            code = alert.get("alert_code")
            if not code:
                return alert
            async with sem:
                try:
                    cap = await _fetch_cap(client, code)
                except httpx.HTTPError:
                    alert["cap_error"] = True
                    return alert
            alert["cap"] = cap
            return alert

        alerts = list(await asyncio.gather(*(enrich(a) for a in alerts)))

    provinces = sorted(
        {
            (a.get("cap") or {}).get("area_desc", [None])[0]
            or (a.get("title") or "").split(" di ")[-1]
            for a in alerts
        }
    )

    return {
        "active_count": len(alerts),
        "provinces_with_alerts": [p for p in provinces if p],
        "alerts": alerts,
    }
