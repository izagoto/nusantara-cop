#!/usr/bin/env python3
"""Bangun backend/app/data/wilayah_index.json dari CSV administratif terbuka."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import UTC, datetime
from pathlib import Path

ADM4_FULL = re.compile(r"^\d{2}\.\d{2}\.\d{2}\.\d{4}$")


def _parse_float(value: str) -> float:
    return float(value.strip())


def _parse_aliases(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    return [part.strip() for part in raw.split("|") if part.strip()]


def build_entries(rows: list[dict[str, str]]) -> list[dict]:
    entries: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        adm4 = (row.get("adm4") or "").strip()
        name = (row.get("name") or "").strip()
        if not adm4 or not name:
            continue
        if not ADM4_FULL.match(adm4):
            continue
        if adm4 in seen:
            continue
        try:
            lon = _parse_float(row["lon"])
            lat = _parse_float(row["lat"])
        except (KeyError, ValueError):
            continue
        kind = (row.get("kind") or "kelurahan").strip() or "kelurahan"
        entry: dict = {
            "kind": kind,
            "name": name,
            "label": name,
            "adm4": adm4,
            "center": [lon, lat],
        }
        aliases = _parse_aliases(row.get("aliases"))
        if aliases:
            entry["aliases"] = aliases
        province = (row.get("province") or "").strip()
        if province:
            entry["province"] = province
        entries.append(entry)
        seen.add(adm4)
    entries.sort(key=lambda item: item["adm4"])
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Bangun wilayah_index.json untuk COP Fase 2")
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        required=True,
        help="CSV dengan kolom adm4,name,lon,lat (+ opsional kind,aliases,province)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("backend/app/data/wilayah_index.json"),
        help="Path keluaran JSON",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input tidak ditemukan: {args.input}")

    with args.input.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fieldnames = {f.lower().strip() for f in (reader.fieldnames or [])}
        required = {"adm4", "name", "lon", "lat"}
        if not required.issubset(fieldnames):
            raise SystemExit(f"CSV wajib kolom: {sorted(required)} — dapat: {sorted(fieldnames)}")
        rows = [{k.lower().strip(): v for k, v in row.items()} for row in reader]

    entries = build_entries(rows)
    if not entries:
        raise SystemExit("Tidak ada baris adm4 valid.")

    payload = {
        "version": 2,
        "generated_at": datetime.now(UTC).isoformat(),
        "source": str(args.input.resolve()),
        "entry_count": len(entries),
        "entries": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(entries)} entri → {args.output}")


if __name__ == "__main__":
    main()
