import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ADM4_PATTERN = re.compile(r"^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$")


def _normalize(text: str) -> str:
    t = text.lower().strip()
    for prefix in ("provinsi ", "prop. ", "prop ", "kota ", "kab. ", "kabupaten ", "daerah "):
        if t.startswith(prefix):
            t = t[len(prefix) :].strip()
    return t


@lru_cache(maxsize=1)
def _load_entries() -> list[dict[str, Any]]:
    path = Path(__file__).resolve().parent / "data" / "wilayah_presets.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries: list[dict[str, Any]] = []
    for raw in payload.get("entries", []):
        names = {_normalize(raw["name"])}
        for alias in raw.get("aliases") or []:
            names.add(_normalize(alias))
        entries.append(
            {
                **raw,
                "search_names": sorted(names),
                "label": raw.get("label") or raw["name"],
            }
        )
    return entries


def _score_entry(query_norm: str, entry: dict[str, Any]) -> int:
    best = 0
    for name in entry["search_names"]:
        if name == query_norm:
            best = max(best, 100)
        elif name.startswith(query_norm):
            best = max(best, 80)
        elif query_norm in name:
            best = max(best, 60)
    adm4 = entry.get("adm4") or ""
    if adm4 and adm4.startswith(query_norm):
        best = max(best, 90)
    return best


def search_wilayah(query: str, *, limit: int = 10) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []

    results: list[tuple[int, dict[str, Any]]] = []
    q_norm = _normalize(q)

    if ADM4_PATTERN.match(q):
        results.append(
            (
                110,
                {
                    "kind": "adm4",
                    "name": q,
                    "label": f"Kode adm4 · {q}",
                    "adm4": q,
                    "center": None,
                },
            )
        )

    for entry in _load_entries():
        score = _score_entry(q_norm, entry)
        if score > 0:
            results.append((score, entry))

    results.sort(key=lambda item: (-item[0], item[1].get("name", "")))
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for _score, entry in results:
        key = entry.get("adm4") or entry.get("name")
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "kind": entry.get("kind"),
                "name": entry.get("name"),
                "label": entry.get("label") or entry.get("name"),
                "adm4": entry.get("adm4"),
                "center": entry.get("center"),
            }
        )
        if len(out) >= limit:
            break
    return out


def match_province_label(label: str) -> dict[str, Any] | None:
    if not label:
        return None
    norm = _normalize(label)
    best: tuple[int, dict[str, Any]] | None = None
    for entry in _load_entries():
        if entry.get("kind") != "province":
            continue
        for name in entry["search_names"]:
            score = 0
            if name == norm:
                score = 100
            elif norm in name or name in norm:
                score = 70
            if score and (best is None or score > best[0]):
                best = (score, entry)
    if not best:
        return None
    entry = best[1]
    return {
        "kind": entry.get("kind"),
        "name": entry.get("name"),
        "label": entry.get("label") or entry.get("name"),
        "adm4": entry.get("adm4"),
        "center": entry.get("center"),
    }
