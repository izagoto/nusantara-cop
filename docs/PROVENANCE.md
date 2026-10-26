# Provenance & kepercayaan data (government readiness)

## Prinsip

1. **Layer resmi** — Hanya data BMKG dengan `official: true` yang boleh dipakai untuk keputusan operasional cuaca/gempa.
2. **Fetch langsung** — Backend memanggil URL BMKG; tidak ada mock atau seed file.
3. **Jejak ingest** — Setiap refresh scheduler menulis `fetched_at` (UTC ISO) ke cache dan API.

## API

| Endpoint | Isi provenance |
|----------|----------------|
| `GET /api/v1/provenance` | Katalog layer resmi + support + waktu ingest terakhir |
| `GET /api/v1/nowcast/geojson` | `provenance` + per-feature: `cap_identifier`, `source_url`, `ingested_at` |
| `GET /api/v1/earthquake/geojson` | `provenance` + per-point: `source_url`, `ingested_at`, `official` |
| `GET /api/v1/weather/adm4/{kode}` | `provenance` dengan `adm4` dan `fetched_at` |

## Layer non-resmi (UI)

- **OpenFreeMap / Esri** — basemap (Analitik, Satelit, Pemukiman)
- **Koroplet analitik** — agregat internal dari telemetri BMKG, bukan produk resmi BMKG

Basemap dan agregat internal harus tidak disamakan dengan peringatan operasional resmi.

## Langkah berikutnya menuju produksi pemerintah

- Persist provenance ke DB (audit trail immutable)
- Export PDF briefing dengan footer sumber + timestamp
- MOU integrasi BMKG/BNPB
- Pentest, SSO, on-prem basemap Indonesia
