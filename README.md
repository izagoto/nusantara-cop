# Indonesia COP

Repositori: **`nusantara-cop`**

**Deskripsi (GitHub):** Common Operational Picture untuk Nusantara — agregator data terbuka BMKG (CAP nowcast, gempa TEWS, cuaca adm4) dengan peta MapLibre. Produk independen, bukan layanan resmi BMKG.

---

**COP** = *Common Operational Picture* (peta situasi operasional bersama) — dipakai dalam penanggulangan bencana dan ruang situasi agar semua pihak melihat data yang sama.

Agregator **kesadaran situasi** berbasis **data terbuka BMKG** untuk seluruh Nusantara: peringatan dini cuaca (CAP + polygon nowcast), gempa TEWS, prakiraan cuaca **adm4** saat diminta, dan koroplet agregat risiko provinsi.

Dashboard peta (MapLibre GL, proyeksi globe) fokus pada telemetri BMKG — bukan replika portal nowcasting BMKG.

> **Pernyataan:** *Indonesia COP* adalah agregator independen. **Bukan** layanan resmi BMKG, BNPB, atau instansi pemerintah. Peringatan operasional mengacu pada sumber BMKG; koroplet analitik adalah agregat internal. Wajib menampilkan atribusi BMKG saat deploy.

## Fitur antarmuka (MVP)

| Area | Isi |
|------|-----|
| Peta | Basemap **Analitik** (koroplet), **Satelit**, **Pemukiman**; terrain dan bangunan 3D pada zoom pemukiman |
| Layer | Aktif/nonaktif CAP (polygon) dan gempa TEWS (M5+ & dirasakan) |
| Panel | Cari wilayah adm4, ringkasan intel nasional, tabel CAP aktif |
| Footer | Koordinat, lokasi, zoom, atribusi BMKG |

Jejak data lengkap: `GET /api/v1/provenance` dan [docs/PROVENANCE.md](docs/PROVENANCE.md) (tanpa panel provenance terpisah di UI).

## Mulai cepat (lokal)

**1. Environment**

```bash
cp .env.example .env
# Opsional: FIRMS_MAP_KEY untuk layer pendukung API (tidak ditampilkan di UI COP)
```

**2. Backend** (port 8080)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

**3. Frontend** (port 5173, proxy ke backend)

```bash
cd frontend
npm install
npm run dev
```

Buka http://127.0.0.1:5173 — backend harus sudah berjalan.

## Docker (semua layanan)

```bash
cp .env.example .env
docker compose up --build
```

UI produksi: http://localhost:3000

## API utama

| Endpoint | Deskripsi |
|----------|-----------|
| `GET /api/v1/health` | Status cache & scheduler |
| `GET /api/v1/national/summary` | Ringkasan nasional |
| `GET /api/v1/nowcast/active` | Peringatan cuaca aktif + metadata CAP |
| `GET /api/v1/nowcast/geojson` | Polygon nowcast untuk peta |
| `GET /api/v1/earthquake/latest` | Gempa terbaru |
| `GET /api/v1/earthquake/recent` | 15 gempa M5+ |
| `GET /api/v1/earthquake/felt` | 15 gempa dirasakan |
| `GET /api/v1/weather/adm4/{kode}` | Prakiraan 3 hari per kelurahan |
| `GET /api/v1/wilayah/search?q=` | Cari provinsi/kota/adm4 (preset MVP) |
| `GET /api/v1/viz/analytics/geojson` | Koroplet provinsi + grid telemetri |
| `GET /api/v1/provenance` | Katalog sumber & waktu ingest |

Layer pendukung (opsional, hanya API): `GET /api/v1/support/firms/geojson`, `GET /api/v1/support/usgs/earthquake/geojson` — lihat [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

Contoh:

```bash
curl -s http://127.0.0.1:8080/api/v1/national/summary | jq .
curl -s http://127.0.0.1:8080/api/v1/nowcast/geojson | jq '.active_count, (.features | length)'
```

## Dokumentasi

- [docs/NASIONAL.md](docs/NASIONAL.md) — strategi cakupan nasional & adm4
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — sumber data & kunci API
- [docs/PROVENANCE.md](docs/PROVENANCE.md) — jejak data & atribusi

## Struktur repositori

```text
backend/          FastAPI, scheduler BMKG, GeoJSON/analitik
frontend/         Vite + MapLibre (src/, index.html)
docs/             Spesifikasi produk & data
docker-compose.yml
```

Artefak build (`frontend/dist/`, `node_modules/`, `.venv/`) tidak perlu di-commit — lihat `.gitignore`.

## Sebelum repo public

- Jangan commit file `.env` (termasuk `FIRMS_MAP_KEY`).
- Pastikan `.env` tidak pernah masuk riwayat git; rotasi kunci FIRMS jika pernah ter-push.

## Nama produk & atribusi

- **Indonesia COP** — singkatan COP dijelaskan di UI sebagai *Common Operational Picture*.
- Wajib menampilkan **BMKG** sebagai sumber data operasional (footer + tautan `data.bmkg.go.id`).
- Respons API relevan memuat objek `attribution` (lihat `GET /api/v1/provenance`).

## Roadmap

1. ~~Backend BMKG + GeoJSON nowcast & gempa~~  
2. ~~Frontend MapLibre COP (CAP, TEWS, analitik)~~  
3. **Fase 2** — Indeks wilayah nasional + antrian refresh cuaca adm4 berprioritas  
